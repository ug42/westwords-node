# Westwords (Node.js)

A simplified Node.js port of [ug42/westwords](https://github.com/ug42/westwords), a social deduction word game in the style of 20 Questions with werewolves.

This version has **no chat or typed questions**. Players talk in a voice chat (Discord, Zoom, a room) and the app handles the parts that need to be secret or tracked:

- **Roles**: secret role cards, team knowledge, night actions
- **Mayor tools**: word choice, and a token board for answering questions
- **Counters**: a shared Yes/No pool, Maybe, So Close, Way Off and Correct tokens, with a per-player tally
- **Timers**: day and vote timers run on the server and move the game on by themselves
- **Voting**: the werewolf hunt or the village vote, then the results

## How a round plays

1. **Lobby.** The host shares the 4-letter code. Players can volunteer to be Mayor. The host sets the roles (a recommended set by player count is the default) and the rules: timers, token counts, word lists and difficulty.
2. **Word choice.** Roles are dealt. The Mayor (chosen at random from the volunteers) picks the secret word from a short list.
3. **Night.**
   - The Doppelganger copies a player's role.
   - The Esper reveals themself to one player.
   - Then everyone flips their card to see their secret information. The host can skip players who are AFK.
4. **Day.** Players ask yes/no questions out loud. The Mayor taps who asked, then taps an answer token. Undo is available. The day ends in one of these ways:
   - Someone gets a **Correct**.
   - The Yes/No tokens run out.
   - The timer expires.
   - The Mayor or host ends it early.
5. **Vote.**
   - **Word guessed:** the werewolves get **one shared pick**, which is the player with the most werewolf votes (a tie is a miss). They can see each other's picks, since they can't talk privately on voice chat. If the pick is the Seer or Fortune Teller, they steal the win.
   - **Not guessed:** everyone votes. The player with the most votes is voted out, and **ties vote out everyone tied** (at least 2 votes are needed). If a Werewolf or the Minion is among them, the village wins.
6. **Results.** All roles and votes are shown. The host starts the next round.

## Roles

| Role | Team | Knows |
|---|---|---|
| Villager | Village | — |
| Seer | Village | The word. The werewolves' target if the word is guessed. |
| Apprentice | Village | The word and the Seer, but only if the Mayor is the Seer. Then the Apprentice becomes the target. |
| Fortune Teller | Village | The first letter of each word. A werewolf target. |
| Beholder | Village | Who the Seer, Apprentice and Fortune Teller are, without knowing which is which |
| Mason | Village | The other Masons |
| Esper | Village | Night: shows their identity to one player |
| Doppelganger | Village* | Night: copies another player's role and team |
| Werewolf | Werewolf | The word and the other werewolves |
| Minion | Werewolf | The werewolves (the werewolves don't know the Minion) |

The Mayor also has a secret role, sees the word, and is never a valid werewolf target.

## Balance changes from the original

The overall game flow is the same as the original. These rule changes were chosen to balance it:

| Area | Original | This version |
|---|---|---|
| Werewolf hunt | Every werewolf vote was its own kill attempt | One shared pick (the werewolves' plurality); a tie is a miss |
| Village vote ties | Everyone tied at the top was voted out | Same: the most votes, ties included, are voted out (2+ votes needed) |
| Yes/No tokens | Fixed at 36 | Auto: 4 per questioner, between 16 and 40 |
| Day timer | Fixed at 6:00 | Auto: 4:00 for 3–4 players, +30s per extra player, max 8:00 |
| 4-player roles | Villager, Apprentice, Fortune Teller, Werewolf | Villager, **Seer**, Fortune Teller, Werewolf |

Auto values scale as players join until the host edits them. **Use recommended** restores them.

Smaller changes: the Mayor is never a werewolf target, as the Apprentice's description intended. Timers move the game on by themselves. The Mayor can undo an accidental **Correct**, which also brings the day back. Word choices are always distinct.

## Bots (for testing)

In the lobby, the host can click **+ Add bot** to fill seats, so you can test a whole game alone in one browser tab. Bots:

- **Night:** take their night actions and acknowledge their roles after a short, human-like delay.
- **Day:** post **on-screen questions** (bots can't talk in voice chat). The question shows in a bubble on the Mayor's board. When the Mayor taps that bot and gives a token, the token answers the question. Questions depend on the bot's role:

  | Bot role | What it asks |
  |---|---|
  | Seer, or an Apprentice who sees the word | Steers toward the word: the real category, word count, first letter |
  | Fortune Teller | Probes the letters it was shown |
  | Werewolf | Misleads with wrong categories, wrong letters and decoy guesses |
  | Minion | Doesn't know the word, so it throws out wild decoy guesses |

  Bots never repeat a question that anyone has already asked this round.
  | Everyone else | Asks honest 20-questions style questions and makes blind guesses |

- **Vote:** werewolves follow a packmate's pick in the hunt. No bot votes for a teammate it knows about.

**The Mayor is always a human.** Bots are never picked, even if they would otherwise be eligible. A game needs at least one human, and when the last human leaves, the bots are removed too. Set `DISABLE_BOTS=1` to turn bots off on a deployed server.

## Run locally

```bash
npm install
npm start          # http://localhost:3000
npm test           # engine + socket integration tests
npm run art        # regenerate role card SVGs (scripts/build-art.js)
```

Requires Node 20+.

## Deploy for free

All state is in memory and lives in a single process, so run **one instance**. Games are lost on restart, which is fine for a party game.

### Render (recommended)
1. Push this repo to GitHub.
2. In Render, go to **New → Blueprint** and choose the repo. `render.yaml` sets up a free web service with a `/healthz` health check.
3. Share the `https://<name>.onrender.com` URL.

Free Render services go to sleep after about 15 minutes idle. The first visit afterwards takes about 30 to 60 seconds to wake up, so open the site a minute before game night.

### Fly.io / Koyeb / Railway
Use the included `Dockerfile` (listens on `$PORT`, default 8080). For Fly:
```bash
fly launch --no-deploy && fly scale count 1 && fly deploy
```

### Google Cloud Run
Deploy the Dockerfile with `--max-instances=1 --session-affinity` so every socket reaches the same instance.

## Project layout

```
server.js             Express + Socket.IO, rooms, timers, per-player state broadcast
src/game.js           Game engine (pure, unit-tested): phases, roles, tokens, voting
src/roles.js          Role catalogue + recommended role sets by player count
src/words.js          Word list sampling (data/words.json, ported from the original)
public/               Single-page client (vanilla JS, no build step)
public/img/roles/     Generated role cards (one consistent "frontier tarot" deck)
scripts/build-art.js  Generator for the role art
test/                 node:test suites
```

## Security notes

- Each browser gets a random secret token, stored in localStorage. Other players only see a hash of it, so knowing someone's player ID does not let you act as them.
- Each player receives a view built for them alone. Roles, the word and night information are never sent to anyone who shouldn't see them, until the results screen.
