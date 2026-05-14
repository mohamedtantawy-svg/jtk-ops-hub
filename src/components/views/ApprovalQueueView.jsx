import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useAnnouncementRequests } from '../../hooks/useAnnouncementRequests';
import { isApprover } from '../../data/approvers';
import { AUDIENCE_LABELS, AUDIENCES, SOUND_PRESETS, COMMS_TYPES } from '../../data/comms';
import { renderRichText } from '../../utils/renderRichText';
import EmptyState from '../ui/EmptyState';
import CommentReactions from '../ui/CommentReactions';

// Convert an ISO timestamp to the local-time value expected by <input type="datetime-local">.
// The input element wants "YYYY-MM-DDTHH:MM" with no timezone suffix.
function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(val) {
  if (!val) return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/*
  Approval Queue — visible to all users.

  - Non-approvers see only their own requests ("My Requests").
  - Approvers see two tabs: Pending (pending + needs_info) and All, plus
    the full audit log + comment thread per request.

  Actions:
    Requester:   withdraw, edit (if status in [pending, needs_info]), comment
    Approver:    approve, reject, ask clarification, edit, comment

  No destructive operations — rejections keep the row, they don't delete it.
*/

const STATUS_STYLES = {
  pending:        { label: 'Pending',             bg: '#fff7e6', fg: '#8a5a00' },
  needs_info:     { label: 'Needs info',          bg: '#eaf4ff', fg: '#1565c0' },
  // 2026-05-12 two-stage: approved on the request side, but the
  // requester still has to post on Slack and hit Publish.
  awaiting_post:  { label: 'Awaiting Slack post', bg: '#f3eff8', fg: '#6b3fa0' },
  approved:       { label: 'Approved',            bg: '#e6f7ec', fg: '#0b7a3f' },
  rejected:       { label: 'Rejected',            bg: '#fdecea', fg: '#b02020' },
  withdrawn:      { label: 'Withdrawn',           bg: '#f3f3f3', fg: '#616161' },
};

function Badge({ status }) {
  const s = STATUS_STYLES[status] || { label: status, bg: '#eee', fg: '#333' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 10px',
      borderRadius: 128, background: s.bg, color: s.fg,
      fontSize: 11, fontWeight: 700, letterSpacing: '.02em',
    }}>{s.label}</span>
  );
}

function formatTime(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); }
}

const ACTION_LABELS = {
  created:         'created the request',
  edited:          'edited the request',
  comment_added:   'left a comment',
  requested_info:  'requested more info',
  approved:        'approved',
  awaiting_post:   'released for Slack post',
  rejected:        'rejected',
  withdrawn:       'withdrawn',
  scheduled:       'scheduled for later',
  published:       'published to Ops Hub',
};

// `embedded` mode strips the outer page chrome (padding + big title) so this
// view can be rendered inside another view (e.g. AnnouncementsView's
// "Pending Approval" tab) without duplicating headers.
const ApprovalQueueView = ({ user, addToast, embedded = false }) => {
  const {
    items, canApprove, loading, refresh,
    fetchDetail, approve, publishAwaitingPost, reject, askClarification, withdraw, addComment,
    edit,
  } = useAnnouncementRequests();
  // Default tab: approvers start on Pending, everyone else on My Requests (the
  // only tab they can see). Using a lazy initializer with the roster directly
  // avoids a first-render flash for non-approvers whose canApprove is still
  // loading from the hook.
  const [tab, setTab] = useState(() => (isApprover(user?.email) ? 'pending' : 'mine'));
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [rejectionDraft, setRejectionDraft] = useState('');
  const [questionDraft, setQuestionDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // urgent-override state removed 2026-05-14 — publishing rate limits
  // are gone, so there's nothing left to override.
  // Approver edit mode — when true, reveals inline editable fields so the
  // approver can adjust wording/pictures/schedule/popup mode before approving.
  const [editMode, setEditMode] = useState(false);
  const [edits, setEdits] = useState({}); // only dirty fields are tracked
  // Local schedule override (approver can change the requested date/time)
  const [scheduledForLocal, setScheduledForLocal] = useState('');
  const setEdit = (key, value) => setEdits(prev => ({ ...prev, [key]: value }));

  const isApproverUser = canApprove || isApprover(user?.email);
  const userEmailLc = (user?.email || '').toLowerCase();

  const filtered = useMemo(() => {
    const mine = (r) => String(r.requestedByEmail || '').toLowerCase() === userEmailLc;
    if (tab === 'mine') return items.filter(mine);
    if (!isApproverUser) return items.filter(mine);
    // awaiting_post rows still need action (requester posts on Slack
    // then triggers publish), so they belong in the Pending tab — the
    // approver can keep an eye on rows that haven't been finalised
    // and step in if the requester is OOO. Once published the row
    // moves to approved and drops to the Decided tab.
    if (tab === 'pending') return items.filter(r => r.status === 'pending' || r.status === 'needs_info' || r.status === 'awaiting_post');
    if (tab === 'decided') return items.filter(r => ['approved','rejected','withdrawn'].includes(r.status));
    return items; // all
  }, [items, tab, userEmailLc, isApproverUser]);

  const loadDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); return; }
    setDetailLoading(true);
    try {
      const data = await fetchDetail(id);
      setDetail(data);
    } catch (e) {
      if (addToast) addToast('error', 'Detail error', e.message || 'Could not load request');
    }
    setDetailLoading(false);
  }, [fetchDetail, addToast]);

  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId, loadDetail]);

  // When the selected request changes, reset the approver's edit draft so
  // we don't leak field values from the previous request. We also flag the
  // selection as "needs seed" so the next detail load can seed the schedule
  // picker with whatever time the requester originally asked for.
  const seedRef = useRef(null);
  useEffect(() => {
    setEditMode(false);
    setEdits({});
    setScheduledForLocal('');
    seedRef.current = selectedId;
  }, [selectedId]);

  // Seed the schedule picker exactly once per selection, when the detail
  // arrives. Crucially, this effect does NOT run on subsequent detail reloads
  // (after approve / comment / etc. refresh) — otherwise any unsaved approver
  // edits to the schedule (or any field, since this effect used to reset all
  // of them) would be wiped mid-workflow.
  useEffect(() => {
    if (!detail?.item) return;
    if (seedRef.current !== selectedId) return;
    if (detail.item.id !== selectedId) return;
    setScheduledForLocal(detail.item.scheduledFor ? isoToLocalInput(detail.item.scheduledFor) : '');
    seedRef.current = null;
  }, [detail, selectedId]);

  const runWithBusy = async (fn, successMsg) => {
    setBusy(true);
    try {
      await fn();
      if (successMsg && addToast) addToast('success', successMsg.title, successMsg.body || '');
      await refresh();
      if (selectedId) await loadDetail(selectedId);
    } catch (e) {
      if (addToast) addToast('error', 'Action failed', e.body?.error || e.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  // Default approve — two-stage flow (Laura's 2026-05-12 ask). The
  // request moves to awaiting_post. No announcement row is created
  // yet. The requester posts on Slack, then hits "Publish on Ops Hub"
  // (handler below) to complete the release.
  const handleApprove = () => {
    const overrideEdits = editMode ? { ...edits } : {};
    const scheduledForOverride = scheduledForLocal ? localInputToIso(scheduledForLocal) : null;
    runWithBusy(
      () => approve(selectedId, {
        scheduledFor: scheduledForOverride,
        overrideEdits,
        publishImmediately: false,
      }),
      {
        title: 'Approved',
        body: 'Requester can now post on Slack and trigger the Ops Hub publish.',
      },
    );
  };

  // Override — bypass the Slack-first stage and publish immediately.
  // Same semantics as the legacy one-shot approve. Useful for urgent
  // fixes or internal notices that don't need a Slack mirror.
  const handleApproveAndPublishNow = () => {
    const overrideEdits = editMode ? { ...edits } : {};
    runWithBusy(
      () => approve(selectedId, {
        scheduledFor: null, // force immediate publish
        overrideEdits,
        publishImmediately: true,
      }),
      { title: 'Published', body: 'Announcement sent to audience immediately — Slack-first step skipped.' },
    );
  };

  // Stage 2 trigger — moves an awaiting_post request into the
  // published state. Requester drives this (after they've posted on
  // Slack); approvers can also trigger it as an override.
  const handlePublishAwaitingPost = () => {
    runWithBusy(
      () => publishAwaitingPost(selectedId),
      { title: 'Published', body: 'Ops Hub announcement is live.' },
    );
  };

  const handleReject = () => {
    const reason = rejectionDraft.trim();
    if (!reason) { if (addToast) addToast('warn', 'Reason required', 'Add a short reason so the requester can iterate'); return; }
    runWithBusy(async () => {
      await reject(selectedId, reason);
      setRejectionDraft('');
    }, { title: 'Rejected', body: 'Requester will see the reason' });
  };

  const handleAsk = () => {
    const q = questionDraft.trim();
    if (!q) return;
    runWithBusy(async () => {
      await askClarification(selectedId, q);
      setQuestionDraft('');
    }, { title: 'Sent', body: 'Requester will see your question' });
  };

  const handleComment = () => {
    const txt = commentDraft.trim();
    if (!txt) return;
    runWithBusy(async () => {
      await addComment(selectedId, txt);
      setCommentDraft('');
    });
  };

  const handleWithdraw = () => runWithBusy(
    () => withdraw(selectedId),
    { title: 'Withdrawn', body: 'Request removed from the queue' }
  );

  // Save edits made AFTER approval, while the request is in
  // awaiting_post (Laura Llopis 2026-05-14 feedback "Edit announcement
  // on Awaiting slack post status"). Most common edit is splicing the
  // Slack thread URL into the link field once the requester has
  // posted on Slack but before triggering Publish on Ops Hub.
  // Dirty-field-only PATCH keeps the audit log clean.
  const handleSaveAwaitingEdits = () => {
    if (Object.keys(edits).length === 0) {
      setEditMode(false);
      return;
    }
    runWithBusy(
      () => edit(selectedId, edits),
      { title: 'Updated', body: 'Announcement updated. Click "Publish on Ops Hub" to release.' },
    ).then(() => {
      setEditMode(false);
      setEdits({});
    });
  };

  if (!user) return null;

  return (
    <div style={embedded
      ? { padding: '12px 24px 24px', width: '100%' }
      : { padding: 24, width: '100%', maxWidth: 1280, margin: '0 auto' }
    }>
      {/* Header — hidden in embedded mode since the host view already has one */}
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em', margin: 0 }}>Announcement requests</h1>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {isApproverUser
                ? 'Review, approve, or reject announcements before they publish.'
                : 'Track your submitted announcement requests.'}
            </div>
          </div>
          <button onClick={refresh} style={{ padding: '6px 12px', fontSize: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', color: 'var(--text)', cursor: 'pointer' }}>
            <i className="bi-arrow-clockwise" style={{ marginRight: 4 }}></i> Refresh
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
        {isApproverUser && (
          <TabButton active={tab === 'pending'} onClick={() => setTab('pending')}>
            Pending ({items.filter(r => r.status === 'pending' || r.status === 'needs_info' || r.status === 'awaiting_post').length})
          </TabButton>
        )}
        <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>
          My Requests ({items.filter(r => String(r.requestedByEmail || '').toLowerCase() === userEmailLc).length})
        </TabButton>
        {isApproverUser && (
          <TabButton active={tab === 'decided'} onClick={() => setTab('decided')}>
            Decided ({items.filter(r => ['approved','rejected','withdrawn'].includes(r.status)).length})
          </TabButton>
        )}
        {isApproverUser && (
          <TabButton active={tab === 'all'} onClick={() => setTab('all')}>All ({items.length})</TabButton>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedId ? 'minmax(300px, 400px) 1fr' : '1fr', gap: 16 }}>
        {/* List */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="bi-megaphone"
              title="Nothing here"
              description={tab === 'mine' ? "You haven't submitted anything yet." : 'No requests match this filter.'}
            />
          ) : (
            filtered.map(r => (
              <div key={r.id}
                role="button" tabIndex={0}
                onClick={() => setSelectedId(r.id)}
                onKeyDown={e => e.key === 'Enter' && setSelectedId(r.id)}
                style={{
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--border-light)',
                  cursor: 'pointer',
                  background: selectedId === r.id ? 'var(--surface-2)' : 'transparent',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Badge status={r.status} />
                  {r.scheduledFor && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}><i className="bi-clock" style={{ marginRight: 4 }}></i>{new Date(r.scheduledFor).toLocaleString()}</span>}
                </div>
                <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {r.requestedByName || r.requestedByEmail} · {AUDIENCE_LABELS[r.target] || r.target} · {formatTime(r.createdAt)}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Detail */}
        {selectedId && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', padding: 18, overflow: 'hidden' }}>
            {detailLoading || !detail ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading detail…</div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Badge status={detail.item.status} />
                  {detail.item.scheduledFor && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}><i className="bi-calendar-event" style={{ marginRight: 4 }}></i>Scheduled {formatTime(detail.item.scheduledFor)}</span>}
                  <button onClick={() => setSelectedId(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }} aria-label="Close"><i className="bi-x-lg"></i></button>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{detail.item.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Requested by <strong>{detail.item.requestedByName || detail.item.requestedByEmail}</strong>
                  {' · '}{AUDIENCE_LABELS[detail.item.target] || detail.item.target}
                  {' · '}{detail.item.isPopup ? 'Popup' : 'Standard'}
                  {' · '}priority: {detail.item.priority}
                </div>
                {detail.item.imageUrl && (
                  <div style={{ marginBottom: 12 }}>
                    <img src={detail.item.imageUrl} alt="" style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8, border: '1px solid var(--border)' }} />
                  </div>
                )}
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, color: 'var(--text)', marginBottom: 12, fontSize: 13 }}>
                  {detail.item.body
                    ? detail.item.body.split('\n').map((ln, i) => (
                        <div key={i}>
                          {ln === '' ? ' ' : renderRichText(ln, { color: 'var(--accent)', keyPrefix: `aq-${i}` })}
                        </div>
                      ))
                    : <em style={{ color: 'var(--text-muted)' }}>(no body)</em>}
                </div>
                {detail.item.link && (
                  <div style={{ marginBottom: 12 }}>
                    <i className="bi-link-45deg" style={{ marginRight: 4 }}></i>
                    <a href={detail.item.link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 12 }}>{detail.item.link}</a>
                  </div>
                )}

                {detail.item.rejectionReason && (
                  <div style={{ padding: 10, background: '#fdecea', border: '1px solid #f5bcbc', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#b02020' }}>
                    <strong>Rejection reason:</strong> {detail.item.rejectionReason}
                  </div>
                )}

                {/* Approver actions */}
                {isApproverUser && (detail.item.status === 'pending' || detail.item.status === 'needs_info') && (
                  <div style={{ padding: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.05em' }}>APPROVER ACTIONS</div>
                      <button
                        onClick={() => { setEditMode(m => !m); if (editMode) setEdits({}); }}
                        style={{ padding: '4px 10px', fontSize: 11, background: editMode ? 'var(--accent)' : 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', color: editMode ? 'white' : 'var(--text)', cursor: 'pointer' }}>
                        <i className={`bi-${editMode ? 'check2' : 'pencil'}`} style={{ marginRight: 4 }}></i>
                        {editMode ? 'Editing — tap to cancel' : 'Edit before approving'}
                      </button>
                    </div>

                    {/* Inline edit form — reveals when editMode is on */}
                    {editMode && (
                      <div style={{ padding: 10, background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 8, marginBottom: 10, display: 'grid', gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Title</label>
                          <input
                            type="text"
                            value={edits.title ?? detail.item.title ?? ''}
                            onChange={e => setEdit('title', e.target.value)}
                            style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 13, fontFamily: 'inherit' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Body</label>
                          <textarea
                            rows={5}
                            value={edits.body ?? detail.item.body ?? ''}
                            onChange={e => setEdit('body', e.target.value)}
                            style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
                          />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div>
                            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Audience</label>
                            <select
                              value={edits.target ?? detail.item.target ?? 'global'}
                              onChange={e => setEdit('target', e.target.value)}
                              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12, background: 'var(--surface)' }}>
                              {AUDIENCES.map(a => (
                                <option key={a} value={a}>{AUDIENCE_LABELS[a]}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Priority</label>
                            <select
                              value={edits.priority ?? detail.item.priority ?? 'medium'}
                              onChange={e => setEdit('priority', e.target.value)}
                              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12, background: 'var(--surface)' }}>
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                            </select>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div>
                            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Type</label>
                            <select
                              value={edits.type ?? detail.item.type ?? 'announce'}
                              onChange={e => setEdit('type', e.target.value)}
                              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12, background: 'var(--surface)' }}>
                              {Object.entries(COMMS_TYPES).map(([k, v]) => (
                                <option key={k} value={k}>{v.label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Sound (popup only)</label>
                            <select
                              value={edits.soundKey ?? detail.item.soundKey ?? 'chime'}
                              onChange={e => setEdit('soundKey', e.target.value)}
                              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12, background: 'var(--surface)' }}>
                              {Object.entries(SOUND_PRESETS).map(([k, v]) => (
                                <option key={k} value={k}>{v.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Image URL</label>
                          <input
                            type="text"
                            value={edits.imageUrl ?? detail.item.imageUrl ?? ''}
                            onChange={e => setEdit('imageUrl', e.target.value)}
                            placeholder="https://…"
                            style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12, fontFamily: 'inherit' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Link</label>
                          <input
                            type="text"
                            value={edits.link ?? detail.item.link ?? ''}
                            onChange={e => setEdit('link', e.target.value)}
                            placeholder="https://…"
                            style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12, fontFamily: 'inherit' }}
                          />
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text)' }}>
                          <input
                            type="checkbox"
                            checked={edits.isPopup ?? Boolean(detail.item.isPopup)}
                            onChange={e => setEdit('isPopup', e.target.checked)}
                          />
                          Deliver as a blocking <strong>popup</strong> (vs. standard feed entry)
                        </label>
                      </div>
                    )}

                    {/* Schedule picker — approver can adjust the send time */}
                    <div style={{ marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'end' }}>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                          Schedule for (leave empty to publish immediately)
                        </label>
                        <input
                          type="datetime-local"
                          value={scheduledForLocal}
                          onChange={e => setScheduledForLocal(e.target.value)}
                          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12, background: 'var(--surface)', fontFamily: 'inherit' }}
                        />
                      </div>
                      {scheduledForLocal && (
                        <button onClick={() => setScheduledForLocal('')} style={{ padding: '6px 10px', fontSize: 11, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', color: 'var(--text-muted)', cursor: 'pointer', height: 32 }}>
                          Clear
                        </button>
                      )}
                    </div>

                    {/* Urgent override block removed 2026-05-14 along
                        with the publishing rate limits it bypassed. */}
                    {/* Two-stage approve (2026-05-12). Primary button releases
                        the request to the requester for Slack-first posting;
                        secondary override publishes inline without Slack
                        mirroring. Legacy "send now" became the override path. */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <button disabled={busy} onClick={handleApprove}
                        title="Approve the request — the requester will post on Slack, then trigger the Ops Hub publish from here."
                        style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, color: 'white', background: '#0b7a3f', border: 'none', borderRadius: 'var(--radius-pill)', cursor: busy ? 'wait' : 'pointer' }}>
                        <i className="bi-check-circle" style={{ marginRight: 4 }}></i>
                        Approve — Slack post first
                      </button>
                      <button disabled={busy} onClick={handleApproveAndPublishNow}
                        title="Skip the Slack-first step and publish to Ops Hub immediately. Use for urgent or internal notices that don't need a Slack mirror."
                        style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, color: 'white', background: '#0a66c2', border: 'none', borderRadius: 'var(--radius-pill)', cursor: busy ? 'wait' : 'pointer' }}>
                        <i className="bi-lightning-fill" style={{ marginRight: 4 }}></i>
                        Approve &amp; publish now
                      </button>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Ask for clarification</div>
                      <textarea rows={2} value={questionDraft} onChange={e => setQuestionDraft(e.target.value)} placeholder="What would you like to know?" style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: 8, fontSize: 12, fontFamily: 'inherit' }} />
                      <button disabled={busy || !questionDraft.trim()} onClick={handleAsk} style={{ marginTop: 4, padding: '6px 12px', fontSize: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', color: 'var(--text)', cursor: busy ? 'wait' : 'pointer' }}>
                        Send question
                      </button>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Reject</div>
                      <textarea rows={2} value={rejectionDraft} onChange={e => setRejectionDraft(e.target.value)} placeholder="Share a short reason…" style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: 8, fontSize: 12, fontFamily: 'inherit' }} />
                      <button disabled={busy || !rejectionDraft.trim()} onClick={handleReject} style={{ marginTop: 4, padding: '6px 12px', fontSize: 12, color: 'white', background: '#b02020', border: 'none', borderRadius: 'var(--radius-pill)', cursor: busy ? 'wait' : 'pointer' }}>
                        Reject
                      </button>
                    </div>
                  </div>
                )}

                {/* Requester withdraw */}
                {detail.isRequester && (detail.item.status === 'pending' || detail.item.status === 'needs_info') && (
                  <button disabled={busy} onClick={handleWithdraw} style={{ marginBottom: 12, padding: '6px 12px', fontSize: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', color: 'var(--text)', cursor: busy ? 'wait' : 'pointer' }}>
                    <i className="bi-x-circle" style={{ marginRight: 4 }}></i> Withdraw request
                  </button>
                )}

                {/* Awaiting Slack post — stage 2 of the two-stage approval
                    flow (Laura's 2026-05-12 ask). Visible to the requester
                    (their job to post on Slack first, then trigger the
                    publish here) and to approvers (override path if the
                    requester is OOO and the announcement still needs to
                    go out). */}
                {detail.item.status === 'awaiting_post' && (detail.isRequester || isApproverUser) && (
                  <div style={{ padding: 12, background: '#f3eff8', border: '1px solid #c4b1f9', borderRadius: 10, marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#6b3fa0' }}>
                        <i className="bi-megaphone-fill" style={{ marginRight: 6 }} />
                        Approved — Slack post first
                      </div>
                      {/* Edit affordance added 2026-05-14 (Laura Llopis):
                          requester needs to splice in the Slack thread URL
                          after they post on Slack but before triggering
                          Publish on Ops Hub. Reuses the existing
                          editMode + edits state so the per-selection
                          reset already handles cleanup. */}
                      <button
                        onClick={() => { setEditMode(m => !m); if (editMode) setEdits({}); }}
                        disabled={busy}
                        style={{ padding: '4px 10px', fontSize: 11, background: editMode ? '#6b3fa0' : 'var(--surface)', border: '1px solid #c4b1f9', borderRadius: 'var(--radius-pill)', color: editMode ? 'white' : '#6b3fa0', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                        <i className={`bi-${editMode ? 'x-lg' : 'pencil'}`} style={{ marginRight: 4, fontSize: 10 }} />
                        {editMode ? 'Cancel edit' : 'Edit'}
                      </button>
                    </div>
                    {!editMode ? (
                      <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 10, lineHeight: 1.5 }}>
                        {detail.isRequester
                          ? 'Post this announcement on Slack first. Add the Slack thread URL via Edit if you want it on the Ops Hub message. Click below to release.'
                          : 'The requester is expected to post this on Slack first, then publish here. You can publish on their behalf if they are OOO.'}
                      </div>
                    ) : (
                      <div style={{ padding: 10, background: 'var(--surface)', border: '1px dashed #c4b1f9', borderRadius: 8, marginBottom: 10, display: 'grid', gap: 8 }}>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Slack thread URL (link)</label>
                          <input
                            type="text"
                            value={edits.link ?? detail.item.link ?? ''}
                            onChange={e => setEdit('link', e.target.value)}
                            placeholder="https://deel.slack.com/archives/…"
                            autoFocus
                            style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 13, fontFamily: 'inherit' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Title</label>
                          <input
                            type="text"
                            value={edits.title ?? detail.item.title ?? ''}
                            onChange={e => setEdit('title', e.target.value)}
                            style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 13, fontFamily: 'inherit' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Body</label>
                          <textarea
                            rows={5}
                            value={edits.body ?? detail.item.body ?? ''}
                            onChange={e => setEdit('body', e.target.value)}
                            style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Image URL</label>
                          <input
                            type="text"
                            value={edits.imageUrl ?? detail.item.imageUrl ?? ''}
                            onChange={e => setEdit('imageUrl', e.target.value)}
                            placeholder="https://…"
                            style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: 12, fontFamily: 'inherit' }}
                          />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                          <button
                            disabled={busy || Object.keys(edits).length === 0}
                            onClick={handleSaveAwaitingEdits}
                            style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, color: 'white', background: Object.keys(edits).length === 0 ? 'var(--text-muted)' : '#6b3fa0', border: 'none', borderRadius: 'var(--radius-pill)', cursor: busy || Object.keys(edits).length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                            <i className="bi-check2" style={{ marginRight: 4 }} />
                            Save changes
                          </button>
                        </div>
                      </div>
                    )}
                    <button disabled={busy} onClick={handlePublishAwaitingPost}
                      style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, color: 'white', background: '#6b3fa0', border: 'none', borderRadius: 'var(--radius-pill)', cursor: busy ? 'wait' : 'pointer' }}>
                      <i className="bi-send-fill" style={{ marginRight: 4 }} />
                      Publish on Ops Hub
                    </button>
                  </div>
                )}

                {/* Comment thread */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '.05em' }}>DISCUSSION ({detail.comments.length})</div>
                  {detail.comments.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No comments yet.</div>}
                  {detail.comments.map(c => (
                    <div key={c.id} style={{ padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.authorName || c.authorEmail} · {formatTime(c.createdAt)}</div>
                      <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{c.body}</div>
                      <CommentReactions
                        commentType="announcement_request"
                        commentId={c.id}
                        reactions={c.reactions || []}
                        currentUserEmail={user?.email}
                        currentUserName={user?.name}
                        compact
                      />
                    </div>
                  ))}
                  <textarea rows={2} value={commentDraft} onChange={e => setCommentDraft(e.target.value)} placeholder="Add a comment…" style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: 8, fontSize: 12, fontFamily: 'inherit' }} />
                  <button disabled={busy || !commentDraft.trim()} onClick={handleComment} style={{ marginTop: 4, padding: '6px 12px', fontSize: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', color: 'var(--text)', cursor: busy ? 'wait' : 'pointer' }}>
                    Comment
                  </button>
                </div>

                {/* Audit log */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '.05em' }}>AUDIT LOG</div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                    {detail.audit.map(a => (
                      <div key={a.id} style={{ padding: '6px 10px', borderBottom: '1px solid var(--border-light)', fontSize: 12, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <i className="bi-circle-fill" style={{ fontSize: 5, color: 'var(--accent)' }}></i>
                        <div style={{ flex: 1 }}>
                          <strong>{a.actorName || a.actorEmail || 'System'}</strong> {ACTION_LABELS[a.action] || a.action}
                          {a.meta && a.meta.reason && <span style={{ color: 'var(--text-muted)' }}> — {a.meta.reason}</span>}
                          {a.meta && a.meta.urgentOverride && <span style={{ color: '#b02020', fontWeight: 600 }}> (urgent override)</span>}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{formatTime(a.createdAt)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

function TabButton({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '10px 14px',
      border: 'none',
      background: 'transparent',
      color: active ? 'var(--accent)' : 'var(--text)',
      fontSize: 13,
      fontWeight: active ? 700 : 500,
      borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
      cursor: 'pointer',
      marginBottom: -1,
    }}>{children}</button>
  );
}

export default ApprovalQueueView;
