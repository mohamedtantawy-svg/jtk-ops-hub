// ── Leaders Alerts: detail drawer ─────────────────────────────────────────
// Slide-in drawer from the right. Shows the alert + ack flow + audit log.
// Comments + reactions land in Stage 4 (placeholder note for now).

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  getLeaderAlert,
  ackLeaderAlert,
  unackLeaderAlert,
  patchLeaderAlert,
  deleteLeaderAlert,
  muteLeaderAlertThread,
  unfollowLeaderAlert,
} from '../../services/leaderAlertsApi';
import { MEMBERS } from '../../data/members';
import { FLAGS, getCountryName } from '../../data/constants';
import LeaderAlertCommentsThread from './LeaderAlertCommentsThread';

// ── Constants (mirror LeaderAlertsView) ───────────────────────────────────

const SEVERITY_META = {
  critical: { label: 'Critical', color: '#dc2626', bg: '#fef2f2', icon: 'bi-exclamation-octagon-fill' },
  high:     { label: 'High',     color: '#d97706', bg: '#fff8e6', icon: 'bi-exclamation-triangle-fill' },
  medium:   { label: 'Medium',   color: '#0369a1', bg: '#e0f2fe', icon: 'bi-info-circle-fill' },
  low:      { label: 'Low',      color: '#15803d', bg: '#f0fdf4', icon: 'bi-check-circle' },
};

const STATUS_META = {
  new:         { label: 'New',         color: '#1d4ed8', bg: '#dbeafe', icon: 'bi-circle-fill' },
  in_progress: { label: 'In Progress', color: '#ed8d00', bg: '#fff8e6', icon: 'bi-arrow-repeat' },
  on_hold:     { label: 'On Hold',     color: '#525252', bg: '#f3f4f6', icon: 'bi-pause-circle-fill' },
  resolved:    { label: 'Resolved',    color: '#29811e', bg: '#dcfce7', icon: 'bi-check-circle-fill' },
};

const STATUS_OPTIONS = ['new', 'in_progress', 'on_hold', 'resolved'];
const SEVERITY_OPTIONS = ['critical', 'high', 'medium', 'low'];

// Defensive ISO parse — see audit L2 in LEADER_ALERTS_PLAN.md.
function ensureIsoZ(s) {
  if (!s) return s;
  const str = String(s);
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(str)) return str;
  if (/T\d{2}:\d{2}/.test(str)) return str + 'Z';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str)) return str.replace(' ', 'T') + 'Z';
  return str;
}

function formatExact(iso) {
  if (!iso) return '';
  return new Date(ensureIsoZ(iso)).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatRelative(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(ensureIsoZ(iso)).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day} days ago`;
  return new Date(ensureIsoZ(iso)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// All current managers (for the "Missing" panel + ack universe size).
function listAllManagers() {
  const out = [];
  for (const m of MEMBERS) {
    const access = String(m.access || '').toLowerCase();
    if (access === 'team_lead' || access === 'regional_manager' || access === 'admin') out.push(m);
  }
  return out;
}

// ── Component ─────────────────────────────────────────────────────────────

const LeaderAlertDetailPanel = ({
  alertId, alertHint,
  settings, user, perms,
  onClose, onChanged,
}) => {
  const [data, setData]       = useState(null);          // { alert, acks, comments, followers, log }
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [busy, setBusy]       = useState(false);         // ack/patch in flight
  const [showLog, setShowLog] = useState(false);
  const [showAcks, setShowAcks] = useState(false);

  const fetchTickRef = useRef(0);

  const refetch = useCallback(async () => {
    fetchTickRef.current += 1;
    const tick = fetchTickRef.current;
    setLoading(true);
    setError(null);
    try {
      const d = await getLeaderAlert(alertId);
      if (tick !== fetchTickRef.current) return;
      setData(d);
    } catch (e) {
      if (tick !== fetchTickRef.current) return;
      setError(e?.message || 'Could not load alert');
    } finally {
      if (tick === fetchTickRef.current) setLoading(false);
    }
  }, [alertId]);

  useEffect(() => { refetch(); }, [refetch]);

  // Esc to close.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const alert     = data?.alert || alertHint;
  const acks      = Array.isArray(data?.acks)      ? data.acks      : [];
  const log       = Array.isArray(data?.log)       ? data.log       : [];
  const comments  = Array.isArray(data?.comments)  ? data.comments  : [];
  const followers = Array.isArray(data?.followers) ? data.followers : [];

  const sev    = alert ? (SEVERITY_META[alert.severity] || SEVERITY_META.medium) : SEVERITY_META.medium;
  const status = alert ? (STATUS_META[alert.status] || STATUS_META.new) : STATUS_META.new;

  const allManagers = useMemo(listAllManagers, []);
  const ackedEmailSet = useMemo(() => new Set(acks.map(a => (a.email || '').toLowerCase())), [acks]);
  const missingManagers = useMemo(
    () => allManagers.filter(m => !ackedEmailSet.has((m.email || '').toLowerCase())),
    [allManagers, ackedEmailSet],
  );
  const myEmailLc = (user?.email || '').toLowerCase();
  const acked = ackedEmailSet.has(myEmailLc);
  const isCreator = (alert?.created_by_email || '').toLowerCase() === myEmailLc;
  const canEdit = isCreator || !!perms?.canManageLeaderAlerts;

  const myFollower = followers.find(f => (f.email || '').toLowerCase() === myEmailLc);
  const muted = !!myFollower?.muted;

  // ── Action handlers ──────────────────────────────────────────────────────
  const toggleAck = async () => {
    if (busy || !alert) return;
    setBusy(true);
    try {
      if (acked) await unackLeaderAlert(alert.id);
      else await ackLeaderAlert(alert.id);
      await refetch();
      onChanged?.();
    } catch (e) {
      setError(e?.message || 'Could not update acknowledgement');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (next) => {
    if (busy || !alert || alert.status === next) return;
    setBusy(true);
    try {
      await patchLeaderAlert(alert.id, { status: next });
      await refetch();
      onChanged?.();
    } catch (e) {
      setError(e?.message || 'Could not change status');
    } finally {
      setBusy(false);
    }
  };

  const changeSeverity = async (next) => {
    if (busy || !alert || alert.severity === next) return;
    setBusy(true);
    try {
      await patchLeaderAlert(alert.id, { severity: next });
      await refetch();
      onChanged?.();
    } catch (e) {
      setError(e?.message || 'Could not change severity');
    } finally {
      setBusy(false);
    }
  };

  const toggleMute = async () => {
    if (busy || !alert) return;
    setBusy(true);
    try {
      if (muted) await unfollowLeaderAlert(alert.id);
      else await muteLeaderAlertThread(alert.id, true);
      await refetch();
    } catch (e) {
      setError(e?.message || 'Could not toggle mute');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!perms?.canManageLeaderAlerts) return;
    if (!window.confirm('Delete this alert? This cannot be undone.')) return;
    setBusy(true);
    try {
      await deleteLeaderAlert(alert.id);
      onChanged?.();
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Could not delete alert');
      setBusy(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="leader-alert-detail-title"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        background: 'rgba(15, 23, 42, 0.35)',
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div style={{
        width: 'min(680px, 100%)', height: '100%',
        background: 'var(--surface)', boxShadow: 'var(--shadow-lg)',
        display: 'flex', flexDirection: 'column',
        animation: 'la-slide-in .18s ease-out',
      }}>
        <style>{`@keyframes la-slide-in { from { transform: translateX(40px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: sev.bg, color: sev.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <i className={sev.icon} style={{ fontSize: 15 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="leader-alert-detail-title" style={{
              fontSize: 13, fontWeight: 700, color: 'var(--text)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {alert ? alert.title : 'Loading…'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {alert && (
                <>
                  {alert.created_by_name || alert.created_by_email} · {formatRelative(alert.created_at)}
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={toggleMute}
            disabled={busy || !alert}
            title={muted ? 'Unmute thread' : 'Mute notifications for this alert'}
            style={{
              height: 30, padding: '0 10px', borderRadius: 128,
              border: `1px solid ${muted ? '#0369a1' : 'var(--border)'}`,
              background: muted ? '#e0f2fe' : 'var(--surface)',
              color: muted ? '#0369a1' : 'var(--text-secondary)',
              cursor: busy || !alert ? 'not-allowed' : 'pointer',
              fontSize: 11, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <i className={muted ? 'bi-bell-slash-fill' : 'bi-bell'} style={{ fontSize: 11 }} />
            {muted ? 'Muted' : 'Mute'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            style={{
              width: 30, height: 30, borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-secondary)', cursor: busy ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <i className="bi-x-lg" style={{ fontSize: 12 }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px 24px' }}>
          {loading && !alert && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Loading alert…
            </div>
          )}
          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: 10,
              background: '#fef2f2', color: '#b91c1c',
              fontSize: 12, marginBottom: 12,
            }}>
              {error}
            </div>
          )}

          {alert && (
            <>
              {/* Status / Severity / Category control row */}
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16,
                paddingBottom: 12, borderBottom: '1px solid var(--border-light)',
              }}>
                <ControlPill
                  label="Status"
                  value={alert.status}
                  options={STATUS_OPTIONS.map(s => ({ id: s, label: STATUS_META[s].label, color: STATUS_META[s].color, icon: STATUS_META[s].icon }))}
                  onChange={changeStatus}
                  disabled={!canEdit || busy}
                />
                <ControlPill
                  label="Severity"
                  value={alert.severity}
                  options={SEVERITY_OPTIONS.map(s => ({ id: s, label: SEVERITY_META[s].label, color: SEVERITY_META[s].color, icon: SEVERITY_META[s].icon }))}
                  onChange={changeSeverity}
                  disabled={!canEdit || busy}
                />
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 128,
                  background: 'var(--surface-2)', color: 'var(--text-secondary)',
                  fontSize: 12, fontWeight: 600,
                }}>
                  <i className="bi-tag-fill" style={{ fontSize: 11 }} />
                  {alert.category}
                </span>
                {perms?.canManageLeaderAlerts && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={busy}
                    style={{
                      marginLeft: 'auto',
                      padding: '6px 12px', borderRadius: 128,
                      border: '1px solid var(--border)', background: 'var(--surface)',
                      color: '#b91c1c', fontSize: 12, fontWeight: 600,
                      cursor: busy ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <i className="bi-trash" style={{ fontSize: 11, marginRight: 4 }} />
                    Delete
                  </button>
                )}
              </div>

              {/* Body text */}
              <div style={{
                fontSize: 13, lineHeight: 1.6, color: 'var(--text)',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                marginBottom: 16,
              }}>
                {alert.body}
              </div>

              {/* Impact tags */}
              {Array.isArray(alert.impact_tags) && alert.impact_tags.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <SectionLabel>Impact</SectionLabel>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {alert.impact_tags.map(tag => (
                      <ImpactChip key={tag} tag={tag} />
                    ))}
                  </div>
                </div>
              )}

              {/* Links */}
              {Array.isArray(alert.links) && alert.links.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <SectionLabel>Links</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                    {alert.links.map((u, i) => (
                      <a key={i} href={u} target="_blank" rel="noreferrer" style={{
                        fontSize: 12, color: '#0369a1',
                        wordBreak: 'break-all', textDecoration: 'none',
                      }}>
                        <i className="bi-link-45deg" style={{ marginRight: 4 }} />
                        {u}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Attachments */}
              {Array.isArray(alert.attachments) && alert.attachments.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <SectionLabel>Attachments</SectionLabel>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                    {alert.attachments.map((a, i) => (
                      <a
                        key={i}
                        href={a.dataUri}
                        target="_blank"
                        rel="noreferrer"
                        style={{ display: 'block' }}
                      >
                        {a.kind === 'image'
                          ? <img src={a.dataUri} alt={a.name || ''} style={{ maxWidth: 200, maxHeight: 140, borderRadius: 10, border: '1px solid var(--border)' }} />
                          : <div style={{
                              padding: '10px 14px', borderRadius: 10,
                              background: 'var(--surface-2)', border: '1px solid var(--border)',
                              fontSize: 12, color: 'var(--text-secondary)',
                            }}>
                              <i className="bi-camera-video" style={{ marginRight: 6 }} />
                              {a.name || 'Video'}
                            </div>}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* The cool ack button */}
              <AckButton
                acked={acked}
                count={acks.length || alert.ack_count || 0}
                missingCount={missingManagers.length}
                acks={acks}
                busy={busy}
                onClick={toggleAck}
                onShowAcks={() => setShowAcks(true)}
              />

              {/* Comments thread */}
              <div style={{ marginTop: 24, marginBottom: 24 }}>
                <SectionLabel>Discussion</SectionLabel>
                <div style={{ marginTop: 8 }}>
                  <LeaderAlertCommentsThread
                    alertId={alert.id}
                    initialComments={comments}
                    currentUser={user}
                    perms={perms}
                  />
                </div>
              </div>

              {/* Audit log (collapsed) */}
              <button
                type="button"
                onClick={() => setShowLog(s => !s)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 0', border: 'none', background: 'transparent',
                  color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', marginBottom: 6,
                }}
              >
                <i className={showLog ? 'bi-chevron-down' : 'bi-chevron-right'} style={{ fontSize: 11 }} />
                Activity log ({log.length})
              </button>
              {showLog && (
                <div style={{
                  border: '1px solid var(--border)', borderRadius: 10,
                  background: 'var(--surface-2)', padding: '8px 12px',
                  maxHeight: 240, overflowY: 'auto',
                }}>
                  {log.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>No activity recorded yet.</div>
                  )}
                  {log.map(entry => (
                    <div key={entry.id} style={{
                      padding: '6px 0', borderBottom: '1px solid var(--border-light)',
                      fontSize: 11, color: 'var(--text-secondary)',
                    }}>
                      <span style={{ color: 'var(--text)' }}>{entry.actor_name || entry.actor_email || 'System'}</span>
                      {' · '}
                      <span style={{ fontWeight: 600 }}>{entry.event_type.replace(/_/g, ' ')}</span>
                      {' · '}
                      <span style={{ color: 'var(--text-muted)' }}>{formatExact(entry.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showAcks && (
        <AcksModal
          acks={acks}
          missing={missingManagers}
          onClose={() => setShowAcks(false)}
        />
      )}
    </div>
  );
};

// ── Subcomponents ─────────────────────────────────────────────────────────

const SectionLabel = ({ children }) => (
  <div style={{
    fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: 0.5,
  }}>{children}</div>
);

const ImpactChip = ({ tag }) => {
  const isSpecial = tag === 'Global' || tag === 'Team';
  if (isSpecial) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 10px', borderRadius: 128,
        background: '#f3eff8', color: '#5b21b6',
        fontSize: 12, fontWeight: 600,
      }}>
        <i className={tag === 'Global' ? 'bi-globe2' : 'bi-people-fill'} style={{ fontSize: 11 }} />
        {tag}
      </span>
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 128,
      background: 'var(--surface-2)', color: 'var(--text)',
      fontSize: 12, fontWeight: 600,
    }}>
      <span>{FLAGS[tag] || tag}</span>
      {getCountryName(tag) || tag}
    </span>
  );
};

const ControlPill = ({ label, value, options, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const cur = options.find(o => o.id === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderRadius: 128,
          border: `1px solid ${cur?.color || 'var(--border)'}`,
          background: cur ? `${cur.color}15` : 'var(--surface)',
          color: cur?.color || 'var(--text-secondary)',
          fontSize: 12, fontWeight: 700,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.7 : 1,
        }}
      >
        {cur && <i className={cur.icon} style={{ fontSize: 11 }} />}
        <span>{label}: {cur?.label || value}</span>
        {!disabled && <i className="bi-chevron-down" style={{ fontSize: 10 }} />}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0,
          minWidth: 180, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 10,
          boxShadow: 'var(--shadow-lg)', padding: '4px 0', zIndex: 100,
        }}>
          {options.map(o => (
            <button
              key={o.id}
              type="button"
              onClick={() => { onChange(o.id); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '8px 12px', border: 'none',
                background: o.id === value ? 'var(--surface-2)' : 'transparent',
                color: o.color, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={(e) => { if (o.id !== value) e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseLeave={(e) => { if (o.id !== value) e.currentTarget.style.background = 'transparent'; }}
            >
              <i className={o.icon} style={{ fontSize: 11 }} />
              {o.label}
              {o.id === value && <i className="bi-check2" style={{ marginLeft: 'auto', fontSize: 13 }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// The cool ack button + avatar stack.
const AckButton = ({ acked, count, missingCount, acks, busy, onClick, onShowAcks }) => {
  const visibleAvatars = acks.slice(0, 5);
  const hiddenAvatars = Math.max(0, count - visibleAvatars.length);
  return (
    <div style={{
      marginTop: 8, padding: '16px 18px', borderRadius: 14,
      border: `1.5px solid ${acked ? '#15803d' : 'var(--border)'}`,
      background: acked ? '#f0fdf4' : 'var(--surface-2)',
      display: 'flex', alignItems: 'center', gap: 14,
      transition: 'all .15s',
    }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 18px', borderRadius: 128,
          border: 'none',
          background: acked ? '#15803d' : '#7c3aed',
          color: 'white', fontSize: 14, fontWeight: 700,
          cursor: busy ? 'not-allowed' : 'pointer',
          boxShadow: acked ? '0 4px 12px rgba(21, 128, 61, 0.3)' : '0 4px 12px rgba(124, 58, 237, 0.3)',
          transition: 'all .15s',
        }}
      >
        <i className={acked ? 'bi-check-circle-fill' : 'bi-hand-thumbs-up-fill'} style={{ fontSize: 16 }} />
        {busy ? 'Saving…' : (acked ? 'Acknowledged' : 'Acknowledge')}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          {count} {count === 1 ? 'leader has' : 'leaders have'} acknowledged
        </div>
        <button
          type="button"
          onClick={onShowAcks}
          style={{
            marginTop: 4,
            border: 'none', background: 'transparent',
            color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600,
            cursor: 'pointer', padding: 0, textDecoration: 'underline',
          }}
        >
          {missingCount} still missing — see who
        </button>
      </div>

      {/* Avatar stack */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {visibleAvatars.map((a, idx) => (
          <Avatar key={a.email} name={a.name || a.email} idx={idx} />
        ))}
        {hiddenAvatars > 0 && (
          <div style={{
            width: 28, height: 28, borderRadius: 14, marginLeft: -8,
            background: 'var(--surface)', border: '2px solid var(--surface)',
            color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            +{hiddenAvatars}
          </div>
        )}
      </div>
    </div>
  );
};

const Avatar = ({ name, idx }) => {
  const initials = (name || '').split(/\s+/).map(s => s.charAt(0).toUpperCase()).slice(0, 2).join('') || '?';
  const palette = ['#7c3aed', '#dc2626', '#0369a1', '#15803d', '#d97706', '#0891b2'];
  const bg = palette[idx % palette.length];
  return (
    <div title={name} style={{
      width: 28, height: 28, borderRadius: 14, marginLeft: idx === 0 ? 0 : -8,
      background: bg, color: 'white',
      border: '2px solid var(--surface)',
      fontSize: 10, fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {initials}
    </div>
  );
};

// Acks modal — two-column "Acknowledged" + "Missing".
const AcksModal = ({ acks, missing, onClose }) => {
  const [tab, setTab] = useState('missing');     // missing | acked
  const [search, setSearch] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ackedSorted = [...acks].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const missingSorted = [...missing].sort((a, b) => (a.team || '').localeCompare(b.team || '') || (a.name || '').localeCompare(b.name || ''));
  const filterFn = (m) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (m.name || '').toLowerCase().includes(q)
      || (m.email || '').toLowerCase().includes(q)
      || (m.team || '').toLowerCase().includes(q)
      || (m.region || '').toLowerCase().includes(q);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div style={{
        width: 'min(560px, 100%)', maxHeight: '78vh',
        background: 'var(--surface)', borderRadius: 16,
        boxShadow: 'var(--shadow-lg)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Acknowledgements</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{acks.length} acked · {missing.length} missing</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 30, height: 30, borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text-secondary)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <i className="bi-x-lg" style={{ fontSize: 12 }} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: '10px 20px 8px' }}>
          {[
            { id: 'missing', label: `Missing (${missing.length})` },
            { id: 'acked',   label: `Acknowledged (${acks.length})` },
          ].map(t => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                style={{
                  padding: '6px 14px', borderRadius: 128, border: 'none',
                  background: active ? '#f3eff8' : 'transparent',
                  color: active ? '#5b21b6' : 'var(--text-secondary)',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            style={{
              height: 28, padding: '0 10px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text)', fontSize: 12, outline: 'none',
              width: 140,
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 12px' }}>
          {tab === 'acked' && (
            <>
              {ackedSorted.filter(filterFn).length === 0 && <PanelEmpty text={search ? `No matches for "${search}"` : 'Nobody has acknowledged yet.'} />}
              {ackedSorted.filter(filterFn).map((a, idx) => (
                <PersonRow
                  key={a.email}
                  name={a.name || a.email}
                  email={a.email}
                  hint={`Acked ${formatRelative(a.created_at)}`}
                  acked
                  idx={idx}
                />
              ))}
            </>
          )}
          {tab === 'missing' && (
            <>
              {missingSorted.filter(filterFn).length === 0 && <PanelEmpty text={search ? `No matches for "${search}"` : 'Everyone has acknowledged 🎉'} />}
              {missingSorted.filter(filterFn).map((m, idx) => (
                <PersonRow
                  key={m.email}
                  name={m.name || m.email}
                  email={m.email}
                  hint={[m.team, m.region].filter(Boolean).join(' · ')}
                  idx={idx}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const PanelEmpty = ({ text }) => (
  <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>{text}</div>
);

const PersonRow = ({ name, email, hint, acked, idx }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '10px 8px', borderRadius: 10,
    transition: 'background .1s',
  }}
    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
  >
    <Avatar name={name} idx={idx} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{email}{hint ? ` · ${hint}` : ''}</div>
    </div>
    {acked && <i className="bi-check-circle-fill" style={{ fontSize: 14, color: '#15803d' }} />}
  </div>
);

export default LeaderAlertDetailPanel;
