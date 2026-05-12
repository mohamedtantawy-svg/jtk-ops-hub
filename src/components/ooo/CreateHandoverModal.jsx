// ── CreateHandoverModal ───────────────────────────────────────────────
// Four-step wizard (HANDOVERS_PLAN.md §12.6):
//   1. Dates    — pick the time-off event being covered
//   2. Coverers — multi-select people-picker + optional country split
//   3. Checklist — pre-filled from the default template, editable
//   4. Review   — Save draft OR Submit (kicks coverer-acceptance flow)
//
// Inputs:
//   • initialEventId — preselected on open from a Calendar bar / Table row
//   • currentUserEmail
//   • members        — merged roster for the people-picker
//   • myEvents       — caller's time-off events (used by step 1)
//   • onClose        — wizard dismiss
//   • onCreated      — called with the created handover on success

import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from '../ui/Avatar';
import MultiCountryPicker from '../team/MultiCountryPicker';
import {
  createHandover,
  submitHandover,
  toggleChecklistItem,
  fetchDefaultChecklistTemplate,
} from '../../services/handoversApi';
import { listMyTimeOffEvents } from '../../services/timeOffApi';

const STEPS = [
  { id: 1, label: 'Dates' },
  { id: 2, label: 'Coverers' },
  { id: 3, label: 'Checklist' },
  { id: 4, label: 'Review' },
];

function fmt(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function daysBetween(a, b) {
  if (!a || !b) return 0;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000) + 1;
}

// Iterate one day at a time between two ISO dates (inclusive) — used to
// detect weekend-only gaps between two events.
function isoAddDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 86400000;
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
function isoDayOfWeek(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun .. 6=Sat
}

// Group time-off events whose gap is only a weekend into a single
// "logical range". Deel reports OOO per-day with weekends excluded, so
// a Fri-Mon vacation lands as two single-day events (Fri + Mon). The
// handover wizard needs to treat that as one continuous range so the
// user submits ONE handover rather than two (Jose's 2026-05-12 bug
// "Date selection only works day by day. If a period spans a weekend,
// it shows as two separate handovers instead of one continuous range").
// Returns groups in start-date order, each carrying the merged range
// + the constituent event ids for backend submission.
function groupWeekendAdjacent(events) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const sorted = [...events].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  const groups = [];
  for (const ev of sorted) {
    const last = groups[groups.length - 1];
    if (!last) {
      groups.push({ events: [ev], start_date: ev.start_date, end_date: ev.end_date });
      continue;
    }
    // Compute the gap between `last.end_date` and `ev.start_date`. If the
    // only non-event days in between are Saturday and/or Sunday, merge.
    let bridge = true;
    let cursor = isoAddDays(last.end_date, 1);
    let safety = 0;
    while (cursor < ev.start_date && safety++ < 14) {
      const dow = isoDayOfWeek(cursor);
      if (dow !== 0 && dow !== 6) { bridge = false; break; }
      cursor = isoAddDays(cursor, 1);
    }
    if (bridge && cursor === ev.start_date) {
      last.events.push(ev);
      last.end_date = ev.end_date;
    } else {
      groups.push({ events: [ev], start_date: ev.start_date, end_date: ev.end_date });
    }
  }
  return groups;
}

function CreateHandoverModal({ initialEventId, currentUserEmail, members, onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [myEvents, setMyEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  // Selection is a SET of event ids — a weekend-adjacent group spans
  // multiple time_off_event rows, and the wizard submits one handover
  // per id (sharing coverers + checklist). Seeded with `initialEventId`
  // for callers that deep-link to a specific event (e.g. "Submit
  // handover" on a single Table row).
  const [selectedEventIds, setSelectedEventIds] = useState(
    initialEventId ? [initialEventId] : [],
  );
  const [reason, setReason] = useState('');
  const [coverers, setCoverers] = useState([]);   // [{ email, country_codes: [] }]
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [coverQuery, setCoverQuery] = useState('');
  const [checklistItems, setChecklistItems] = useState([]);   // [{ id, label, required, hint }]
  const [defaultTemplateLoaded, setDefaultTemplateLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pickerRef = useRef(null);

  // Load my upcoming events for Step 1.
  useEffect(() => {
    setEventsLoading(true);
    listMyTimeOffEvents({ from: new Date().toISOString().slice(0, 10) })
      .then(res => setMyEvents(res?.items || []))
      .catch(err => setError(err?.message || 'Failed to load your time-off'))
      .finally(() => setEventsLoading(false));
  }, []);

  // Load default checklist template for Step 3.
  useEffect(() => {
    fetchDefaultChecklistTemplate()
      .then(res => {
        setChecklistItems(Array.isArray(res?.items) ? res.items.map(i => ({ ...i })) : []);
        setDefaultTemplateLoaded(true);
      })
      .catch(() => setDefaultTemplateLoaded(true));
  }, []);

  // Close the people-picker on outside click.
  useEffect(() => {
    if (!coverPickerOpen) return undefined;
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setCoverPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [coverPickerOpen]);

  // Group adjacent events for display in Step 1 + match the active group
  // by membership of the first selected id (or the only selected id).
  const groupedEvents = useMemo(() => groupWeekendAdjacent(myEvents), [myEvents]);
  const selectedGroup = useMemo(() => {
    if (selectedEventIds.length === 0) return null;
    const head = selectedEventIds[0];
    return groupedEvents.find(g => g.events.some(e => e.id === head)) || null;
  }, [groupedEvents, selectedEventIds]);
  const selectedEvents = useMemo(
    () => myEvents.filter(e => selectedEventIds.includes(e.id)),
    [myEvents, selectedEventIds],
  );
  // Keep the legacy single-event reference around for the Review step's
  // "Range" copy — falls back to the first selected event so the wizard
  // keeps showing something sensible when the group spans many events.
  const selectedEvent = selectedEvents[0] || null;

  const candidateMembers = useMemo(() => {
    const q = coverQuery.trim().toLowerCase();
    const callerLc = (currentUserEmail || '').toLowerCase();
    const taken = new Set(coverers.map(c => (c.email || '').toLowerCase()));
    return (members || [])
      .filter(m => m?.email && m.email.toLowerCase() !== callerLc && !taken.has(m.email.toLowerCase()))
      .filter(m => {
        if (!q) return true;
        const hay = `${m.name || ''} ${m.email || ''}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 12);
  }, [members, coverQuery, coverers, currentUserEmail]);

  // Step gating.
  const step1Ok = selectedEventIds.length > 0;
  const step2Ok = coverers.length > 0;
  const requiredMissing = checklistItems.filter(i => i.required && !i.completed).length;
  const step3Ok = checklistItems.length > 0;

  function addCoverer(email) {
    if (!email) return;
    setCoverers(prev => [...prev, { email: email.toLowerCase(), country_codes: [] }]);
    setCoverQuery('');
  }
  function removeCoverer(email) {
    setCoverers(prev => prev.filter(c => (c.email || '').toLowerCase() !== email.toLowerCase()));
  }
  function setCovererCountries(email, list) {
    setCoverers(prev => prev.map(c => c.email === email
      ? { ...c, country_codes: list.map(x => String(x || '').toUpperCase()).filter(Boolean) }
      : c,
    ));
  }
  function toggleChecklistRequired(itemId) {
    setChecklistItems(prev => prev.map(i => i.id === itemId ? { ...i, required: !i.required } : i));
  }
  function setChecklistCompleted(itemId, completed) {
    setChecklistItems(prev => prev.map(i => i.id === itemId ? { ...i, completed: !!completed } : i));
  }
  function removeChecklistItem(itemId) {
    setChecklistItems(prev => prev.filter(i => i.id !== itemId));
  }
  function addCustomItem() {
    const id = `custom_${Date.now()}`;
    setChecklistItems(prev => [...prev, { id, label: 'New item', required: false, hint: '', completed: false }]);
  }
  function setItemLabel(itemId, value) {
    setChecklistItems(prev => prev.map(i => i.id === itemId ? { ...i, label: value } : i));
  }

  async function save({ submit }) {
    setBusy(true);
    setError(null);
    try {
      if (submit && requiredMissing > 0) {
        throw new Error(`${requiredMissing} required item${requiredMissing === 1 ? '' : 's'} still unchecked`);
      }
      // One handover per selected time-off event id, all sharing the
      // same coverers + checklist + reason. The Deel time-off feed
      // ships per-day rows with weekends excluded, so a Fri-Mon
      // vacation lands as two events; this loop submits them as one
      // logical handover from the user's perspective.
      const sharedCoverers = coverers.map(c => ({
        email: c.email,
        country_codes: c.country_codes || [],
      }));
      const sharedChecklist = checklistItems.map(i => ({
        id: i.id, label: i.label, required: i.required !== false, hint: i.hint || null,
      }));
      const preChecked = checklistItems.filter(i => i.completed);

      const created = [];
      for (const eventId of selectedEventIds) {
        const res = await createHandover({
          time_off_event_id: eventId,
          reason: reason || null,
          coverers: sharedCoverers,
          checklist_items: sharedChecklist,
        });
        const handoverId = res?.handover?.id;
        if (!handoverId) throw new Error('Create returned no id');
        // Mirror pre-checked items on the server so the audit log
        // captures the click and the row reflects the right counts.
        for (const item of preChecked) {
          await toggleChecklistItem(handoverId, item.id, { completed: true });
        }
        let final = res.handover;
        if (submit) {
          const submitted = await submitHandover(handoverId);
          final = submitted?.handover || final;
        }
        created.push(final);
      }
      // Surface the first handover to the caller for the deep-link /
      // toast flow; the parent refreshes its list either way so the
      // remaining rows appear in the table on the next paint.
      onCreated?.(created[0]);
    } catch (err) {
      setError(err?.message || 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  function next() { if (step < 4) setStep(step + 1); }
  function back() { if (step > 1) setStep(step - 1); }

  return (
    <>
      <div role="presentation" onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 60 }} />
      <div role="dialog" aria-modal="true" aria-label="Create handover"
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(640px, 95vw)', maxHeight: '92vh',
          background: 'var(--surface)',
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(15,23,42,0.20)',
          display: 'flex', flexDirection: 'column',
          zIndex: 61,
          fontFamily: 'inherit',
        }}>
        <header style={{
          padding: '18px 22px',
          borderBottom: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>New handover</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Step {step} of {STEPS.length}: {STEPS[step - 1].label}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 6, fontFamily: 'inherit',
          }}>
            <i className="bi-x-lg" style={{ fontSize: 16 }} />
          </button>
        </header>

        <div style={{ display: 'flex', gap: 6, padding: '10px 22px 0' }}>
          {STEPS.map(s => (
            <div key={s.id} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: s.id <= step ? 'var(--purple, #7c3aed)' : 'rgba(15,23,42,0.10)',
              transition: 'background .15s',
            }} />
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div style={{ padding: '10px 12px', background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', borderRadius: 10, fontSize: 12, fontWeight: 500 }}>
              {error}
            </div>
          )}

          {step === 1 && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                Pick the OOO range you want to hand over. Only your approved time-off appears here.
                Weekend-adjacent days are grouped into a single range — submitting covers every day in
                the group with one set of coverers + checklist.
              </div>
              {eventsLoading ? (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading…</div>
              ) : groupedEvents.length === 0 ? (
                <div style={{ padding: 18, borderRadius: 10, background: 'rgba(15,23,42,0.03)', border: '1px dashed var(--border)', fontSize: 13, color: 'var(--text-secondary)' }}>
                  You have no approved upcoming OOO. Submit your time-off in Deel first.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {groupedEvents.map(g => {
                    const ids = g.events.map(e => e.id);
                    const active = selectedEventIds.length > 0 && ids.some(id => selectedEventIds.includes(id));
                    // Group is "fully covered" only when EVERY event in it
                    // already has an in-flight or completed handover. A
                    // mixed group still allows the user to add the
                    // missing ones — we filter out the covered ids at
                    // submit time so the user can't double-create.
                    const handovers = g.events.filter(e => e.handover);
                    const totalDays = daysBetween(g.start_date, g.end_date);
                    return (
                      <button
                        key={ids.join('|')}
                        type="button"
                        onClick={() => {
                          // Select every event in the group that doesn't
                          // already have a handover. Empty selection
                          // (everything covered) falls back to the full
                          // list so the user at least sees a record on
                          // the Review step.
                          const uncovered = g.events.filter(e => !e.handover).map(e => e.id);
                          setSelectedEventIds(uncovered.length > 0 ? uncovered : ids);
                        }}
                        style={{
                          textAlign: 'left',
                          padding: '12px 14px',
                          borderRadius: 12,
                          border: active ? '2px solid var(--purple, #7c3aed)' : '1px solid var(--border)',
                          background: active ? 'rgba(124, 58, 237, 0.06)' : 'var(--surface)',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{fmt(g.start_date)} → {fmt(g.end_date)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {totalDays} day{totalDays === 1 ? '' : 's'}
                          {g.events.length > 1 ? ` · ${g.events.length} time-off entries merged across the weekend` : ''}
                          {handovers.length === g.events.length
                            ? ` · handover already ${String(handovers[0].handover.status).replace(/_/g, ' ')}`
                            : handovers.length > 0
                              ? ` · ${handovers.length} of ${g.events.length} already handed over`
                              : ' · no handover yet'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
                <span style={{ display: 'block', marginBottom: 4 }}>Optional reason / context for the coverer</span>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value.slice(0, 1000))}
                  placeholder="e.g. parental leave — primary contact for SafetyWing"
                  rows={3}
                  style={{
                    width: '100%', resize: 'vertical', padding: 10,
                    border: '1px solid var(--border)', borderRadius: 10,
                    fontFamily: 'inherit', fontSize: 13, color: 'var(--text)',
                    background: 'var(--surface)',
                  }}
                />
              </label>
            </>
          )}

          {step === 2 && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                Add the people who will cover you. Per-coverer country split is optional — leave it blank for full coverage.
              </div>

              <div ref={pickerRef} style={{ position: 'relative' }}>
                <input
                  value={coverQuery}
                  onChange={e => { setCoverQuery(e.target.value); setCoverPickerOpen(true); }}
                  onFocus={() => setCoverPickerOpen(true)}
                  placeholder="Search team members…"
                  style={{
                    width: '100%', height: 36, padding: '0 12px',
                    border: '1px solid var(--border)', borderRadius: 10,
                    fontFamily: 'inherit', fontSize: 13,
                    background: 'var(--surface)',
                  }}
                />
                {coverPickerOpen && candidateMembers.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6,
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 10, boxShadow: '0 8px 24px rgba(15,23,42,0.10)',
                    maxHeight: 240, overflowY: 'auto', zIndex: 5,
                  }}>
                    {candidateMembers.map(m => (
                      <button
                        key={m.email}
                        type="button"
                        onClick={() => { addCoverer(m.email); setCoverPickerOpen(false); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          width: '100%', padding: '8px 12px',
                          background: 'transparent', border: 'none',
                          textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        <Avatar name={m.name} initials={m.initials} src={m.avatarUrl || m.avatar_url} size="sm" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{m.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {coverers.length === 0 ? (
                <div style={{ padding: 14, borderRadius: 10, background: 'rgba(15,23,42,0.03)', border: '1px dashed var(--border)', fontSize: 12, color: 'var(--text-secondary)' }}>
                  No coverers yet. Pick at least one before submitting.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {coverers.map(c => {
                    const m = (members || []).find(mm => (mm.email || '').toLowerCase() === c.email);
                    return (
                      <div key={c.email} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 12px',
                        borderRadius: 10, border: '1px solid var(--border)',
                        background: 'var(--surface)',
                      }}>
                        <Avatar name={m?.name || c.email} initials={m?.initials} src={m?.avatarUrl || m?.avatar_url} size="sm" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{m?.name || c.email}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{c.country_codes.length === 0 ? 'Full coverage' : `Covers ${c.country_codes.join(', ')}`}</div>
                        </div>
                        <MultiCountryPicker
                          selected={c.country_codes}
                          onSave={(next) => setCovererCountries(c.email, next)}
                          size="sm"
                        />
                        <button
                          type="button"
                          onClick={() => removeCoverer(c.email)}
                          aria-label={`Remove ${m?.name || c.email}`}
                          style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: 'var(--text-secondary)', padding: 4, fontFamily: 'inherit',
                          }}
                        >
                          <i className="bi-x-lg" style={{ fontSize: 12 }} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                {defaultTemplateLoaded
                  ? 'Pre-filled from the org default. Tick items you have done before submitting. Required items block submit until checked.'
                  : 'Loading template…'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {checklistItems.map(item => (
                  <div key={item.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '10px 12px',
                    borderRadius: 10, border: '1px solid var(--border)',
                    background: item.completed ? 'rgba(124, 58, 237, 0.05)' : 'var(--surface)',
                  }}>
                    <input
                      type="checkbox"
                      checked={!!item.completed}
                      onChange={e => setChecklistCompleted(item.id, e.target.checked)}
                      style={{ marginTop: 3, cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <input
                        value={item.label}
                        onChange={e => setItemLabel(item.id, e.target.value)}
                        style={{
                          width: '100%', border: 'none', background: 'transparent',
                          fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                          color: 'var(--text)', padding: 0,
                        }}
                      />
                      {item.hint && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{item.hint}</div>
                      )}
                    </div>
                    <label style={{ fontSize: 10, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={item.required !== false}
                        onChange={() => toggleChecklistRequired(item.id)}
                      />
                      Required
                    </label>
                    <button
                      type="button"
                      onClick={() => removeChecklistItem(item.id)}
                      aria-label="Remove item"
                      style={{
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: 'var(--text-secondary)', padding: 4, fontFamily: 'inherit',
                      }}
                    >
                      <i className="bi-x-lg" style={{ fontSize: 11 }} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addCustomItem}
                style={{
                  alignSelf: 'flex-start',
                  padding: '6px 12px', borderRadius: 8,
                  border: '1px dashed var(--border)',
                  background: 'transparent', color: 'var(--text-secondary)',
                  fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <i className="bi-plus-lg" style={{ marginRight: 6, fontSize: 11 }} />
                Add custom item
              </button>
              {requiredMissing > 0 && (
                <div style={{ fontSize: 11, color: '#92400E' }}>
                  {requiredMissing} required item{requiredMissing === 1 ? '' : 's'} still unchecked — Save as draft, or check them to submit.
                </div>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                Review and submit. You can always come back and edit while the handover is in draft / pending state.
              </div>
              <div style={{ padding: 14, borderRadius: 12, border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 700 }}>OOO range</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedGroup ? `${fmt(selectedGroup.start_date)} → ${fmt(selectedGroup.end_date)}` : (selectedEvent ? `${fmt(selectedEvent.start_date)} → ${fmt(selectedEvent.end_date)}` : '—')}</div>
                {selectedEventIds.length > 1 && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                    {selectedEventIds.length} time-off entries handed over in one go (weekend-adjacent).
                  </div>
                )}
                {reason && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>{reason}</div>}
              </div>
              <div style={{ padding: 14, borderRadius: 12, border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 700 }}>Coverers</div>
                {coverers.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>None added yet</div> : coverers.map(c => {
                  const m = (members || []).find(mm => (mm.email || '').toLowerCase() === c.email);
                  return (
                    <div key={c.email} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
                      <Avatar name={m?.name || c.email} initials={m?.initials} size="sm" />
                      <span style={{ fontWeight: 600 }}>{m?.name || c.email}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{c.country_codes.length === 0 ? '· full coverage' : `· ${c.country_codes.join(', ')}`}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ padding: 14, borderRadius: 12, border: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 700 }}>Checklist</div>
                <div style={{ fontSize: 12 }}>{checklistItems.length} item{checklistItems.length === 1 ? '' : 's'} · {checklistItems.filter(i => i.completed).length} ticked · {checklistItems.filter(i => i.required !== false).length} required</div>
              </div>
            </>
          )}
        </div>

        <footer style={{
          padding: '14px 22px',
          borderTop: '1px solid var(--border-light)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
          flexShrink: 0,
        }}>
          <button type="button" onClick={back} disabled={step === 1 || busy} style={{
            padding: '8px 14px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--surface)',
            color: step === 1 ? 'var(--text-secondary)' : 'var(--text)',
            fontWeight: 600, fontSize: 12, cursor: step === 1 ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}>
            ← Back
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {step < 4 && (
              <button
                type="button"
                onClick={next}
                disabled={busy || (step === 1 && !step1Ok) || (step === 2 && !step2Ok) || (step === 3 && !step3Ok)}
                style={{
                  padding: '8px 16px', borderRadius: 8,
                  background: 'var(--purple, #7c3aed)',
                  color: 'white', border: 'none', fontWeight: 700, fontSize: 12,
                  cursor: 'pointer', fontFamily: 'inherit',
                  opacity: (busy || (step === 1 && !step1Ok) || (step === 2 && !step2Ok) || (step === 3 && !step3Ok)) ? 0.55 : 1,
                }}
              >
                Continue
              </button>
            )}
            {step === 4 && (
              <>
                <button type="button" onClick={() => save({ submit: false })} disabled={busy || !step1Ok}
                  style={{
                    padding: '8px 14px', borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--surface)',
                    color: 'var(--text)', fontWeight: 600, fontSize: 12,
                    cursor: 'pointer', fontFamily: 'inherit',
                    opacity: busy ? 0.55 : 1,
                  }}
                >
                  Save draft
                </button>
                <button type="button" onClick={() => save({ submit: true })} disabled={busy || !step1Ok || !step2Ok || requiredMissing > 0}
                  style={{
                    padding: '8px 16px', borderRadius: 8,
                    background: 'var(--purple, #7c3aed)',
                    color: 'white', border: 'none', fontWeight: 700, fontSize: 12,
                    cursor: 'pointer', fontFamily: 'inherit',
                    opacity: (busy || !step1Ok || !step2Ok || requiredMissing > 0) ? 0.55 : 1,
                  }}
                >
                  Submit for coverage
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </>
  );
}

export default CreateHandoverModal;
