// ── renderRichText ──────────────────────────────────────────────────────────
// Tiny inline-markup renderer for announcement bodies (and any other plain-
// text surface that wants slack-style hyperlinks). Recognises:
//
//   • Markdown-style named links:  [Open SOP](https://deel.notion.site/sop)
//   • Bare URLs:                   https://deel.notion.site/sop
//   • Bold:                        **emphatic words**
//   • Italic:                      *emphasised words*
//
// Unrecognised text passes through untouched. Output is an array of React
// nodes suitable for rendering inside a <div> / <span>. Links open in a new
// tab with rel="noopener noreferrer" so an announcement body can never
// hijack window.opener.
//
// Why a custom mini-parser instead of a real markdown lib: announcements
// are short, single-line / few-line texts. Pulling react-markdown +
// rehype-sanitize would add ~80KB to the bundle for a feature that needs
// two regexes. Keeping it small and obvious here is the right trade.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';

// Matches `[label](https://...)`. Label captures non-`]` greedily; URL must
// start with http:// or https:// and stops at whitespace, `)`, or `>`.
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)>]+)\)/g;

// Bare URL — http:// or https://. Stops at whitespace, common closing
// punctuation, and angle brackets so we don't slurp trailing prose.
const URL_RE = /(https?:\/\/[^\s<>\)\]]+)/g;

// Trailing punctuation that's almost certainly NOT part of the URL the user
// typed. Strip these off auto-linked bare URLs (the visible text and the
// href both lose them) so "see https://x.com." opens "https://x.com" not
// "https://x.com.".
const TRAILING_PUNCT_RE = /[.,;:!?\)\]'"]+$/;

function linkStyle(color) {
  return {
    color,
    textDecoration: 'underline',
    textUnderlineOffset: 2,
    wordBreak: 'break-word',
  };
}

// Inline emphasis (bold / italic). The 2026-05-03 live audit (F32) caught
// announcement bodies rendering literal `**On-Platform**` because authors
// wrote markdown but the renderer only handled links. Splits on
// `**…**` / `*…*` and wraps in <strong> / <em>. Anything else passes through
// unchanged. Bold MUST be checked before italic so `**word**` doesn't get
// misinterpreted as `*` italic + `word*` text.
function applyEmphasis(text, keyPrefix) {
  if (!text) return [];
  const tokens = String(text).split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*[^*\s]\*|\*[^*\s]\*)/g);
  const out = [];
  tokens.forEach((tok, i) => {
    if (!tok) return;
    const k = `${keyPrefix}-em-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(tok)) {
      out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    } else if (/^\*[^*\s][^*]*[^*\s]\*$|^\*[^*\s]\*$/.test(tok)) {
      out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    } else {
      out.push(<React.Fragment key={k}>{tok}</React.Fragment>);
    }
  });
  return out;
}

// Auto-link bare URLs inside a plain string, returning React nodes. Used as
// the "fallback" pass after markdown links are extracted.
function autoLinkBare(s, color, keyPrefix) {
  if (!s) return [];
  const out = [];
  let last = 0;
  let key = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(s)) !== null) {
    if (m.index > last) {
      out.push(...applyEmphasis(s.slice(last, m.index), `${keyPrefix}-pre-${key++}`));
    }
    let url = m[1];
    let trailing = '';
    const trail = url.match(TRAILING_PUNCT_RE);
    if (trail) {
      trailing = trail[0];
      url = url.slice(0, url.length - trailing.length);
    }
    out.push(
      <a
        key={`${keyPrefix}-l-${key++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={linkStyle(color)}
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>
    );
    if (trailing) {
      out.push(...applyEmphasis(trailing, `${keyPrefix}-trail-${key++}`));
    }
    last = m.index + m[1].length;
  }
  if (last < s.length) {
    // Apply bold/italic emphasis to plain (un-linked) trailing text so
    // markdown formatting works alongside auto-linked URLs. The pre-link
    // segments inside `renderRichText` flow through here too.
    out.push(...applyEmphasis(s.slice(last), `${keyPrefix}-tail-${key++}`));
  } else if (out.length === 0) {
    // No links found at all — still apply emphasis so a plain
    // `**bold**` line renders correctly (was the F32 repro case).
    return applyEmphasis(s, `${keyPrefix}-emonly`);
  }
  return out;
}

/**
 * Render a single line of plain text with markdown links + bare URLs
 * promoted to <a> elements.
 *
 * @param {string} line
 * @param {object} [opts]
 * @param {string} [opts.color] — hex / CSS var for link colour. Default purple.
 * @param {string} [opts.keyPrefix] — unique prefix per call site so React
 *                                    keys don't collide when multiple lines
 *                                    are rendered side-by-side.
 * @returns {React.ReactNode[]}
 */
export function renderRichText(line, opts = {}) {
  if (!line) return null;
  const color = opts.color || 'var(--purple, #6b3fa0)';
  const keyPrefix = opts.keyPrefix || 'rt';

  const parts = [];
  let lastIndex = 0;
  let mdKey = 0;
  let m;
  MD_LINK_RE.lastIndex = 0;
  while ((m = MD_LINK_RE.exec(line)) !== null) {
    if (m.index > lastIndex) {
      parts.push(...autoLinkBare(line.slice(lastIndex, m.index), color, `${keyPrefix}-pre${mdKey}`));
    }
    parts.push(
      <a
        key={`${keyPrefix}-md-${mdKey++}`}
        href={m[2]}
        target="_blank"
        rel="noopener noreferrer"
        style={linkStyle(color)}
        onClick={(e) => e.stopPropagation()}
      >
        {m[1]}
      </a>
    );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < line.length) {
    parts.push(...autoLinkBare(line.slice(lastIndex), color, `${keyPrefix}-tail`));
  }
  return parts.length === 0 ? line : parts;
}

export default renderRichText;
