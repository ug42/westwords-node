'use strict';

const WORDLISTS = require('../data/words.json');

const LEVELS = ['easy', 'medium', 'hard', 'impossible'];

function listCatalog() {
  return Object.entries(WORDLISTS).map(([id, l]) => ({
    id,
    name: l.name,
    description: l.description,
    counts: Object.fromEntries(LEVELS.map((lvl) => [lvl, l[lvl].length])),
  }));
}

function wordPool({ difficulty = 'any', lists = null } = {}) {
  const ids = lists && lists.length ? lists.filter((id) => WORDLISTS[id]) : Object.keys(WORDLISTS);
  const levels = difficulty === 'any' ? LEVELS : [difficulty];
  const pool = new Set();
  for (const id of ids) for (const lvl of levels) for (const w of WORDLISTS[id][lvl]) pool.add(w);
  return [...pool];
}

/** Sample `count` distinct words. Falls back to all difficulties if the filtered pool is too small. */
function pickWords(count, opts = {}, random = Math.random) {
  let pool = wordPool(opts);
  if (pool.length < count) pool = wordPool({ ...opts, difficulty: 'any' });
  if (pool.length < count) pool = wordPool({});
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** Ids of every word list that contains this word. */
function categoriesOf(word) {
  return Object.entries(WORDLISTS)
    .filter(([, l]) => LEVELS.some((lvl) => l[lvl].includes(word)))
    .map(([id]) => id);
}

module.exports = { WORDLISTS, LEVELS, listCatalog, wordPool, pickWords, categoriesOf };
