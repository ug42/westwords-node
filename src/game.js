'use strict';

const { ROLES, ROLE_ORDER, defaultRolesFor } = require('./roles');
const { LEVELS, WORDLISTS, pickWords, categoriesOf } = require('./words');

const BOT_NAMES = [
  'Dusty', 'Tumbleweed', 'Rusty', 'Clem', 'Hattie', 'Jeb', 'Mabel',
  'Cactus', 'Spurs', 'Lasso', 'Dakota', 'Sage', 'Boone', 'Ruby',
  'Wade', 'Etta', 'Silas', 'Opal', 'Gus', 'Nell',
];

class GameError extends Error {}

const PHASES = {
  LOBBY: 'lobby',
  WORD_CHOICE: 'word_choice',
  NIGHT_COPY: 'night_copy', // Doppelganger picks a role to copy
  NIGHT_TARGET: 'night_target', // Esper (and copies) pick a target
  NIGHT_REVEAL: 'night_reveal', // everyone reads their secret info
  DAY: 'day', // questions over voice; Mayor hands out tokens
  VOTE: 'vote',
  RESULTS: 'results',
};

// Answer tokens. Yes and No draw from one shared pool, as in the original.
const TOKENS = {
  yes: { label: 'Yes', pool: 'yesno' },
  no: { label: 'No', pool: 'yesno' },
  maybe: { label: 'Maybe', pool: 'maybe' },
  so_close: { label: 'So Close!', pool: 'so_close' },
  so_far: { label: 'Way Off!', pool: 'so_far' },
  correct: { label: 'Correct!', pool: 'correct' },
};
const TOKEN_IDS = Object.keys(TOKENS);

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 20;

const DEFAULT_SETTINGS = {
  dayTimer: 360, // seconds
  voteTimer: 60, // seconds
  wordChoices: 8,
  difficulty: 'any',
  lists: [], // empty = all lists
  yesNoTokens: 36,
  maybeTokens: 10,
};

const LIMITS = {
  dayTimer: [60, 1800],
  voteTimer: [15, 600],
  wordChoices: [1, 20],
  yesNoTokens: [4, 99],
  maybeTokens: [0, 99],
};

/** Recommended Yes/No pool and day length for a player count (host can override). */
function recommendedRules(playerCount) {
  const n = Math.max(MIN_PLAYERS, playerCount);
  return {
    yesNoTokens: Math.max(16, Math.min(40, 4 * (n - 1))),
    dayTimer: Math.max(240, Math.min(480, 240 + (n - 4) * 30)),
  };
}

function clampInt(v, [lo, hi]) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}

class Game {
  constructor(code, { random = Math.random } = {}) {
    this.code = code;
    this.random = random;
    this.players = new Map(); // id -> { id, name, connected }
    this.order = []; // join order of player ids
    this.spectators = new Map(); // id -> { id, name, connected }
    this.hostId = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.selectedRoles = [];
    this.autoRoles = true;
    this.autoRules = { yesNoTokens: true, dayTimer: true };
    this.version = 0;
    this.lastActivity = Date.now();
    this.resetRound();
  }

  // ---------------------------------------------------------------- helpers

  touch() {
    this.version++;
    this.lastActivity = Date.now();
  }

  resetRound() {
    this.phase = PHASES.LOBBY;
    this.roles = new Map(); // id -> { id: roleId, doppel: bool, copiedFrom }
    this.mayorId = null;
    this.mayorNominees = new Set();
    this.word = null;
    this.wordChoices = [];
    this.pendingActions = new Set();
    this.targets = new Map(); // actor id -> target id
    this.extraKnown = new Map(); // id -> [{ id, label }]
    this.pendingAcks = new Set();
    this.tokens = {};
    this.answers = []; // [{ playerId, token, at }]
    this.dayEndsAt = null;
    this.dayRemainingAtVote = null;
    this.voteEndsAt = null;
    this.voteReason = null;
    this.wordGuessed = false;
    this.voters = [];
    this.votes = new Map();
    this.result = null;
    this.wordCategories = [];
    this.questions = []; // on-screen questions (bots): [{ playerId, text, at, token }]
  }

  isHost(id) {
    return id === this.hostId;
  }

  requireHost(id) {
    if (!this.isHost(id)) throw new GameError('Only the host can do that.');
  }

  requirePhase(...phases) {
    if (!phases.includes(this.phase)) throw new GameError('Not allowed right now.');
  }

  requirePlayer(id) {
    if (!this.players.has(id)) throw new GameError('You are not a player in this game.');
  }

  name(id) {
    return (this.players.get(id) || this.spectators.get(id) || { name: '?' }).name;
  }

  roleOf(id) {
    const r = this.roles.get(id);
    return r ? ROLES[r.id] : null;
  }

  teamOf(id) {
    const r = this.roleOf(id);
    return r ? r.team : null;
  }

  syncAutoRoles() {
    if (this.phase !== PHASES.LOBBY) return;
    if (this.autoRoles) this.selectedRoles = defaultRolesFor(this.players.size);
    const rec = recommendedRules(this.players.size);
    for (const key of Object.keys(this.autoRules)) if (this.autoRules[key]) this.settings[key] = rec[key];
  }

  // --------------------------------------------------------------- membership

  join(id, rawName) {
    const name = String(rawName || '').trim().slice(0, 24);
    if (!name) throw new GameError('Please enter a name.');
    const taken = [...this.players.values(), ...this.spectators.values()].some(
      (p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase()
    );
    if (taken) throw new GameError('That name is already taken in this game.');

    const existing = this.players.get(id) || this.spectators.get(id);
    if (existing) {
      existing.name = name;
      existing.connected = true;
      this.touch();
      return existing;
    }
    const person = { id, name, connected: true };
    if (this.phase === PHASES.LOBBY && this.players.size < MAX_PLAYERS) {
      this.players.set(id, person);
      this.order.push(id);
      if (!this.hostId) this.hostId = id;
      this.syncAutoRoles();
    } else {
      this.spectators.set(id, person);
    }
    this.touch();
    return person;
  }

  setConnected(id, connected) {
    const p = this.players.get(id) || this.spectators.get(id);
    if (p && p.connected !== connected) {
      p.connected = connected;
      this.touch();
    }
  }

  /** Leave voluntarily, or be kicked by the host (lobby only for players). */
  leave(id, by = id) {
    if (by !== id) this.requireHost(by);
    if (this.spectators.delete(id)) {
      this.touch();
      return;
    }
    if (!this.players.has(id)) return;
    if (this.phase !== PHASES.LOBBY) {
      throw new GameError('Players can only leave or be removed while in the lobby.');
    }
    this.players.delete(id);
    this.order = this.order.filter((p) => p !== id);
    this.mayorNominees.delete(id);
    if (this.hostId === id) this.hostId = this.humanIds()[0] || null;
    // Bots never keep a game alive on their own.
    if (!this.humanIds().length) {
      for (const b of this.botIds()) this.players.delete(b);
      this.order = [];
    }
    this.syncAutoRoles();
    this.touch();
  }

  makeHost(by, id) {
    this.requireHost(by);
    this.requirePlayer(id);
    if (this.isBot(id)) throw new GameError('A bot cannot be the host.');
    this.hostId = id;
    this.touch();
  }

  isEmpty() {
    return this.humanIds().length === 0 && this.spectators.size === 0;
  }

  // ------------------------------------------------------------------- bots

  isBot(id) {
    const p = this.players.get(id);
    return !!(p && p.bot);
  }

  botIds() {
    return this.order.filter((id) => this.isBot(id));
  }

  humanIds() {
    return this.order.filter((id) => this.players.has(id) && !this.isBot(id));
  }

  /** Host adds a self-playing bot (handy for local testing). */
  addBot(by) {
    this.requireHost(by);
    this.requirePhase(PHASES.LOBBY);
    if (this.players.size >= MAX_PLAYERS) throw new GameError('The game is full.');
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    const name = BOT_NAMES.find((n) => !taken.has(n.toLowerCase())) || `Bot ${this.players.size + 1}`;
    let id;
    do id = `bot-${Math.floor(this.random() * 1e9).toString(36)}`; while (this.players.has(id));
    this.players.set(id, { id, name, connected: true, bot: true });
    this.order.push(id);
    this.syncAutoRoles();
    this.touch();
    return id;
  }

  removeBots(by) {
    this.requireHost(by);
    this.requirePhase(PHASES.LOBBY);
    for (const id of this.botIds()) {
      this.players.delete(id);
      this.mayorNominees.delete(id);
    }
    this.order = this.order.filter((id) => this.players.has(id));
    this.syncAutoRoles();
    this.touch();
  }

  /** An on-screen question (bots can't talk in voice chat, so theirs appear on screen). */
  addQuestion(playerId, text, now = Date.now()) {
    this.requirePhase(PHASES.DAY);
    this.requirePlayer(playerId);
    if (playerId === this.mayorId) throw new GameError('The Mayor cannot ask questions.');
    const clean = String(text || '').trim().slice(0, 140);
    if (!clean) throw new GameError('Empty question.');
    this.questions.push({ playerId, text: clean, at: now, token: null });
    this.touch();
  }

  /** The player's latest question if it has not been answered yet. */
  openQuestion(playerId) {
    for (let i = this.questions.length - 1; i >= 0; i--) {
      const q = this.questions[i];
      if (q.playerId === playerId) return q.token ? null : q;
    }
    return null;
  }

  // ------------------------------------------------------------------ lobby

  updateSettings(by, patch = {}) {
    this.requireHost(by);
    this.requirePhase(PHASES.LOBBY);
    for (const key of Object.keys(LIMITS)) {
      if (patch[key] !== undefined) {
        const v = clampInt(patch[key], LIMITS[key]);
        if (v !== null) {
          this.settings[key] = v;
          if (key in this.autoRules) this.autoRules[key] = false;
        }
      }
    }
    if (patch.difficulty !== undefined) {
      if (patch.difficulty === 'any' || LEVELS.includes(patch.difficulty)) {
        this.settings.difficulty = patch.difficulty;
      }
    }
    if (Array.isArray(patch.lists)) {
      this.settings.lists = patch.lists.filter((l) => WORDLISTS[l]);
    }
    this.touch();
  }

  addRole(by, roleId) {
    this.requireHost(by);
    this.requirePhase(PHASES.LOBBY);
    const role = ROLES[roleId];
    if (!role) throw new GameError('Unknown role.');
    const count = this.selectedRoles.filter((r) => r === roleId).length;
    if (count >= role.maxInstances) throw new GameError(`At most ${role.maxInstances} ${role.name} allowed.`);
    if (this.selectedRoles.length >= MAX_PLAYERS) throw new GameError('Too many roles.');
    this.selectedRoles.push(roleId);
    this.autoRoles = false;
    this.touch();
  }

  removeRole(by, roleId) {
    this.requireHost(by);
    this.requirePhase(PHASES.LOBBY);
    const role = ROLES[roleId];
    if (!role) throw new GameError('Unknown role.');
    const idx = this.selectedRoles.lastIndexOf(roleId);
    if (idx === -1) throw new GameError(`No ${role.name} selected.`);
    const count = this.selectedRoles.filter((r) => r === roleId).length;
    if (role.required && count <= 1) throw new GameError(`At least one ${role.name} is required.`);
    this.selectedRoles.splice(idx, 1);
    this.autoRoles = false;
    this.touch();
  }

  useRecommendedRoles(by) {
    this.requireHost(by);
    this.requirePhase(PHASES.LOBBY);
    this.autoRoles = true;
    this.syncAutoRoles();
    this.touch();
  }

  useRecommendedRules(by) {
    this.requireHost(by);
    this.requirePhase(PHASES.LOBBY);
    for (const key of Object.keys(this.autoRules)) this.autoRules[key] = true;
    this.syncAutoRoles();
    this.touch();
  }

  toggleMayorNomination(id) {
    this.requirePlayer(id);
    this.requirePhase(PHASES.LOBBY);
    if (this.mayorNominees.has(id)) this.mayorNominees.delete(id);
    else this.mayorNominees.add(id);
    this.touch();
  }

  start(by) {
    this.requireHost(by);
    this.requirePhase(PHASES.LOBBY);
    const n = this.players.size;
    if (n < MIN_PLAYERS) throw new GameError(`Need at least ${MIN_PLAYERS} players.`);
    if (this.selectedRoles.length !== n) {
      const diff = this.selectedRoles.length - n;
      throw new GameError(
        diff < 0 ? `Select ${-diff} more role(s) to match ${n} players.` : `Remove ${diff} role(s) to match ${n} players.`
      );
    }
    if (!this.selectedRoles.includes('werewolf')) throw new GameError('At least one Werewolf is required.');

    const deck = [...this.selectedRoles];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const ids = [...this.order];
    // The Mayor is always a human: bots cannot run the token board.
    const humans = ids.filter((id) => !this.isBot(id));
    if (!humans.length) throw new GameError('At least one human player is needed to be Mayor.');
    const nominees = humans.filter((id) => this.mayorNominees.has(id));
    const keepNominees = new Set(this.mayorNominees);
    this.resetRound();
    this.mayorNominees = keepNominees;
    ids.forEach((id, i) => this.roles.set(id, { id: deck[i], doppel: false }));
    const pool = nominees.length ? nominees : humans;
    this.mayorId = pool[Math.floor(this.random() * pool.length)];
    this.wordChoices = pickWords(this.settings.wordChoices, this.settings, this.random);
    this.tokens = {
      yesno: this.settings.yesNoTokens,
      maybe: this.settings.maybeTokens,
      so_close: 1,
      so_far: 1,
      correct: 1,
    };
    this.phase = PHASES.WORD_CHOICE;
    this.touch();
  }

  // ------------------------------------------------------------------ night

  chooseWord(by, word) {
    this.requirePhase(PHASES.WORD_CHOICE);
    if (by !== this.mayorId) throw new GameError('Only the Mayor chooses the word.');
    if (!this.wordChoices.includes(word)) throw new GameError('That word is not one of your choices.');
    this.word = word;
    this.wordCategories = categoriesOf(word);
    this.enterNightCopy();
    this.touch();
  }

  enterNightCopy() {
    const doppels = [...this.roles].filter(([, r]) => r.id === 'doppelganger').map(([id]) => id);
    if (doppels.length) {
      this.phase = PHASES.NIGHT_COPY;
      this.pendingActions = new Set(doppels);
    } else {
      this.enterNightTarget();
    }
  }

  enterNightTarget() {
    const actors = [...this.roles].filter(([, r]) => ROLES[r.id].nightAction === 'target').map(([id]) => id);
    if (actors.length) {
      this.phase = PHASES.NIGHT_TARGET;
      this.pendingActions = new Set(actors);
    } else {
      this.enterNightReveal();
    }
  }

  enterNightReveal() {
    this.phase = PHASES.NIGHT_REVEAL;
    this.pendingActions = new Set();
    this.pendingAcks = new Set(this.players.keys());
  }

  nightAction(by, targetId) {
    this.requirePhase(PHASES.NIGHT_COPY, PHASES.NIGHT_TARGET);
    if (!this.pendingActions.has(by)) throw new GameError('You have no night action to take.');
    if (!this.players.has(targetId) || targetId === by) throw new GameError('Choose another player.');

    if (this.phase === PHASES.NIGHT_COPY) {
      const target = this.roles.get(targetId);
      // Copying another (unresolved) Doppelganger would loop; copy what they become as a Villager.
      const copiedId = target.id === 'doppelganger' ? 'villager' : target.id;
      this.roles.set(by, { id: copiedId, doppel: true, copiedFrom: targetId });
      this.addKnown(by, targetId, ROLES[target.id].name);
      this.pendingActions.delete(by);
      if (!this.pendingActions.size) this.enterNightTarget();
    } else {
      this.targets.set(by, targetId);
      // The target learns the Esper's identity.
      this.addKnown(targetId, by, ROLES[this.roles.get(by).id].name);
      this.pendingActions.delete(by);
      if (!this.pendingActions.size) this.enterNightReveal();
    }
    this.touch();
  }

  addKnown(viewer, subject, label) {
    if (!this.extraKnown.has(viewer)) this.extraKnown.set(viewer, []);
    const list = this.extraKnown.get(viewer);
    if (!list.some((k) => k.id === subject)) list.push({ id: subject, label });
  }

  /** Mayor-aware: is this player a target whose death loses the game for the village? */
  isCritical(id) {
    if (id === this.mayorId) return false; // the Mayor is public and protected
    const role = this.roles.get(id);
    if (!role) return false;
    if (ROLES[role.id].critical) return true;
    if (role.id === 'apprentice') {
      const mayorRole = this.roles.get(this.mayorId);
      return !!mayorRole && mayorRole.id === 'seer';
    }
    return false;
  }

  /** What a given player secretly knows (word + other players). */
  knowledge(id) {
    const out = { word: null, wordHint: null, known: [] };
    const mine = this.roles.get(id);
    if (!mine) return out;
    if (id === this.mayorId && this.word) out.word = this.word;
    const revealed = [PHASES.NIGHT_REVEAL, PHASES.DAY, PHASES.VOTE, PHASES.RESULTS].includes(this.phase);
    if (!revealed) return out;

    const others = [...this.roles].filter(([pid]) => pid !== id);
    const add = (pid, label) => {
      if (!out.known.some((k) => k.id === pid)) out.known.push({ id: pid, name: this.name(pid), label });
    };
    const mayorRole = this.roles.get(this.mayorId);

    switch (mine.id) {
      case 'werewolf':
        out.word = this.word;
        others.filter(([, r]) => r.id === 'werewolf').forEach(([pid]) => add(pid, 'Werewolf'));
        break;
      case 'seer':
        out.word = this.word;
        others.filter(([, r]) => r.id === 'seer').forEach(([pid]) => add(pid, 'Seer'));
        break;
      case 'apprentice':
        if (mayorRole && mayorRole.id === 'seer') {
          out.word = this.word;
          add(this.mayorId, 'Seer');
        }
        break;
      case 'fortuneteller':
        out.wordHint = this.word
          .split(/\s+/)
          .map((w) => w[0] + '•'.repeat(Math.max(0, w.length - 1)))
          .join(' ');
        break;
      case 'minion':
        others.filter(([, r]) => r.id === 'werewolf' || r.id === 'minion').forEach(([pid, r]) => add(pid, ROLES[r.id].name));
        break;
      case 'beholder':
        others
          .filter(([, r]) => ['seer', 'apprentice', 'fortuneteller'].includes(r.id))
          .forEach(([pid]) => add(pid, 'Seer, Apprentice or Fortune Teller'));
        break;
      case 'mason':
        others.filter(([, r]) => r.id === 'mason').forEach(([pid]) => add(pid, 'Mason'));
        break;
      default:
        break;
    }
    for (const k of this.extraKnown.get(id) || []) add(k.id, k.label);
    if (id === this.mayorId) out.word = this.word;
    return out;
  }

  acknowledge(id) {
    this.requirePhase(PHASES.NIGHT_REVEAL);
    if (!this.pendingAcks.delete(id)) return;
    if (!this.pendingAcks.size) this.startDay(Date.now());
    this.touch();
  }

  /** Host escape hatch for an AFK player during the night. */
  forceNight(by, now = Date.now()) {
    this.requireHost(by);
    if (this.phase === PHASES.NIGHT_COPY || this.phase === PHASES.NIGHT_TARGET) {
      const others = (actor) => [...this.players.keys()].filter((p) => p !== actor);
      for (const actor of [...this.pendingActions]) {
        const opts = others(actor);
        this.nightAction(actor, opts[Math.floor(this.random() * opts.length)]);
        if (this.phase !== PHASES.NIGHT_COPY && this.phase !== PHASES.NIGHT_TARGET) break;
      }
      if (this.phase === PHASES.NIGHT_TARGET) return this.forceNight(by, now);
    } else if (this.phase === PHASES.NIGHT_REVEAL) {
      this.pendingAcks.clear();
      this.startDay(now);
    } else {
      throw new GameError('Nothing to skip.');
    }
    this.touch();
  }

  // -------------------------------------------------------------------- day

  startDay(now) {
    this.phase = PHASES.DAY;
    this.dayEndsAt = now + this.settings.dayTimer * 1000;
  }

  giveToken(by, playerId, token, now = Date.now()) {
    this.requirePhase(PHASES.DAY);
    if (by !== this.mayorId) throw new GameError('Only the Mayor gives tokens.');
    if (!this.players.has(playerId)) throw new GameError('Unknown player.');
    if (playerId === this.mayorId) throw new GameError('The Mayor cannot ask questions.');
    const def = TOKENS[token];
    if (!def) throw new GameError('Unknown token.');
    if (this.tokens[def.pool] <= 0) throw new GameError(`No ${def.label} tokens left.`);
    this.tokens[def.pool]--;
    const q = this.openQuestion(playerId);
    if (q) q.token = token;
    this.answers.push({ playerId, token, at: now, question: q });
    if (token === 'correct') this.startVote(now, true, 'guessed');
    else if (this.tokens.yesno <= 0) this.startVote(now, false, 'tokens');
    this.touch();
  }

  /** Undo the Mayor's last token. Works in the vote phase too if the token ended the day. */
  undoToken(by, now = Date.now()) {
    if (by !== this.mayorId) throw new GameError('Only the Mayor can undo.');
    this.requirePhase(PHASES.DAY, PHASES.VOTE);
    if (!this.answers.length) throw new GameError('Nothing to undo.');
    if (this.phase === PHASES.VOTE) {
      if (!['guessed', 'tokens'].includes(this.voteReason) || this.dayRemainingAtVote <= 0) {
        throw new GameError('Too late to undo.');
      }
      this.phase = PHASES.DAY;
      this.dayEndsAt = now + this.dayRemainingAtVote;
      this.wordGuessed = false;
      this.voters = [];
      this.votes = new Map();
      this.voteEndsAt = null;
      this.voteReason = null;
    }
    const last = this.answers.pop();
    if (last.question) last.question.token = null;
    this.tokens[TOKENS[last.token].pool]++;
    this.touch();
  }

  /** The Mayor can call it early (e.g. the village gives up), matching the original "start vote" button. */
  endDay(by, now = Date.now()) {
    this.requirePhase(PHASES.DAY);
    if (by !== this.mayorId && !this.isHost(by)) throw new GameError('Only the Mayor or host can end the day.');
    this.startVote(now, false, 'called');
    this.touch();
  }

  tallies() {
    const t = {};
    for (const id of this.players.keys()) t[id] = Object.fromEntries(TOKEN_IDS.map((k) => [k, 0]));
    for (const a of this.answers) if (t[a.playerId]) t[a.playerId][a.token]++;
    return t;
  }

  // ------------------------------------------------------------------- vote

  startVote(now, wordGuessed, reason) {
    this.phase = PHASES.VOTE;
    this.voteReason = reason;
    this.wordGuessed = wordGuessed;
    this.dayRemainingAtVote = Math.max(0, (this.dayEndsAt || now) - now);
    this.votes = new Map();
    this.voteEndsAt = now + this.settings.voteTimer * 1000;
    if (wordGuessed) {
      this.voters = [...this.roles].filter(([, r]) => ROLES[r.id].votesOnGuessed).map(([id]) => id);
    } else {
      this.voters = [...this.players.keys()];
    }
    if (!this.voters.length) this.finishVote(now);
  }

  candidatesFor(voterId) {
    const all = [...this.players.keys()].filter((id) => id !== voterId);
    if (this.wordGuessed) return all.filter((id) => this.teamOf(id) !== 'werewolf' || !ROLES[this.roles.get(id).id].votesOnGuessed);
    return all;
  }

  vote(by, targetId, now = Date.now()) {
    this.requirePhase(PHASES.VOTE);
    if (!this.voters.includes(by)) throw new GameError('You are not voting this round.');
    if (!this.candidatesFor(by).includes(targetId)) throw new GameError('You cannot vote for that player.');
    this.votes.set(by, targetId);
    if (this.voters.every((v) => this.votes.has(v))) this.finishVote(now);
    this.touch();
  }

  forceFinishVote(by, now = Date.now()) {
    this.requirePhase(PHASES.VOTE);
    if (by !== this.mayorId && !this.isHost(by)) throw new GameError('Only the Mayor or host can close voting.');
    this.finishVote(now);
    this.touch();
  }

  finishVote() {
    const counts = new Map();
    for (const t of this.votes.values()) counts.set(t, (counts.get(t) || 0) + 1);
    let winner;
    let killed = [];
    let reason;

    // The single player with the most votes, or null if nobody voted or the top is tied.
    const max = Math.max(0, ...counts.values());
    const top = [...counts].filter(([, c]) => c === max).map(([id]) => id);
    const unique = max > 0 && top.length === 1 ? top[0] : null;
    const roleName = (id) => ROLES[this.roles.get(id).id].name;

    if (this.wordGuessed) {
      // One shared pick: the werewolves' plurality choice. A tie is a miss.
      if (unique) killed = [unique];
      if (unique && this.isCritical(unique)) {
        winner = 'werewolf';
        reason = `The village guessed the word, but the werewolves found the ${roleName(unique)}.`;
      } else {
        winner = 'village';
        reason = unique
          ? 'The village guessed the word and the werewolves missed their mark.'
          : counts.size
            ? 'The village guessed the word and the werewolves could not agree on a target.'
            : 'The village guessed the word and the werewolves never struck.';
      }
    } else {
      // Everyone with the most votes is voted out, ties included. At least 2 votes are
      // needed, so a table where every player got exactly one vote removes nobody.
      if (max > 1) killed = top;
      const caught = killed.filter((id) => ROLES[this.roles.get(id).id].losesIfKilled);
      if (caught.length) {
        winner = 'village';
        reason = `The word was not guessed, but the village caught the ${caught.map(roleName).join(' and ')}.`;
      } else {
        winner = 'werewolf';
        reason = killed.length
          ? 'The word was not guessed and the village voted out an innocent.'
          : 'The word was not guessed and the village could not agree on anyone.';
      }
    }

    this.result = {
      winner,
      reason,
      killed,
      counts: Object.fromEntries(counts),
      votes: Object.fromEntries(this.votes),
    };
    this.phase = PHASES.RESULTS;
    this.voteEndsAt = null;
  }

  // ------------------------------------------------------------------ timers

  nextDeadline() {
    if (this.phase === PHASES.DAY) return this.dayEndsAt;
    if (this.phase === PHASES.VOTE) return this.voteEndsAt;
    return null;
  }

  /** Advance timed phases. Returns true if state changed. */
  tick(now = Date.now()) {
    if (this.phase === PHASES.DAY && now >= this.dayEndsAt) {
      this.startVote(now, false, 'timer');
      this.touch();
      return true;
    }
    if (this.phase === PHASES.VOTE && now >= this.voteEndsAt) {
      this.finishVote(now);
      this.touch();
      return true;
    }
    return false;
  }

  backToLobby(by) {
    this.requireHost(by);
    for (const [id, s] of this.spectators) {
      if (this.players.size >= MAX_PLAYERS) break;
      this.players.set(id, s);
      this.order.push(id);
      this.spectators.delete(id);
    }
    const nominees = this.mayorNominees;
    this.resetRound();
    this.mayorNominees = nominees;
    this.syncAutoRoles();
    this.touch();
  }

  // -------------------------------------------------------------------- view

  /** Personalized, secret-safe snapshot for one viewer. */
  view(viewerId, now = Date.now()) {
    const isPlayer = this.players.has(viewerId);
    const finished = this.phase === PHASES.RESULTS;
    const myRole = this.roles.get(viewerId);
    const tallies = this.tallies();

    const players = this.order
      .filter((id) => this.players.has(id))
      .map((id) => {
        const p = this.players.get(id);
        const entry = {
          id,
          name: p.name,
          connected: p.connected,
          isHost: id === this.hostId,
          isMayor: id === this.mayorId,
          nominee: this.mayorNominees.has(id),
          bot: !!p.bot,
          question: this.phase === PHASES.DAY ? (this.openQuestion(id) || {}).text || null : null,
          tokens: tallies[id],
          waiting:
            (this.phase === PHASES.NIGHT_REVEAL && this.pendingAcks.has(id)) ||
            (this.phase === PHASES.VOTE && this.voters.includes(id) && !this.votes.has(id)),
          voter: this.phase === PHASES.VOTE && this.voters.includes(id),
        };
        if (finished) {
          const r = this.roles.get(id);
          entry.role = r.id;
          entry.doppel = r.doppel;
        }
        return entry;
      });

    const view = {
      code: this.code,
      version: this.version,
      serverNow: now,
      phase: this.phase,
      me: {
        id: viewerId,
        isPlayer,
        isSpectator: this.spectators.has(viewerId),
        isHost: viewerId === this.hostId,
        isMayor: viewerId === this.mayorId,
      },
      players,
      spectators: [...this.spectators.values()].map((s) => ({ id: s.id, name: s.name, connected: s.connected })),
      settings: this.settings,
      selectedRoles: this.selectedRoles,
      autoRoles: this.autoRoles,
      autoRules: this.autoRules,
      mayorId: this.mayorId,
      tokens: this.tokens,
      answers: this.answers.slice(-12).map((a) => ({ playerId: a.playerId, token: a.token, at: a.at })),
      answerCount: this.answers.length,
      questions: this.questions.slice(-10).map((q) => ({ playerId: q.playerId, text: q.text, token: q.token })),
      dayEndsAt: this.phase === PHASES.DAY ? this.dayEndsAt : null,
      voteEndsAt: this.phase === PHASES.VOTE ? this.voteEndsAt : null,
      pendingActions: [...this.pendingActions],
      pendingAckCount: this.pendingAcks.size,
    };

    if (myRole) {
      const k = this.knowledge(viewerId);
      view.me.role = myRole.id;
      view.me.doppel = myRole.doppel;
      view.me.knowledge = k;
      view.me.needsAction = this.pendingActions.has(viewerId);
      view.me.needsAck = this.phase === PHASES.NIGHT_REVEAL && this.pendingAcks.has(viewerId);
    }
    if (this.phase === PHASES.WORD_CHOICE && viewerId === this.mayorId) view.me.wordChoices = this.wordChoices;

    if (this.phase === PHASES.VOTE) {
      view.vote = {
        wordGuessed: this.wordGuessed,
        reason: this.voteReason,
        voterCount: this.voters.length,
        votedCount: this.votes.size,
        canUndo:
          viewerId === this.mayorId && ['guessed', 'tokens'].includes(this.voteReason) && this.dayRemainingAtVote > 0,
      };
      if (this.voters.includes(viewerId)) {
        view.vote.candidates = this.candidatesFor(viewerId);
        view.vote.myVote = this.votes.get(viewerId) || null;
      }
      // Werewolves see each other's picks while hunting, like pointing in person.
      if (this.wordGuessed && this.voters.includes(viewerId)) {
        view.vote.teamVotes = Object.fromEntries(this.votes);
      }
    }

    if (finished) {
      view.word = this.word;
      view.result = this.result;
      view.wordGuessed = this.wordGuessed;
      if (myRole) view.me.won = ROLES[myRole.id].team === this.result.winner;
    }
    return view;
  }
}

module.exports = { recommendedRules, Game, GameError, PHASES, TOKENS, TOKEN_IDS, DEFAULT_SETTINGS, LIMITS, MIN_PLAYERS, MAX_PLAYERS, ROLE_ORDER };
