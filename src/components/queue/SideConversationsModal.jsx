// ── SideConversationsModal (Phase 4) ─────────────────────────────────────────
// Full CRUD for Zendesk side conversations on a given ticket.
//   • Left rail   — list of side conversations + "+ New" button
//   • Right pane  — selected side conv (subject, state, messages, reply box,
//                    close button), or the New form when creating
//
// Triggered from Detail.jsx's left-rail Quick Links. Reuses the same modal
// styling vocabulary as MacroPreviewModal so the page feels consistent.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  fetchSideConversations,
  fetchSideConversation,
  createSideConversation,
  replySideConversation,
  closeSideConversation,
} from '../../services/integrationsApi';

function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const m = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

function absTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function SideConversationsModal({ ticketId, onClose, addToast }) {
  const overlayRef = useRef(null);
  const [list, setList] = useState(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);

  const [closing, setClosing] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newTo, setNewTo] = useState('');           // comma-separated emails
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // ── Load list on mount ────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetchSideConversations(ticketId);
      const items = res?.items || [];
      // Sort by updated desc so the most-recent activity floats to top.
      items.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      setList(items);
    } catch (err) {
      setListError(err?.message || 'Failed to load side conversations');
    } finally {
      setListLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { loadList(); }, [loadList]);

  // ── Load selected side conv detail when selectedId changes ────────────
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setReplyText('');
    fetchSideConversation(ticketId, selectedId)
      .then(d => { if (!cancelled) setDetail(d); })
      .catch(err => { if (!cancelled) setDetailError(err?.message || 'Failed to load'); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [ticketId, selectedId]);

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleSelect = useCallback((id) => {
    setCreating(false);
    setSelectedId(id);
  }, []);

  const handleStartCreate = useCallback(() => {
    setCreating(true);
    setSelectedId(null);
    setNewSubject('');
    setNewBody('');
    setNewTo('');
  }, []);

  const handleCreate = useCallback(async () => {
    if (createSubmitting) return;
    const recipients = newTo.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    if (!newSubject.trim()) { addToast?.('error', 'Subject required', 'Side conversations need a subject line.'); return; }
    if (!newBody.trim())    { addToast?.('error', 'Body required',    'Add at least one line to the message.'); return; }
    if (recipients.length === 0) { addToast?.('error', 'Recipient required', 'Add at least one email address.'); return; }
    setCreateSubmitting(true);
    try {
      const res = await createSideConversation(ticketId, { subject: newSubject.trim(), body: newBody, to: recipients });
      addToast?.('success', 'Side conversation created', `"${newSubject.trim()}" was sent.`);
      setCreating(false);
      // Reload list and select the new one if we got it back.
      await loadList();
      if (res?.sideConversation?.id) setSelectedId(res.sideConversation.id);
    } catch (err) {
      addToast?.('error', 'Create failed', err?.message || 'Please retry.');
    } finally {
      setCreateSubmitting(false);
    }
  }, [createSubmitting, newTo, newSubject, newBody, ticketId, addToast, loadList]);

  const handleReply = useCallback(async () => {
    if (!selectedId || !replyText.trim() || replySending) return;
    setReplySending(true);
    try {
      await replySideConversation(ticketId, selectedId, replyText);
      addToast?.('success', 'Reply sent', 'Your message was added to the side conversation.');
      setReplyText('');
      // Reload the selected conversation to show the new message.
      const d = await fetchSideConversation(ticketId, selectedId);
      setDetail(d);
    } catch (err) {
      addToast?.('error', 'Reply failed', err?.message || 'Please retry.');
    } finally {
      setReplySending(false);
    }
  }, [selectedId, replyText, replySending, ticketId, addToast]);

  const handleClose = useCallback(async () => {
    if (!selectedId || closing) return;
    if (detail?.state === 'closed') return;
    setClosing(true);
    try {
      await closeSideConversation(ticketId, selectedId);
      addToast?.('success', 'Side conversation closed', 'No further replies will be accepted.');
      // Reload list + detail to reflect the new state.
      await loadList();
      const d = await fetchSideConversation(ticketId, selectedId);
      setDetail(d);
    } catch (err) {
      addToast?.('error', 'Close failed', err?.message || 'Please retry.');
    } finally {
      setClosing(false);
    }
  }, [selectedId, closing, detail?.state, ticketId, addToast, loadList]);

  // ── Esc / outside-click handling ──────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (replySending || closing || createSubmitting) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, replySending, closing, createSubmitting]);

  const overlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9000, animation: 'fadeInOverlay 0.18s ease both',
  };
  const modalStyle = {
    width: 'min(960px, 94vw)', height: 'min(720px, 88vh)',
    background: 'white', borderRadius: 16,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
    animation: 'scaleInModal 0.2s cubic-bezier(0.16, 1, 0.3, 1) both',
  };

  return (
    <div ref={overlayRef} style={overlayStyle} role="dialog" aria-modal="true" aria-label="Side conversations"
      onClick={e => { if (e.target === e.currentTarget && !replySending && !closing && !createSubmitting) onClose(); }}>
      <div style={modalStyle}>
        <style>{`
          @keyframes fadeInOverlay { from { opacity:0; } to { opacity:1; } }
          @keyframes scaleInModal { from { opacity:0; transform:scale(0.97) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
          .sc-row:hover { background: #f7f5f2 !important; }
          .sc-row.active { background: #eff6ff !important; border-left-color: #1f74b3 !important; }
        `}</style>

        {/* Header */}
        <div style={{ padding: '12px 18px', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <i className="bi-chat-square-quote-fill" style={{ fontSize: 14, color: '#7c3aed' }} />
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1b1b1b', flex: 1 }}>
            Side conversations
            <span style={{ marginLeft: 8, fontSize: 11, fontFamily: 'ui-monospace, monospace', color: '#9e9e9e' }}>{ticketId}</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent',
              color: '#9e9e9e', cursor: 'pointer', fontSize: 16,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f7f5f2'; e.currentTarget.style.color = '#1b1b1b'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9e9e9e'; }}
          >
            <i className="bi-x-lg" />
          </button>
        </div>

        {/* Body — master/detail */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '300px 1fr', minHeight: 0 }}>
          {/* List */}
          <div style={{ borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: 10, borderBottom: '1px solid #f0efed', flexShrink: 0 }}>
              <button
                onClick={handleStartCreate}
                style={{
                  width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  height: 32, padding: '0 12px', borderRadius: 8,
                  border: '1px dashed #c4b1f9',
                  background: creating ? '#f3eff8' : 'white',
                  color: '#7c3aed', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', transition: 'all .12s', fontFamily: 'inherit',
                }}
                onMouseEnter={e => { if (!creating) e.currentTarget.style.background = '#f3eff8'; }}
                onMouseLeave={e => { if (!creating) e.currentTarget.style.background = 'white'; }}
              >
                <i className="bi-plus-circle" style={{ fontSize: 11 }} />
                New side conversation
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {listLoading && (!list || list.length === 0) ? (
                <div style={{ padding: '24px 14px', textAlign: 'center', color: '#9e9e9e', fontSize: 12 }}>
                  <i className="bi-arrow-clockwise spin" style={{ fontSize: 20, display: 'block', marginBottom: 6 }} />
                  Loading…
                </div>
              ) : listError ? (
                <div style={{ padding: '14px 16px', fontSize: 12, color: '#991b1b' }}>
                  <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />
                  {listError}
                  <button onClick={loadList} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#991b1b', textDecoration: 'underline', cursor: 'pointer' }}>Retry</button>
                </div>
              ) : (list || []).length === 0 ? (
                <div style={{ padding: '24px 14px', textAlign: 'center', color: '#9e9e9e', fontSize: 12 }}>
                  No side conversations yet.<br />
                  Click "New" above to start one.
                </div>
              ) : (
                list.map(sc => (
                  <button
                    key={sc.id}
                    className={`sc-row ${selectedId === sc.id ? 'active' : ''}`}
                    onClick={() => handleSelect(sc.id)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '10px 14px',
                      border: 'none', borderBottom: '1px solid #f7f5f2',
                      borderLeft: '3px solid transparent',
                      background: selectedId === sc.id ? '#eff6ff' : 'white',
                      cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'background .1s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700,
                        padding: '2px 6px', borderRadius: 128,
                        background: sc.state === 'closed' ? '#f3f3f3' : '#dcfce7',
                        color: sc.state === 'closed' ? '#6b6560' : '#15803d',
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>{sc.state}</span>
                      <span style={{ fontSize: 11, color: '#9e9e9e' }}>{relTime(sc.updatedAt)}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1b1b1b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sc.subject || '(no subject)'}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 11, color: '#9e9e9e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sc.preview || '(no preview)'}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 10, color: '#bebebe' }}>
                      {sc.messageCount} {sc.messageCount === 1 ? 'message' : 'messages'}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Detail / Create form */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {creating ? (
              <NewSideConvForm
                subject={newSubject} setSubject={setNewSubject}
                body={newBody} setBody={setNewBody}
                to={newTo} setTo={setNewTo}
                submitting={createSubmitting}
                onSubmit={handleCreate}
                onCancel={() => setCreating(false)}
              />
            ) : !selectedId ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9e9e9e', fontSize: 13, padding: 24, textAlign: 'center' }}>
                <div>
                  <i className="bi-chat-square-quote" style={{ fontSize: 32, display: 'block', marginBottom: 8, color: '#d0d0d0' }} />
                  Pick a side conversation on the left,<br />or start a new one.
                </div>
              </div>
            ) : detailLoading && !detail ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#616161', fontSize: 13 }}>
                <div style={{ textAlign: 'center' }}>
                  <i className="bi-arrow-clockwise spin" style={{ fontSize: 24, display: 'block', marginBottom: 8 }} />
                  Loading messages…
                </div>
              </div>
            ) : detailError ? (
              <div style={{ padding: 18 }}>
                <div style={{ padding: '12px 14px', borderRadius: 10, background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', fontSize: 12 }}>
                  <i className="bi-exclamation-triangle-fill" style={{ marginRight: 6 }} />
                  {detailError}
                </div>
              </div>
            ) : detail ? (
              <DetailPane
                detail={detail}
                replyText={replyText}
                setReplyText={setReplyText}
                replySending={replySending}
                onReply={handleReply}
                closing={closing}
                onClose={handleClose}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function NewSideConvForm({ subject, setSubject, body, setBody, to, setTo, submitting, onSubmit, onCancel }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ padding: '14px 18px 6px', borderBottom: '1px solid #f0efed', flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1b1b1b' }}>New side conversation</div>
        <div style={{ fontSize: 11, color: '#9e9e9e', marginTop: 2 }}>
          Off-ticket email thread for coordinating with internal teams or external parties.
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        <Field label="To" hint="One or more email addresses, comma- or space-separated.">
          <input
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="alice@example.com, bob@example.com"
            disabled={submitting}
            style={inputStyle}
            onFocus={e => e.target.style.borderColor = '#7c3aed'}
            onBlur={e => e.target.style.borderColor = '#e8e8e8'}
          />
        </Field>
        <Field label="Subject">
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="What is this thread about?"
            disabled={submitting}
            style={inputStyle}
            onFocus={e => e.target.style.borderColor = '#7c3aed'}
            onBlur={e => e.target.style.borderColor = '#e8e8e8'}
          />
        </Field>
        <Field label="Message">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write the first message to send…"
            rows={8}
            disabled={submitting}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 140, fontFamily: 'inherit', lineHeight: 1.6 }}
            onFocus={e => e.target.style.borderColor = '#7c3aed'}
            onBlur={e => e.target.style.borderColor = '#e8e8e8'}
          />
        </Field>
      </div>
      <div style={{ padding: '12px 18px', borderTop: '1px solid #e8e8e8', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
        <button
          onClick={onCancel}
          disabled={submitting}
          style={btnSecondaryStyle(submitting)}
        >Cancel</button>
        <button
          onClick={onSubmit}
          disabled={submitting}
          style={btnPrimaryStyle(submitting)}
        >
          {submitting
            ? <><i className="bi-hourglass-split" style={{ fontSize: 11 }} />Creating…</>
            : <><i className="bi-send-fill" style={{ fontSize: 11 }} />Create &amp; send</>}
        </button>
      </div>
    </div>
  );
}

function DetailPane({ detail, replyText, setReplyText, replySending, onReply, closing, onClose }) {
  const isClosed = detail.state === 'closed';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #f0efed', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 128,
            background: isClosed ? '#f3f3f3' : '#dcfce7',
            color: isClosed ? '#6b6560' : '#15803d',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>{detail.state}</span>
          <span style={{ fontSize: 11, color: '#9e9e9e' }}>
            {detail.messages?.length || 0} {detail.messages?.length === 1 ? 'message' : 'messages'}
          </span>
          <div style={{ flex: 1 }} />
          {!isClosed && (
            <button
              onClick={onClose}
              disabled={closing}
              title="Close this side conversation"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                height: 28, padding: '0 12px', borderRadius: 6,
                border: '1px solid #e8e8e8', background: 'white',
                color: '#616161', fontSize: 11, fontWeight: 600,
                cursor: closing ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', transition: 'all .12s',
              }}
              onMouseEnter={e => { if (!closing) { e.currentTarget.style.borderColor = '#d42d35'; e.currentTarget.style.color = '#d42d35'; } }}
              onMouseLeave={e => { if (!closing) { e.currentTarget.style.borderColor = '#e8e8e8'; e.currentTarget.style.color = '#616161'; } }}
            >
              {closing
                ? <><i className="bi-hourglass-split spin" style={{ fontSize: 10 }} />Closing…</>
                : <><i className="bi-x-circle" style={{ fontSize: 10 }} />Close</>}
            </button>
          )}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1b1b1b' }}>{detail.subject || '(no subject)'}</div>
        {Array.isArray(detail.participants) && detail.participants.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#616161', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span style={{ fontWeight: 600, color: '#9e9e9e' }}>Participants:</span>
            {detail.participants.map((p, i) => (
              <span key={p.email || i} style={{ fontFamily: 'ui-monospace, monospace' }}>
                {p.name || p.email}{p.email && p.name ? ` <${p.email}>` : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 10, background: '#fafaf9' }}>
        {(detail.messages || []).length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#9e9e9e', fontSize: 12 }}>
            No messages yet.
          </div>
        ) : (
          detail.messages.map(m => (
            <article key={m.id} style={{
              background: 'white', border: '1px solid #f0efed', borderRadius: 10, padding: '10px 14px',
            }}>
              <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1b1b1b', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.from?.name || m.from?.email || 'Unknown'}
                  {m.from?.email && m.from?.name && (
                    <span style={{ marginLeft: 6, fontSize: 10, color: '#9e9e9e', fontFamily: 'ui-monospace, monospace' }}>
                      &lt;{m.from.email}&gt;
                    </span>
                  )}
                </div>
                <span title={absTime(m.createdAt)} style={{ fontSize: 11, color: '#9e9e9e' }}>{relTime(m.createdAt)}</span>
              </header>
              {Array.isArray(m.to) && m.to.length > 0 && (
                <div style={{ fontSize: 10, color: '#bebebe', marginBottom: 6, fontFamily: 'ui-monospace, monospace' }}>
                  To: {m.to.map(t => t.email || t.name).join(', ')}
                </div>
              )}
              <div style={{ fontSize: 13, color: '#1b1b1b', whiteSpace: 'pre-wrap', lineHeight: 1.55, wordBreak: 'break-word' }}>
                {m.body || '(empty)'}
              </div>
            </article>
          ))
        )}
      </div>

      {/* Reply box (hidden when closed) */}
      {!isClosed && (
        <div style={{ padding: '12px 18px', borderTop: '1px solid #e8e8e8', flexShrink: 0 }}>
          <textarea
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder="Reply to this side conversation… (Cmd+Enter to send)"
            rows={3}
            disabled={replySending}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: 10, borderRadius: 8, border: '1px solid #e8e8e8',
              fontSize: 13, lineHeight: 1.55, fontFamily: 'inherit', resize: 'vertical',
              outline: 'none', transition: 'border-color .12s',
            }}
            onFocus={e => e.target.style.borderColor = '#7c3aed'}
            onBlur={e => e.target.style.borderColor = '#e8e8e8'}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                onReply();
              }
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              disabled={!replyText.trim() || replySending}
              onClick={onReply}
              style={btnPrimaryStyle(!replyText.trim() || replySending)}
            >
              {replySending
                ? <><i className="bi-hourglass-split" style={{ fontSize: 11 }} />Sending…</>
                : <><i className="bi-send" style={{ fontSize: 11 }} />Send Reply</>}
            </button>
          </div>
        </div>
      )}
      {isClosed && (
        <div style={{ padding: '10px 18px', borderTop: '1px solid #e8e8e8', flexShrink: 0, fontSize: 11, color: '#9e9e9e', textAlign: 'center', background: '#f7f5f2' }}>
          <i className="bi-lock-fill" style={{ marginRight: 6 }} />
          This side conversation is closed. Re-open from Zendesk if needed.
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </div>
      {children}
      {hint && <div style={{ marginTop: 4, fontSize: 10, color: '#bebebe' }}>{hint}</div>}
    </div>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '8px 10px', borderRadius: 8, border: '1px solid #e8e8e8',
  fontSize: 13, color: '#1b1b1b', outline: 'none',
  transition: 'border-color .12s',
};

function btnPrimaryStyle(disabled) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    height: 36, padding: '0 18px', borderRadius: 8,
    border: 'none',
    background: disabled ? '#e0e0e0' : '#7c3aed',
    color: disabled ? '#9e9e9e' : 'white',
    fontSize: 12, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all .15s', fontFamily: 'inherit',
  };
}
function btnSecondaryStyle(disabled) {
  return {
    height: 36, padding: '0 16px', borderRadius: 8,
    border: '1px solid #e8e8e8', background: 'white', color: '#1b1b1b',
    fontSize: 12, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    transition: 'all .15s', fontFamily: 'inherit',
  };
}
