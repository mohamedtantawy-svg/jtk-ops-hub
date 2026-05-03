import { useState, useEffect, useRef } from 'react';
import { MEMBERS } from '../../data/members';
import { OUTBOUND_TEAMS } from '../../data/requests';

const PRIORITIES = ['low','medium','high','critical'];
const priorityColors = { low:'#29811e', medium:'#1f74b3', high:'#ed5e2a', critical:'#d42d35' };

const inputStyle = {
  width:'100%', padding:'9px 12px', border:'1px solid #e8e8e8', borderRadius:12,
  fontSize:14, color:'#1b1b1b', background:'var(--surface)', outline:'none',
  fontFamily:'inherit', boxSizing:'border-box',
};
const labelStyle = {
  fontSize:11, fontWeight:600, color:'#616161', textTransform:'uppercase',
  letterSpacing:'.05em', marginBottom:6, display:'block',
};

export default function CreateRequestModal({ onConfirm, onClose, currentUser, tasks = [] }) {
  const [subject, setSubject]       = useState('');
  const [description, setDesc]      = useState('');
  const [toTeam, setToTeam]         = useState('legal');
  const [priority, setPriority]     = useState('medium');
  const [linkedTaskId, setLinked]   = useState('');
  const [externalRef, setExtRef]    = useState('');
  const [submitted, setSubmitted]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const backdropRef = useRef(null);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = () => {
    if (!subject.trim()) { setSubmitted(true); return; }
    if (submitting) return;
    setSubmitting(true);
    onConfirm({
      subject: subject.trim(),
      description,
      toTeam,
      priority,
      raisedById: currentUser?.id ?? 14,
      linkedTaskId: linkedTaskId || null,
      linkedSource: linkedTaskId
        ? tasks.find(t => t.id === linkedTaskId)?.source ?? null
        : null,
      externalRef: externalRef || null,
      notes: '',
    });
    onClose();
  };

  const selectedTeam = OUTBOUND_TEAMS.find(t => t.id === toTeam);

  return (
    <div
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', zIndex:1000,
        display:'flex', alignItems:'center', justifyContent:'center', padding:24,
      }}
    >
      <div style={{
        background:'var(--surface)', borderRadius:20, width:'100%', maxWidth:520,
        maxHeight:'90vh', overflowY:'auto',
        boxShadow:'0 8px 40px rgba(0,0,0,0.18)', display:'flex', flexDirection:'column',
      }}>
        {/* Header */}
        <div style={{ padding:'24px 28px 0', display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:18, fontWeight:700, color:'#1b1b1b' }}>Raise a Request</div>
            <div style={{ fontSize:13, color:'#9e9e9e', marginTop:2 }}>Send a request to another team for support or action</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#616161', fontSize:18, padding:4, lineHeight:1 }}>
            <i className="bi-x-lg"/>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding:'20px 28px 28px' }}>

          {/* To Team */}
          <div style={{ marginBottom:20 }}>
            <label style={labelStyle}>To Team *</label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {OUTBOUND_TEAMS.map(t => {
                const active = toTeam === t.id;
                return (
                  <button key={t.id} onClick={() => setToTeam(t.id)} style={{
                    display:'flex', alignItems:'center', gap:6,
                    padding:'6px 14px', borderRadius:128, fontSize:13, fontWeight:500, cursor:'pointer',
                    border:'1px solid', transition:'all .15s',
                    borderColor: active ? '#1b1b1b' : '#e8e8e8',
                    background: active ? '#1b1b1b' : 'white',
                    color: active ? 'white' : '#616161',
                  }}>
                    <i className={t.icon} style={{ fontSize:11 }}/>{t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subject */}
          <div style={{ marginBottom:20 }}>
            <label style={labelStyle}>Subject *</label>
            <input
              value={subject} onChange={e => setSubject(e.target.value)}
              placeholder={`e.g. Contract review needed — ${selectedTeam?.label}`}
              className={submitted && !subject.trim() ? 'input-error' : ''}
              style={inputStyle}
              autoFocus
            />
            {submitted && !subject.trim() && (
              <div className="error-msg"><i className="bi bi-exclamation-circle"/><span>This field is required</span></div>
            )}
          </div>

          {/* Priority */}
          <div style={{ marginBottom:20 }}>
            <label style={labelStyle}>Priority</label>
            <div style={{ display:'flex', gap:8 }}>
              {PRIORITIES.map(p => {
                const active = priority === p;
                return (
                  <button key={p} onClick={() => setPriority(p)} style={{
                    padding:'6px 16px', borderRadius:128, fontSize:13, fontWeight:500, cursor:'pointer',
                    border:'1px solid', transition:'all .15s',
                    borderColor: active ? priorityColors[p] : '#e8e8e8',
                    background: active ? priorityColors[p] : 'white',
                    color: active ? 'white' : '#616161',
                  }}>
                    {p.charAt(0).toUpperCase()+p.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Link to task */}
          {tasks.length > 0 && (
            <div style={{ marginBottom:20 }}>
              <label style={labelStyle}>Linked Task (optional)</label>
              <select value={linkedTaskId} onChange={e => setLinked(e.target.value)} style={inputStyle}>
                <option value="">— Not linked to a task —</option>
                {tasks.filter(t => t.source !== 'calendar').map(t => (
                  <option key={t.id} value={t.id}>{t.id} — {t.subject?.slice(0,60)}</option>
                ))}
              </select>
            </div>
          )}

          {/* External ref */}
          <div style={{ marginBottom:20 }}>
            <label style={labelStyle}>External Reference (optional)</label>
            <input
              value={externalRef} onChange={e => setExtRef(e.target.value)}
              placeholder="e.g. LEG-1234 or ticket number from the other team"
              style={inputStyle}
            />
          </div>

          {/* Description */}
          <div style={{ marginBottom:24 }}>
            <label style={labelStyle}>Description</label>
            <textarea
              value={description} onChange={e => setDesc(e.target.value)}
              placeholder="Describe what you need from this team, relevant context, and any deadlines…"
              rows={3}
              style={{ ...inputStyle, resize:'vertical', lineHeight:1.5 }}
            />
          </div>

          {/* Actions */}
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <button onClick={onClose} style={{
              padding:'9px 20px', borderRadius:128, fontSize:14, fontWeight:500,
              border:'1px solid #e8e8e8', background:'var(--surface)', color:'#616161', cursor:'pointer',
            }}>Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={!subject.trim()||submitting}
              style={{
                padding:'9px 24px', borderRadius:128, fontSize:14, fontWeight:600, border:'none',
                background: !subject.trim()||submitting ? '#e8e8e8' : '#1b1b1b',
                color: !subject.trim()||submitting ? '#9e9e9e' : 'white',
                cursor: !subject.trim()||submitting ? 'not-allowed' : 'pointer', transition:'all .15s',
                opacity: submitting ? .6 : 1,
              }}
            >{submitting?'Raising…':'Raise Request'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
