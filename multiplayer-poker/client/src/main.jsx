import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import { LogOut, Spade, Users, Copy, Play, RotateCcw, MessageCircle } from 'lucide-react';
import './styles/app.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function Card({ card }) {
  if (!card) return <div className="card empty">?</div>;
  if (card.hidden) return <div className="card back">◆</div>;
  const red = card.suit === '♥' || card.suit === '♦';
  return <div className={`card ${red ? 'red' : ''}`}><span>{card.rank}</span><b>{card.suit}</b></div>;
}

function Auth({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault(); setError('');
    const res = await fetch(`${API}/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (!res.ok) return setError(data.error || 'Failed');
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    onLogin(data.user);
  }

  return <main className="auth-page">
    <section className="hero-card">
      <div className="brand"><Spade size={34}/><span>RoyalRoom Poker</span></div>
      <h1>Live multiplayer Texas Hold’em.</h1>
      <p>Create a table, invite anyone with a room code, and play a real-time poker hand with saved users and secure login.</p>
    </section>
    <form className="auth-card" onSubmit={submit}>
      <h2>{mode === 'login' ? 'Welcome back' : 'Create account'}</h2>
      <input placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} />
      <input placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
      {error && <p className="error">{error}</p>}
      <button>{mode === 'login' ? 'Log in' : 'Sign up'}</button>
      <p className="switch" onClick={()=>setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in'}
      </p>
    </form>
  </main>;
}

function Lobby({ user, onLogout, onEnter }) {
  const [roomCode, setRoomCode] = useState('');
  const [games, setGames] = useState([]);
  const [error, setError] = useState('');
  const botTables = [
    { level: 'easy', title: 'Easy Bot', desc: 'Loose and forgiving' },
    { level: 'medium', title: 'Medium Bot', desc: 'Balanced calls and folds' },
    { level: 'hard', title: 'Hard Bot', desc: 'More aggressive raises' }
  ];
  const token = localStorage.getItem('token');
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  async function loadGames() {
    const res = await fetch(`${API}/games`, { headers: authHeaders });
    const data = await res.json(); if (res.ok) setGames(data.games);
  }
  useEffect(() => { loadGames(); }, []);

  async function createGame() {
    setError('');
    const res = await fetch(`${API}/games/create`, { method: 'POST', headers: authHeaders });
    const data = await res.json();
    if (!res.ok) return setError(data.error || 'Could not create game');
    onEnter(data.roomCode);
  }

  async function joinGame(code = roomCode) {
    setError('');
    const res = await fetch(`${API}/games/join`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ roomCode: code }) });
    const data = await res.json();
    if (!res.ok) return setError(data.error || 'Could not join game');
    onEnter(data.roomCode);
  }

  async function createBotGame(level) {
    setError('');
    const res = await fetch(`${API}/games/create-bot`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ level }) });
    const data = await res.json();
    if (!res.ok) return setError(data.error || 'Could not create bot game');
    onEnter(data.roomCode);
  }

  return <main className="lobby">
    <nav><div className="brand small"><Spade/> RoyalRoom</div><button className="ghost" onClick={onLogout}><LogOut size={16}/> Logout</button></nav>
    <section className="lobby-grid">
      <div className="panel big">
        <h1>Lobby</h1><p>Logged in as <b>{user.username}</b>. Create a fresh table or join with a code.</p>
        <button className="primary" onClick={createGame}>Create New Poker Table</button>
        <div className="join-row"><input placeholder="Room code" value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())}/><button onClick={()=>joinGame()}>Join</button></div>
        {error && <p className="error">{error}</p>}
      </div>
      <div className="tables-grid">
        <div className="panel">
          <h2>Open tables</h2>
          {games.filter(g => !g.bot_level).length === 0 && <p className="muted">No tables yet. Create one.</p>}
          {games.filter(g => !g.bot_level).map(g => <div className="game-row" key={g.room_code}><div><b>{g.room_code}</b><span>{g.players} players • {g.status}</span></div>{g.status === 'WAITING' && <button onClick={()=>joinGame(g.room_code)}>Join</button>}</div>)}
        </div>
        <div className="panel">
          <h2>Bot tables</h2>
          {botTables.map(b => <div className="game-row" key={b.level}><div><b>{b.title}</b><span>{b.desc}</span></div><button onClick={()=>createBotGame(b.level)}>Play</button></div>)}
        </div>
      </div>
    </section>
  </main>;
}

function PokerTable({ roomCode, user, onBack }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [raise, setRaise] = useState(50);
  const [chatText, setChatText] = useState('');
  const token = localStorage.getItem('token');
  const socket = useMemo(() => io(API, { auth: { token } }), [token]);

  useEffect(() => {
    socket.emit('join_room', { roomCode });
    socket.on('game_state', setState);
    socket.on('error_message', setError);
    return () => socket.disconnect();
  }, [socket, roomCode]);

  const game = state?.game;
  const userId = String(user.id);
  const me = game?.players.find(p => String(p.userId) === userId);
  const isMyTurn = String(game?.currentTurnUserId) === userId;
  const callAmount = Math.max(0, (game?.currentBet || 0) - (me?.currentBet || 0));
  const winner = game?.players.find(p => String(p.userId) === String(game.winnerUserId));
  const isHost = String(game?.dealerUserId) === userId;
  const showdownHands = game?.status === 'FINISHED'
    ? game.players
    : [];
  const actions = state?.actions || [];
  const chats = state?.chats || [];

  function action(type, amount = 0) { setError(''); socket.emit('player_action', { roomCode, action: type, amount }); }
  function resetChips() {
    setError('');
    if (window.confirm('Reset every player back to 1000 chips and return the table to the lobby?')) {
      socket.emit('reset_chips', { roomCode });
    }
  }
  function sendChat(e) {
    e.preventDefault();
    const message = chatText.trim();
    if (!message) return;
    socket.emit('send_chat', { roomCode, message });
    setChatText('');
  }

  return <main className="table-page">
    <nav><button className="ghost" onClick={onBack}>← Lobby</button><div className="room-code"><span>Room {roomCode}</span><button onClick={()=>navigator.clipboard.writeText(roomCode)}><Copy size={14}/></button></div></nav>
    <section className="table-layout">
      <aside className="panel players-panel">
        <h2><Users size={18}/> Players</h2>
        {game?.players.map(p => <div className={`player ${String(game.currentTurnUserId) === String(p.userId) ? 'active' : ''} ${p.folded ? 'folded' : ''}`} key={p.userId}>
          <span>Seat {p.seat}: <b>{p.username}</b>{p.botLevel && <em> {p.botLevel} bot</em>}</span><small>{p.chips} chips • bet {p.currentBet}</small>
        </div>)}
      </aside>

      <section className="felt">
        <div className="pot">Pot: <b>{game?.pot || 0}</b> · Round: <b>{game?.round || 'LOBBY'}</b></div>
        <div className="community">{[0,1,2,3,4].map(i => <Card key={i} card={game?.communityCards?.[i]}/>)}</div>
        {winner && <div className="winner">🏆 {winner.username} wins!</div>}
        {showdownHands.length > 0 && <div className="showdown-hands">
          <h3>Final hands</h3>
          <div className="showdown-grid">
            {showdownHands.map(p => <div className="showdown-hand" key={p.userId}>
              <span>{String(p.userId) === userId ? 'You' : p.username}{p.botLevel && <em> {p.botLevel} bot</em>}</span>
              <div className="cards small-cards">{(p.cards?.length ? p.cards : [null,null]).map((c,i)=><Card key={i} card={c}/>)}</div>
            </div>)}
          </div>
        </div>}
        {game?.status !== 'FINISHED' && <div className="your-hand"><h3>Your hand</h3><div className="cards">{(me?.cards?.length ? me.cards : [null,null]).map((c,i)=><Card key={i} card={c}/>)}</div></div>}
        <div className="controls">
          {game?.status === 'WAITING' && <button className="primary" onClick={()=>socket.emit('start_game', { roomCode })}><Play size={16}/> Start Game</button>}
          {isHost && <button className="ghost" onClick={resetChips}><RotateCcw size={16}/> Reset Chips</button>}
          {game?.status === 'FINISHED' && <button className="primary" onClick={()=>socket.emit('new_hand', { roomCode })}><RotateCcw size={16}/> Reset Hand</button>}
          {game?.status === 'ACTIVE' && <>
            <button disabled={!isMyTurn} onClick={()=>action('fold')}>Fold</button>
            <button disabled={!isMyTurn || callAmount !== 0} onClick={()=>action('check')}>Check</button>
            <button disabled={!isMyTurn} onClick={()=>action('call')}>Call {callAmount}</button>
            <input type="number" value={raise} onChange={e=>setRaise(e.target.value)} />
            <button disabled={!isMyTurn} onClick={()=>action('raise', Number(raise))}>Raise</button>
          </>}
        </div>
        {error && <p className="error center">{error}</p>}
      </section>

      <aside className="side-stack">
        <div className="panel chat-panel">
          <h2><MessageCircle size={18}/> Chat</h2>
          <div className="chat-messages">
            {chats.length === 0 && <p className="muted">No messages yet.</p>}
            {chats.map(c => <p key={c.id}><b>{String(c.user_id) === userId ? 'You' : c.username}:</b> {c.message}</p>)}
          </div>
          <form className="chat-form" onSubmit={sendChat}>
            <input maxLength="300" placeholder="Message table" value={chatText} onChange={e=>setChatText(e.target.value)} />
            <button type="submit">Send</button>
          </form>
        </div>

        <div className="panel log-panel">
          <h2>Action Log</h2>
          <div className="log-messages">
            {actions.map(a => <p key={a.id}><b>{a.username || 'Dealer'}:</b> {a.message}</p>)}
          </div>
        </div>
      </aside>
    </section>
  </main>;
}

function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const [room, setRoom] = useState('');
  function logout() { localStorage.clear(); setUser(null); setRoom(''); }
  if (!user) return <Auth onLogin={setUser}/>;
  if (room) return <PokerTable roomCode={room} user={user} onBack={()=>setRoom('')}/>;
  return <Lobby user={user} onLogout={logout} onEnter={setRoom}/>;
}

createRoot(document.getElementById('root')).render(<App />);
