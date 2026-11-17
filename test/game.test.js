'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, GameError, PHASES, recommendedRules } = require('../src/game');
const { DEFAULT_ROLES, ROLES } = require('../src/roles');

/** Build a game with n players and force a specific role layout. */
function setup(roles, { mayor = 'p0' } = {}) {
  const g = new Game('TEST');
  roles.forEach((_, i) => g.join(`p${i}`, `Player${i}`));
  g.useRecommendedRoles('p0');
  // replace the deck with an exact assignment
  g.selectedRoles = [...roles];
  g.autoRoles = false;
  g.start('p0');
  roles.forEach((r, i) => g.roles.set(`p${i}`, { id: r, doppel: false }));
  g.mayorId = mayor;
  return g;
}

function toDay(g, now = 1000) {
  g.chooseWord(g.mayorId, g.wordChoices[0]);
  while (g.phase === PHASES.NIGHT_COPY || g.phase === PHASES.NIGHT_TARGET) {
    const actor = [...g.pendingActions][0];
    const target = [...g.players.keys()].find((p) => p !== actor);
    g.nightAction(actor, target);
  }
  assert.equal(g.phase, PHASES.NIGHT_REVEAL);
  for (const id of g.players.keys()) g.acknowledge(id);
  assert.equal(g.phase, PHASES.DAY);
  g.dayEndsAt = now + g.settings.dayTimer * 1000;
}

test('default role sets match player counts and include a werewolf', () => {
  for (const [n, roles] of Object.entries(DEFAULT_ROLES)) {
    assert.equal(roles.length, Number(n));
    assert.ok(roles.includes('werewolf'));
    for (const r of roles) assert.ok(ROLES[r], r);
  }
});

test('lobby: host, auto roles, late joiners spectate', () => {
  const g = new Game('X');
  g.join('a', 'Ann');
  g.join('b', 'Bob');
  g.join('c', 'Cy');
  assert.equal(g.hostId, 'a');
  assert.deepEqual(g.selectedRoles, DEFAULT_ROLES[3]);
  assert.throws(() => g.join('d', 'ann'), GameError); // duplicate name
  assert.throws(() => g.start('b'), GameError); // not host
  g.start('a');
  assert.equal(g.phase, PHASES.WORD_CHOICE);
  g.join('d', 'Dee');
  assert.ok(g.spectators.has('d'));
  assert.equal(g.wordChoices.length, 8);
  assert.equal(new Set(g.wordChoices).size, 8);
});

test('role count must match players; werewolf cannot be removed', () => {
  const g = new Game('X');
  ['a', 'b', 'c'].forEach((id) => g.join(id, id));
  assert.throws(() => g.removeRole('a', 'werewolf'), GameError);
  g.addRole('a', 'villager');
  assert.throws(() => g.start('a'), /Remove 1/);
  g.removeRole('a', 'villager');
  g.start('a');
});

test('mayor is chosen from nominees', () => {
  const g = new Game('X');
  ['a', 'b', 'c', 'd'].forEach((id) => g.join(id, id));
  g.toggleMayorNomination('c');
  g.start('a');
  assert.equal(g.mayorId, 'c');
});

test('night knowledge per role', () => {
  const g = setup(['villager', 'werewolf', 'werewolf', 'seer', 'fortuneteller', 'minion', 'beholder', 'mason', 'mason', 'apprentice']);
  toDay(g);
  const w = g.word;
  assert.equal(g.knowledge('p0').word, w); // mayor
  assert.equal(g.knowledge('p1').word, w);
  assert.deepEqual(g.knowledge('p1').known.map((k) => k.id), ['p2']);
  assert.equal(g.knowledge('p3').word, w);
  assert.equal(g.knowledge('p4').word, null);
  assert.equal(g.knowledge('p4').wordHint[0], w[0]);
  assert.deepEqual(g.knowledge('p5').known.map((k) => k.id).sort(), ['p1', 'p2']);
  assert.equal(g.knowledge('p5').word, null);
  assert.deepEqual(g.knowledge('p6').known.map((k) => k.id).sort(), ['p3', 'p4', 'p9']);
  assert.deepEqual(g.knowledge('p7').known.map((k) => k.id), ['p8']);
  assert.equal(g.knowledge('p9').word, null); // apprentice, mayor is not seer
});

test('apprentice sees the word and becomes the target when the mayor is the seer', () => {
  const g = setup(['seer', 'apprentice', 'werewolf', 'villager']);
  toDay(g);
  assert.equal(g.knowledge('p1').word, g.word);
  assert.ok(g.isCritical('p1'));
  assert.ok(!g.isCritical('p0'));
});

test('secrets are not leaked in views', () => {
  const g = setup(['villager', 'werewolf', 'seer', 'villager']);
  toDay(g);
  const v = g.view('p3');
  assert.equal(v.me.knowledge.word, null);
  assert.ok(v.players.every((p) => p.role === undefined));
  assert.ok(!JSON.stringify(v).includes(g.word));
});

test('doppelganger copies a role and its team; esper reveals itself to target', () => {
  const g = setup(['villager', 'doppelganger', 'werewolf', 'esper', 'villager', 'villager']);
  g.chooseWord('p0', g.wordChoices[0]);
  assert.equal(g.phase, PHASES.NIGHT_COPY);
  assert.throws(() => g.nightAction('p3', 'p0'), GameError);
  g.nightAction('p1', 'p2');
  assert.equal(g.roles.get('p1').id, 'werewolf');
  assert.equal(g.roles.get('p1').doppel, true);
  assert.equal(g.phase, PHASES.NIGHT_TARGET);
  g.nightAction('p3', 'p4');
  assert.equal(g.phase, PHASES.NIGHT_REVEAL);
  assert.deepEqual(g.knowledge('p4').known, [{ id: 'p3', name: 'Player3', label: 'Esper' }]);
  assert.deepEqual(g.knowledge('p2').known.map((k) => k.id), ['p1']);
  assert.ok(g.knowledge('p1').known.some((k) => k.id === 'p2'));
});

test('tokens: shared yes/no pool, correct starts werewolf hunt, undo restores day', () => {
  const g = setup(['villager', 'werewolf', 'seer', 'villager']);
  toDay(g, 0);
  assert.throws(() => g.giveToken('p1', 'p2', 'yes', 10), GameError); // not mayor
  assert.throws(() => g.giveToken('p0', 'p0', 'yes', 10), GameError); // mayor can't ask
  g.giveToken('p0', 'p2', 'yes', 10);
  g.giveToken('p0', 'p3', 'no', 20);
  assert.equal(g.tokens.yesno, g.settings.yesNoTokens - 2);
  assert.equal(g.tallies().p2.yes, 1);
  g.giveToken('p0', 'p3', 'correct', 30_000);
  assert.equal(g.phase, PHASES.VOTE);
  assert.deepEqual(g.voters, ['p1']);
  assert.ok(!g.candidatesFor('p1').includes('p1'));
  g.undoToken('p0', 40_000);
  assert.equal(g.phase, PHASES.DAY);
  assert.equal(g.tokens.correct, 1);
  assert.equal(g.dayEndsAt, 40_000 + (g.settings.dayTimer * 1000 - 30_000));
});

test('running out of yes/no tokens starts an everyone vote', () => {
  const g = setup(['villager', 'werewolf', 'seer', 'villager']);
  g.settings.yesNoTokens = 4;
  g.tokens.yesno = 2;
  toDay(g);
  g.giveToken('p0', 'p2', 'yes');
  g.giveToken('p0', 'p2', 'no');
  assert.equal(g.phase, PHASES.VOTE);
  assert.equal(g.wordGuessed, false);
  assert.equal(g.voters.length, 4);
});

test('timer expiry moves day to vote and vote to results', () => {
  const g = setup(['villager', 'werewolf', 'seer', 'villager']);
  toDay(g, 0);
  assert.equal(g.tick(1000), false);
  assert.equal(g.tick(g.dayEndsAt), true);
  assert.equal(g.phase, PHASES.VOTE);
  assert.equal(g.tick(g.voteEndsAt), true);
  assert.equal(g.phase, PHASES.RESULTS);
  assert.equal(g.result.winner, 'werewolf');
});

test('word guessed: werewolves win by voting the seer, lose otherwise', () => {
  let g = setup(['villager', 'werewolf', 'seer', 'villager']);
  toDay(g);
  g.giveToken('p0', 'p3', 'correct');
  g.vote('p1', 'p2');
  assert.equal(g.result.winner, 'werewolf');

  g = setup(['villager', 'werewolf', 'seer', 'villager']);
  toDay(g);
  g.giveToken('p0', 'p3', 'correct');
  g.vote('p1', 'p3');
  assert.equal(g.result.winner, 'village');
});

test('word not guessed: village wins only by plurality vote on werewolf/minion', () => {
  let g = setup(['villager', 'werewolf', 'seer', 'villager']);
  toDay(g);
  g.endDay('p0');
  g.vote('p0', 'p1');
  g.vote('p1', 'p2');
  g.vote('p2', 'p1');
  g.vote('p3', 'p1');
  assert.equal(g.result.winner, 'village');
  assert.deepEqual(g.result.killed, ['p1']);

  // everyone split 1-1-1-1: nobody dies, werewolves win
  g = setup(['villager', 'werewolf', 'seer', 'villager']);
  toDay(g);
  g.endDay('p0');
  g.vote('p0', 'p1');
  g.vote('p1', 'p2');
  g.vote('p2', 'p3');
  g.vote('p3', 'p0');
  assert.equal(g.result.winner, 'werewolf');
  assert.deepEqual(g.result.killed, []);
});

test('results reveal roles; back to lobby promotes spectators', () => {
  const g = setup(['villager', 'werewolf', 'seer', 'villager']);
  g.join('s', 'Spec');
  toDay(g);
  g.endDay('p0');
  g.forceFinishVote('p0');
  const v = g.view('p2');
  assert.equal(v.phase, PHASES.RESULTS);
  assert.ok(v.players.every((p) => p.role));
  assert.equal(v.me.won, false);
  g.backToLobby('p0');
  assert.equal(g.phase, PHASES.LOBBY);
  assert.ok(g.players.has('s'));
  assert.equal(g.selectedRoles.length, 4); // custom role picks are kept for the host to adjust
  g.useRecommendedRoles('p0');
  assert.equal(g.selectedRoles.length, 5);
});

test('host can skip AFK night players', () => {
  const g = setup(['villager', 'doppelganger', 'werewolf', 'esper', 'villager', 'villager']);
  g.chooseWord('p0', g.wordChoices[0]);
  g.forceNight('p0');
  assert.equal(g.phase, PHASES.NIGHT_REVEAL);
  g.forceNight('p0');
  assert.equal(g.phase, PHASES.DAY);
});

test("balance: werewolves get one shared pick; a tie is a miss", () => {
  // two werewolves, split votes between seer and villager -> tie -> miss
  let g = setup(["villager", "werewolf", "werewolf", "seer", "villager", "villager"]);
  toDay(g);
  g.giveToken("p0", "p4", "correct");
  assert.deepEqual(g.voters.sort(), ["p1", "p2"]);
  g.vote("p1", "p3");
  g.vote("p2", "p4");
  assert.equal(g.result.winner, "village");
  assert.deepEqual(g.result.killed, []);

  // both agree on the seer -> werewolves win
  g = setup(["villager", "werewolf", "werewolf", "seer", "villager", "villager"]);
  toDay(g);
  g.giveToken("p0", "p4", "correct");
  g.vote("p1", "p3");
  g.vote("p2", "p3");
  assert.equal(g.result.winner, "werewolf");
  assert.deepEqual(g.result.killed, ["p3"]);
});

test("village vote: ties vote out everyone tied, catching a hidden werewolf", () => {
  const g = setup(["villager", "werewolf", "seer", "villager", "villager"]);
  toDay(g);
  g.endDay("p0");
  g.vote("p0", "p1");
  g.vote("p2", "p1");
  g.vote("p1", "p3");
  g.vote("p3", "p4");
  g.vote("p4", "p3"); // p1: 2, p3: 2 -> both out
  assert.deepEqual(g.result.killed.sort(), ["p1", "p3"]);
  assert.equal(g.result.winner, "village");

  // tie between two innocents: werewolves win
  const h = setup(["villager", "werewolf", "seer", "villager", "villager"]);
  toDay(h);
  h.endDay("p0");
  h.vote("p0", "p3");
  h.vote("p1", "p3");
  h.vote("p2", "p4");
  h.vote("p3", "p4");
  h.vote("p4", "p0");
  assert.deepEqual(h.result.killed.sort(), ["p3", "p4"]);
  assert.equal(h.result.winner, "werewolf");
});

test("balance: tokens and day timer scale with players until host overrides", () => {
  assert.deepEqual(recommendedRules(4), { yesNoTokens: 16, dayTimer: 240 });
  assert.deepEqual(recommendedRules(10), { yesNoTokens: 36, dayTimer: 420 });
  assert.deepEqual(recommendedRules(20), { yesNoTokens: 40, dayTimer: 480 });
  const g = new Game("X");
  ["a", "b", "c", "d"].forEach((id) => g.join(id, id));
  assert.equal(g.settings.yesNoTokens, 16);
  g.updateSettings("a", { dayTimer: 600 });
  ["e", "f", "g", "h", "i", "j"].forEach((id) => g.join(id, id));
  assert.equal(g.settings.yesNoTokens, 36); // still auto
  assert.equal(g.settings.dayTimer, 600); // host override sticks
  g.useRecommendedRules("a");
  assert.equal(g.settings.dayTimer, 420);
});

test("balance: 4-player default has a Seer and Fortune Teller", () => {
  assert.deepEqual([...DEFAULT_ROLES[4]].sort(), ["fortuneteller", "seer", "villager", "werewolf"]);
});
