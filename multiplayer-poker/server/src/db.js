import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '..', 'poker.sqlite');

sqlite3.verbose();
export const db = new sqlite3.Database(dbPath);

export function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

export function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

export async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    chips INTEGER NOT NULL DEFAULT 1000,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'WAITING',
    pot INTEGER NOT NULL DEFAULT 0,
    deck_json TEXT NOT NULL DEFAULT '[]',
    community_cards_json TEXT NOT NULL DEFAULT '[]',
    current_turn_user_id INTEGER,
    dealer_user_id INTEGER,
    current_bet INTEGER NOT NULL DEFAULT 0,
    round TEXT NOT NULL DEFAULT 'LOBBY',
    winner_user_id INTEGER,
    bot_level TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS game_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    seat INTEGER NOT NULL,
    chips_in_game INTEGER NOT NULL DEFAULT 1000,
    current_bet INTEGER NOT NULL DEFAULT 0,
    folded INTEGER NOT NULL DEFAULT 0,
    all_in INTEGER NOT NULL DEFAULT 0,
    hand_cards_json TEXT NOT NULL DEFAULT '[]',
    bot_level TEXT,
    UNIQUE(game_id, user_id),
    UNIQUE(game_id, seat),
    FOREIGN KEY(game_id) REFERENCES games(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  await run(`ALTER TABLE games ADD COLUMN bot_level TEXT`).catch(() => {});
  await run(`ALTER TABLE game_players ADD COLUMN bot_level TEXT`).catch(() => {});

  await run(`CREATE TABLE IF NOT EXISTS game_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    user_id INTEGER,
    action_type TEXT NOT NULL,
    amount INTEGER DEFAULT 0,
    message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(game_id) REFERENCES games(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS game_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(game_id) REFERENCES games(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
}
