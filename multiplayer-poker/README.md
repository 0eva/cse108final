# RoyalRoom Poker — Multiplayer Final Project

A polished full-stack multiplayer Texas Hold'em poker web app.

## Final project requirement coverage

- Substantial web application
- Frontend: React + Vite
- Server: Node.js + Express
- Database: SQLite
- User sign up and login
- Hashed and salted passwords using bcrypt
- Live multiplayer sessions using Socket.IO
- Users can create or join poker tables
- Game actions are saved in the database

## Features

- Register and log in securely
- Create a poker table with a room code
- Join an existing table
- Real-time player list
- Private player cards
- Community cards
- Pot and chip tracking
- Check, call, raise, and fold actions
- Action log
- Basic poker hand winner detection
- Polished casino-style UI

## How to run locally

From the project root:

```bash
npm install
npm run install:all
```

Create the server environment file:

```bash
cp server/.env.example server/.env
```

Run both frontend and backend:

```bash
npm run dev
```

Open:

```txt
http://localhost:5173
```

Backend runs on:

```txt
http://localhost:4000
```

## How to demo

1. Open the app in two browser windows.
2. Register or log in as two different users.
3. User 1 creates a poker table.
4. User 2 joins using the room code.
5. User 1 starts the game.
6. Each user sees their own private cards.
7. Take turns checking, calling, raising, or folding.
8. The board deals flop, turn, and river automatically as betting rounds finish.
9. The winner is shown and logged.

## Notes for deployment

For a live demo, deploy the server to Render or Railway and deploy the client to Vercel or Netlify.

Set these environment variables on the server:

```txt
PORT=4000
JWT_SECRET=your_long_random_secret
CLIENT_ORIGIN=https://your-frontend-url.com
```

Set this environment variable on the client:

```txt
VITE_API_URL=https://your-backend-url.com
```
