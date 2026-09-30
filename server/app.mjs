import express from 'express';
import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import multer from 'multer';
import { z, ZodError } from 'zod';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.mjs';
import { openDatabase, transaction } from './db.mjs';
import { todayInZone, validatePeriod } from './period.mjs';
import {
  check,
  digest,
  hashPassword,
  HttpError,
  newId,
  newToken,
  publicUser,
  verifyPassword,
} from './security.mjs';

const credentials = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.-]{3,64}$/),
  password: z.string().min(12).max(128),
});
const date = z.iso.date();
const applicationInput = z.object({
  seatId: z.string().min(1).max(32),
  startDate: date,
  endDate: date,
  termId: z.string().max(40).nullable().optional(),
  purpose: z.string().trim().min(20).max(3000),
  outcome: z.string().trim().min(10).max(2000),
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 3, fileSize: 5 * 1024 * 1024, fields: 1, fieldSize: 20000, parts: 4 },
}).array('files', 3);
const stamp = () => new Date().toISOString();
const maxSessionAge = 8 * 60 * 60 * 1000;

export async function createApp(options = {}) {
  const config = options.config ?? loadConfig();
  const db = options.db ?? openDatabase(options.dataDir);
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const origin = options.origin ?? process.env.PUBLIC_ORIGIN ?? 'http://localhost:4312';
  check(!production || origin.startsWith('https://'), 500, '生产环境必须设置 HTTPS PUBLIC_ORIGIN');
  const seatMap = new Map(
    config.rooms.flatMap((room) =>
      room.seats.map((seat) => [seat.id, { ...seat, roomId: room.id }]),
    ),
  );
  const app = express();
  app.disable('x-powered-by');
  if (production) app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
        },
      },
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.use('/api', express.json({ limit: '24kb' }));
  app.use('/api', (req, _res, next) => {
    try {
      const raw = req.headers.cookie
        ?.split(';')
        .map((v) => v.trim())
        .find((v) => v.startsWith('ows_session='))
        ?.slice(12);
      if (raw && /^[a-f0-9]{64}$/.test(raw)) {
        const session = db
          .prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?')
          .get(digest(raw), Date.now());
        const user =
          session &&
          db.prepare('SELECT * FROM users WHERE id=? AND disabled=0').get(session.user_id);
        if (user) req.auth = { session, user };
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const allowedOrigins = production
          ? [origin]
          : [origin, 'http://localhost:5173', 'http://127.0.0.1:5173'];
        check(
          !req.headers.origin || allowedOrigins.includes(req.headers.origin),
          403,
          '请求来源不受信任',
        );
        check(req.headers['x-requested-with'] === 'open-workstations', 403, '缺少请求校验标识');
        if (req.auth)
          check(
            req.headers['x-csrf-token'] === req.auth.session.csrf,
            403,
            '安全令牌已失效，请刷新页面',
          );
      }
      next();
    } catch (error) {
      next(error);
    }
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: options.test ? 1000 : 25,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  const applyLimit = rateLimit({
    windowMs: 60 * 60_000,
    limit: options.test ? 1000 : 12,
    keyGenerator: (req) => req.auth?.user.id ?? ipKeyGenerator(req.ip),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  function requireUser(req, _res, next) {
    try {
      check(req.auth?.user, 401, '请先登录');
      next();
    } catch (error) {
      next(error);
    }
  }
  function requireManager(req, _res, next) {
    try {
      check(req.auth?.user?.role === 'manager', 403, '需要管理员权限');
      next();
    } catch (error) {
      next(error);
    }
  }
  function sessionFor(user, res) {
    const token = newToken();
    const csrf = newToken();
    db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
    db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)').run(
      digest(token),
      user.id,
      csrf,
      Date.now() + maxSessionAge,
    );
    res.cookie('ows_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: production,
      maxAge: maxSessionAge,
      path: '/',
    });
    return { user: publicUser(user), csrf };
  }
  function event(applicationId, actorId, action, note) {
    db.prepare(
      'INSERT INTO events(id,application_id,actor_id,action,note,created_at) VALUES(?,?,?,?,?,?)',
    ).run(newId(), applicationId, actorId, action, note, stamp());
  }
  function expire() {
    const ended = db
      .prepare("SELECT id FROM applications WHERE status='approved' AND end_date<?")
      .all(todayInZone(config.timeZone));
    if (ended.length)
      transaction(db, () => {
        for (const row of ended) {
          db.prepare(
            "UPDATE applications SET status='expired',version=version+1,updated_at=? WHERE id=? AND status='approved'",
          ).run(stamp(), row.id);
          event(row.id, null, 'expired', '使用期限结束；继续使用请重新申请');
        }
      });
  }
  function findApplication(req, id) {
    const row = db
      .prepare(
        'SELECT a.*,u.name AS applicant_name FROM applications a JOIN users u ON a.user_id=u.id WHERE a.id=?',
      )
      .get(id);
    check(
      row && (req.auth.user.role === 'manager' || row.user_id === req.auth.user.id),
      404,
      '申请不存在',
    );
    return row;
  }
  function detail(row) {
    const attachments = db
      .prepare('SELECT id,filename,size FROM attachments WHERE application_id=? ORDER BY rowid')
      .all(row.id);
    const events = db
      .prepare(
        'SELECT action,note,created_at FROM events WHERE application_id=? ORDER BY created_at,rowid',
      )
      .all(row.id);
    return { ...row, attachments, events };
  }

  app.get('/api/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });
  app.get('/api/site', (_req, res) => {
    expire();
    const today = todayInZone(config.timeZone);
    const pending = db
      .prepare(
        "SELECT seat_id,count(*) AS count FROM applications WHERE status='pending' GROUP BY seat_id",
      )
      .all();
    const occupied = db
      .prepare(
        "SELECT seat_id FROM applications WHERE status='approved' AND start_date<=? AND end_date>=?",
      )
      .all(today, today);
    const counts = new Map(pending.map((row) => [row.seat_id, row.count]));
    const used = new Set(occupied.map((row) => row.seat_id));
    res.json({
      ...config,
      today,
      rooms: config.rooms.map((room) => ({
        ...room,
        seats: room.seats.map((seat) => ({
          ...seat,
          pendingCount: counts.get(seat.id) ?? 0,
          occupied: used.has(seat.id),
        })),
      })),
    });
  });
  app.get('/api/session', (req, res) =>
    res.json({
      user: req.auth ? publicUser(req.auth.user) : null,
      csrf: req.auth?.session.csrf ?? '',
    }),
  );
  app.post('/api/auth/register', authLimit, async (req, res) => {
    check(config.registrationOpen, 403, '注册暂未开放');
    const input = credentials.extend({ name: z.string().trim().min(2).max(60) }).parse(req.body);
    check(
      !db.prepare('SELECT 1 FROM users WHERE username=?').get(input.username),
      409,
      '用户名已被使用',
    );
    const password = await hashPassword(input.password);
    const user = { id: newId(), ...input, password, role: 'applicant' };
    try {
      db.prepare(
        'INSERT INTO users(id,username,name,password,role,created_at) VALUES(?,?,?,?,?,?)',
      ).run(user.id, user.username, user.name, user.password, user.role, stamp());
    } catch (error) {
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) throw new HttpError(409, '用户名已被使用');
      throw error;
    }
    res.status(201).json(sessionFor(user, res));
  });
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const input = credentials.parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(input.username);
    check(
      user && !user.disabled && (await verifyPassword(input.password, user.password)),
      401,
      '账号或密码不正确',
    );
    res.json(sessionFor(user, res));
  });
  app.post('/api/auth/logout', (req, res) => {
    if (req.auth)
      db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.auth.session.token_hash);
    res.clearCookie('ows_session', { path: '/', sameSite: 'strict', secure: production });
    res.json({ ok: true });
  });
  app.get('/api/applications', requireUser, (req, res) => {
    expire();
    const rows =
      req.auth.user.role === 'manager'
        ? db
            .prepare(
              'SELECT a.*,u.name AS applicant_name FROM applications a JOIN users u ON a.user_id=u.id ORDER BY a.created_at DESC LIMIT 200',
            )
            .all()
        : db
            .prepare(
              'SELECT * FROM applications WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
            )
            .all(req.auth.user.id);
    res.json(rows);
  });
  app.get('/api/applications/:id', requireUser, (req, res) =>
    res.json(detail(findApplication(req, req.params.id))),
  );
  app.post('/api/applications', requireUser, applyLimit, upload, (req, res) => {
    check(req.auth.user.role === 'applicant', 403, '只有申请人可以提交申请');
    check(config.applicationOpen, 403, '申请窗口暂未开放');
    let raw;
    try {
      raw = JSON.parse(req.body.payload);
    } catch {
      throw new HttpError(400, '申请内容格式不正确');
    }
    const input = applicationInput.parse(raw);
    const seat = seatMap.get(input.seatId);
    check(seat, 404, '工位不存在');
    validatePeriod(
      config,
      seat.type,
      input.startDate,
      input.endDate,
      input.termId,
      todayInZone(config.timeZone),
    );
    check(
      !db
        .prepare(
          "SELECT 1 FROM applications WHERE user_id=? AND status IN ('pending','approved') AND start_date<=? AND end_date>=?",
        )
        .get(req.auth.user.id, input.endDate, input.startDate),
      409,
      '你在这段时间已有待审核或获批申请',
    );
    const files = req.files ?? [];
    check(
      files.every((file) => file.originalname.length <= 150 && file.size > 0),
      400,
      '材料文件名过长或文件为空',
    );
    const id = newId();
    transaction(db, () => {
      db.prepare(
        `INSERT INTO applications(id,user_id,seat_id,seat_type,start_date,end_date,term_id,purpose,outcome,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?)`,
      ).run(
        id,
        req.auth.user.id,
        seat.id,
        seat.type,
        input.startDate,
        input.endDate,
        input.termId ?? null,
        input.purpose,
        input.outcome,
        stamp(),
        stamp(),
      );
      for (const file of files)
        db.prepare(
          'INSERT INTO attachments(id,application_id,filename,mime,size,content) VALUES(?,?,?,?,?,?)',
        ).run(newId(), id, file.originalname, 'application/octet-stream', file.size, file.buffer);
      event(id, req.auth.user.id, 'submitted', '提交申请');
    });
    res.status(201).json({ id, status: 'pending' });
  });
  app.get('/api/attachments/:id', requireUser, (req, res) => {
    const file = db.prepare('SELECT * FROM attachments WHERE id=?').get(req.params.id);
    check(file, 404, '文件不存在');
    findApplication(req, file.application_id);
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(file.content));
  });
  app.post('/api/applications/:id/withdraw', requireUser, (req, res) => {
    transaction(db, () => {
      const row = findApplication(req, req.params.id);
      check(
        row.user_id === req.auth.user.id && row.status === 'pending',
        409,
        '只能撤回自己的待审核申请',
      );
      db.prepare(
        "UPDATE applications SET status='withdrawn',version=version+1,updated_at=? WHERE id=?",
      ).run(stamp(), row.id);
      event(row.id, req.auth.user.id, 'withdrawn', '申请人撤回申请');
    });
    res.json({ ok: true });
  });
  app.post('/api/admin/applications/:id/decision', requireManager, (req, res) => {
    const input = z
      .object({
        decision: z.enum(['approved', 'rejected']),
        note: z.string().trim().min(3).max(1000),
        version: z.number().int().positive(),
      })
      .parse(req.body);
    transaction(db, () => {
      const row = findApplication(req, req.params.id);
      check(
        row.status === 'pending' && row.version === input.version,
        409,
        '申请状态已变化，请刷新后重试',
      );
      check(
        row.start_date >= todayInZone(config.timeZone),
        409,
        '申请开始日期已过，请申请人重新提交',
      );
      if (input.decision === 'approved') {
        check(
          !db
            .prepare(
              "SELECT 1 FROM applications WHERE seat_id=? AND status='approved' AND start_date<=? AND end_date>=? LIMIT 1",
            )
            .get(row.seat_id, row.end_date, row.start_date),
          409,
          '这段时间的工位已分配给其他申请人',
        );
        check(
          !db
            .prepare(
              "SELECT 1 FROM applications WHERE user_id=? AND id<>? AND status='approved' AND start_date<=? AND end_date>=? LIMIT 1",
            )
            .get(row.user_id, row.id, row.end_date, row.start_date),
          409,
          '申请人在这段时间已有获批工位',
        );
      }
      db.prepare(
        'UPDATE applications SET status=?,decision_note=?,reviewer_id=?,version=version+1,updated_at=? WHERE id=?',
      ).run(input.decision, input.note, req.auth.user.id, stamp(), row.id);
      event(row.id, req.auth.user.id, input.decision, input.note);
    });
    res.json({ ok: true });
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, '接口不存在')));
  const dist = resolve('dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false }));
    app.get('{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  app.use((error, _req, res, _next) => {
    const status =
      error instanceof ZodError ||
      error instanceof SyntaxError ||
      error instanceof multer.MulterError
        ? 400
        : (error.status ?? 500);
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500 ? '服务器处理失败' : error.message });
  });
  return { app, db, config };
}
