// ── AnnouncementMedia ──────────────────────────────────────────────────────
// Render helper for the optional media attached to an announcement. The DB
// stores either an http(s) URL (legacy, rarely used) or an inline data URI
// for the image/video the author uploaded in ComposeModal. Same field
// (`image_url` server-side / `imageUrl` client-side) carries both kinds —
// we sniff the data-URI prefix to pick `<video controls>` vs `<img>` so
// callers don't have to repeat the conditional at every render site
// (PreviewPopup, AnnouncementPopup, AnnouncementsView's row + popup).

export function isAnnouncementVideo(src) {
  return typeof src === 'string' && /^data:video\//i.test(src);
}

export default function AnnouncementMedia({ src, style, alt = '' }) {
  if (!src) return null;
  if (isAnnouncementVideo(src)) {
    return (
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        style={style}
      />
    );
  }
  return <img src={src} alt={alt} style={style} />;
}
