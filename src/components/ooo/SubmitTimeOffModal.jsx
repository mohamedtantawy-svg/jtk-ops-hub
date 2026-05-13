// ── SubmitTimeOffModal ──────────────────────────────────────────────────
// Manual time-off entry (Lucy's 2026-05-13 ask). One step:
//   • For (person picker — gated by caller's reporting chain)
//   • Start date / End date
//   • Optional reason (≤ 80 chars to match the schema)
//
// Permission scope on the client mirrors `canManageTimeOffFor` on the
// server so the picker can't offer someone the caller is going to be
// refused on submit. Server is still the authority — the client gate
// is just UX, the 403 path is still handled.

import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from '../ui/Avatar';
import { createTimeOffEvent } from '../../services/timeOffApi';

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isManagerAccess(access) {
  const a = String(access || '').toLowerCase();
  return a === 'admin' || a === 'regional_manager' || a === 'team_lead';
}

// Compute the set of emails the caller is allowed to submit time off
// for. Mirrors src/lib/queue-scoping.js::canManageTimeOffFor — keep
// in sync if the spec changes.
//   • Agents      → self only
//   • Team Leads  → self + direct reports
//   • Regional Mgrs → self + every email in their reporting subtree
//   • Admin       → every active member
function buildManageableEmails(callerEmail, callerAccess, members) {
  const out = new Set();
  if (!callerEmail) return out;
  const lcCaller = String(callerEmail).toLowerCase();
  out.add(lcCaller);
  const access = String(callerAccess || '').toLowerCase();
  if (!isManagerAccess(access) || !Array.isArray(members)) return out;

  if (access === 'admin') {
    for (const m of members) if (m?.email && !m.isDeleted) out.add(String(m.email).toLowerCase());
    return out;
  }

  // Build managerEmail → directReports map once.
  const directByManager = new Map();
  for (const m of members) {
    if (!m || m.isDeleted) continue;
    const mgr = m.managerEmail ? String(m.managerEmail).toLowerCase() : null;
    if (!mgr) continue;
    if (!directByManager.has(mgr)) directByManager.set(mgr, []);
    directByManager.get(mgr).push(String(m.email).toLowerCase());
  }

  if (access === 'team_lead') {
    for (const e of directByManager.get(lcCaller) || []) out.add(e);
    return out;
  }

  // regional_manager → BFS through directs to surface the full subtree.
  const queue = [lcCaller];
  while (queue.length > 0) {
    const head = queue.shift();
    for (const e of directByManager.get(head) || []) {
      if (!out.has(e)) { out.add(e); queue.push(e); }
    }
  }
  return out;
}

export default function SubmitTimeOffModal({ currentUserEmail, currentUserAccess, members, onClose, onCreated, onToast }) {
  const callerLc = (currentUserEmail || '').toLowerCase();
  const candidates = useMemo(() => {
    const allowed = buildManageableEmails(callerLc, currentUserAccess, members);
    return (members || [])
      .filter(m => m?.email && !m.isDeleted && allowed.has(String(m.email).toLowerCase()))
      .sort((a, b) => {
        const aSelf = String(a.email).toLowerCase() === callerLc ? 0 : 1;
        const bSelf = String(b.email).toLowerCase() === callerLc ? 0 : 1;
        if (aSelf !== bSelf) return aSelf - bSelf;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
  }, [callerLc, currentUserAccess, members]);

  const [workEmail, setWorkEmail] = useState(callerLc);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [startDate, setStartDate] = useState(isoToday());
  const [endDate, setEndDate] = useState(isoToday());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pickerRef = useRef(null);

  // Outside-click closes the person picker without closing the modal.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDocClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [pickerOpen]);

  // Esc closes the whole modal.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selectedMember = useMemo(
    () => candidates.find(m => String(m.email).toLowerCase() === workEmail),
    [candidates, workEmail],
  );

  const filteredCandidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(m => {
      const hay = `${m.name || ''} ${m.email || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [candidates, query]);

  const datesValid = !!startDate && !!endDate && endDate >= startDate;
  const canSubmit = !!workEmail && datesValid && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createTimeOffEvent({
        workEmail,
        startDate,
        endDate,
        reason: reason.trim() || null,
      });
      onCreated?.(res?.item || null);
      onToast?.({ kind: 'success', message: `Time off submitted for ${selectedMember?.name || workEmail}.` });
      onClose?.();
    } catch (err) {
      const msg = err?.body?.error || err?.message || 'Failed to submit time off';
      setError(msg);
      onToast?.({ kind: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  };

  // Manager OR admin — show the picker. Agents only ever submit for
  // themselves, so we lock the field to a read-only display.
  const canPickPerson = isManagerAccess(currentUserAccess);

  return (
    <>
      <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.30)', zIndex: 60 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Submit time off"
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(480px, 92vw)', maxHeight: '90vh',
          background: 'var(--surface)',
          borderRadius: 14,
          boxShadow: '0 20px 40px rgba(15,23,42,0.18)',
          zIndex: 61,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'inherit',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px 12px',
          borderBottom: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: '#f3eff8',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <i className="bi-calendar-plus" style={{ fontSize: 18, color: '#7c3aed' }}></i>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Submit time off</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Add an entry the Deel sync missed or got wrong. {canPickPerson ? 'You can submit for yourself or anyone reporting to you.' : 'You can only submit for yourself.'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', padding: 6, cursor: 'pointer', color: 'var(--text-secondary)' }}
          >
            <i className="bi-x-lg" style={{ fontSize: 14 }}></i>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Person */}
          <div ref={pickerRef} style={{ position: 'relative' }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>
              For
            </label>
            {canPickPerson ? (
              <>
                <button
                  type="button"
                  onClick={() => setPickerOpen(p => !p)}
                  aria-haspopup="listbox"
                  aria-expanded={pickerOpen}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--surface)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    color: 'var(--text)',
                    textAlign: 'left',
                  }}
                >
                  {selectedMember ? (
                    <>
                      <Avatar name={selectedMember.name} initials={selectedMember.initials} src={selectedMember.avatarUrl} size="sm" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedMember.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedMember.email}</div>
                      </div>
                    </>
                  ) : (
                    <span style={{ flex: 1, color: 'var(--text-secondary)', fontSize: 13 }}>Pick a person…</span>
                  )}
                  <i className="bi-chevron-down" style={{ fontSize: 12, color: 'var(--text-secondary)' }} />
                </button>
                {pickerOpen && (
                  <div
                    role="listbox"
                    style={{
                      position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      boxShadow: '0 8px 24px rgba(15,23,42,0.10)',
                      padding: 4,
                      maxHeight: 280,
                      overflowY: 'auto',
                      zIndex: 62,
                    }}
                  >
                    <input
                      autoFocus
                      type="search"
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Search…"
                      style={{
                        width: '100%', height: 32, padding: '0 10px',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        background: 'var(--surface)',
                        color: 'var(--text)',
                        fontSize: 12,
                        fontFamily: 'inherit',
                        marginBottom: 4,
                      }}
                    />
                    {filteredCandidates.length === 0 && (
                      <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center' }}>
                        No matches
                      </div>
                    )}
                    {filteredCandidates.map(m => {
                      const isSelf = String(m.email).toLowerCase() === callerLc;
                      return (
                        <button
                          key={m.email}
                          type="button"
                          role="option"
                          aria-selected={String(m.email).toLowerCase() === workEmail}
                          onClick={() => {
                            setWorkEmail(String(m.email).toLowerCase());
                            setPickerOpen(false);
                            setQuery('');
                          }}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                            padding: '6px 8px',
                            border: 'none',
                            background: String(m.email).toLowerCase() === workEmail ? 'var(--surface-2)' : 'transparent',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontFamily: 'inherit',
                            color: 'var(--text)',
                            borderRadius: 6,
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
                          onMouseLeave={e => e.currentTarget.style.background = String(m.email).toLowerCase() === workEmail ? 'var(--surface-2)' : 'transparent'}
                        >
                          <Avatar name={m.name} initials={m.initials} src={m.avatarUrl} size="sm" />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span>{m.name}</span>
                              {isSelf && <span style={{ fontSize: 9, fontWeight: 700, color: '#7c3aed', background: '#f3eff8', padding: '1px 6px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.04em' }}>You</span>}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--surface-2)',
                color: 'var(--text)',
              }}>
                {selectedMember && <Avatar name={selectedMember.name} initials={selectedMember.initials} src={selectedMember.avatarUrl} size="sm" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedMember?.name || currentUserEmail}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{currentUserEmail}</div>
                </div>
              </div>
            )}
          </div>

          {/* Dates */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label htmlFor="time-off-start" style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>
                Start
              </label>
              <input
                id="time-off-start"
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                style={{
                  width: '100%', height: 36, padding: '0 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label htmlFor="time-off-end" style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>
                End
              </label>
              <input
                id="time-off-end"
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={e => setEndDate(e.target.value)}
                style={{
                  width: '100%', height: 36, padding: '0 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
          {!datesValid && (
            <div style={{ fontSize: 11, color: '#b91c1c' }}>End date must be on or after start date.</div>
          )}

          {/* Reason */}
          <div>
            <label htmlFor="time-off-reason" style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>
              Reason <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>(optional)</span>
            </label>
            <input
              id="time-off-reason"
              type="text"
              maxLength={80}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. PTO, sick day, public holiday"
              style={{
                width: '100%', height: 36, padding: '0 10px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 13,
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <div style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: '#FEE2E2',
              color: '#991b1b',
              fontSize: 12,
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 22px',
          borderTop: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end',
        }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              height: 34, padding: '0 14px',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--surface)',
              color: 'var(--text)',
              fontWeight: 600, fontSize: 12,
              cursor: busy ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              height: 34, padding: '0 16px',
              border: 'none',
              borderRadius: 8,
              background: canSubmit ? '#7c3aed' : '#d4d4d8',
              color: 'white',
              fontWeight: 700, fontSize: 12,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
            }}
          >
            {busy ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </>
  );
}
