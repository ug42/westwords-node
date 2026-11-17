'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, GameError, PHASES } = require('../src/game');
const { BotDriver, questionFor, voteFor, CATEGORY_PHRASE } = require('../src/bots');

// mulberry32: small, well-distributed seeded PRNG
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lobbyWithBots(humans, bots, random = Math.random) {
  const g = new Game('BOTS', { random });
  humans.forEach((h) => g.join(h, h));
  for (let i = 0; i < bots; i++) g.addBot(humans[0]);
  return g;
}

test('host adds and removes bots; bots get unique names and a bot flag', () => {
  const g = lobbyWithBots(['ann'], 5);
  assert.equal(g.players.size, 6);
  assert.equal(g.botIds().length, 5);
  assert.equal(new Set([...g.players.values()].map((p) => p.name)).size, 6);
  assert.ok(g.view('ann').players.filter((p) => p.bot).length === 5);
  assert.throws(() => g.addBot('nobody'), GameError);
  assert.throws(() => g.makeHost('ann', g.botIds()[0]), /bot cannot be the host/);
  g.removeBots('ann');
  assert.equal(g.players.size, 1);
});

test('the Mayor is always a human, with or without volunteers', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const g = lobbyWithBots(['ann', 'bob'], 6, seeded(seed));
    // even a bot "volunteering" cannot become Mayor
    g.mayorNominees.add(g.botIds()[0]);
    g.start('ann');
    assert.ok(['ann', 'bob'].includes(g.mayorId), `seed ${seed} picked ${g.mayorId}`);
  }
  const solo = lobbyWithBots(['ann'], 3);
  solo.start('ann');
  assert.equal(solo.mayorId, 'ann');
});

test('bots never keep a game alive once the humans leave', () => {
  const g = lobbyWithBots(['ann'], 3);
  g.leave('ann');
  assert.equal(g.players.size, 0);
  assert.ok(g.isEmpty());
});

/** Set up a started game in the day phase with fixed roles; p0 (human) is Mayor. */
function dayGame(roles) {
  const g = new Game('Q');
  g.join('p0', 'Human');
  for (let i = 1; i < roles.length; i++) {
    const id = g.addBot('p0');
    g.players.set(`p${i}`, { ...g.players.get(id), id: `p${i}` });
    g.players.delete(id);
    g.order[g.order.indexOf(id)] = `p${i}`;
  }
  g.selectedRoles = [...roles];
  g.autoRoles = false;
  g.start('p0');
  roles.forEach((r, i) => g.roles.set(`p${i}`, { id: r, doppel: false }));
  g.mayorId = 'p0';
  g.wordChoices = ['Mars'];
  g.chooseWord('p0', 'Mars');
  g.forceNight('p0');
  if (g.phase === PHASES.NIGHT_REVEAL) g.forceNight('p0');
  assert.equal(g.phase, PHASES.DAY);
  return g;
}

test('bot questions fit what each role knows', () => {
  const g = dayGame(['villager', 'seer', 'werewolf', 'fortuneteller', 'minion', 'villager']);
  const space = CATEGORY_PHRASE.space;
  const asked = (id, n = 400) => [...Array(n)].map((_, i) => questionFor(g, id, seeded(i + 1)));

  const seer = asked('p1');
  assert.ok(seer.includes(`Is it ${space}?`), 'seer hints the true category');
  assert.ok(seer.includes('Does it start with "M"?'), 'seer hints the true letter');
  assert.ok(!seer.some((q) => q.includes('"Mars"')), 'seer never says the word');

  const wolf = asked('p2');
  assert.ok(!wolf.includes(`Is it ${space}?`), 'werewolf never confirms the true category');
  assert.ok(!wolf.includes('Does it start with "M"?'), 'werewolf never gives the true letter');
  assert.ok(!wolf.some((q) => q.includes('"Mars"')));

  const ft = asked('p3');
  assert.ok(ft.includes('Does it start with "M"?'), 'fortune teller probes its letter');

  for (const id of ['p4', 'p5']) assert.ok(!asked(id).some((q) => q.includes('"Mars"')));
  for (const q of [...seer, ...wolf, ...ft]) assert.match(q, /\?$/);
});

test('on-screen questions are answered by the Mayor and undo reopens them', () => {
  const g = dayGame(['villager', 'seer', 'werewolf', 'villager']);
  g.addQuestion('p1', 'Is it a planet?');
  assert.equal(g.view('p0').players.find((p) => p.id === 'p1').question, 'Is it a planet?');
  assert.throws(() => g.addQuestion('p0', 'Mayor question?'), GameError);
  g.giveToken('p0', 'p1', 'yes');
  assert.equal(g.questions[0].token, 'yes');
  assert.equal(g.view('p0').players.find((p) => p.id === 'p1').question, null);
  g.undoToken('p0');
  assert.equal(g.questions[0].token, null);
});

test('werewolf bots in the hunt follow their packmate; nobody votes a known teammate', () => {
  const g = dayGame(['villager', 'werewolf', 'werewolf', 'seer', 'villager', 'villager']);
  g.giveToken('p0', 'p4', 'correct');
  g.vote('p1', 'p3');
  assert.equal(voteFor(g, 'p2', g.candidatesFor('p2'), seeded(3)), 'p3');

  const h = dayGame(['villager', 'werewolf', 'werewolf', 'seer', 'villager', 'villager']);
  h.endDay('p0');
  for (let s = 1; s < 50; s++) assert.notEqual(voteFor(h, 'p1', h.candidatesFor('p1'), seeded(s)), 'p2');
});

test('bot driver plays a full round around a human Mayor', () => {
  const g = lobbyWithBots(['ann'], 7, seeded(42));
  g.start('ann');
  assert.equal(g.mayorId, 'ann');
  const driver = new BotDriver(g, { random: seeded(7), speed: 1 });
  let now = Date.now();
  const run = (ms) => {
    for (let t = 0; t < ms; t += 250) {
      now += 250;
      driver.step(now);
      g.tick(now);
    }
  };
  g.chooseWord('ann', g.wordChoices[0]);
  run(15000); // bots do night actions
  if (g.pendingAcks.has('ann')) g.acknowledge('ann');
  run(10000);
  assert.equal(g.phase, PHASES.DAY);
  g.dayEndsAt = now + 120000;
  run(30000);
  assert.ok(g.questions.length >= 3, `expected bot questions, got ${g.questions.length}`);
  // each bot has at most one unanswered question at a time
  const open = g.botIds().filter((b) => g.openQuestion(b));
  assert.equal(open.length, new Set(open).size);
  const asker = g.questions[0].playerId;
  g.giveToken('ann', asker, 'correct', now);
  assert.equal(g.phase, PHASES.VOTE);
  // the human may be a werewolf who also has to vote
  if (g.voters.includes("ann")) g.vote("ann", g.candidatesFor("ann")[0], now);
  run(10000);
  assert.equal(g.phase, PHASES.RESULTS);
  assert.ok(g.result.winner);
});

test("bots never repeat a question already asked this round", () => {
  const g = dayGame(["villager", "seer", "werewolf", "fortuneteller", "minion", "villager"]);
  const rnd = seeded(11);
  const bots = ["p1", "p2", "p3", "p4", "p5"];
  for (let i = 0; i < 120; i++) {
    const bot = bots[i % bots.length];
    const q = questionFor(g, bot, rnd);
    if (!q) continue;
    g.addQuestion(bot, q);
    g.questions[g.questions.length - 1].token = "maybe"; // mark answered so the bot can ask again
  }
  const norm = g.questions.map((q) => q.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  assert.ok(norm.length > 60, "bots kept finding fresh questions");
  assert.equal(new Set(norm).size, norm.length, "no duplicates");
  assert.ok(!norm.some((q) => q === "is it mars"), "nobody blurts the word");
});
