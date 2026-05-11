import express from 'express';
import { requireAuth } from '../middleware.js';
import { all, get, run } from '../db.js';

const router = express.Router();
const code = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const BOT_LEVELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

async function ensureBotUser(level) {
  const username = `Bot ${BOT_LEVELS[level]}`;
  const existing = await get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return existing.id;
  const created = await run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, 'BOT']);
  return created.id;
}

async function addPlayer(gameId, userId, botLevel = null) {
  const count = await get('SELECT COUNT(*) as n FROM game_players WHERE game_id = ?', [gameId]);
  if (count.n >= 6) throw new Error('Table is full');
  const existing = await get('SELECT * FROM game_players WHERE game_id = ? AND user_id = ?', [gameId, userId]);
  if (existing) return existing;
  await run('INSERT INTO game_players (game_id, user_id, seat, bot_level) VALUES (?, ?, ?, ?)', [gameId, userId, count.n + 1, botLevel]);
  return get('SELECT * FROM game_players WHERE game_id = ? AND user_id = ?', [gameId, userId]);
}

router.post('/create', requireAuth, async (req, res) => {
  const roomCode = code();
  const created = await run('INSERT INTO games (room_code, dealer_user_id) VALUES (?, ?)', [roomCode, req.user.id]);
  await addPlayer(created.id, req.user.id);
  res.json({ gameId: created.id, roomCode });
});

router.post('/create-bot', requireAuth, async (req, res) => {
  const level = String(req.body.level || 'easy').toLowerCase();
  if (!BOT_LEVELS[level]) return res.status(400).json({ error: 'Invalid bot level' });
  const roomCode = code();
  const botUserId = await ensureBotUser(level);
  const created = await run('INSERT INTO games (room_code, dealer_user_id, bot_level) VALUES (?, ?, ?)', [roomCode, req.user.id, level]);
  await addPlayer(created.id, req.user.id);
  await addPlayer(created.id, botUserId, level);
  res.json({ gameId: created.id, roomCode });
});

router.post('/join', requireAuth, async (req, res) => {
  const roomCode = String(req.body.roomCode || '').trim().toUpperCase();
  const game = await get('SELECT * FROM games WHERE room_code = ?', [roomCode]);
  if (!game) return res.status(404).json({ error: 'Room not found' });
  if (game.status !== 'WAITING') return res.status(400).json({ error: 'Game already started' });
  try {
    await addPlayer(game.id, req.user.id);
    res.json({ gameId: game.id, roomCode });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:roomCode', requireAuth, async (req, res) => {
  const game = await get('SELECT * FROM games WHERE room_code = ?', [req.params.roomCode.toUpperCase()]);
  if (!game) return res.status(404).json({ error: 'Room not found' });
  const players = await all(`SELECT gp.*, u.username FROM game_players gp JOIN users u ON u.id = gp.user_id WHERE gp.game_id = ? ORDER BY gp.seat`, [game.id]);
  res.json({ game, players });
});

router.get('/', requireAuth, async (_req, res) => {
  const games = await all(`SELECT g.room_code, g.status, g.created_at, g.bot_level, COUNT(gp.id) as players
    FROM games g LEFT JOIN game_players gp ON gp.game_id = g.id
    GROUP BY g.id ORDER BY g.created_at DESC LIMIT 20`);
  res.json({ games });
});

export default router;
