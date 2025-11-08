const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();

// CORS configuration: allow all by default, or restrict via CORS_ORIGIN (comma-separated)
const corsOrigins = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow server-to-server or curl
    if (corsOrigins.includes('*') || corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  }
};
app.use(cors(corsOptions));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const repoRoot = path.resolve(__dirname, '..');
const botsConfigPath = path.join(__dirname, 'config', 'bots.json');
const botsConfig = JSON.parse(fs.readFileSync(botsConfigPath, 'utf8'));

// Runtime state: id -> { proc, status, lastExit }
const bots = new Map();
// Log subscribers per bot
const wsClients = new Map(); // id -> Set<ws>

function broadcastLog(id, line) {
  const set = wsClients.get(id);
  if (!set) return;
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(JSON.stringify({ id, line: String(line), ts: Date.now() }));
  }
}

function attachProcLogging(id, proc) {
  proc.stdout.on('data', d => broadcastLog(id, d.toString()))
  proc.stderr.on('data', d => broadcastLog(id, d.toString()))
}

function spawnBot(id, extraEnv = {}) {
  const cfg = botsConfig.find(b => b.id === id);
  if (!cfg) throw new Error(`Unknown bot id: ${id}`);
  if (bots.get(id)?.status === 'running') throw new Error(`Bot ${id} already running`);

  const scriptAbs = path.join(repoRoot, cfg.script);
  if (!fs.existsSync(scriptAbs)) throw new Error(`Script not found: ${cfg.script}`);

  const nodeExec = process.execPath; // use same Node as manager
  const proc = spawn(nodeExec, [scriptAbs], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  bots.set(id, { proc, status: 'running', lastExit: null });
  attachProcLogging(id, proc);

  proc.on('exit', (code, signal) => {
    bots.set(id, { proc: null, status: 'stopped', lastExit: { code, signal } });
    broadcastLog(id, `\n[manager] bot exited code=${code} signal=${signal}\n`);
  });
}

function stopBot(id) {
  const entry = bots.get(id);
  if (!entry || entry.status !== 'running') return false;
  try {
    entry.proc.kill('SIGTERM');
    return true;
  } catch (_) {
    return false;
  }
}

// REST
app.get('/healthz', (_, res) => res.send('ok'));

app.get('/bots', (_, res) => {
  const out = botsConfig.map(cfg => {
    const s = bots.get(cfg.id);
    return {
      id: cfg.id,
      label: cfg.label,
      status: s?.status || 'stopped',
      lastExit: s?.lastExit || null
    };
  });
  res.json(out);
});

app.post('/bots/:id/spawn', (req, res) => {
  try {
    spawnBot(req.params.id, req.body || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post('/bots/:id/stop', (req, res) => {
  const ok = stopBot(req.params.id);
  res.json({ ok });
});

const server = app.listen(PORT, () => {
  console.log(`manager listening on :${PORT}`);
});

// WebSocket for logs: ws://.../logs?id=bot1
const wss = new WebSocketServer({ server, path: '/logs' });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x'); // host ignored
  const id = url.searchParams.get('id');
  if (!id) return ws.close();
  if (!wsClients.has(id)) wsClients.set(id, new Set());
  wsClients.get(id).add(ws);
  ws.on('close', () => wsClients.get(id)?.delete(ws));
});
