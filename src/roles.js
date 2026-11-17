'use strict';

/**
 * Role catalogue. Mirrors the roles of the original Westwords (Python) game.
 *
 * Fields:
 *   team              'village' | 'werewolf'
 *   maxInstances      how many of this role may be in a game
 *   required          at least one must always be selected
 *   minPlayers        suggested minimum player count (informational)
 *   nightAction       null | 'copy' (Doppelganger) | 'target' (Esper)
 *   critical          losing this player to the werewolf vote loses the game
 *                     for the village (Seer / Fortune Teller; Apprentice is
 *                     promoted to critical when the Mayor is the Seer)
 *   votesOnGuessed    votes in the "word guessed" werewolf hunt
 *   losesIfKilled     the werewolf team loses if this player is voted out
 *                     when the word was NOT guessed
 */
const ROLES = {
  villager: {
    id: 'villager',
    name: 'Villager',
    team: 'village',
    maxInstances: 8,
    minPlayers: 3,
    nightAction: null,
    description:
      'An ordinary townsfolk. Ask the Mayor questions and help the village guess the secret word.',
  },
  seer: {
    id: 'seer',
    name: 'Seer',
    team: 'village',
    maxInstances: 1,
    minPlayers: 0,
    critical: true,
    nightAction: null,
    description:
      'Sees the secret word. Steer the village toward it, but carefully: if the word is guessed, the werewolves win by finding you.',
  },
  apprentice: {
    id: 'apprentice',
    name: 'Apprentice',
    team: 'village',
    maxInstances: 1,
    minPlayers: 5,
    nightAction: null,
    description:
      'An ordinary villager, unless the Mayor is the Seer. Then you see the word and become the werewolves’ target instead.',
  },
  fortuneteller: {
    id: 'fortuneteller',
    name: 'Fortune Teller',
    team: 'village',
    maxInstances: 4,
    minPlayers: 5,
    critical: true,
    nightAction: null,
    description:
      'Sees the first letter of each word in the secret word. If the word is guessed, the werewolves win by finding you.',
  },
  beholder: {
    id: 'beholder',
    name: 'Beholder',
    team: 'village',
    maxInstances: 1,
    minPlayers: 5,
    nightAction: null,
    description:
      'Knows who holds the Seer, Apprentice and Fortune Teller roles, but not which is which. Losing you does not lose the game.',
  },
  mason: {
    id: 'mason',
    name: 'Mason',
    team: 'village',
    maxInstances: 2,
    minPlayers: 8,
    nightAction: null,
    description: 'A villager who knows the other Masons.',
  },
  esper: {
    id: 'esper',
    name: 'Esper',
    team: 'village',
    maxInstances: 1,
    minPlayers: 5,
    nightAction: 'target',
    actionPrompt:
      'Choose a player to reach telepathically. They will learn that you are the Esper.',
    description:
      'At night, pick one player. They learn that you are the Esper, but you do not learn their role.',
  },
  doppelganger: {
    id: 'doppelganger',
    name: 'Doppelganger',
    team: 'village',
    maxInstances: 6,
    minPlayers: 6,
    nightAction: 'copy',
    actionPrompt: 'Choose a player to mimic. You will become a copy of their role and team.',
    description:
      'At night, look at another player’s role and become a copy of it, including its team and abilities.',
  },
  werewolf: {
    id: 'werewolf',
    name: 'Werewolf',
    team: 'werewolf',
    maxInstances: 4,
    minPlayers: 0,
    required: true,
    votesOnGuessed: true,
    losesIfKilled: true,
    nightAction: null,
    description:
      'Sees the secret word and the other werewolves. Lead the village astray. If they guess the word anyway, hunt down the Seer or Fortune Teller.',
  },
  minion: {
    id: 'minion',
    name: 'Minion',
    team: 'werewolf',
    maxInstances: 1,
    minPlayers: 7,
    losesIfKilled: true,
    nightAction: null,
    description:
      'Knows the werewolves, but they do not know you, and you do not see the word. Your team loses if you are voted out.',
  },
};

const ROLE_ORDER = [
  'villager',
  'seer',
  'apprentice',
  'fortuneteller',
  'beholder',
  'mason',
  'esper',
  'doppelganger',
  'werewolf',
  'minion',
];

// Default role sets by player count, matching the original game.
const V = 'villager', S = 'seer', A = 'apprentice', F = 'fortuneteller', B = 'beholder',
  M = 'mason', E = 'esper', D = 'doppelganger', W = 'werewolf', N = 'minion';
const rep = (r, n) => Array(n).fill(r);
const DEFAULT_ROLES = {
  3: [V, F, W],
  4: [V, S, F, W], // balance change: two hunt targets instead of one
  5: [...rep(V, 2), A, S, W],
  6: [...rep(V, 3), A, S, W],
  7: [...rep(V, 4), A, S, W],
  8: [...rep(V, 4), A, S, W, W],
  9: [...rep(V, 4), E, A, S, W, W],
  10: [...rep(V, 5), E, A, S, W, W],
  11: [...rep(V, 5), B, A, S, ...rep(W, 3)],
  12: [...rep(V, 6), B, A, S, ...rep(W, 3)],
  13: [...rep(V, 6), M, M, A, S, ...rep(W, 3)],
  14: [...rep(V, 7), M, M, A, S, ...rep(W, 3)],
  15: [...rep(V, 7), M, M, A, S, ...rep(W, 3), F],
  16: [...rep(V, 7), M, M, A, S, ...rep(W, 3), F, B],
  17: [...rep(V, 7), M, M, A, S, ...rep(W, 3), F, B, E],
  18: [...rep(V, 8), M, M, A, S, ...rep(W, 3), F, B, E],
  19: [...rep(V, 8), M, M, A, S, N, ...rep(W, 3), F, B, E],
  20: [...rep(V, 8), M, M, A, S, N, ...rep(W, 3), F, B, E, D],
};

function defaultRolesFor(playerCount) {
  const n = Math.max(3, Math.min(20, playerCount));
  return [...DEFAULT_ROLES[n]];
}

module.exports = { ROLES, ROLE_ORDER, DEFAULT_ROLES, defaultRolesFor };
