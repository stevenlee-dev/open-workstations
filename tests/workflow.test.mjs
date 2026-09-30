import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { createApp } from '../server/app.mjs';
import { loadConfig } from '../server/config.mjs';
import { hashPassword, newId } from '../server/security.mjs';
import { todayInZone } from '../server/period.mjs';

test('多人可以申请同一工位，批准时阻止重叠分配', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'open-workstations-'));
  const config = loadConfig();
  const { app, db } = await createApp({ dataDir, config, test: true });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const today = todayInZone(config.timeZone);
  try {
    const managerId = newId();
    db.prepare(
      'INSERT INTO users(id,username,name,password,role,created_at) VALUES(?,?,?,?,?,?)',
    ).run(
      managerId,
      'reviewer',
      '审核员',
      await hashPassword('managerPassword123'),
      'manager',
      new Date().toISOString(),
    );
    const json = async (path, method = 'GET', body, auth) => {
      const headers = {
        'X-Requested-With': 'open-workstations',
        ...(method !== 'GET' ? { Origin: 'http://127.0.0.1:4312' } : {}),
        ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}),
      };
      if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
      const response = await fetch(base + path, {
        method,
        headers,
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      });
      return {
        status: response.status,
        data: await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0],
      };
    };
    const register = async (name) => {
      const result = await json('/api/auth/register', 'POST', {
        username: name,
        name,
        password: 'applicantPassword123',
      });
      assert.equal(result.status, 201);
      return { cookie: result.cookie, csrf: result.data.csrf };
    };
    const a = await register('personone');
    const b = await register('persontwo');
    const form = () => {
      const body = new FormData();
      body.append(
        'payload',
        JSON.stringify({
          seatId: 'S-01',
          startDate: today,
          endDate: today,
          purpose: '这是用于集成测试的工位使用计划，日期为今天。',
          outcome: '完成一份可供审核的工作记录。',
        }),
      );
      return body;
    };
    const first = await json('/api/applications', 'POST', form(), a);
    const second = await json('/api/applications', 'POST', form(), b);
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const site = await json('/api/site');
    assert.equal(site.data.rooms[0].seats[0].pendingCount, 2);
    assert.equal(site.data.rooms[0].seats[0].occupied, false);
    const login = await json('/api/auth/login', 'POST', {
      username: 'reviewer',
      password: 'managerPassword123',
    });
    assert.equal(login.status, 200);
    const manager = { cookie: login.cookie, csrf: login.data.csrf };
    const approved = await json(
      `/api/admin/applications/${first.data.id}/decision`,
      'POST',
      { decision: 'approved', note: '材料齐全，同意使用。', version: 1 },
      manager,
    );
    assert.equal(approved.status, 200);
    const conflict = await json(
      `/api/admin/applications/${second.data.id}/decision`,
      'POST',
      { decision: 'approved', note: '尝试重复分配。', version: 1 },
      manager,
    );
    assert.equal(conflict.status, 409);
    const denied = await json(`/api/applications/${first.data.id}`, 'GET', null, b);
    assert.equal(denied.status, 404);
    const c = await register('personthree');
    const otherSeat = new FormData();
    otherSeat.append(
      'payload',
      JSON.stringify({
        seatId: 'S-02',
        startDate: today,
        endDate: today,
        termId: 'not-a-real-term',
        purpose: '这是第三位申请人的短期工位使用计划，需要完成完整记录。',
        outcome: '完成另外一份可以检查的成果报告。',
      }),
    );
    const third = await json('/api/applications', 'POST', otherSeat, c);
    assert.equal(third.status, 201);
    assert.equal(
      db.prepare('SELECT term_id FROM applications WHERE id=?').get(third.data.id).term_id,
      null,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    const relativeTarget = relative(realpathSync(tmpdir()), realpathSync(dataDir));
    assert.ok(
      relativeTarget &&
        !relativeTarget.startsWith('..') &&
        basename(dataDir).startsWith('open-workstations-'),
    );
    rmSync(dataDir, { recursive: true, force: true });
  }
});
