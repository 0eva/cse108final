import jwt from 'jsonwebtoken';
import { all, get, run } from '../db.js';
import { createDeck, draw } from '../utils/deck.js';
import { determineWinner } from '../utils/pokerLogic.js';

function publicGame(game, players, viewerId) {
  const community = JSON.parse(game.community_cards_json || '[]');
  return {
    id: game.id,
    roomCode: game.room_code,
    status: game.status,
    pot: game.pot,
    communityCards: community,
    currentTurnUserId: game.current_turn_user_id,
    currentBet: game.current_bet,
    round: game.round,
    winnerUserId: game.winner_user_id,
    dealerUserId: game.dealer_user_id,
    players: players.map(p => ({
      userId: p.user_id,
      username: p.username,
      seat: p.seat,
      chips: p.chips_in_game,
      currentBet: p.current_bet,
      folded: Boolean(p.folded),
      allIn: Boolean(p.all_in),
      botLevel: p.bot_level,
      cards: p.user_id === viewerId || game.status === 'FINISHED' ? JSON.parse(p.hand_cards_json || '[]') : JSON.parse(p.hand_cards_json || '[]').map(() => ({ hidden: true }))
    }))
  };
}

async function stateFor(roomCode, viewerId) {
  const game = await get('SELECT * FROM games WHERE room_code = ?', [roomCode]);
  if (!game) return null;
  const players = await all(`SELECT gp.*, u.username FROM game_players gp JOIN users u ON u.id = gp.user_id WHERE gp.game_id = ? ORDER BY gp.seat`, [game.id]);
  const actions = await all(`SELECT ga.*, u.username FROM game_actions ga LEFT JOIN users u ON u.id = ga.user_id WHERE ga.game_id = ? ORDER BY ga.id DESC LIMIT 10`, [game.id]);
  const chats = await all(`SELECT gc.*, u.username FROM game_chats gc JOIN users u ON u.id = gc.user_id WHERE gc.game_id = ? ORDER BY gc.id DESC LIMIT 50`, [game.id]);
  return { game: publicGame(game, players, viewerId), actions: actions.reverse(), chats: chats.reverse() };
}

function nextPlayer(players, currentId) {
  const active = players.filter(p => !p.folded && !p.all_in && p.chips_in_game > 0).sort((a, b) => a.seat - b.seat);
  if (!active.length) return null;
  const idx = active.findIndex(p => p.user_id === currentId);
  return active[(idx + 1 + active.length) % active.length];
}

async function broadcast(io, roomCode) {
  const sockets = await io.in(roomCode).fetchSockets();
  for (const s of sockets) {
    const st = await stateFor(roomCode, s.user.id);
    s.emit('game_state', st);
  }
}

async function advanceRound(game, players) {
  const active = players.filter(p => !p.folded);
  if (active.length <= 1) {
    await finishHand(game);
    return true;
  }

  const bettingComplete = active.every(p =>
    p.all_in || (p.acted_this_round && p.current_bet === game.current_bet)
  );
  if (!bettingComplete) return false;

  let deck = JSON.parse(game.deck_json);
  let community = JSON.parse(game.community_cards_json);
  let round = game.round;

  if (round === 'PREFLOP') {
    const d = draw(deck, 3);
    community = d.cards;
    deck = d.deck;
    round = 'FLOP';
  } else if (round === 'FLOP') {
    const d = draw(deck, 1);
    community.push(...d.cards);
    deck = d.deck;
    round = 'TURN';
  } else if (round === 'TURN') {
    const d = draw(deck, 1);
    community.push(...d.cards);
    deck = d.deck;
    round = 'RIVER';
  } else if (round === 'RIVER') {
    await finishHand(game);
    return true;
  }

  const first = active.sort((a, b) => a.seat - b.seat)[0];
  await run('UPDATE game_players SET current_bet = 0, acted_this_round = 0 WHERE game_id = ?', [game.id]);
  await run(
    'UPDATE games SET deck_json = ?, community_cards_json = ?, round = ?, current_bet = 0, current_turn_user_id = ? WHERE id = ?',
    [JSON.stringify(deck), JSON.stringify(community), round, first.user_id, game.id]
  );
  await run('INSERT INTO game_actions (game_id, action_type, message) VALUES (?, ?, ?)', [game.id, 'ROUND', `${round} dealt`]);
  return true;
}

function holeStrength(player) {
  const values = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
  const cards = JSON.parse(player.hand_cards_json || '[]');
  if (cards.length < 2) return 0;
  const [a, b] = cards.map(c => values[c.rank] || 0);
  return (a + b) + (a === b ? 12 : 0) + (cards[0].suit === cards[1].suit ? 3 : 0);
}

function chooseBotMove(game, player) {
  const level = player.bot_level || 'easy';
  const callAmount = Math.max(0, game.current_bet - player.current_bet);
  const strength = holeStrength(player);
  const canRaise = player.chips_in_game > callAmount + 50;
  if (callAmount === 0) {
    if ((level === 'hard' && strength >= 24 && canRaise) || (level === 'medium' && strength >= 28 && canRaise)) return { action: 'raise', amount: game.current_bet + 50 };
    return { action: 'check' };
  }
  if (level === 'easy' && callAmount > 100 && strength < 18) return { action: 'fold' };
  if (level === 'medium' && callAmount > 150 && strength < 20) return { action: 'fold' };
  if (level === 'hard' && strength >= 27 && canRaise) return { action: 'raise', amount: Math.min(player.current_bet + callAmount + 50, player.current_bet + player.chips_in_game) };
  return { action: 'call' };
}

async function applyAction(roomCode, user, action, amount = 0, onError = () => {}) {
  const game = await get('SELECT * FROM games WHERE room_code = ?', [roomCode]);
  if (!game || game.status !== 'ACTIVE') return;
  if (game.current_turn_user_id !== user.id) return onError('Not your turn');
  const player = await get('SELECT * FROM game_players WHERE game_id = ? AND user_id = ?', [game.id, user.id]);
  if (!player || player.folded) return;

  let message = '';
  let newPot = game.pot;
  let newCurrentBet = game.current_bet;
  let chips = player.chips_in_game;
  let playerBet = player.current_bet;

  if (action === 'fold') {
    await run('UPDATE game_players SET folded = 1, acted_this_round = 1 WHERE id = ?', [player.id]);
    message = `${user.username} folded`;
  } else if (action === 'check') {
    if (player.current_bet !== game.current_bet) return onError('Cannot check. You need to call.');
    await run('UPDATE game_players SET acted_this_round = 1 WHERE id = ?', [player.id]);
    message = `${user.username} checked`;
  } else if (action === 'call') {
    const need = Math.max(0, game.current_bet - player.current_bet);
    const pay = Math.min(need, chips);
    chips -= pay; playerBet += pay; newPot += pay;
    await run('UPDATE game_players SET chips_in_game=?, current_bet=?, all_in=?, acted_this_round=1 WHERE id=?', [chips, playerBet, chips === 0 ? 1 : 0, player.id]);
    await run('UPDATE games SET pot=? WHERE id=?', [newPot, game.id]);
    message = `${user.username} called ${pay}`;
  } else if (action === 'raise') {
    amount = Number(amount);
    if (!Number.isFinite(amount) || amount <= game.current_bet) return onError('Raise must be higher than current bet');
    const need = amount - player.current_bet;
    if (need > chips) return onError('Not enough chips');
    chips -= need; playerBet = amount; newPot += need; newCurrentBet = amount;
    await run('UPDATE game_players SET chips_in_game=?, current_bet=?, all_in=?, acted_this_round=1 WHERE id=?', [chips, playerBet, chips === 0 ? 1 : 0, player.id]);
    await run('UPDATE game_players SET acted_this_round = 0 WHERE game_id = ? AND id != ? AND folded = 0 AND all_in = 0', [game.id, player.id]);
    await run('UPDATE games SET pot=?, current_bet=? WHERE id=?', [newPot, newCurrentBet, game.id]);
    message = `${user.username} ${game.current_bet === 0 ? 'bet' : 'raised to'} ${amount}`;
  }

  await run('INSERT INTO game_actions (game_id, user_id, action_type, amount, message) VALUES (?, ?, ?, ?, ?)', [game.id, user.id, action.toUpperCase(), amount, message]);
  let updatedGame = await get('SELECT * FROM games WHERE id = ?', [game.id]);
  let updatedPlayers = await all('SELECT * FROM game_players WHERE game_id = ? ORDER BY seat', [game.id]);
  const roundAdvanced = await advanceRound(updatedGame, updatedPlayers);
  updatedGame = await get('SELECT * FROM games WHERE id = ?', [game.id]);
  updatedPlayers = await all('SELECT * FROM game_players WHERE game_id = ? ORDER BY seat', [game.id]);
  if (!roundAdvanced && updatedGame.status === 'ACTIVE') {
    const nxt = nextPlayer(updatedPlayers, user.id);
    if (nxt) await run('UPDATE games SET current_turn_user_id = ? WHERE id = ?', [nxt.user_id, game.id]);
  }
}

async function playBots(io, roomCode) {
  for (let i = 0; i < 6; i++) {
    const game = await get('SELECT * FROM games WHERE room_code = ?', [roomCode]);
    if (!game || game.status !== 'ACTIVE') return;
    const bot = await get(`SELECT gp.*, u.username FROM game_players gp JOIN users u ON u.id = gp.user_id WHERE gp.game_id = ? AND gp.user_id = ? AND gp.bot_level IS NOT NULL`, [game.id, game.current_turn_user_id]);
    if (!bot) return;
    const move = chooseBotMove(game, bot);
    await applyAction(roomCode, { id: bot.user_id, username: bot.username }, move.action, move.amount || 0);
    await broadcast(io, roomCode);
  }
}

async function finishHand(game) {
  const players = await all(`SELECT gp.*, u.username FROM game_players gp JOIN users u ON u.id = gp.user_id WHERE gp.game_id = ? ORDER BY gp.seat`, [game.id]);
  const community = JSON.parse(game.community_cards_json || '[]');
  const { winners, handName } = determineWinner(players, community);
  const share = Math.floor(game.pot / winners.length);
  for (const w of winners) await run('UPDATE game_players SET chips_in_game = chips_in_game + ? WHERE game_id = ? AND user_id = ?', [share, game.id, w.user_id]);
  await run('UPDATE games SET status = ?, winner_user_id = ?, current_turn_user_id = NULL WHERE id = ?', ['FINISHED', winners[0].user_id, game.id]);
  await run('INSERT INTO game_actions (game_id, user_id, action_type, amount, message) VALUES (?, ?, ?, ?, ?)', [game.id, winners[0].user_id, 'WIN', game.pot, `${winners.map(w => w.username).join(', ')} won with ${handName}`]);
}

export function setupGameSocket(io) {
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      socket.user = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', socket => {
    socket.on('join_room', async ({ roomCode }) => {
      roomCode = String(roomCode || '').toUpperCase();
      socket.join(roomCode);
      await broadcast(io, roomCode);
    });

    socket.on('start_game', async ({ roomCode }) => {
      roomCode = String(roomCode || '').toUpperCase();
      const game = await get('SELECT * FROM games WHERE room_code = ?', [roomCode]);
      const players = await all('SELECT * FROM game_players WHERE game_id = ? ORDER BY seat', [game.id]);
      if (!game || players.length < 2) return socket.emit('error_message', 'Need at least 2 players');
      if (game.dealer_user_id !== socket.user.id) return socket.emit('error_message', 'Only table creator can start');

      let deck = createDeck();
      for (const p of players) {
        const dealt = draw(deck, 2); deck = dealt.deck;
        await run('UPDATE game_players SET hand_cards_json = ?, folded = 0, all_in = 0, current_bet = 0, acted_this_round = 0 WHERE id = ?', [JSON.stringify(dealt.cards), p.id]);
      }
      await run(`UPDATE games SET status='ACTIVE', pot=0, deck_json=?, community_cards_json='[]', round='PREFLOP', current_bet=0, current_turn_user_id=? WHERE id=?`, [JSON.stringify(deck), players[0].user_id, game.id]);
      await run('INSERT INTO game_actions (game_id, user_id, action_type, message) VALUES (?, ?, ?, ?)', [game.id, socket.user.id, 'START', 'Game started']);
      await playBots(io, roomCode);
      await broadcast(io, roomCode);
    });

    socket.on('player_action', async ({ roomCode, action, amount = 0 }) => {
      roomCode = String(roomCode || '').toUpperCase();
      await applyAction(roomCode, socket.user, action, amount, msg => socket.emit('error_message', msg));
      await playBots(io, roomCode);
      await broadcast(io, roomCode);
    });

    socket.on('send_chat', async ({ roomCode, message }) => {
      roomCode = String(roomCode || '').toUpperCase();
      const text = String(message || '').trim().slice(0, 300);
      if (!text) return;
      const game = await get('SELECT * FROM games WHERE room_code = ?', [roomCode]);
      if (!game) return socket.emit('error_message', 'Room not found');
      const player = await get('SELECT id FROM game_players WHERE game_id = ? AND user_id = ?', [game.id, socket.user.id]);
      if (!player) return socket.emit('error_message', 'Join the table before chatting');
      await run('INSERT INTO game_chats (game_id, user_id, message) VALUES (?, ?, ?)', [game.id, socket.user.id, text]);
      await broadcast(io, roomCode);
    });


    socket.on('reset_chips', async ({ roomCode }) => {
      roomCode = String(roomCode || '').toUpperCase();
      const game = await get('SELECT * FROM games WHERE room_code = ?', [roomCode]);
      if (!game) return socket.emit('error_message', 'Room not found');
      if (game.dealer_user_id !== socket.user.id) return socket.emit('error_message', 'Only the host can reset chips');

      await run(`UPDATE game_players
        SET chips_in_game=1000, current_bet=0, folded=0, all_in=0, acted_this_round=0, hand_cards_json='[]'
        WHERE game_id=?`, [game.id]);

      await run(`UPDATE games
        SET status='WAITING', pot=0, deck_json='[]', community_cards_json='[]', round='LOBBY',
            current_bet=0, current_turn_user_id=NULL, winner_user_id=NULL
        WHERE id=?`, [game.id]);

      await run('INSERT INTO game_actions (game_id, user_id, action_type, message) VALUES (?, ?, ?, ?)',
        [game.id, socket.user.id, 'RESET_CHIPS', `${socket.user.username} reset all players to 1000 chips`]);

      await broadcast(io, roomCode);
    });

    socket.on('new_hand', async ({ roomCode }) => {
      roomCode = String(roomCode || '').toUpperCase();
      const game = await get('SELECT * FROM games WHERE room_code = ?', [roomCode]);
      if (!game || game.dealer_user_id !== socket.user.id) return;
      await run(`UPDATE games SET status='WAITING', pot=0, deck_json='[]', community_cards_json='[]', round='LOBBY', current_bet=0, current_turn_user_id=NULL, winner_user_id=NULL WHERE id=?`, [game.id]);
      await run(`UPDATE game_players SET current_bet=0, folded=0, all_in=0, acted_this_round=0, hand_cards_json='[]' WHERE game_id=?`, [game.id]);
      await playBots(io, roomCode);
      await broadcast(io, roomCode);
    });
  });
}
