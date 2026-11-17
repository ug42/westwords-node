'use strict';
/**
 * Self-playing bots for local testing.
 *
 * Bots take their night actions, acknowledge their roles, vote, and during the
 * day post on-screen yes/no questions shaped by what their role knows:
 *
 *   Seer / Apprentice-who-sees  steer toward the word (true category, letters)
 *   Fortune Teller              probe the first letters it was shown
 *   Werewolf                    mislead (wrong categories, wrong letters, decoys)
 *   Minion                      doesn't know the word; throws out wild decoys
 *   everyone else               generic 20-questions fishing and blind guesses
 *
 * The human Mayor answers them with tokens like any other question.
 */
const { PHASES } = require('./game');
const { WORDLISTS, wordPool } = require('./words');

// How each word list reads in a question: "Is it ___?"
const CATEGORY_PHRASE = {
  locations: 'a place you could visit',
  movies: 'a movie',
  movie_characters: 'a movie character',
  video_games: 'a video game character',
  actors: 'an actor or actress',
  games: 'a board or video game',
  space: 'something to do with space',
  nouns: 'an everyday thing',
  base_game: 'an everyday thing',
  extended_game: 'an everyday thing',
  extended: 'an everyday thing',
};
const ALL_PHRASES = [...new Set(Object.values(CATEGORY_PHRASE))];

const GENERIC = [
  'Is it alive?',
  'Is it bigger than a breadbox?',
  'Can you hold it in one hand?',
  'Would I find it indoors?',
  'Is it made by people?',
  'Is it a person?',
  'Is it fictional?',
  'Can you eat it?',
  'Is it more than 100 years old?',
  'Would I find it in a kitchen?',
  'Does it have anything to do with sports?',
  'Is it famous?',
  'Does it use electricity?',
  'Is it an animal?',
  'Is it something you wear?',
  'Is it found outdoors?',
  'Is it used for fun?',
  'Is it expensive?',
  'Would a kid know what it is?',
  'Is it colorful?',
  'Is it soft?',
  'Does it make a noise?',
  'Is it from America?',
  'Is it on TV?',
];

const LETTERS = 'ABCDEFGHIJKLMNOPRSTW';

const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];
const firstLetter = (w) => (w.match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase();

function phraseFor(categories) {
  for (const c of categories) if (CATEGORY_PHRASE[c]) return CATEGORY_PHRASE[c];
  return 'an everyday thing';
}

function decoyWord(game, rnd, { sameCategory = false } = {}) {
  const lists = sameCategory && game.wordCategories.length ? game.wordCategories : Object.keys(WORDLISTS);
  const pool = wordPool({ lists }).filter((w) => w !== game.word);
  return pick(pool.length ? pool : ['a horse'], rnd);
}

const normalize = (q) => q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Build one question for a bot from what its role knows, never repeating a
 * question already asked this round (by anyone). Returns null if it runs dry.
 */
function questionFor(game, botId, rnd = Math.random) {
  const asked = new Set(game.questions.map((q) => normalize(q.text)));
  for (let i = 0; i < 40; i++) {
    const q = draftQuestion(game, botId, rnd);
    if (!asked.has(normalize(q))) return q;
  }
  // Everything obvious is taken: fall back to a fresh guess (never the real word).
  for (let i = 0; i < 40; i++) {
    const q = `Is it "${decoyWord(game, rnd, { sameCategory: rnd() < 0.5 })}"?`;
    if (!asked.has(normalize(q))) return q;
  }
  return null;
}

function draftQuestion(game, botId, rnd) {
  const role = game.roles.get(botId).id;
  const k = game.knowledge(botId);
  const word = k.word; // known only to roles that saw it
  const roll = rnd();
  const generic = () => pick(GENERIC, rnd);
  const trueCat = phraseFor(game.wordCategories);

  if (role === 'werewolf' && word) {
    // Lead the village away from the truth.
    if (roll < 0.35) return `Is it ${pick(ALL_PHRASES.filter((p) => p !== trueCat), rnd)}?`;
    if (roll < 0.55) {
      const wrong = pick([...LETTERS].filter((l) => l !== firstLetter(word)), rnd);
      return `Does it start with "${wrong}"?`;
    }
    if (roll < 0.8) return `Is it "${decoyWord(game, rnd)}"?`;
    return generic();
  }

  if (word) {
    // Seer, Apprentice-as-Seer: nudge toward the word without saying it.
    const words = word.split(/\s+/);
    if (roll < 0.35) return `Is it ${trueCat}?`;
    if (roll < 0.5) return words.length > 1 ? 'Is it more than one word?' : 'Is it a single word?';
    if (roll < 0.65) return `Does it start with "${firstLetter(word)}"?`;
    if (roll < 0.8) return `Is it something like "${decoyWord(game, rnd, { sameCategory: true })}"?`;
    return generic();
  }

  if (k.wordHint) {
    // Fortune Teller: probes the letters it saw.
    const parts = k.wordHint.split(/\s+/);
    if (roll < 0.35) return `Does it start with "${parts[0][0].toUpperCase()}"?`;
    if (roll < 0.5 && parts.length > 1) return `Is the second word starting with "${parts[1][0].toUpperCase()}"?`;
    if (roll < 0.6) return `Does it have about ${parts[0].length} letters?`;
    if (roll < 0.75) return `Is it ${pick(ALL_PHRASES, rnd)}?`;
    return generic();
  }

  if (role === 'minion') {
    // Knows nothing about the word; muddies the water.
    if (roll < 0.4) return `Is it "${decoyWord(game, rnd)}"?`;
    if (roll < 0.6) return `Is it ${pick(ALL_PHRASES, rnd)}?`;
    return generic();
  }

  // Ordinary villagers and friends: honest fishing.
  if (roll < 0.25) return `Is it ${pick(ALL_PHRASES, rnd)}?`;
  if (roll < 0.35) return `Does it start with "${pick([...LETTERS], rnd)}"?`;
  if (roll < 0.45 && game.answers.length > 6) return `Is it "${decoyWord(game, rnd, { sameCategory: true })}"?`;
  return generic();
}

/** Pick a vote target for a bot: avoid known teammates, otherwise random. */
function voteFor(game, botId, candidates, rnd = Math.random) {
  const myTeam = game.teamOf(botId);
  const known = game.knowledge(botId).known || [];
  const teammates = new Set(
    known
      .filter((x) => myTeam === 'werewolf' ? /Werewolf|Minion/.test(x.label) : /Mason|Esper|Seer/.test(x.label))
      .map((x) => x.id)
  );
  // Werewolves in the hunt follow a teammate's pick if there is one, so the pack agrees.
  if (game.wordGuessed && myTeam === 'werewolf') {
    const teamPick = [...game.votes.values()].find((t) => candidates.includes(t));
    if (teamPick) return teamPick;
  }
  const options = candidates.filter((c) => !teammates.has(c));
  return pick(options.length ? options : candidates, rnd);
}

const rand = (rnd, lo, hi) => lo + rnd() * (hi - lo);

/**
 * Drives the bots of one game. Call step() regularly; it returns true when it
 * changed the game so the caller can broadcast.
 */
class BotDriver {
  constructor(game, { random = Math.random, speed = 1 } = {}) {
    this.game = game;
    this.random = random;
    this.speed = speed; // < 1 makes bots act faster (tests)
    this.due = new Map(); // botId -> { key, at }
    this.nextAsk = new Map(); // botId -> timestamp
    this.dayKey = null;
  }

  delay(lo, hi) {
    return rand(this.random, lo, hi) * this.speed;
  }

  /** Schedule an action for a bot once per (phase, key); run it when due. */
  whenDue(bot, key, now, lo, hi, fn) {
    const d = this.due.get(bot);
    if (!d || d.key !== key) {
      this.due.set(bot, { key, at: now + this.delay(lo, hi) });
      return false;
    }
    if (now < d.at) return false;
    this.due.delete(bot);
    try {
      fn();
      return true;
    } catch {
      return false; // state moved on; ignore
    }
  }

  step(now = Date.now()) {
    const g = this.game;
    let changed = false;
    const others = (id) => [...g.players.keys()].filter((p) => p !== id);
    const dayKey = g.phase === PHASES.DAY ? `day:${g.dayEndsAt}` : null;
    if (dayKey !== this.dayKey) {
      this.dayKey = dayKey;
      this.nextAsk.clear();
    }

    for (const bot of g.botIds()) {
      switch (g.phase) {
        case PHASES.NIGHT_COPY:
        case PHASES.NIGHT_TARGET:
          if (g.pendingActions.has(bot)) {
            changed = this.whenDue(bot, g.phase, now, 1500, 4000, () =>
              g.nightAction(bot, pick(others(bot), this.random))
            ) || changed;
          }
          break;
        case PHASES.NIGHT_REVEAL:
          if (g.pendingAcks.has(bot)) {
            changed = this.whenDue(bot, 'reveal', now, 1000, 3500, () => g.acknowledge(bot)) || changed;
          }
          break;
        case PHASES.DAY: {
          if (bot === g.mayorId || g.openQuestion(bot)) break;
          if (!this.nextAsk.has(bot)) this.nextAsk.set(bot, now + this.delay(2000, 9000));
          if (now >= this.nextAsk.get(bot)) {
            try {
              const q = questionFor(g, bot, this.random);
              if (q) {
                g.addQuestion(bot, q, now);
                changed = true;
              }
            } catch {
              /* ignore */
            }
            this.nextAsk.set(bot, now + this.delay(8000, 20000));
          }
          break;
        }
        case PHASES.VOTE:
          if (g.voters.includes(bot) && !g.votes.has(bot)) {
            changed = this.whenDue(bot, `vote:${g.voteEndsAt}`, now, 2000, 6000, () =>
              g.vote(bot, voteFor(g, bot, g.candidatesFor(bot), this.random), now)
            ) || changed;
          }
          break;
        default:
          break;
      }
    }
    return changed;
  }
}

module.exports = { BotDriver, questionFor, voteFor, CATEGORY_PHRASE, GENERIC };
