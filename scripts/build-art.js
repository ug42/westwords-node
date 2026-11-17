'use strict';
/**
 * Generates the role card art in public/img/roles/.
 *
 * Every card shares one "frontier tarot" frame: a parchment card, an arched
 * window onto a desert sky, a mesa horizon and a team plaque. Only the central
 * silhouette changes per role, so the set reads as one deck.
 *
 *   Village team  -> golden dusk sky, sun, teal trim, star plaque
 *   Werewolf team -> blood-moon night sky, crimson trim, claw plaque
 *
 * Run: npm run art
 */
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'public', 'img', 'roles');
const INK = '#2a1810';
const PAPER = '#f3e4c5';
const PAPER_DARK = '#e2cc9f';

const TEAMS = {
  village: {
    trim: '#2f6f73',
    sky: ['#fbd38d', '#f3a65a', '#d9673b'],
    orb: '#fff1c4',
    orbOpacity: 0.9,
    ground: '#5b3420',
    eye: '#fbd38d',
  },
  werewolf: {
    trim: '#9b2230',
    sky: ['#1d0f2b', '#5a1630', '#b23a2c'],
    orb: '#f06a4a',
    orbOpacity: 0.95,
    ground: '#1a0d0a',
    eye: '#ffcf5a',
  },
};

// ------------------------------------------------------------------ emblems
// Each emblem draws inside the arch (roughly x 50..190, y 60..218).
// `t` is the team palette (for eyes/highlights that should glow).

const bust = (x, { hat = true, fill = INK, extra = '' } = {}) => `
  <g transform="translate(${x - 120} 0)" fill="${fill}">
    <path d="M78 218 C80 176 96 154 120 150 C144 154 160 176 162 218 Z"/>
    <path d="M112 146 h16 v10 h-16 z"/>
    <circle cx="120" cy="124" r="20"/>
    ${hat ? `<ellipse cx="120" cy="106" rx="38" ry="7"/>
    <path d="M100 106 C100 84 108 78 113 80 C117 82 123 82 127 80 C132 78 140 84 140 106 Z"/>` : ''}
    ${extra}
  </g>`;

const EMBLEMS = {
  villager: (t) => `
    ${bust(112)}
    <g stroke="${INK}" stroke-width="5" stroke-linecap="round" fill="none">
      <path d="M168 218 V84"/>
      <path d="M152 84 H184"/>
      <path d="M152 84 V62 M168 84 V58 M184 84 V62"/>
    </g>
    <circle cx="104" cy="126" r="2.6" fill="${t.eye}"/>
    <circle cx="120" cy="126" r="2.6" fill="${t.eye}"/>`,

  seer: (t) => `
    <g stroke="${INK}" stroke-width="5" stroke-linecap="round">
      ${[...Array(12)]
        .map((_, i) => {
          const a = (i / 12) * Math.PI * 2;
          const r1 = 62, r2 = 80;
          return `<line x1="${(120 + Math.cos(a) * r1).toFixed(1)}" y1="${(140 + Math.sin(a) * r1 * 0.8).toFixed(1)}" x2="${(120 + Math.cos(a) * r2).toFixed(1)}" y2="${(140 + Math.sin(a) * r2 * 0.8).toFixed(1)}"/>`;
        })
        .join('')}
    </g>
    <path d="M52 140 Q120 72 188 140 Q120 208 52 140 Z" fill="${INK}"/>
    <circle cx="120" cy="140" r="27" fill="${t.eye}"/>
    <circle cx="120" cy="140" r="12" fill="${INK}"/>
    <circle cx="113" cy="133" r="4" fill="#fff8e6"/>`,

  apprentice: (t) => `
    <g stroke="${INK}" stroke-width="4" stroke-linecap="round">
      <line x1="120" y1="72" x2="120" y2="60"/><line x1="92" y1="80" x2="84" y2="70"/><line x1="148" y1="80" x2="156" y2="70"/>
    </g>
    <path d="M82 112 Q120 72 158 112 Q120 136 82 112 Z" fill="${INK}"/>
    <path d="M96 108 Q120 92 144 108 Q120 122 96 108 Z" fill="${t.eye}"/>
    <circle cx="120" cy="110" r="7" fill="${INK}"/>
    <path d="M82 112 Q120 84 158 112 L158 104 Q120 76 82 104 Z" fill="${INK}"/>
    <path d="M56 214 L56 160 Q88 146 118 162 L118 214 Q88 200 56 214 Z" fill="${INK}"/>
    <path d="M184 214 L184 160 Q152 146 122 162 L122 214 Q152 200 184 214 Z" fill="${INK}"/>
    <g stroke="${t.eye}" stroke-width="2.5" stroke-linecap="round" opacity="0.8">
      <path d="M68 172 Q88 164 108 174 M68 184 Q88 176 108 186 M68 196 Q88 188 108 198"/>
      <path d="M132 174 Q152 164 172 172 M132 186 Q152 176 172 184 M132 198 Q152 188 172 196"/>
    </g>`,

  fortuneteller: (t) => `
    <g fill="${INK}">
      <rect x="62" y="74" width="40" height="62" rx="4" transform="rotate(-22 82 105)"/>
      <rect x="138" y="74" width="40" height="62" rx="4" transform="rotate(22 158 105)"/>
    </g>
    <g fill="none" stroke="${t.eye}" stroke-width="2" opacity="0.75">
      <rect x="68" y="80" width="28" height="50" rx="2" transform="rotate(-22 82 105)"/>
      <rect x="144" y="80" width="28" height="50" rx="2" transform="rotate(22 158 105)"/>
    </g>
    <circle cx="120" cy="146" r="44" fill="${INK}"/>
    <circle cx="120" cy="146" r="36" fill="${t.eye}" opacity="0.9"/>
    <path d="M120 120 L125 140 L144 146 L125 152 L120 172 L115 152 L96 146 L115 140 Z" fill="${INK}"/>
    <circle cx="106" cy="132" r="5" fill="#fff8e6" opacity="0.9"/>
    <path d="M88 218 L96 186 H144 L152 218 Z" fill="${INK}"/>
    <rect x="80" y="210" width="80" height="8" rx="3" fill="${INK}"/>`,

  beholder: (t) => `
    <g fill="${t.eye}" stroke="${INK}" stroke-width="3" stroke-linejoin="round">
      ${[[150, 70], [178, 96], [168, 64]]
        .map(([x, y], i) => {
          const r = i === 2 ? 7 : 10;
          return `<path d="M${x} ${y - r} L${x + r * 0.3} ${y - r * 0.3} L${x + r} ${y} L${x + r * 0.3} ${y + r * 0.3} L${x} ${y + r} L${x - r * 0.3} ${y + r * 0.3} L${x - r} ${y} L${x - r * 0.3} ${y - r * 0.3} Z"/>`;
        })
        .join('')}
    </g>
    <g transform="rotate(-36 112 150)" fill="${INK}">
      <rect x="60" y="138" width="44" height="24" rx="4"/>
      <rect x="100" y="134" width="40" height="32" rx="4"/>
      <rect x="136" y="128" width="40" height="44" rx="5"/>
      <rect x="172" y="124" width="8" height="52" rx="3"/>
      <rect x="66" y="136" width="4" height="28" fill="${t.eye}" opacity="0.6"/>
    </g>
    <g stroke="${INK}" stroke-width="6" stroke-linecap="round">
      <line x1="116" y1="160" x2="84" y2="218"/>
      <line x1="116" y1="160" x2="148" y2="218"/>
      <line x1="116" y1="160" x2="116" y2="218"/>
    </g>`,

  mason: (t) => `
    <g fill="${INK}">
      ${[0, 1, 2]
        .map((row) =>
          [...Array(5)]
            .map((_, c) => {
              const off = row % 2 ? -17 : 0;
              const x = 52 + c * 34 + off;
              const w = Math.min(31, 188 - x);
              return x + 4 < 188 && w > 6 ? `<rect x="${Math.max(52, x)}" y="${168 + row * 17}" width="${x < 52 ? w + x - 52 : w}" height="14" rx="1.5"/>` : '';
            })
            .join('')
        )
        .join('')}
    </g>
    <g transform="rotate(38 120 120)" fill="${INK}">
      <rect x="114" y="70" width="12" height="80" rx="4"/>
      <rect x="96" y="56" width="48" height="22" rx="3"/>
    </g>
    <g transform="rotate(-38 120 120)" fill="${INK}">
      <path d="M120 54 L144 92 L120 108 L96 92 Z"/>
      <rect x="117" y="104" width="6" height="16"/>
      <rect x="113" y="118" width="14" height="36" rx="5"/>
    </g>
    <g transform="rotate(-38 120 120)"><path d="M120 64 L134 90 L120 100 Z" fill="${t.eye}" opacity="0.55"/></g>`,

  esper: (t) => `
    <path fill="${INK}" d="M70 218 C70 196 74 186 84 178 C76 168 72 156 72 140 C72 106 96 86 124 86
      C150 86 166 102 168 124 C169 132 172 136 178 146 C181 150 179 153 174 154 L170 155 L172 166
      C172 172 168 175 162 175 L158 176 L160 186 C160 194 154 197 144 196 L134 195 L134 218 Z"/>
    <circle cx="138" cy="122" r="4" fill="${t.eye}"/>
    <g fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round">
      <path d="M96 72 A40 40 0 0 1 148 66"/>
      <path d="M84 58 A58 58 0 0 1 162 50"/>
      <path d="M74 44 A76 76 0 0 1 176 36" opacity="0.8"/>
    </g>
    <circle cx="110" cy="118" r="16" fill="${t.eye}" opacity="0.35"/>`,

  doppelganger: (t) => `
    <g transform="translate(82 218) scale(0.85) translate(-120 -218)">
      ${bust(120)}
      <circle cx="112" cy="126" r="2.8" fill="${t.eye}"/><circle cx="128" cy="126" r="2.8" fill="${t.eye}"/>
    </g>
    <g transform="translate(158 218) scale(0.85) translate(-120 -218)" fill="none" stroke="${INK}" stroke-width="4.5" stroke-dasharray="7 5" stroke-linejoin="round">
      <path d="M78 218 C80 176 96 154 120 150 C144 154 160 176 162 218"/>
      <circle cx="120" cy="124" r="20"/>
      <ellipse cx="120" cy="106" rx="38" ry="7"/>
      <path d="M100 106 C100 84 108 78 113 80 C117 82 123 82 127 80 C132 78 140 84 140 106"/>
      <circle cx="112" cy="126" r="2.8" fill="${INK}" stroke="none"/><circle cx="128" cy="126" r="2.8" fill="${INK}" stroke="none"/>
    </g>
    <line x1="120" y1="56" x2="120" y2="212" stroke="#fff8e6" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round" opacity="0.9"/>`,

  werewolf: (t) => `
    <path fill="${INK}" d="M66 218 C68 194 72 176 80 162 L74 156 L84 150 L80 142 L90 138 L88 128
      L96 124 L86 86 L112 106 L124 98 L164 62 L178 62 L176 72 L152 92 L174 92 L170 100 L146 112
      C140 136 148 166 162 196 L168 218 Z"/>
    <path d="M118 106 L132 102 L128 110 Z" fill="${t.eye}"/>
    <path d="M152 92 L160 86" stroke="${t.eye}" stroke-width="1.5" opacity="0.6"/>`,


  minion: (t) => `
    ${bust(120, {
      extra: `<path d="M104 86 L98 66 L112 80 Z M136 86 L142 66 L128 80 Z"/>
      <path d="M98 126 L142 126 L120 154 Z"/>`,
    })}
    <rect x="102" y="117" width="36" height="7" rx="3" fill="${t.eye}" opacity="0.25"/>
    <circle cx="112" cy="120" r="2.6" fill="${t.eye}"/>
    <circle cx="128" cy="120" r="2.6" fill="${t.eye}"/>
    <g fill="${INK}">
      <path d="M170 140 V128 M176 128 h-12" stroke="${INK}" stroke-width="3" fill="none"/>
      <rect x="160" y="140" width="22" height="30" rx="4"/>
      <rect x="156" y="136" width="30" height="6" rx="2"/>
      <rect x="156" y="168" width="30" height="6" rx="2"/>
    </g>
    <rect x="165" y="146" width="12" height="18" rx="3" fill="${t.eye}"/>
    <path d="M150 190 Q160 176 168 172" stroke="${INK}" stroke-width="7" stroke-linecap="round" fill="none"/>`,
};

const ROLE_TEAMS = {
  villager: 'village',
  seer: 'village',
  apprentice: 'village',
  fortuneteller: 'village',
  beholder: 'village',
  mason: 'village',
  esper: 'village',
  doppelganger: 'village',
  werewolf: 'werewolf',
  minion: 'werewolf',
};

// -------------------------------------------------------------------- frame

const ARCH = 'M44 252 V96 A76 76 0 0 1 196 96 V252 Z';

function plaqueGlyph(team, t) {
  if (team === 'village') {
    const pts = [...Array(10)]
      .map((_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 5 : 12;
        return `${(120 + Math.cos(a) * r).toFixed(1)},${(286 + Math.sin(a) * r).toFixed(1)}`;
      })
      .join(' ');
    return `<polygon points="${pts}" fill="${t.trim}"/>`;
  }
  return `<g stroke="${t.trim}" stroke-width="4" stroke-linecap="round">
    <path d="M110 276 L104 296 M120 274 L116 298 M130 276 L128 296"/></g>`;
}

function card(roleId) {
  const team = ROLE_TEAMS[roleId];
  const t = TEAMS[team];
  const id = roleId;
  const orbY = team === 'werewolf' ? 104 : 196;
  const orbR = team === 'werewolf' ? 46 : 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320" role="img" aria-label="${roleId}">
  <defs>
    <linearGradient id="sky-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${t.sky[0]}"/>
      <stop offset="0.6" stop-color="${t.sky[1]}"/>
      <stop offset="1" stop-color="${t.sky[2]}"/>
    </linearGradient>
    <radialGradient id="glow-${id}" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${t.orb}" stop-opacity="${t.orbOpacity}"/>
      <stop offset="0.7" stop-color="${t.orb}" stop-opacity="${t.orbOpacity}"/>
      <stop offset="1" stop-color="${t.orb}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="arch-${id}"><path d="${ARCH}"/></clipPath>
  </defs>
  <rect x="4" y="4" width="232" height="312" rx="18" fill="${PAPER}" stroke="${INK}" stroke-width="6"/>
  <rect x="16" y="16" width="208" height="288" rx="10" fill="none" stroke="${t.trim}" stroke-width="3"/>
  <rect x="22" y="22" width="196" height="276" rx="7" fill="none" stroke="${PAPER_DARK}" stroke-width="2"/>
  ${[[16, 16], [224, 16], [16, 304], [224, 304]]
    .map(([x, y]) => `<path d="M${x} ${y - 7} L${x + 7} ${y} L${x} ${y + 7} L${x - 7} ${y} Z" fill="${t.trim}" stroke="${INK}" stroke-width="2"/>`)
    .join('')}
  <g clip-path="url(#arch-${id})">
    <rect x="40" y="16" width="160" height="240" fill="url(#sky-${id})"/>
    <circle cx="${team === 'werewolf' ? 160 : 120}" cy="${orbY}" r="${orbR + 14}" fill="url(#glow-${id})"/>
    ${team === 'werewolf'
      ? `<circle cx="160" cy="104" r="${orbR - 6}" fill="${t.orb}"/>
         <g fill="#fff" opacity="0.8"><circle cx="66" cy="60" r="1.6"/><circle cx="90" cy="84" r="1.2"/><circle cx="76" cy="120" r="1.4"/><circle cx="122" cy="52" r="1.2"/></g>`
      : `<g fill="#fff8e6" opacity="0.5"><ellipse cx="78" cy="78" rx="18" ry="4"/><ellipse cx="166" cy="66" rx="14" ry="3"/></g>`}
    <path d="M40 222 L64 212 L70 200 L104 200 L110 214 L150 216 L160 206 L186 206 L192 216 L200 218 V256 H40 Z" fill="${t.ground}"/>
    <g opacity="0.95">${EMBLEMS[roleId](t)}</g>
    <rect x="40" y="218" width="160" height="40" fill="${t.ground}"/>
    <path d="M176 218 V200 M176 206 h-6 v-6 M176 210 h6 v-8" stroke="${t.ground}" stroke-width="4" stroke-linecap="round" fill="none"/>
  </g>
  <path d="${ARCH}" fill="none" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M30 270 H210" stroke="${INK}" stroke-width="2"/>
  ${plaqueGlyph(team, t)}
</svg>
`;
}

function mayorBadge() {
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 6;
    const r = i % 2 ? 26 : 50;
    pts.push(`${(64 + Math.cos(a) * r).toFixed(1)},${(64 + Math.sin(a) * r).toFixed(1)}`);
  }
  const tips = [...Array(6)]
    .map((_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      return `<circle cx="${(64 + Math.cos(a) * 52).toFixed(1)}" cy="${(64 + Math.sin(a) * 52).toFixed(1)}" r="7"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="Mayor">
  <g fill="#e9b949" stroke="${INK}" stroke-width="4" stroke-linejoin="round">
    <polygon points="${pts.join(' ')}"/>${tips}
  </g>
  <circle cx="64" cy="64" r="20" fill="#f7d77c" stroke="${INK}" stroke-width="3"/>
  <circle cx="64" cy="64" r="13" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="2 3"/>
</svg>
`;
}

function cardBack() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320" role="img" aria-label="Hidden role">
  <defs>
    <pattern id="p" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="24" height="24" fill="#5b3420"/>
      <path d="M0 12 H24 M12 0 V24" stroke="#6e4229" stroke-width="2"/>
    </pattern>
  </defs>
  <rect x="4" y="4" width="232" height="312" rx="18" fill="url(#p)" stroke="${INK}" stroke-width="6"/>
  <rect x="16" y="16" width="208" height="288" rx="10" fill="none" stroke="#e9b949" stroke-width="3"/>
  <circle cx="120" cy="160" r="62" fill="${PAPER}" stroke="${INK}" stroke-width="5"/>
  <path d="M120 112 C140 140 140 180 120 208 C100 180 100 140 120 112 Z" fill="#9b2230"/>
  <path d="M72 160 C100 140 140 140 168 160 C140 180 100 180 72 160 Z" fill="#2f6f73"/>
  <circle cx="120" cy="160" r="12" fill="#e9b949" stroke="${INK}" stroke-width="3"/>
</svg>
`;
}

function favicon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#1d0f2b"/>
  <circle cx="40" cy="22" r="13" fill="#f06a4a"/>
  <path d="M8 58 C9 46 14 40 20 36 L16 22 L26 30 L30 16 L36 30 C40 30 44 28 48 24 L56 18 L50 32 C52 34 50 36 46 37 C48 44 50 50 52 58 Z" fill="#f3e4c5"/>
</svg>
`;
}

fs.mkdirSync(OUT, { recursive: true });
for (const id of Object.keys(EMBLEMS)) fs.writeFileSync(path.join(OUT, `${id}.svg`), card(id));
fs.writeFileSync(path.join(OUT, 'back.svg'), cardBack());
fs.writeFileSync(path.join(__dirname, '..', 'public', 'img', 'mayor.svg'), mayorBadge());
fs.writeFileSync(path.join(__dirname, '..', 'public', 'favicon.svg'), favicon());
console.log(`Wrote ${Object.keys(EMBLEMS).length} role cards + back, mayor badge and favicon.`);
