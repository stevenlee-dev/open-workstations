import { openDatabase } from '../server/db.mjs';
import { hashPassword, newId } from '../server/security.mjs';

const [username, name] = process.argv.slice(2);
if (!username || !name || !/^[a-zA-Z0-9_.-]{3,64}$/.test(username)) {
  console.error('用法：npm run admin:create -- <用户名> <显示名称>');
  process.exitCode = 1;
} else {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    console.error('先设置至少 12 位的 ADMIN_PASSWORD 环境变量；命令行参数和文档中不要写密码。');
    process.exitCode = 1;
  } else {
    const db = openDatabase();
    if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username.toLowerCase()))
      throw new Error('用户名已存在');
    db.prepare(
      'INSERT INTO users(id,username,name,password,role,created_at) VALUES (?,?,?,?,?,?)',
    ).run(
      newId(),
      username.toLowerCase(),
      name,
      await hashPassword(password),
      'manager',
      new Date().toISOString(),
    );
    db.close();
    console.log('管理员已创建；请清除当前终端的 ADMIN_PASSWORD 环境变量。');
  }
}
