import { escapeHtml, pickTier, placeholder, FONT_STACKS } from './_shared.js';

// Word of the Day — a daily-rotating vocabulary word. Zero fetch, zero key:
// rotates a built-in set (or the user's own list) by day-of-year, so it
// changes once a day and never depends on a flaky dictionary API. `now` comes
// from ctx.now when present (frozen demo → deterministic) else Date.now().

// [word, part-of-speech, definition]. Kept concise so the definition fits a
// small e-ink tile at a legible size.
const BUILT_IN = [
  ['petrichor', 'n.', 'the earthy scent produced when rain falls on dry soil'],
  ['ephemeral', 'adj.', 'lasting for a very short time'],
  ['mellifluous', 'adj.', 'sweet or musical; pleasant to hear'],
  ['limerence', 'n.', 'the state of being infatuated with another person'],
  ['sonder', 'n.', 'the awareness that each passerby lives a life as vivid as your own'],
  ['ineffable', 'adj.', 'too great to be expressed in words'],
  ['serendipity', 'n.', 'the occurrence of happy events by chance'],
  ['halcyon', 'adj.', 'denoting a period that is idyllically happy and peaceful'],
  ['ubiquitous', 'adj.', 'present, appearing, or found everywhere'],
  ['sonorous', 'adj.', 'imposingly deep and full in sound'],
  ['ephemera', 'n.', 'things that exist or are useful for only a short time'],
  ['quixotic', 'adj.', 'idealistic and impractical to an extreme degree'],
  ['susurrus', 'n.', 'a soft murmuring or rustling sound'],
  ['eloquent', 'adj.', 'fluent or persuasive in speaking or writing'],
  ['aplomb', 'n.', 'self-confidence or assurance, especially in a demanding situation'],
  ['ephemeron', 'n.', 'something short-lived or transitory'],
  ['numinous', 'adj.', 'having a strong spiritual or otherworldly quality'],
  ['effervescent', 'adj.', 'vivacious and enthusiastic'],
  ['penumbra', 'n.', 'a partial shadow between full light and full shadow'],
  ['saudade', 'n.', 'a deep, nostalgic longing for something absent'],
  ['wabi-sabi', 'n.', 'finding beauty in imperfection and impermanence'],
  ['equanimity', 'n.', 'calmness and composure, especially under strain'],
  ['perspicacious', 'adj.', 'having keen insight or discernment'],
  ['luminous', 'adj.', 'full of or shedding light; bright'],
  ['vellichor', 'n.', 'the strange wistfulness of used bookstores'],
  ['solitude', 'n.', 'the state of being alone, often by choice'],
  ['redolent', 'adj.', 'strongly reminiscent or suggestive of something'],
  ['gossamer', 'n.', 'something light, delicate, or insubstantial'],
  ['incandescent', 'adj.', 'full of strong emotion; passionate'],
  ['ephemerality', 'n.', 'the quality of lasting for a very short time'],
  ['nascent', 'adj.', 'just coming into existence and beginning to develop'],
  ['assiduous', 'adj.', 'showing great care and perseverance'],
  ['tenacious', 'adj.', 'holding firmly to a purpose; persistent'],
  ['sagacious', 'adj.', 'having or showing keen mental discernment'],
  ['ebullient', 'adj.', 'cheerful and full of energy'],
  ['fastidious', 'adj.', 'very attentive to accuracy and detail'],
  ['pellucid', 'adj.', 'translucently clear; easily understood'],
  ['zephyr', 'n.', 'a soft, gentle breeze'],
  ['coalesce', 'v.', 'to come together to form one whole'],
  ['diaphanous', 'adj.', 'light, delicate, and translucent'],
  ['effulgent', 'adj.', 'shining brightly; radiant'],
  ['resplendent', 'adj.', 'attractive and impressive through being richly colorful'],
  ['sanguine', 'adj.', 'optimistic, especially in a difficult situation'],
  ['temerity', 'n.', 'excessive confidence or boldness; audacity'],
  ['verdant', 'adj.', 'green with growing plants; lush'],
  ['winsome', 'adj.', 'attractive or appealing in a fresh, innocent way'],
  ['alacrity', 'n.', 'brisk and cheerful readiness'],
  ['bucolic', 'adj.', 'relating to the pleasant aspects of the countryside'],
  ['cynosure', 'n.', 'a person or thing that is the center of attention'],
  ['defenestration', 'n.', 'the act of throwing someone out of a window'],
  ['elucidate', 'v.', 'to make something clear; explain'],
  ['felicity', 'n.', 'intense happiness; the ability to find apt expression'],
  ['ineluctable', 'adj.', 'unable to be resisted or avoided; inevitable'],
  ['juxtapose', 'v.', 'to place close together for contrasting effect'],
  ['kismet', 'n.', 'destiny; fate'],
  ['lissome', 'adj.', 'thin, supple, and graceful'],
  ['mercurial', 'adj.', 'subject to sudden or unpredictable changes of mood'],
  ['obfuscate', 'v.', 'to render obscure, unclear, or unintelligible'],
  ['propinquity', 'n.', 'nearness in place or relationship'],
  ['quiescent', 'adj.', 'in a state of inactivity or dormancy']
];

function dayOfYear(now) {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000);
}

// Custom rows: "word — definition" or "word (part) — definition". Split on
// the first em/hyphen dash; pull an optional (part) prefix off the word.
function parseCustom(str) {
  if (typeof str !== 'string' || !str.trim()) return null;
  const m = str.match(/^(.*?)[\s]*[—-][\s]*(.+)$/);
  if (!m) return [str.trim(), '', ''];
  let word = m[1].trim();
  let part = '';
  const pm = word.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (pm) { word = pm[1].trim(); part = pm[2].trim(); }
  return [word, part, m[2].trim()];
}

export const def = {
  id: 'wordofday',
  label: 'Word of the Day',
  minSize: { w: 6, h: 3 },
  sizes: {
    S: { w: 8, h: 4 },
    M: { w: 10, h: 5 },
    L: { w: 12, h: 6 }
  },
  defaultSize: 'M',
  variants: {
    serif:  { label: 'Serif — big word + definition' }
  },
  defaultVariant: 'serif',
  degrade: {
    tiny: ['definition', 'part']
  },
  defaults: () => ({
    variant: 'serif',
    words: [],           // optional custom "word — definition" rows
    title: '',
  })
};

export function render(ctx) {
  const { settings, cellW, cellH, density } = ctx;
  const s = settings || {};
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const titleLabel = (typeof s.title === 'string' && s.title.trim())
    ? s.title.trim() : 'WORD OF THE DAY';

  const custom = (Array.isArray(s.words) ? s.words : []).map(parseCustom).filter(Boolean);
  const pool = custom.length ? custom : BUILT_IN;
  if (!pool.length) {
    return placeholder(titleLabel, 'Add a word', 'msg', { cellW, cellH });
  }

  const [word, part, definition] = pool[dayOfYear(now) % pool.length];
  const tier = pickTier(cellW || 0, cellH || 0, density);
  const showDef = tier !== 'tiny' && definition;
  const partHtml = (part && tier !== 'tiny')
    ? `<span style="font-family:${FONT_STACKS.mono};font-size:12px;letter-spacing:1px">${escapeHtml(part)}</span>` : '';
  const wordHtml = `<div class="autofit" style="font-family:${FONT_STACKS.serif};line-height:1.05" data-min-font="20" data-max-font="52">${escapeHtml(word)}</div>`;
  const defHtml = showDef
    ? `<div class="autofit multiline" style="font-family:${FONT_STACKS.serif};line-height:1.3" data-min-font="13" data-max-font="22">${escapeHtml(definition)}</div>` : '';

  const variant = ctx.variant || (def.variants[s.variant] ? s.variant : 'trmnl');
  if (variant === 'serif') {
    return `<div class="widget wod" style="display:flex;flex-direction:column;justify-content:center;height:100%;gap:6px">
      <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">${wordHtml}${partHtml}</div>
      ${defHtml}
    </div>`;
  }

  return `<div class="tr-card">
    <div class="tr-titlebar"><span>${escapeHtml(titleLabel)}</span>${part && tier !== 'tiny' ? `<span class="tr-meta">${escapeHtml(part)}</span>` : ''}</div>
    <div class="tr-body" style="flex-direction:column;justify-content:center;gap:6px">
      ${wordHtml}
      ${defHtml}
    </div>
  </div>`;
}
