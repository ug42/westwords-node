'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { server, games } = require('../server');

function client(port, token) {
  const s = connect(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'], forceNew: true });
  s.last = null;
  s.on('state', (v) => (s.last = v));
  s.call = (ev, payload = {}) => new Promise((res) => s.emit(ev, payload, res));
  s.act = (type, args = {}) => s.call('action', { type, ...args });
  return s;
}

const settle = () => new Promise((r) => setTimeout(r, 60));

test('full round over sockets', async (t) => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const tokens = ['a', 'b', 'c', 'd'].map((x) => x.repeat(20));
  const [host, ...rest] = tokens.map((tk) => client(port, tk));
  t.after(() => {
    [host, ...rest].forEach((s) => s.close());
    server.close();
  });

  const created = await host.call('create', { name: 'Host' });
  assert.ok(created.ok);
  const code = created.code;
  for (const [i, s] of rest.entries()) assert.ok((await s.call('join', { code, name: `P${i}` })).ok);
  await settle();
  assert.equal(host.last.players.length, 4);

  // non-host cannot start; unknown actions rejected
  assert.equal((await rest[0].act('start')).ok, false);
  assert.equal((await host.act('__proto__')).ok, false);

  // reload simulation: a second socket with the same token resumes as the same player
  const again = client(port, tokens[1]);
  t.after(() => again.close());
  assert.ok((await again.call('resume', { code })).ok);
  await settle();
  assert.equal(again.last.players.length, 4);
  assert.equal(again.last.me.id, rest[0].last.me.id);

  assert.ok((await host.act('start')).ok);
  await settle();
  const all = [host, ...rest];
  const mayor = all.find((s) => s.last.me.isMayor);
  assert.ok(mayor.last.me.wordChoices.length > 0);
  for (const s of all) if (s !== mayor) assert.equal(s.last.me.wordChoices, undefined);

  // no player sees another player's role before the end
  for (const s of all) assert.ok(s.last.players.every((p) => p.role === undefined));

  assert.ok((await mayor.act('chooseWord', { word: mayor.last.me.wordChoices[0] })).ok);
  await settle();
  // 4 players: villager, seer, fortune teller, werewolf -> no night actions
  assert.equal(host.last.phase, 'night_reveal');
  for (const s of all) await s.act('acknowledge');
  await settle();
  assert.equal(host.last.phase, 'day');
  assert.ok(host.last.dayEndsAt > Date.now());

  const asker = all.find((s) => s !== mayor);
  assert.ok((await mayor.act('giveToken', { playerId: asker.last.me.id, token: 'yes' })).ok);
  assert.equal((await asker.act('giveToken', { playerId: asker.last.me.id, token: 'yes' })).ok, false);
  await settle();
  assert.equal(host.last.tokens.yesno, host.last.settings.yesNoTokens - 1);
  assert.equal(host.last.players.find((p) => p.id === asker.last.me.id).tokens.yes, 1);

  assert.ok((await mayor.act('giveToken', { playerId: asker.last.me.id, token: 'correct' })).ok);
  await settle();
  assert.equal(host.last.phase, 'vote');
  assert.equal(host.last.vote.wordGuessed, true);
  const wolves = all.filter((s) => s.last.vote.candidates);
  assert.ok(wolves.length >= 1);
  for (const w of wolves) {
    const target = w.last.vote.candidates[0];
    assert.ok((await w.act('vote', { target })).ok);
  }
  await settle();
  assert.equal(host.last.phase, 'results');
  assert.ok(['village', 'werewolf'].includes(host.last.result.winner));
  assert.ok(host.last.players.every((p) => p.role));
  assert.ok(host.last.word);

  assert.ok((await host.act('backToLobby')).ok);
  await settle();
  assert.equal(host.last.phase, 'lobby');
  assert.ok(games.has(code));
});
