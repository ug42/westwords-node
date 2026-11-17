'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');

const { Game, GameError, TOKENS, LIMITS, DEFAULT_SETTINGS, MIN_PLAYERS, MAX_PLAYERS } = require('./src/game');
const { ROLES, ROLE_ORDER } = require('./src/roles');
const { listCatalog, LEVELS } = require('./src/words');
const { BotDriver } = require('./src/bots');

const PORT = Number(process.env.PORT) || 3000;
const BOTS_ENABLED = process.env.DISABLE_BOTS !== '1';
const IDLE_GAME_MS = 3 * 60 * 60 * 1000; // drop games idle for 3h
const EMPTY_GAME_MS = 15 * 60 * 1000; // drop games with nobody connected for 15m

const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, { serveClient: true, pingInterval: 20000, pingTimeout: 20000 });

const PUBLIC = path.join(__dirname, 'public');
// Code and markup revalidate on every load (ETag), so a deploy is picked up immediately.
// Images rarely change and can be cached for a day.
app.use(
  express.static(PUBLIC, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      res.setHeader('Cache-Control', /\.(svg|png|ico)$/.test(filePath) ? 'public, max-age=86400' : 'no-cache');
    },
  })
);

const META = {
  roles: ROLES,
  roleOrder: ROLE_ORDER,
  tokens: TOKENS,
  limits: LIMITS,
  defaults: DEFAULT_SETTINGS,
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  wordLists: listCatalog(),
  levels: LEVELS,
  botsEnabled: BOTS_ENABLED,
};
app.get('/api/meta', (_req, res) => res.json(META));
app.get('/healthz', (_req, res) => res.json({ ok: true, games: games.size }));
app.get('/g/:code', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

// ------------------------------------------------------------------- games

/** @type {Map<string, Game>} */
const games = new Map();
const timers = new Map();

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion when read aloud
function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!games.has(code)) return code;
  }
}

function publicId(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('base64url').slice(0, 16);
}

function room(code) {
  return `game:${code}`;
}

// ------------------------------------------------------------------- bots

const botDrivers = new Map(); // code -> { driver, interval }

function syncBots(game) {
  const running = botDrivers.get(game.code);
  const wanted = games.has(game.code) && game.botIds().length > 0;
  if (wanted && !running) {
    const driver = new BotDriver(game);
    const interval = setInterval(() => {
      if (driver.step(Date.now())) broadcast(game);
    }, 400);
    interval.unref();
    botDrivers.set(game.code, { driver, interval });
  } else if (!wanted && running) {
    clearInterval(running.interval);
    botDrivers.delete(game.code);
  }
}

function dropGame(code) {
  clearTimeout(timers.get(code));
  timers.delete(code);
  const game = games.get(code);
  games.delete(code);
  if (game) syncBots(game);
}

async function broadcast(game) {
  syncBots(game);
  const sockets = await io.in(room(game.code)).fetchSockets();
  const now = Date.now();
  for (const s of sockets) s.emit('state', game.view(s.data.pid, now));
  schedule(game);
}

function schedule(game) {
  clearTimeout(timers.get(game.code));
  const deadline = game.nextDeadline();
  if (deadline == null) return timers.delete(game.code);
  const delay = Math.max(0, deadline - Date.now()) + 25;
  timers.set(
    game.code,
    setTimeout(() => {
      if (game.tick(Date.now())) broadcast(game);
      else schedule(game);
    }, Math.min(delay, 2 ** 31 - 1))
  );
}

async function refreshConnected(game, pid) {
  const sockets = await io.in(room(game.code)).fetchSockets();
  game.setConnected(pid, sockets.some((s) => s.data.pid === pid));
}

// Actions a client may perform on its current game: name -> (game, pid, args) => void
const ACTIONS = {
  updateSettings: (g, pid, a) => g.updateSettings(pid, a.settings),
  addRole: (g, pid, a) => g.addRole(pid, a.role),
  removeRole: (g, pid, a) => g.removeRole(pid, a.role),
  recommendedRoles: (g, pid) => g.useRecommendedRoles(pid),
  recommendedRules: (g, pid) => g.useRecommendedRules(pid),
  nominate: (g, pid) => g.toggleMayorNomination(pid),
  kick: (g, pid, a) => g.leave(a.playerId, pid),
  makeHost: (g, pid, a) => g.makeHost(pid, a.playerId),
  start: (g, pid) => g.start(pid),
  chooseWord: (g, pid, a) => g.chooseWord(pid, a.word),
  nightAction: (g, pid, a) => g.nightAction(pid, a.target),
  acknowledge: (g, pid) => g.acknowledge(pid),
  forceNight: (g, pid) => g.forceNight(pid),
  giveToken: (g, pid, a) => g.giveToken(pid, a.playerId, a.token),
  undo: (g, pid) => g.undoToken(pid),
  endDay: (g, pid) => g.endDay(pid),
  vote: (g, pid, a) => g.vote(pid, a.target),
  closeVote: (g, pid) => g.forceFinishVote(pid),
  backToLobby: (g, pid) => g.backToLobby(pid),
  addBot: (g, pid) => {
    if (!BOTS_ENABLED) throw new GameError('Bots are disabled on this server.');
    g.addBot(pid);
  },
  removeBots: (g, pid) => g.removeBots(pid),
};

io.on('connection', (socket) => {
  const secret = socket.handshake.auth && socket.handshake.auth.token;
  if (typeof secret !== 'string' || secret.length < 16 || secret.length > 128) {
    socket.emit('fatal', 'Missing session token. Please reload.');
    return socket.disconnect(true);
  }
  socket.data.pid = publicId(secret);
  socket.data.code = null;

  const reply = (cb, payload) => typeof cb === 'function' && cb(payload);
  const fail = (cb, err) => {
    if (!(err instanceof GameError)) console.error(err);
    reply(cb, { ok: false, error: err instanceof GameError ? err.message : 'Something went wrong.' });
  };

  async function enter(game, name) {
    if (socket.data.code && socket.data.code !== game.code) await exit();
    game.join(socket.data.pid, name);
    socket.data.code = game.code;
    await socket.join(room(game.code));
    await broadcast(game);
  }

  async function exit() {
    const game = games.get(socket.data.code);
    socket.leave(room(socket.data.code));
    socket.data.code = null;
    if (game) await refreshConnected(game, socket.data.pid).then(() => broadcast(game));
  }

  socket.on('create', async ({ name } = {}, cb) => {
    try {
      const game = new Game(newCode());
      games.set(game.code, game);
      await enter(game, name);
      reply(cb, { ok: true, code: game.code });
    } catch (e) {
      fail(cb, e);
    }
  });

  socket.on('join', async ({ code, name } = {}, cb) => {
    try {
      const game = games.get(String(code || '').toUpperCase().trim());
      if (!game) throw new GameError('No game with that code. Check the code or start a new game.');
      await enter(game, name);
      reply(cb, { ok: true, code: game.code });
    } catch (e) {
      fail(cb, e);
    }
  });

  // Re-attach after a reload without re-entering a name.
  socket.on('resume', async ({ code } = {}, cb) => {
    try {
      const game = games.get(String(code || '').toUpperCase().trim());
      if (!game) return reply(cb, { ok: false, error: 'gone' });
      const me = game.players.get(socket.data.pid) || game.spectators.get(socket.data.pid);
      if (!me) return reply(cb, { ok: false, error: 'not-member', exists: true });
      await enter(game, me.name);
      reply(cb, { ok: true, code: game.code });
    } catch (e) {
      fail(cb, e);
    }
  });

  socket.on('leave', async (_args, cb) => {
    try {
      const game = games.get(socket.data.code);
      if (game) {
        game.leave(socket.data.pid);
        if (game.isEmpty()) dropGame(game.code);
      }
      await exit();
      reply(cb, { ok: true });
    } catch (e) {
      fail(cb, e);
    }
  });

  socket.on('action', async ({ type, ...args } = {}, cb) => {
    try {
      const game = games.get(socket.data.code);
      if (!game) throw new GameError('You are not in a game.');
      const fn = Object.hasOwn(ACTIONS, type) && ACTIONS[type];
      if (!fn) throw new GameError('Unknown action.');
      fn(game, socket.data.pid, args);
      await broadcast(game);
      reply(cb, { ok: true });
    } catch (e) {
      fail(cb, e);
    }
  });

  socket.on('disconnect', async () => {
    const game = games.get(socket.data.code);
    if (game) {
      await refreshConnected(game, socket.data.pid);
      await broadcast(game);
    }
  });
});

// Garbage-collect stale games.
setInterval(() => {
  const now = Date.now();
  for (const [code, game] of games) {
    const anyoneHere = [...game.players.values(), ...game.spectators.values()].some((p) => p.connected && !p.bot);
    const idle = now - game.lastActivity;
    if (idle > IDLE_GAME_MS || (!anyoneHere && idle > EMPTY_GAME_MS)) {
      dropGame(code);
    }
  }
}, 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`Westwords listening on http://localhost:${PORT}`));
}

module.exports = { app, server, io, games };
