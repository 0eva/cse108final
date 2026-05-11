import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { initDb } from './db.js';
import authRoutes from './routes/auth.js';
import gameRoutes from './routes/games.js';
import { setupGameSocket } from './sockets/gameSocket.js';

const app = express();
const server = http.createServer(app);
const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const io = new Server(server, { cors: { origin, methods: ['GET', 'POST'] } });

app.use(cors({ origin }));
app.use(express.json());
app.use('/auth', authRoutes);
app.use('/games', gameRoutes);
app.get('/health', (_req, res) => res.json({ ok: true }));

setupGameSocket(io);
await initDb();

const port = process.env.PORT || 4000;
server.listen(port, () => console.log(`Poker server running on http://localhost:${port}`));
