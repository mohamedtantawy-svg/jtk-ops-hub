// ── ImageLightbox ──────────────────────────────────────────────────────────
// In-app fullscreen viewer for screenshot attachments. Replaces the
// `<a href={dataUri} target="_blank">` pattern that previously sat under
// every Feedback / HR Hub / Leaders-Alerts attachment thumbnail —
// modern Chrome refuses to navigate to large data: URIs in a new tab
// (silent blank page) so clicking a screenshot did nothing visible.
//
// Mount once per render site, control visibility with a `src` state. Esc
// or backdrop click closes. The download link gives the user an actual
// way to save the file (browsers allow `download` attribute on data URIs).

import { useEffect } from 'react';

export default function ImageLightbox({ src, alt = '', name, onClose }) {
  useEffect(() => {
    if (!src) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-label="Attachment viewer"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.85)',
        zIndex: 2000,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      {/* Toolbar */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 12, right: 12,
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        <a
          href={src}
          download={name || 'attachment'}
          onClick={e => e.stopPropagation()}
          aria-label="Download"
          title="Download"
          style={toolbarBtn}
        >
          <i className="bi-download" style={{ fontSize: 13 }} />
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
          style={{ ...toolbarBtn, border: 'none', cursor: 'pointer' }}
        >
          <i className="bi-x-lg" style={{ fontSize: 14 }} />
        </button>
      </div>

      {/* Image — scaled to fit, click stops propagation so the user can
          interact (right-click → save) without dismissing. */}
      <img
        src={src}
        alt={alt}
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: 'min(96vw, 1600px)',
          maxHeight: 'calc(100vh - 100px)',
          objectFit: 'contain',
          borderRadius: 8,
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          background: '#fff',
        }}
      />

      {name && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            color: 'rgba(255,255,255,0.85)', fontSize: 12,
            background: 'rgba(0,0,0,0.5)', padding: '4px 10px', borderRadius: 8,
            maxWidth: '80vw', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {name}
        </div>
      )}
    </div>
  );
}

const toolbarBtn = {
  width: 36, height: 36, borderRadius: 999,
  background: 'rgba(255,255,255,0.95)', color: '#1b1b1b',
  border: '1px solid rgba(255,255,255,0.4)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  textDecoration: 'none',
};
