/* Westwords client. Vanilla JS, no build step. */
(() => {
  'use strict';

  // ------------------------------------------------------------ persistence
  const store = {
    get(k, d = null) {
      try {
        const v = localStorage.getItem('ww.' + k);
        return v === null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('ww.' + k, JSON.stringify(v));
      } catch {
        /* private mode: fine */
      }
    },
  };

  function sessionToken() {
    let t = store.get('token');
    if (!t || t.length < 16) {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      t = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      store.set('token', t);
    }
    return t;
  }

  // ------------------------------------------------------------------ state
  let META = null;
  let S = null; // latest game view
  let clockOffset = 0; // serverNow - localNow
  let pendingRender = false;
  let selectedAsker = null; // Mayor UI: player currently asking
  let showSecret = false; // day/vote: secret panel collapsed by default
  let revealFlipped = false; // night reveal: card turned over locally
  let soundOn = store.get('sound', true);
  const app = document.getElementById('app');

  const socket = io({ auth: { token: sessionToken() }, transports: ['websocket', 'polling'] });

  // --------------------------------------------------------------- helpers
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const role = (id) => META.roles[id];
  const player = (id) => (S && S.players.find((p) => p.id === id)) || { name: '?' };
  const pname = (id) => esc(player(id).name);
  const now = () => Date.now() + clockOffset;
  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const roleImg = (id, cls = '') => `<img class="role-img ${cls}" src="/img/roles/${id}.svg" alt="${esc(role(id).name)}">`;
  const TOKEN_ICON = { yes: '✔', no: '✖', maybe: '?', so_close: '◎', so_far: '⤫', correct: '★' };

  function toast(msg, kind = 'error') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'show ' + kind;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.className = ''), 3500);
  }

  function emit(event, payload = {}) {
    return new Promise((resolve) => {
      socket.timeout(8000).emit(event, payload, (err, res) => {
        if (err) {
          toast('The server did not answer. Check your connection.');
          return resolve({ ok: false });
        }
        if (!res.ok && res.error && !['gone', 'not-member'].includes(res.error)) toast(res.error);
        resolve(res);
      });
    });
  }
  const act = (type, args = {}) => emit('action', { type, ...args });

  function codeFromUrl() {
    const m = location.pathname.match(/^\/g\/([A-Za-z]{4})\/?$/);
    return m ? m[1].toUpperCase() : null;
  }

  // ------------------------------------------------------------------ sound
  let audioCtx = null;
  function beep(freq = 880, dur = 0.08, vol = 0.08) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = freq;
      g.gain.value = vol;
      o.connect(g).connect(audioCtx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      o.stop(audioCtx.currentTime + dur + 0.02);
    } catch {
      /* no audio */
    }
  }
  const soundBtn = document.getElementById('sound-btn');
  const paintSound = () => {
    soundBtn.textContent = soundOn ? '🔔' : '🔕';
    soundBtn.setAttribute('aria-pressed', String(soundOn));
  };
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    store.set('sound', soundOn);
    paintSound();
    beep(660);
  });
  paintSound();

  // -------------------------------------------------------------- rendering
  function render() {
    // Don't clobber a field the user is typing in; render when they leave it.
    const a = document.activeElement;
    if (a && app.contains(a) && (a.matches('input[type=text], input[type=number]'))) {
      pendingRender = true;
      return;
    }
    pendingRender = false;
    const chip = document.getElementById('code-chip');
    if (!S) {
      chip.hidden = true;
      app.innerHTML = viewHome();
      return;
    }
    chip.hidden = false;
    chip.textContent = S.code;
    const views = {
      lobby: viewLobby,
      word_choice: viewWordChoice,
      night_copy: viewNightAction,
      night_target: viewNightAction,
      night_reveal: viewReveal,
      day: viewDay,
      vote: viewVote,
      results: viewResults,
    };
    app.innerHTML = `<div class="phase phase-${S.phase}">${views[S.phase]()}</div>`;
    tickTimers();
  }
  app.addEventListener('focusout', () => setTimeout(() => pendingRender && render(), 0));

  // ----- home
  function viewHome() {
    const code = codeFromUrl() || '';
    const name = store.get('name', '');
    return `
      <section class="hero">
        <img class="hero-card" src="/img/roles/werewolf.svg" alt="">
        <img class="hero-card" src="/img/roles/seer.svg" alt="">
        <img class="hero-card" src="/img/roles/villager.svg" alt="">
      </section>
      <section class="panel narrow">
        <h1 class="title">Westwords</h1>
        <p class="lede">A Mayor holds a secret word. The village asks yes-or-no questions <strong>out loud in your voice chat</strong>.
        Werewolves who know the word steer everyone wrong. This page handles the roles, night actions, tokens, timers and votes.</p>
        <form id="home-form" class="stack" autocomplete="off">
          <label>Your name<input id="name" type="text" maxlength="24" required value="${esc(name)}" placeholder="e.g. Calamity"></label>
          <div class="row">
            <label class="grow">Game code<input id="code" type="text" maxlength="4" value="${esc(code)}" placeholder="ABCD" class="code-input"></label>
            <button class="btn" type="submit" data-mode="join">Join</button>
          </div>
          <div class="or">or</div>
          <button class="btn primary big" type="submit" data-mode="create">Start a new game</button>
        </form>
      </section>
      <details class="panel narrow how">
        <summary>How to play</summary>
        <ol>
          <li><b>Setup.</b> Everyone gets a secret role. One player is the <b>Mayor</b> and picks the secret word.</li>
          <li><b>Night.</b> Werewolves and the Seer see the word. The Fortune Teller sees its first letters. Other roles learn who's who.</li>
          <li><b>Day.</b> Ask the Mayor yes/no questions out loud. The Mayor taps your name and answers with a token. Yes/No tokens and time are limited.</li>
          <li><b>Word guessed?</b> The werewolves get one shared shot: if their top pick is the Seer or Fortune Teller, they steal the win.</li>
          <li><b>Not guessed?</b> Everyone votes. Whoever gets the most votes is voted out, and ties take out everyone tied. Catch a Werewolf or the Minion and the village still wins.</li>
        </ol>
      </details>`;
  }

  // ----- shared bits
  function timerHtml(endsAt, label) {
    return `<div class="timer" data-ends="${endsAt}"><span class="timer-label">${label}</span><span class="timer-val">--:--</span></div>`;
  }

  function secretPanel({ collapsible = false } = {}) {
    if (!S.me.role) return '';
    const r = role(S.me.role);
    const k = S.me.knowledge || {};
    const body = `
      <div class="secret-body">
        ${roleImg(S.me.role, 'secret-img')}
        <div>
          <div class="role-name team-${r.team}">${esc(r.name)}${S.me.doppel ? ' <small>(Doppelganger)</small>' : ''}</div>
          <div class="team-tag team-${r.team}">${r.team === 'werewolf' ? 'Werewolf team' : 'Village team'}</div>
          ${S.me.isMayor ? `<div class="mayor-tag"><img src="/img/mayor.svg" alt=""> You are the Mayor</div>` : ''}
          ${k.word ? `<div class="word-reveal">Word: <b>${esc(k.word)}</b></div>` : ''}
          ${k.wordHint ? `<div class="word-reveal">Word: <b class="mono">${esc(k.wordHint)}</b></div>` : ''}
          ${
            k.known && k.known.length
              ? `<ul class="known">${k.known.map((x) => `<li><b>${esc(x.name)}</b> is ${esc(x.label)}</li>`).join('')}</ul>`
              : ''
          }
          <button class="link" type="button" data-act="role-info" data-role="${S.me.role}">Role details</button>
        </div>
      </div>`;
    if (!collapsible) return `<section class="panel secret">${body}</section>`;
    return `
      <section class="panel secret ${showSecret ? 'open' : 'closed'}">
        <button class="secret-toggle" type="button" data-act="toggle-secret">${showSecret ? 'Hide my secret' : 'Show my secret role'}</button>
        ${showSecret ? body : ''}
      </section>`;
  }

  function hostSkip(label) {
    return S.me.isHost ? `<button class="btn ghost small" data-act="forceNight">${label}</button>` : '';
  }

  // ----- lobby
  function viewLobby() {
    const host = S.me.isHost;
    const n = S.players.length;
    const counts = {};
    S.selectedRoles.forEach((r) => (counts[r] = (counts[r] || 0) + 1));
    const diff = S.selectedRoles.length - n;
    const link = `${location.origin}/g/${S.code}`;

    const players = S.players
      .map(
        (p) => `
      <li class="${p.connected ? '' : 'offline'}">
        <span class="pname">${esc(p.name)}${p.id === S.me.id ? ' <small>(you)</small>' : ''}</span>
        ${p.isHost ? '<span class="badge">host</span>' : ''}
        ${p.bot ? '<span class="badge bot">bot</span>' : ''}
        ${p.nominee ? '<span class="badge gold">wants Mayor</span>' : ''}
        ${!p.connected ? '<span class="badge dim">offline</span>' : ''}
        ${
          host && p.id !== S.me.id
            ? `<span class="row-actions">
                ${p.bot ? '' : `<button class="link" data-act="makeHost" data-id="${p.id}">make host</button>`}
                <button class="link danger" data-act="kick" data-id="${p.id}">remove</button></span>`
            : ''
        }
      </li>`
      )
      .join('');

    const roles = META.roleOrder
      .map((id) => {
        const r = role(id);
        const c = counts[id] || 0;
        return `
        <div class="role-tile ${c ? 'on' : ''} team-${r.team}">
          <button class="tile-img" data-act="role-info" data-role="${id}" title="About ${esc(r.name)}">${roleImg(id)}</button>
          <div class="tile-name">${esc(r.name)}</div>
          <div class="stepper">
            ${host ? `<button data-act="removeRole" data-role="${id}" ${c > (r.required ? 1 : 0) ? '' : 'disabled'} aria-label="Remove ${esc(r.name)}">−</button>` : ''}
            <span class="count">${c}</span>
            ${host ? `<button data-act="addRole" data-role="${id}" ${c >= r.maxInstances ? 'disabled' : ''} aria-label="Add ${esc(r.name)}">+</button>` : ''}
          </div>
        </div>`;
      })
      .join('');

    const st = S.settings;
    const L = META.limits;
    const dis = host ? '' : 'disabled';
    const num = (key, label, unit = '') =>
      `<label><span>${label}${S.autoRules[key] ? ' <span class="auto">auto</span>' : ''}</span><span class="inline"><input type="number" data-setting="${key}" min="${L[key][0]}" max="${L[key][1]}" value="${st[key]}" ${dis}>${unit}</span></label>`;
    const lists = META.wordLists
      .map(
        (l) =>
          `<label class="check"><input type="checkbox" data-list="${l.id}" ${!st.lists.length || st.lists.includes(l.id) ? 'checked' : ''} ${dis}> ${esc(l.name)}</label>`
      )
      .join('');

    let startMsg = '';
    if (n < META.minPlayers) startMsg = `Need at least ${META.minPlayers} players.`;
    else if (diff < 0) startMsg = `Add ${-diff} more role${diff === -1 ? '' : 's'} to match ${n} players.`;
    else if (diff > 0) startMsg = `Remove ${diff} role${diff === 1 ? '' : 's'} to match ${n} players.`;
    const me = S.players.find((p) => p.id === S.me.id);

    return `
      <section class="panel">
        <div class="lobby-head">
          <div>
            <div class="eyebrow">Game code</div>
            <div class="big-code">${S.code}</div>
          </div>
          <div class="share">
            <button class="btn small" data-act="copy" data-text="${esc(link)}">Copy invite link</button>
            <span class="hint">Read the code out in voice chat</span>
          </div>
        </div>
      </section>

      <div class="cols">
        <section class="panel">
          <h2>Players <span class="muted">${n}/${META.maxPlayers}</span></h2>
          <ul class="plist">${players}</ul>
          ${S.spectators.length ? `<p class="muted small">Watching: ${S.spectators.map((s) => esc(s.name)).join(', ')}</p>` : ''}
          ${
            S.me.isPlayer
              ? `<button class="btn ${me && me.nominee ? 'gold' : ''}" data-act="nominate">${me && me.nominee ? '✓ Volunteered for Mayor' : 'Volunteer as Mayor'}</button>
                 <p class="hint">The Mayor is picked at random from volunteers (or from everyone if nobody volunteers).</p>`
              : `<p class="hint">You're watching. You'll join when the host returns to the lobby.</p>`
          }
          ${
            host && META.botsEnabled
              ? `<div class="bot-row">
                  <button class="btn small" data-act="addBot" ${n >= META.maxPlayers ? 'disabled' : ''}>+ Add bot</button>
                  ${S.players.some((p) => p.bot) ? '<button class="btn small ghost" data-act="removeBots">Remove all bots</button>' : ''}
                </div>
                <p class="hint">Bots play on their own for testing: they act at night, vote, and post on-screen questions that fit their role. The Mayor is always a human.</p>`
              : ''
          }
          <button class="btn ghost small" data-act="leave">Leave game</button>
        </section>

        <section class="panel">
          <div class="roles-head"><h2>Rules</h2>${host && Object.values(S.autoRules).some((x) => !x) ? '<button class="btn small" data-act="recommendedRules">Use recommended</button>' : ''}</div>
          <div class="settings">
            ${num('dayTimer', 'Day timer', 's')}
            ${num('voteTimer', 'Vote timer', 's')}
            ${num('yesNoTokens', 'Yes/No tokens')}
            ${num('maybeTokens', 'Maybe tokens')}
            ${num('wordChoices', 'Words offered to Mayor')}
            <label>Word difficulty
              <select data-setting="difficulty" ${dis}>
                ${['any', ...META.levels].map((l) => `<option value="${l}" ${st.difficulty === l ? 'selected' : ''}>${l[0].toUpperCase() + l.slice(1)}</option>`).join('')}
              </select>
            </label>
          </div>
          <details class="lists"><summary>Word lists (${st.lists.length || 'all'})</summary><div class="list-grid">${lists}</div></details>
          <p class="hint">Fields marked <span class="auto">auto</span> scale with the number of players until the host changes them.</p>
          ${host ? '' : '<p class="hint">Only the host can change rules and roles.</p>'}
        </section>
      </div>

      <section class="panel">
        <div class="roles-head">
          <h2>Roles <span class="muted">${S.selectedRoles.length} selected for ${n} players</span></h2>
          ${host && !S.autoRoles ? '<button class="btn small" data-act="recommendedRoles">Use recommended</button>' : ''}
          ${S.autoRoles ? '<span class="badge">recommended set</span>' : ''}
        </div>
        <div class="role-grid">${roles}</div>
      </section>

      <section class="start-bar">
        ${startMsg ? `<span class="warn">${startMsg}</span>` : '<span class="ok">Ready when you are.</span>'}
        ${host ? `<button class="btn primary big" data-act="start" ${startMsg ? 'disabled' : ''}>Deal roles</button>` : '<span class="muted">Waiting for the host to start…</span>'}
      </section>`;
  }

  // ----- word choice
  function viewWordChoice() {
    if (S.me.isMayor) {
      return `
        <section class="panel center">
          <img class="mayor-big" src="/img/mayor.svg" alt="">
          <h1>You are the Mayor</h1>
          <p class="lede">Pick the secret word. Choose something the village has a fair shot at.</p>
          <div class="word-grid">${S.me.wordChoices.map((w) => `<button class="word-btn" data-act="chooseWord" data-word="${esc(w)}">${esc(w)}</button>`).join('')}</div>
        </section>
        ${secretPanel()}`;
    }
    return `
      <section class="panel center night">
        <img class="mayor-big" src="/img/mayor.svg" alt="">
        <h1>Night falls…</h1>
        <p class="lede"><b>${pname(S.mayorId)}</b> is the Mayor and is choosing the secret word.</p>
      </section>
      ${secretPanel()}`;
  }

  // ----- night actions
  function viewNightAction() {
    const copy = S.phase === 'night_copy';
    if (S.me.needsAction) {
      const r = role(S.me.role);
      const opts = S.players
        .filter((p) => p.id !== S.me.id)
        .map((p) => `<button class="pick" data-act="nightAction" data-id="${p.id}">${esc(p.name)}${p.isMayor ? ' <img class="mini-badge" src="/img/mayor.svg" alt="Mayor">' : ''}</button>`)
        .join('');
      return `
        <section class="panel center night">
          ${roleImg(S.me.role, 'action-img')}
          <h1>${esc(r.name)}</h1>
          <p class="lede">${esc(r.actionPrompt)}</p>
          <div class="pick-grid">${opts}</div>
        </section>`;
    }
    return `
      <section class="panel center night">
        <h1>Night falls…</h1>
        <p class="lede">${copy ? 'A Doppelganger is choosing whom to copy.' : 'Someone is reaching out in the dark.'}</p>
        <p class="muted">Waiting on ${S.pendingActions.length} night action${S.pendingActions.length === 1 ? '' : 's'}. Stay quiet in voice chat.</p>
        ${hostSkip('Skip (pick at random for AFK players)')}
      </section>
      ${secretPanel()}`;
  }

  // ----- reveal
  function viewReveal() {
    if (!S.me.role) return spectatorWait('Players are reading their secret roles.');
    const done = !S.me.needsAck;
    const flipped = done || revealFlipped;
    return `
      <section class="reveal">
        <div class="flip ${flipped ? 'flipped' : ''}" data-act="flip">
          <div class="flip-inner">
            <img class="flip-back" src="/img/roles/back.svg" alt="Tap to reveal">
            <img class="flip-front" src="/img/roles/${S.me.role}.svg" alt="${esc(role(S.me.role).name)}">
          </div>
        </div>
        <p class="hint center">${flipped ? '' : 'Tap the card to reveal. Make sure nobody can see your screen.'}</p>
      </section>
      <div id="reveal-info" class="${flipped ? '' : 'hidden'}">
        ${secretPanel()}
        <section class="panel">
          <p>${esc(role(S.me.role).description)}</p>
          ${
            done
              ? `<p class="muted">Waiting for ${S.pendingAckCount} player${S.pendingAckCount === 1 ? '' : 's'} to finish reading…</p>`
              : '<button class="btn primary big" data-act="acknowledge">Got it, start the day</button>'
          }
          ${hostSkip('Start the day now')}
        </section>
      </div>`;
  }

  function spectatorWait(msg) {
    return `<section class="panel center night"><h1>Spectating</h1><p class="lede">${msg}</p></section>`;
  }

  // ----- day
  function tokenPool() {
    const t = S.tokens;
    const cell = (k, label, val) => `<div class="pool pool-${k}"><span class="pool-icon">${TOKEN_ICON[k]}</span><span class="pool-n">${val}</span><span class="pool-l">${label}</span></div>`;
    return `<div class="pools">
      ${cell('yes', 'Yes / No', t.yesno)}
      ${cell('maybe', 'Maybe', t.maybe)}
      ${cell('so_close', 'So Close', t.so_close)}
      ${cell('so_far', 'Way Off', t.so_far)}
      ${cell('correct', 'Correct', t.correct)}
    </div>`;
  }

  function tallyChips(tokens) {
    return Object.entries(tokens)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `<span class="tchip t-${k}" title="${esc(META.tokens[k].label)}">${TOKEN_ICON[k]}${n > 1 ? n : ''}</span>`)
      .join('');
  }

  function viewDay() {
    const mayor = S.me.isMayor;
    const askers = S.players.filter((p) => !p.isMayor);
    if (selectedAsker && !askers.some((p) => p.id === selectedAsker)) selectedAsker = null;

    const playerCards = askers
      .map(
        (p) => `
      <button class="asker ${selectedAsker === p.id ? 'sel' : ''} ${p.connected ? '' : 'offline'}" ${mayor ? `data-act="select-asker" data-id="${p.id}"` : 'tabindex="-1"'}>
        <span class="asker-name">${esc(p.name)}${p.id === S.me.id ? ' <small>(you)</small>' : ''}${p.bot ? ' <span class="badge bot">bot</span>' : ''}</span>
        ${p.question ? `<span class="bubble">${esc(p.question)}</span>` : ''}
        <span class="tchips">${tallyChips(p.tokens) || '<span class="muted small">no tokens yet</span>'}</span>
      </button>`
      )
      .join('');

    const feed = S.answers
      .slice()
      .reverse()
      .map((a) => `<li><span class="tchip t-${a.token}">${TOKEN_ICON[a.token]}</span> <b>${META.tokens[a.token].label}</b> to ${pname(a.playerId)}</li>`)
      .join('');

    const questions = (S.questions || [])
      .slice()
      .reverse()
      .map(
        (q) => `<li class="${q.token ? 'answered' : 'open'}"><b>${pname(q.playerId)}:</b> ${esc(q.text)}
          ${q.token ? `<span class="tchip t-${q.token}">${TOKEN_ICON[q.token]} ${META.tokens[q.token].label}</span>` : '<span class="waiting">waiting for the Mayor</span>'}</li>`
      )
      .join('');
    const selected = selectedAsker && askers.find((p) => p.id === selectedAsker);

    const tokenButtons = Object.entries(META.tokens)
      .map(([k, t]) => {
        const left = S.tokens[t.pool];
        return `<button class="token-btn t-${k}" data-act="giveToken" data-token="${k}" ${!selectedAsker || left <= 0 ? 'disabled' : ''}>
          <span class="tb-icon">${TOKEN_ICON[k]}</span><span>${t.label}</span></button>`;
      })
      .join('');

    return `
      <section class="day-head">
        ${timerHtml(S.dayEndsAt, 'Day ends in')}
        <div class="mayor-line"><img src="/img/mayor.svg" alt=""> Mayor: <b>${pname(S.mayorId)}</b></div>
      </section>
      ${tokenPool()}
      ${
        mayor
          ? `<section class="panel mayor-panel">
              <h2>Mayor's board</h2>
              <p class="hint">1. Tap who asked. 2. Tap your answer. The word is <b>${esc(S.me.knowledge.word)}</b>.</p>
              <div class="asker-grid">${playerCards}</div>
              ${selected && selected.question ? `<p class="answering">Answering <b>${esc(selected.name)}</b>: “${esc(selected.question)}”</p>` : ''}
              <div class="token-row">${tokenButtons}</div>
              <div class="row end">
                <button class="btn ghost small" data-act="undo" ${S.answerCount ? '' : 'disabled'}>Undo last token</button>
                <button class="btn ghost small" data-act="endDay">End day &amp; vote</button>
              </div>
            </section>`
          : `<section class="panel">
              <h2>Questioners</h2>
              <p class="hint">Ask the Mayor yes/no questions out loud. Their answers show up here.</p>
              <div class="asker-grid">${playerCards}</div>
              ${S.me.isHost ? '<div class="row end"><button class="btn ghost small" data-act="endDay">End day &amp; vote</button></div>' : ''}
            </section>`
      }
      ${questions ? `<section class="panel"><h2>On-screen questions</h2><p class="hint">Bots can't talk, so their questions appear here.</p><ul class="qlist">${questions}</ul></section>` : ''}
      ${feed ? `<section class="panel"><h2>Latest answers</h2><ul class="feed">${feed}</ul></section>` : ''}
      ${mayor ? '' : secretPanel({ collapsible: true })}`;
  }

  // ----- vote
  function viewVote() {
    const v = S.vote;
    const reasons = {
      guessed: 'The word was guessed!',
      tokens: 'Out of Yes/No tokens.',
      timer: 'Time ran out.',
      called: 'The day was ended early.',
    };
    const headline = v.wordGuessed
      ? 'Werewolves: find the Seer or Fortune Teller!'
      : 'Everyone: find a Werewolf or the Minion!';
    let body;
    if (v.candidates) {
      const team = v.teamVotes || {};
      body = `
        <div class="pick-grid">
          ${v.candidates
            .map((id) => {
              const backers = Object.entries(team)
                .filter(([voter, t]) => t === id && voter !== S.me.id)
                .map(([voter]) => pname(voter));
              return `<button class="pick ${v.myVote === id ? 'sel' : ''}" data-act="vote" data-id="${id}">
                ${pname(id)}${player(id).isMayor ? ' <img class="mini-badge" src="/img/mayor.svg" alt="Mayor">' : ''}
                ${backers.length ? `<small class="backers">🐺 ${backers.join(', ')}</small>` : ''}
              </button>`;
            })
            .join('')}
        </div>
        <p class="hint">${v.myVote ? `You voted for <b>${pname(v.myVote)}</b>. You can change it until everyone has voted.` : 'Tap a player to cast your vote.'}</p>
        <p class="hint">${v.wordGuessed ? 'The pack gets <b>one</b> shot: the player with the most werewolf votes. A tie means you miss.' : 'Whoever gets the most votes (2+) is voted out. Ties vote out everyone tied, so one Werewolf among them is enough.'}</p>`;
    } else {
      body = `<p class="lede">${v.wordGuessed ? 'The werewolves are choosing their single victim. Discuss out loud and try to bluff them!' : 'Watching the vote.'}</p>`;
    }
    const waiting = S.players.filter((p) => p.waiting).map((p) => esc(p.name));
    return `
      <section class="day-head">${timerHtml(S.voteEndsAt, 'Voting closes in')}</section>
      <section class="panel center ${v.wordGuessed ? 'hunt' : ''}">
        <div class="eyebrow">${reasons[v.reason] || ''}</div>
        <h1>${headline}</h1>
        ${body}
        <p class="muted">${v.votedCount}/${v.voterCount} votes in${waiting.length ? `. Waiting on ${waiting.join(', ')}` : ''}</p>
        <div class="row center">
          ${v.canUndo ? '<button class="btn ghost small" data-act="undo">Undo last token (back to day)</button>' : ''}
          ${S.me.isMayor || S.me.isHost ? '<button class="btn ghost small" data-act="closeVote">Close voting now</button>' : ''}
        </div>
      </section>
      ${secretPanel({ collapsible: true })}`;
  }

  // ----- results
  function viewResults() {
    const r = S.result;
    const wolvesWin = r.winner === 'werewolf';
    const myLine = S.me.role ? `<div class="you-${S.me.won ? 'won' : 'lost'}">${S.me.won ? 'You won!' : 'You lost.'}</div>` : '';
    const cards = S.players
      .map((p) => {
        const votes = r.counts[p.id] || 0;
        const votedFor = r.votes[p.id];
        const killed = r.killed.includes(p.id);
        return `
        <div class="result-card ${killed ? 'killed' : ''} team-${role(p.role).team}">
          ${roleImg(p.role)}
          <div class="rc-name">${esc(p.name)}${p.isMayor ? ' <img class="mini-badge" src="/img/mayor.svg" alt="Mayor">' : ''}</div>
          <div class="rc-role">${esc(role(p.role).name)}${p.doppel ? ' (Doppelganger)' : ''}</div>
          <div class="rc-votes">${votes ? `${votes} vote${votes > 1 ? 's' : ''}` : ''}${killed ? ' · ☠ voted out' : ''}</div>
          ${votedFor ? `<div class="rc-voted muted small">voted ${pname(votedFor)}</div>` : ''}
        </div>`;
      })
      .join('');
    return `
      <section class="panel center banner ${wolvesWin ? 'wolves' : 'village'}">
        <img class="banner-img" src="/img/roles/${wolvesWin ? 'werewolf' : 'villager'}.svg" alt="">
        <h1>${wolvesWin ? 'The Werewolves win' : 'The Village wins'}</h1>
        <p class="lede">${esc(r.reason)}</p>
        <div class="word-reveal">The word was <b>${esc(S.word)}</b></div>
        ${myLine}
      </section>
      <section class="panel"><h2>Everyone's roles</h2><div class="result-grid">${cards}</div></section>
      <section class="start-bar">
        ${S.me.isHost ? '<button class="btn primary big" data-act="backToLobby">Play again</button>' : '<span class="muted">The host can start another round.</span>'}
      </section>`;
  }

  // ------------------------------------------------------------------ timers
  let lastBeepSecond = null;
  function tickTimers() {
    document.querySelectorAll('.timer').forEach((el) => {
      const ends = Number(el.dataset.ends);
      if (!ends) return;
      const left = ends - now();
      el.querySelector('.timer-val').textContent = fmt(left);
      el.classList.toggle('low', left < 30000);
      el.classList.toggle('critical', left < 10000);
      const sec = Math.ceil(left / 1000);
      if (sec !== lastBeepSecond && sec >= 1 && (sec <= 5 || sec === 10 || sec === 30 || sec === 60)) {
        lastBeepSecond = sec;
        beep(sec <= 5 ? 990 : 660);
      }
    });
  }
  setInterval(tickTimers, 250);

  // ------------------------------------------------------------- role dialog
  const dialog = document.getElementById('role-dialog');
  function showRole(id) {
    const r = role(id);
    dialog.innerHTML = `
      <form method="dialog" class="role-dialog">
        ${roleImg(id, 'dialog-img')}
        <div>
          <h2 class="team-${r.team}">${esc(r.name)}</h2>
          <div class="team-tag team-${r.team}">${r.team === 'werewolf' ? 'Werewolf team' : 'Village team'}</div>
          <p>${esc(r.description)}</p>
          <p class="muted small">Max ${r.maxInstances} per game${r.minPlayers ? ` · suggested ${r.minPlayers}+ players` : ''}</p>
          <button class="btn">Close</button>
        </div>
      </form>`;
    if (dialog.showModal) dialog.showModal();
  }
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());

  // ---------------------------------------------------------------- events
  app.addEventListener('submit', async (e) => {
    if (e.target.id !== 'home-form') return;
    e.preventDefault();
    const mode = (e.submitter && e.submitter.dataset.mode) || 'join';
    const name = document.getElementById('name').value.trim();
    const code = document.getElementById('code').value.trim().toUpperCase();
    if (!name) return toast('Please enter your name.');
    store.set('name', name);
    if (mode === 'join' && code.length !== 4) return toast('Enter the 4-letter game code, or start a new game.');
    const res = await emit(mode === 'create' ? 'create' : 'join', { name, code });
    if (res.ok) enterGame(res.code);
  });

  app.addEventListener('input', (e) => {
    if (e.target.id === 'code') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  });

  app.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.setting) {
      const v = el.type === 'number' ? Number(el.value) : el.value;
      act('updateSettings', { settings: { [el.dataset.setting]: v } });
    } else if (el.dataset.list) {
      const checked = [...app.querySelectorAll('[data-list]')].filter((c) => c.checked).map((c) => c.dataset.list);
      if (!checked.length) {
        el.checked = true;
        return toast('Keep at least one word list.');
      }
      act('updateSettings', { settings: { lists: checked.length === META.wordLists.length ? [] : checked } });
    }
  });

  app.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const a = el.dataset.act;
    switch (a) {
      case 'role-info':
        return showRole(el.dataset.role);
      case 'copy':
        try {
          await navigator.clipboard.writeText(el.dataset.text);
          toast('Invite link copied.', 'ok');
        } catch {
          toast(el.dataset.text, 'ok');
        }
        return;
      case 'toggle-secret':
        showSecret = !showSecret;
        return render();
      case 'select-asker':
        selectedAsker = selectedAsker === el.dataset.id ? null : el.dataset.id;
        return render();
      case 'flip':
        revealFlipped = true;
        return render();
      case 'leave': {
        if (!confirm('Leave this game?')) return;
        const res = await emit('leave');
        if (res.ok) exitGame();
        return;
      }
      case 'giveToken': {
        if (el.dataset.token === 'correct' && !confirm(`Mark ${player(selectedAsker).name}'s guess as CORRECT? This ends the day.`)) return;
        const res = await act('giveToken', { playerId: selectedAsker, token: el.dataset.token });
        if (res.ok) {
          selectedAsker = null;
          beep(520, 0.06);
          render();
        }
        return;
      }
      case 'endDay':
        if (confirm('End the day now and go straight to voting?')) act('endDay');
        return;
      case 'closeVote':
        if (confirm('Close voting now? Missing votes will not count.')) act('closeVote');
        return;
      case 'kick':
        if (confirm(`Remove ${player(el.dataset.id).name} from the game?`)) act('kick', { playerId: el.dataset.id });
        return;
      case 'makeHost':
        if (confirm(`Make ${player(el.dataset.id).name} the host?`)) act('makeHost', { playerId: el.dataset.id });
        return;
      case 'chooseWord':
        if (confirm(`Use "${el.dataset.word}" as the secret word?`)) act('chooseWord', { word: el.dataset.word });
        return;
      case 'nightAction':
        if (confirm(`Choose ${player(el.dataset.id).name}?`)) act('nightAction', { target: el.dataset.id });
        return;
      case 'vote':
        return act('vote', { target: el.dataset.id });
      case 'addRole':
      case 'removeRole':
        return act(a, { role: el.dataset.role });
      case 'start':
        showSecret = false;
        return act('start');
      default:
        // nominate, recommendedRoles, acknowledge, forceNight, undo, backToLobby
        return act(a);
    }
  });

  // ------------------------------------------------------------ navigation
  function enterGame(code) {
    store.set('lastCode', code);
    if (location.pathname !== `/g/${code}`) history.pushState({}, '', `/g/${code}`);
  }

  function exitGame() {
    S = null;
    store.set('lastCode', null);
    history.pushState({}, '', '/');
    render();
  }

  async function resume() {
    const code = codeFromUrl() || store.get('lastCode');
    if (!code) return render();
    const res = await emit('resume', { code });
    if (res.ok) return enterGame(res.code);
    if (res.error === 'gone') {
      if (codeFromUrl()) toast(`Game ${code} has ended or doesn't exist.`);
      store.set('lastCode', null);
      if (codeFromUrl()) history.replaceState({}, '', '/');
    }
    S = null;
    render();
    // Visiting an invite link with a remembered name: focus the join button.
    const name = document.getElementById('name');
    if (res.error === 'not-member' && name && name.value) document.querySelector('[data-mode="join"]')?.focus();
  }

  window.addEventListener('popstate', () => {
    if (!codeFromUrl() && S) {
      // back button to home: keep membership, just show home
      S = null;
      render();
    } else resume();
  });

  // ------------------------------------------------------------- socket io
  const conn = document.getElementById('conn');
  socket.on('connect', () => {
    conn.className = 'conn on';
    conn.title = 'Connected';
    if (META) resume();
  });
  socket.on('disconnect', () => {
    conn.className = 'conn off';
    conn.title = 'Reconnecting…';
  });
  socket.on('fatal', (m) => toast(m));
  socket.on('state', (view) => {
    const prevPhase = S && S.phase;
    clockOffset = view.serverNow - Date.now();
    S = view;
    if (prevPhase && prevPhase !== S.phase) {
      showSecret = false;
      revealFlipped = false;
      selectedAsker = null;
      if (['day', 'vote', 'results'].includes(S.phase)) beep(740, 0.15);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    render();
  });

  fetch('/api/meta')
    .then((r) => r.json())
    .then((m) => {
      META = m;
      if (socket.connected) resume();
      else render();
    })
    .catch(() => (app.innerHTML = '<p class="loading">Could not reach the server. Reload to try again.</p>'));
})();
