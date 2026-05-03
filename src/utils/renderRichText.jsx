// ── renderRichText ──────────────────────────────────────────────────────────
// Tiny inline-markup renderer for announcement bodies (and any other plain-
// text surface that wants slack-style hyperlinks). Recognises:
//
//   • Markdown-style named links:  [Open SOP](https://deel.notion.site/sop)
//   • Bare URLs:                   https://deel.notion.site/sop
//   • Bold:                        **emphatic words**
//   • Italic:                      *emphasised words*
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
  // The pre-URL fragments above pushed raw React.Fragment text — replace
  // them with emphasis-rendered equivalents on a final sweep so bold/italic
  // can appear inside the same line as links.
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
