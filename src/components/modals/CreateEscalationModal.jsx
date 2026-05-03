import { useState, useEffect, useRef } from 'react';
import { MEMBERS } from '../../data/members';

const SLACK_CHANNELS = [
  { id:'C_ESCALATIONS',  name:'#escalations' },
  { id:'C_HR_URGENT',    name:'#hr-urgent' },
  { id:'C_OPS_ALERTS',   name:'#ops-alerts' },
  { id:'C_LEGAL_HR',     name:'#legal-hr' },
  { id:'C_MGMT_ESCAL',   name:'#mgmt-escalations' },
];

const inputStyle = {
  width:'100%', padding:'9px 12px', border:'1px solid #e8e8e8', borderRadius:12,
  fontSize:14, color:'#1b1b1b', background:'var(--surface)', outline:'none',
  fontFamily:'inherit', boxSizing:'border-box',
};
const labelStyle = {
  fontSize:11, fontWeight:600, color:'#616161', textTransform:'uppercase',
  letterSpacing:'.05em', marginBottom:6, display:'block',
};

export default function CreateEscalationModal({ onConfirm, onClose, currentUser, tasks = [] }) {
  const [source, setSource]         = useState('slack');   // 'slack' | 'manual'
  const [subject, setSubject]       = useState('');
  const [reason, setReason]         = useState('');
  const [managerId, setManagerId]   = useState('');
  const [linkedTaskId, setLinked]   = useState('');
  const [slackChannel, setChannel]  = useState(SLACK_CHANNELS[0].id);
  const [slackUser, setSlackUser]   = useState('');
  const [slackMsgUrl, setMsgUrl]    = useState('');
  const backdropRef = useRef(null);

  const managers = MEMBERS.filter(m => ['team_lead','regional_manager','admin'].includes(m.role));

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const [submitting, setSubmitting] = useState(false);
  const canSubmit = subject.trim() && reason.trim() && managerId;

  const handleSubmit = () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    const mgr = MEMBERS.find(m => m.id === Number(managerId));
    const linkedTask = tasks.find(t => t.id === linkedTaskId) ?? null;
    const channel = SLACK_CHANNELS.find(c => c.id === slackChannel);
    onConfirm({
      subject: subject.trim(),
      reason: reason.trim(),
      escalationSource: source,
      managerId: mgr?.id ?? null,
      managerName: mgr?.name ?? 'Team Lead',
      task: linkedTask,
      taskId: linkedTask?.id ?? null,
      // Slack-specific
      slackChannel: source === 'slack' ? channel?.name : null,
      slackUser: source === 'slack' ? slackUser.trim() || null : null,
      slackMessageUrl: source === 'slack' ? slackMsgUrl.trim() || null : null,
    });
    onClose();
  };

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
        boxShadow:'0 8px 40px rgba(0,0,0,0.18)',
      }}>
        {/* Header */}
        <div style={{ padding:'24px 28px 0', display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:36, height:36, background:'#ffe2de', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <i className="bi-arrow-up-circle-fill" style={{ color:'#d42d35', fontSize:17 }}/>
            </div>
            <div>
              <div style={{ fontSize:18, fontWeight:700, color:'#1b1b1b' }}>Create Escalation</div>
              <div style={{ fontSize:12, color:'#9e9e9e', marginTop:1 }}>Log a Slack or manual escalation</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#616161', fontSize:18, padding:4, lineHeight:1 }}>
            <i className="bi-x-lg"/>
          </button>
        </div>

        <div style={{ padding:'20px 28px 28px' }}>

          {/* Source toggle */}
          <div style={{ marginBottom:20 }}>
            <label style={labelStyle}>Source</label>
            <div style={{ display:'inline-flex', background:'#f7f5f2', borderRadius:128, padding:3, gap:2 }}>
              {[
                { id:'slack',  icon:'bi-slack',     label:'Slack Channel' },
                { id:'manual', icon:'bi-person',     label:'Manual' },
              ].map(s => {
                const active = source === s.id;
                return (
                  <button key={s.id} onClick={() => setSource(s.id)} style={{
                    padding:'6px 18px', borderRadius:128, fontSize:13, fontWeight: active ? 600 : 500,
                    border:'none', background: active ? 'white' : 'transparent',
                    color: active ? '#1b1b1b' : '#616161', cursor:'pointer',
                    boxShadow: active ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                    display:'flex', alignItems:'center', gap:6, transition:'all .15s',
                  }}>
                    <i className={s.icon} style={{ fontSize:12 }}/>{s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Slack fields */}
          {source === 'slack' && (
            <div style={{ background:'#f7f5f2', borderRadius:12, padding:'14px 16px', marginBottom:20, border:'1px solid #e8e8e8' }}>
              <div style={{ fontSize:12, fontWeight:600, color:'#616161', marginBottom:12, display:'flex', alignItems:'center', gap:6 }}>
                <i className="bi-slack" style={{ fontSize:13 }}/>Slack Details
              </div>
              <div style={{ marginBottom:12 }}>
                <label style={labelStyle}>Channel</label>
                <select value={slackChannel} onChange={e => setChannel(e.target.value)} style={inputStyle}>
                  {SLACK_CHANNELS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div style={{ marginBottom:12 }}>
                <label style={labelStyle}>Raised by (Slack user)</label>
                <input
                  value={slackUser} onChange={e => setSlackUser(e.target.value)}
                  placeholder="e.g. @john.doe or John Doe"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Message link (optional)</label>
                <input
                  value={slackMsgUrl} onChange={e => setMsgUrl(e.target.value)}
                  placeholder="Paste Slack message URL…"
                  style={inputStyle}
                />
              </div>
            </div>
          )}

          {/* Subject */}
          <div style={{ marginBottom:20 }}>
            <label style={labelStyle}>Subject *</label>
            <input
              value={subject} onChange={e => setSubject(e.target.value)}
              placeholder="Brief description of the escalation"
              style={inputStyle}
              autoFocus
            />
          </div>

          {/* Reason */}
          <div style={{ marginBottom:20 }}>
            <label style={labelStyle}>Reason *</label>
            <textarea
              value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Why does this need manager attention? Include any relevant context…"
              rows={3}
              style={{ ...inputStyle, resize:'vertical', lineHeight:1.5 }}
            />
          </div>

          {/* Link to ticket (optional) */}
          {tasks.length > 0 && (
            <div style={{ marginBottom:20 }}>
              <label style={labelStyle}>Linked Ticket (optional)</label>
              <select value={linkedTaskId} onChange={e => setLinked(e.target.value)} style={inputStyle}>
                <option value="">— Not linked to a ticket —</option>
                {tasks.filter(t => t.source !== 'calendar').map(t => (
                  <option key={t.id} value={t.id}>{t.id} — {t.subject?.slice(0,60)}</option>
                ))}
              </select>
            </div>
          )}

          {/* Route to manager */}
          <div style={{ marginBottom:24 }}>
            <label style={labelStyle}>Route to *</label>
            <select value={managerId} onChange={e => setManagerId(e.target.value)} style={inputStyle}>
              <option value="">— Select manager —</option>
              {managers.map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.role.replace('_',' ')})</option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <button onClick={onClose} style={{
              padding:'9px 20px', borderRadius:128, fontSize:14, fontWeight:500,
              border:'1px solid #e8e8e8', background:'var(--surface)', color:'#616161', cursor:'pointer',
            }}>Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit||submitting}
              style={{
                padding:'9px 22px', borderRadius:128, fontSize:14, fontWeight:600,
                border:'none', display:'flex', alignItems:'center', gap:6,
                background: canSubmit&&!submitting ? '#d42d35' : '#e8e8e8',
                color: canSubmit&&!submitting ? 'white' : '#9e9e9e',
                cursor: canSubmit&&!submitting ? 'pointer' : 'not-allowed', transition:'all .15s',
                opacity: submitting ? .6 : 1,
              }}
            >
              <i className="bi-arrow-up-circle-fill" style={{ fontSize:13 }}/>{submitting?'Escalating…':'Escalate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
