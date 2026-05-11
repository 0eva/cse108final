import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { get, run } from '../db.js';
import { requireAuth } from '../middleware.js';

const router = express.Router();
const signToken = user => jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET || 'dev_secret', { expiresIn: '7d' });

router.post('/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const existing = await get('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) return res.status(409).json({ error: 'Username already exists' });
    const passwordHash = await bcrypt.hash(password, 12);
    const created = await run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);
    const user = { id: created.id, username, chips: 1000 };
    res.json({ token: signToken(user), user });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = await get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password' });
  res.json({ token: signToken(user), user: { id: user.id, username: user.username, chips: user.chips } });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

export default router;
