import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function openDatabase(dataDir = process.env.DATA_DIR ?? '.data') {
  const directory = resolve(dataDir);
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'workstations.db'));
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('applicant','manager')),
      disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      seat_id TEXT NOT NULL, seat_type TEXT NOT NULL,
      start_date TEXT NOT NULL, end_date TEXT NOT NULL, term_id TEXT,
      purpose TEXT NOT NULL, outcome TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','withdrawn','expired')),
      version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      reviewer_id TEXT REFERENCES users(id), decision_note TEXT
    );
    CREATE INDEX IF NOT EXISTS applications_seat_period ON applications(seat_id,status,start_date,end_date);
    CREATE INDEX IF NOT EXISTS applications_user ON applications(user_id,created_at);
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, content BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(id),
      actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  return db;
}

export function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
