import { useState, useEffect, useRef } from 'react';
import { MEMBERS } from '../../data/members';
import { PROJECT_TYPES, PROJECT_STATUSES } from '../../data/projects';

const PRIORITIES = ['low','medium','high','critical'];
const TEAMS = ['EMEA','APAC','AMER'];

const inputStyle = {
  width:'100%', padding:'9px 12px', border:'1px solid #e8e8e8', borderRadius:12,
  fontSize:14, color:'#1b1b1b', background:'var(--surface)', outline:'none',
  fontFamily:'inherit', boxSizing:'border-box',
};
const labelStyle = { fontSize:11, fontWeight:600, color:'#616161', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6, display:'block' };
const sectionStyle = { marginBottom:20 };

const priorityColors = { low:'#29811e', medium:'#1f74b3', high:'#ed5e2a', critical:'#d42d35' };

export default function CreateProjectModal({ onConfirm, onClose, project, currentUser }) {
  const editing = !!project;

  const [name, setName]             = useState(project?.name ?? '');
  const [type, setType]             = useState(project?.type ?? 'onboarding');
  const [status, setStatus]         = useState(project?.status ?? 'planning');
  const [priority, setPriority]     = useState(project?.priority ?? 'medium');
  const [description, setDesc]      = useState(project?.description ?? '');
  const [leadId, setLeadId]         = useState(project?.leadId ?? currentUser?.id ?? 14);
  const [deadline, setDeadline]     = useState(project?.deadline ?? '');
  const [assignScope, setScope]     = useState(project?.assignScope ?? 'individuals');
  const [assignTeam, setTeam]       = useState(project?.assignTeam ?? 'EMEA');
  const [assigneeIds, setAssignees] = useState(project?.assigneeIds ?? []);
  const [submitted, setSubmitted]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deadlineError, setDeadlineError] = useState('');

  const backdropRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const toggleAssignee = (id) => {
    setAssignees(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSubmit = () => {
    setSubmitted(true);
    setDeadlineError('');
    if (!name.trim() || !deadline) return;
    // Validate deadline is not in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDate = new Date(deadline + 'T00:00:00');
    if (selectedDate < today) {
      setDeadlineError('Deadline cannot be in the past');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    onConfirm({
      name: name.trim(),
      type, status, priority, description,
      leadId, deadline, assignScope,
      assignTeam: assignScope === 'team' ? assignTeam : null,
      assigneeIds: assignScope === 'individuals' ? assigneeIds : [],
    });
    onClose();
  };

  const leads = MEMBERS.filter(m => ['team_lead','regional_manager','admin'].includes(m.role));

  return (
    <div
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:1000,
        display:'flex', alignItems:'center', justifyContent:'center', padding:24,
        backdropFilter:'blur(4px)',
      }}
    >
      <style>{`@keyframes modalIn { from { opacity:0; transform:scale(0.96) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
      <div style={{
        background:'var(--surface)', borderRadius:20, width:'100%', maxWidth:520,
        maxHeight:'90vh', overflowY:'auto', boxShadow:'0 8px 40px rgba(0,0,0,0.18)',
        display:'flex', flexDirection:'column',
        animation:'modalIn 0.2s cubic-bezier(0.16,1,0.3,1) both',
      }}>
        {/* Header */}
        <div style={{ padding:'24px 28px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0, borderBottom:'1px solid var(--border)', paddingBottom:'var(--space-4)', marginBottom:'var(--space-4)' }}>
          <div>
            <div style={{ fontSize:18, fontWeight:700, color:'#1b1b1b' }}>
              {editing ? 'Edit Project' : 'New Project'}
            </div>
            <div style={{ fontSize:13, color:'#9e9e9e', marginTop:2 }}>
              {editing ? 'Update project details' : 'Create a new project and assign it to your team'}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', padding:6, borderRadius:8, color:'#616161', fontSize:18, lineHeight:1 }}>
            <i className="bi-x-lg"/>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding:'20px 28px 28px', flex:1 }}>

          {/* Name */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Project Name *</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Q2 EMEA Onboarding Revamp"
              className={submitted && !name.trim() ? 'input-error' : ''}
              style={inputStyle}
              autoFocus
            />
            {submitted && !name.trim() && (
              <div className="error-msg"><i className="bi bi-exclamation-circle"/><span>This field is required</span></div>
            )}
          </div>

          {/* Type + Priority row */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20 }}>
            <div>
              <label style={labelStyle}>Type</label>
              <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
                {PROJECT_TYPES.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)} style={{ ...inputStyle, color: priorityColors[priority] }}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
              </select>
            </div>
          </div>

          {/* Status + Deadline row */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20 }}>
            <div>
              <label style={labelStyle}>Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
                {PROJECT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Deadline *</label>
              <input
                type="date"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
                className={submitted && !deadline ? 'input-error' : ''}
                style={inputStyle}
              />
              {submitted && !deadline && (
                <div className="error-msg"><i className="bi bi-exclamation-circle"/><span>This field is required</span></div>
              )}
              {deadlineError && (
                <div style={{color:'var(--red)',fontSize:'var(--font-xs)',marginTop:4}}>{deadlineError}</div>
              )}
            </div>
          </div>

          {/* Lead */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Project Lead</label>
            <select value={leadId} onChange={e => setLeadId(Number(e.target.value))} style={inputStyle}>
              {leads.map(m => <option key={m.id} value={m.id}>{m.name} ({m.role.replace('_',' ')})</option>)}
            </select>
          </div>

          {/* Assign scope */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Assign To</label>
            <div style={{ display:'flex', gap:8, marginBottom:12 }}>
              {['individuals','team','everyone'].map(scope => (
                <button
                  key={scope}
                  onClick={() => setScope(scope)}
                  style={{
                    padding:'6px 16px', borderRadius:128, fontSize:13, fontWeight:500, cursor:'pointer', border:'1px solid',
                    borderColor: assignScope === scope ? '#1b1b1b' : '#e8e8e8',
                    background: assignScope === scope ? '#1b1b1b' : 'white',
                    color: assignScope === scope ? 'white' : '#616161',
                    transition:'all .15s',
                  }}
                >
                  {scope === 'individuals' ? 'Individuals' : scope === 'team' ? 'Team' : 'Everyone'}
                </button>
              ))}
            </div>

            {assignScope === 'team' && (
              <div style={{ display:'flex', gap:8 }}>
                {TEAMS.map(t => (
                  <button
                    key={t}
                    onClick={() => setTeam(t)}
                    style={{
                      padding:'6px 16px', borderRadius:128, fontSize:13, fontWeight:500, cursor:'pointer', border:'1px solid',
                      borderColor: assignTeam === t ? '#1f74b3' : '#e8e8e8',
                      background: assignTeam === t ? '#e8f0fe' : 'white',
                      color: assignTeam === t ? '#1f74b3' : '#616161',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}

            {assignScope === 'individuals' && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {MEMBERS.filter(m => m.id !== leadId).map(m => {
                  const selected = assigneeIds.includes(m.id);
                  const initials = m.name.split(' ').map(w=>w[0]).join('').slice(0,2);
                  return (
                    <div
                      key={m.id}
                      onClick={() => toggleAssignee(m.id)}
                      style={{
                        display:'flex', alignItems:'center', gap:8, padding:'6px 12px 6px 8px',
                        borderRadius:128, border:'1px solid', cursor:'pointer', transition:'all .15s',
                        borderColor: selected ? '#1f74b3' : '#e8e8e8',
                        background: selected ? '#e8f0fe' : 'white',
                      }}
                    >
                      <div style={{
                        width:24, height:24, borderRadius:'50%', background: selected ? '#1f74b3' : '#e8e8e8',
                        color: selected ? 'white' : '#616161', display:'flex', alignItems:'center',
                        justifyContent:'center', fontSize:10, fontWeight:700, flexShrink:0,
                      }}>{initials}</div>
                      <span style={{ fontSize:13, fontWeight:500, color: selected ? '#1f74b3' : '#1b1b1b' }}>
                        {m.name.split(' ')[0]}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {assignScope === 'everyone' && (
              <div style={{ padding:'10px 14px', background:'#f7f5f2', borderRadius:10, fontSize:13, color:'#616161' }}>
                <i className="bi-people-fill" style={{ marginRight:6 }}/>
                This project will be visible to all team members
              </div>
            )}
          </div>

          {/* Description */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Description</label>
            <textarea
              value={description} onChange={e => setDesc(e.target.value)}
              placeholder="Describe the project goals, scope, and expected outcomes…"
              rows={3}
              style={{ ...inputStyle, resize:'vertical', lineHeight:1.5 }}
            />
          </div>

          {/* Actions */}
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', borderTop:'1px solid var(--border)', paddingTop:'var(--space-4)', marginTop:'var(--space-4)' }}>
            <button onClick={onClose} style={{
              padding:'9px 20px', borderRadius:128, fontSize:14, fontWeight:500,
              border:'1px solid #e8e8e8', background:'var(--surface)', color:'#616161', cursor:'pointer',
            }}>
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!name.trim() || !deadline || !!deadlineError || submitting}
              style={{
                padding:'9px 24px', borderRadius:128, fontSize:14, fontWeight:600,
                border:'none', background: (!name.trim()||!deadline||deadlineError||submitting) ? '#e8e8e8' : '#1b1b1b',
                color: (!name.trim()||!deadline||deadlineError||submitting) ? '#9e9e9e' : 'white',
                cursor: (!name.trim()||!deadline||deadlineError||submitting) ? 'not-allowed' : 'pointer', transition:'all .15s',
                opacity: submitting ? .6 : 1,
              }}
            >
              {submitting?'Saving…':editing ? 'Save Changes' : 'Create Project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
