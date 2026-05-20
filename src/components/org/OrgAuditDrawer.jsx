// ── OrgAuditDrawer (Phase 7, 2026-05-20) ───────────────────────────────────
// Right-side drawer showing the audit log for the Org tab. Loads from
// /api/v1/org/audit (admin-only) and renders entries grouped by date.
// Useful when an admin asks "who archived this team?" — every mutation
// from Phase 1 onward writes here.

import { useEffect, useState } from 'react';
import { apiFetch } from '../../services/api';

const ACTION_LABELS = {
  'node.create':        { label: 'Created node',          icon: 'bi-plus-circle',    color: 'var(--purple)' },
  'node.update':        { label: 'Updated node',          icon: 'bi-pencil-square',  color: '#1f74b3' },
  'node.move':          { label: 'Moved node',            icon: 'bi-arrow-left-right', color: '#0ea5e9' },
  'node.reorder':       { label: 'Reordered node',        icon: 'bi-arrows-vertical', color: 'var(--text-secondary)' },
  'node.archive':       { label: 'Archived node',         icon: 'bi-archive',         color: 'var(--orange)' },
  'node.admin.grant':   { label: 'Granted delegated admin', icon: 'bi-shield-plus', color: 'var(--purple)' },
  'node.admin.revoke':  { label: 'Revoked delegated admin', icon: 'bi-shield-minus', color: 'var(--orange)' },
  'vacancy.create':     { label: 'Opened vacancy',         icon: 'bi-person-dash',     color: 'var(--orange)' },
  'vacancy.delete':     { label: 'Closed vacancy',         icon: 'bi-person-check',    color: '#10b981' },
  'org.bootstrap':      { label: 'Bootstrapped org',       icon: 'bi-magic',           color: 'var(--purple)' },
};

function relativeTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 14) return `${diffDay}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function OrgAuditDrawer({ open, onClose }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    apiFetch('/org/audit?limit=200')
      .then(res => { setEntries(res?.entries || []); })
      .catch(err => setError(err?.message || 'Could not load audit log'))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Org audit log"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.42)',
        zIndex: 1500,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: 'min(560px, 96vw)',
          background: 'var(--surface)',
          boxShadow: '-12px 0 30px rgba(0,0,0,0.12)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{
          padding: '16px 22px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'var(--purple-light)', color: 'var(--purple)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <i className="bi bi-journal-text" style={{ fontSize: 16 }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text)' }}>
              Audit log
            </div>
            <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)' }}>
              Every org mutation, append-only. Showing the last {entries.length} entries.
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 6, color: 'var(--text-secondary)', borderRadius: 6,
            }}
          ><i className="bi bi-x-lg" style={{ fontSize: 14 }} /></button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-md)' }}>
              <i className="bi bi-arrow-clockwise" style={{ fontSize: 20, animation: 'spin 1.4s linear infinite' }} />
              <div style={{ marginTop: 8 }}>Loading…</div>
            </div>
          ) : error ? (
            <div style={{ padding: 24, color: 'var(--red-solid, #b91c1c)', fontSize: 'var(--font-sm)' }}>{error}</div>
          ) : entries.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-md)' }}>
              <i className="bi bi-archive" style={{ fontSize: 24, opacity: 0.6 }} />
              <div style={{ marginTop: 8 }}>No audit entries yet.</div>
            </div>
          ) : entries.map(e => {
            const meta = ACTION_LABELS[e.action] || { label: e.action, icon: 'bi-dot', color: 'var(--text-muted)' };
            return (
              <div key={e.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '10px 22px',
                borderBottom: '1px solid var(--border-light)',
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: `${meta.color}22`, color: meta.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, marginTop: 2,
                }}>
                  <i className={`bi ${meta.icon}`} style={{ fontSize: 13 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text)' }}>
                    {meta.label}
                    {e.after?.name && <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · {e.after.name}</span>}
                    {!e.after?.name && e.before?.name && <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · {e.before.name}</span>}
                  </div>
                  <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                    by {e.actorEmail || 'unknown'} · {relativeTime(e.createdAt)}
                  </div>
                  {e.metadata && (
                    <div style={{
                      fontSize: 'var(--font-xs)', color: 'var(--text-muted)',
                      marginTop: 3, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      background: 'var(--surface-2)',
                      padding: '4px 8px', borderRadius: 6,
                      maxWidth: '100%',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{JSON.stringify(e.metadata)}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
