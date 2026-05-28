// ── RichTextBody (2026-05-28 — Mohamed ask) ────────────────────────────
// Renders user-typed text with proper affordances for two inline tokens:
//   • URLs                → styled <a> hyperlink (target=_blank,
//                           rel="noopener noreferrer"), word-breaks so
//                           long URLs don't blow the column width.
//   • @first.last mentions → purple chip pill (same look as the existing
//                            HR-Hub CommentBody chips).
//
// Everything else passes through as plain text inside a `pre-wrap`
// container so newlines + indentation typed by the user survive intact.
//
// Why a shared component
// ──────────────────────
// Insiya pasted a deep-link URL into an HR Hub comment and it rendered
// as plain text — no hyperlink, not clickable. Mohamed's directive was
// "anywhere on Ops Hub" — every surface that renders user-typed text
// should auto-link, otherwise the experience is inconsistent and
// frustrating. Centralising in one component avoids per-surface drift
// and means a future change (e.g. adding inline emoji shortcodes) lands
// in one place.
//
// Safety
// ──────
// The URL regex only matches `http(s)://...` and `www...`. `javascript:`
// / `data:` URIs cannot match, so passing the captured value to an
// <a href> is safe from script-execution XSS. React's standard
// attribute escaping handles the rest. The mention regex matches
// `[a-z][a-z0-9._-]{1,80}` which is the same shape as the existing
// HR Hub mention parser — keeps visual + functional parity.
//
// Same-tab vs new-tab
// ───────────────────
// All URLs open in a new tab. Internal links (jtk.dp.com/?view=...)
// would full-page-reload in the same tab and discard the current
// drawer state / draft text the user might still be editing —
// opening in a new tab preserves the current session. The
// performance cost is one extra tab; in exchange we never silently
// destroy in-progress work.

import { useMemo } from 'react';

// Match http(s)://... and www....* — the regex is intentionally
// conservative on terminators: stops at whitespace, angle brackets, or
// quote chars. Trailing punctuation (.,;) is trimmed post-match so a
// sentence-final URL doesn't pull the period into its href.
const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+\.[a-z]{2,}[^\s<>"']*)/gi;
const MENTION_RE = /(^|\s)@([a-z][a-z0-9._-]{1,80})/gi;
// Trailing characters that should be peeled back off a URL match
// before linking (otherwise sentence-final periods / commas get baked
// into the href).
const TRAILING_PUNCT = /[.,;:!?)\]>}'"]+$/;

/**
 * Two-pass tokenizer. First pass: pull out URL matches. Second pass:
 * walk the remaining text segments and split on @mention. Returns a
 * flat list of { kind: 'url' | 'mention' | 'text', value }.
 */
function tokenize(body) {
  if (!body) return [];
  const out = [];
  // Pass 1 — URLs.
  let cursor = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(body)) != null) {
    if (m.index > cursor) {
      out.push({ kind: 'text', value: body.slice(cursor, m.index) });
    }
    let url = m[1];
    // Peel trailing punctuation back into the text stream — keeps
    // sentence terminators rendering correctly outside the link.
    const trailMatch = url.match(TRAILING_PUNCT);
    let trail = '';
    if (trailMatch) {
      trail = trailMatch[0];
      url = url.slice(0, url.length - trail.length);
    }
    if (url) out.push({ kind: 'url', value: url });
    if (trail) out.push({ kind: 'text', value: trail });
    cursor = URL_RE.lastIndex;
  }
  if (cursor < body.length) {
    out.push({ kind: 'text', value: body.slice(cursor) });
  }
  // Pass 2 — @mentions inside the text segments only.
  const final = [];
  for (const seg of out) {
    if (seg.kind !== 'text') { final.push(seg); continue; }
    let last = 0;
    let mm;
    MENTION_RE.lastIndex = 0;
    while ((mm = MENTION_RE.exec(seg.value)) != null) {
      const start = mm.index + mm[1].length;
      if (start > last) final.push({ kind: 'text', value: seg.value.slice(last, start) });
      final.push({ kind: 'mention', value: mm[2] });
      last = start + 1 + mm[2].length;
    }
    if (last < seg.value.length) final.push({ kind: 'text', value: seg.value.slice(last) });
  }
  return final;
}

// Resolves the href passed to <a>. www-prefixed links get http:// in
// front so the browser doesn't treat them as relative paths.
//
// 2026-05-28 — explicit protocol allowlist via the URL parser. CodeQL's
// js/xss-through-dom data-flow analyzer can't follow a regex-only
// guarantee back to the assignment site (mistake #37 — analyzer-
// friendly = literal, parsed checks). The URL constructor throws on
// malformed input, and we then check protocol against a static
// allowlist of `http:` / `https:`. Anything that survives both gates
// is by-definition a safe http(s) URL — `javascript:`, `data:`,
// `vbscript:` etc. cannot pass.
function resolveHref(value) {
  if (typeof value !== 'string' || value.length === 0) return '#';
  // Prepend http:// for www.foo.com style strings so the URL parser
  // doesn't see them as relative paths.
  const candidate = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  try {
    const u = new URL(candidate);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.toString();
    }
  } catch {
    // Malformed — fall through to the safe sentinel.
  }
  return '#';
}

export default function RichTextBody({ body, style, linkStyle, mentionStyle }) {
  const tokens = useMemo(() => tokenize(body || ''), [body]);
  return (
    <div
      style={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        ...style,
      }}
    >
      {tokens.map((tok, i) => {
        if (tok.kind === 'url') {
          return (
            <a
              key={i}
              href={resolveHref(tok.value)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                // Stop the click from propagating to ancestors (e.g. row
                // click handlers that open a drawer). The user explicitly
                // wants to follow the link, not toggle the row.
                e.stopPropagation();
              }}
              style={{
                color: '#1f74b3',
                textDecoration: 'underline',
                wordBreak: 'break-all',
                ...linkStyle,
              }}
            >{tok.value}</a>
          );
        }
        if (tok.kind === 'mention') {
          return (
            <span
              key={i}
              style={{
                background: '#f3eff8',
                color: '#5b21b6',
                borderRadius: 4,
                padding: '0 4px',
                fontWeight: 600,
                ...mentionStyle,
              }}
            >@{tok.value}</span>
          );
        }
        return <span key={i}>{tok.value}</span>;
      })}
    </div>
  );
}
