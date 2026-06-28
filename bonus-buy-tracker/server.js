const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── State file ────────────────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, 'data', 'state.json');

const DEFAULT_STATE = {
  balance: 0,
  startBalance: 0,
  bonuses: [],
};

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  broadcast(state);
}

// ─── SSE broadcast ─────────────────────────────────────────────────────────────
const clients = new Set();

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify(loadState())}\n\n`);
  clients.add(res);

  const hb = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(hb);
    clients.delete(res);
  });
});

function broadcast(state) {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  clients.forEach(c => c.write(payload));
}

// ─── API ───────────────────────────────────────────────────────────────────────

app.get('/api/state', (_req, res) => res.json(loadState()));

app.post('/api/balance', (req, res) => {
  const { balance, resetStart } = req.body;
  const state = loadState();
  state.balance = Number(balance);
  if (!state.startBalance || resetStart) state.startBalance = Number(balance);
  saveState(state);
  res.json({ ok: true });
});

app.post('/api/bonus/add', (req, res) => {
  const { game, cost, image } = req.body;
  if (!game || !cost) return res.status(400).json({ error: 'game and cost required' });

  const state = loadState();
  const isFirst = !state.bonuses.some(b => b.status === 'active');

  const bonus = {
    id: Date.now(),
    game: game.trim(),
    cost: Number(cost),
    result: null,
    image: image || null,
    status: isFirst ? 'active' : 'pending',
    createdAt: new Date().toISOString(),
  };

  state.bonuses.push(bonus);
  saveState(state);
  res.json({ ok: true, bonus });
});

app.post('/api/bonus/:id/result', (req, res) => {
  const { result } = req.body;
  const state = loadState();
  const bonus = state.bonuses.find(b => b.id == req.params.id);
  if (!bonus) return res.status(404).json({ error: 'not found' });

  bonus.result = Number(result);
  bonus.status = 'completed';

  const nextPending = state.bonuses.find(b => b.status === 'pending');
  if (nextPending) nextPending.status = 'active';

  saveState(state);
  res.json({ ok: true });
});

app.post('/api/bonus/:id/activate', (req, res) => {
  const state = loadState();
  state.bonuses.forEach(b => {
    if (b.status === 'active') b.status = 'pending';
  });
  const bonus = state.bonuses.find(b => b.id == req.params.id);
  if (!bonus) return res.status(404).json({ error: 'not found' });
  bonus.status = 'active';
  saveState(state);
  res.json({ ok: true });
});

// ─── UPDATE image ──────────────────────────────────────────────────────────────
app.post('/api/bonus/:id/image', (req, res) => {
  const { image } = req.body;
  const state = loadState();
  const bonus = state.bonuses.find(b => b.id == req.params.id);
  if (!bonus) return res.status(404).json({ error: 'not found' });
  bonus.image = image || null;
  saveState(state);
  res.json({ ok: true });
});

app.delete('/api/bonus/:id', (req, res) => {
  const state = loadState();
  state.bonuses = state.bonuses.filter(b => b.id != req.params.id);
  if (!state.bonuses.some(b => b.status === 'active')) {
    const first = state.bonuses.find(b => b.status === 'pending');
    if (first) first.status = 'active';
  }
  saveState(state);
  res.json({ ok: true });
});

app.post('/api/reset', (_req, res) => {
  saveState({ ...DEFAULT_STATE });
  res.json({ ok: true });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅  Bonus Buy Tracker running → http://localhost:${PORT}`);
  console.log(`   Widget  → http://localhost:${PORT}/widget.html`);
  console.log(`   Admin   → http://localhost:${PORT}/admin.html`);
});
