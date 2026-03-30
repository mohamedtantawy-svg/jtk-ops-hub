import { useState, useContext } from 'react';
import { PermissionsContext } from '../../App';
import { MEMBERS } from '../../data/members';
import { PROJECT_TYPES, PROJECT_STATUSES } from '../../data/projects';

const labelStyle = { fontSize:11, fontWeight:600, color:'#9e9e9e', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6, display:'block' };
const priorityColors = { low:'#29811e', medium:'#1f74b3', high:'#ed5e2a', critical:'#d42d35' };
const priorityBg    = { low:'#e6f4e5', medium:'#e8f0fe', high:'#fef3ee', critical:'#fce9ea' };

const MILESTONES_BY_TYPE = {
  onboarding:          ['Kickoff meeting',        'System access setup',     'Training complete'],
  offboarding:         ['Exit interview',          'Access revocation',       'Asset return'],
  compliance:          ['Audit preparation',       'Review & sign-off',       'Report submission'],
  process_improvement: ['Discovery & scoping',     'Pilot rollout',           'Full deployment'],
  reporting:           ['Data source alignment',   'Dashboard build',         'Stakeholder sign-off'],
  audit:               ['Scope definition',        'Evidence collection',     'Final report'],
  other:               ['Planning complete',       'Execution started',       'Review & close'],
};

function daysLeft(deadline) {
  const diff = Math.ceil((new Date(deadline) - new Date()) / 86400000);
  return diff;
}

function AvatarStack({ ids, max = 5 }) {
  const shown = ids.slice(0, max);
  const rest = ids.length - max;
  return (
    <div style={{ display:'flex', alignItems:'center' }}>
      {shown.map((id, i) => {
        const m = MEMBERS.find(x => x.id === id);
        if (!m) return null;
        const initials = m.name.split(' ').map(w=>w[0]).join('').slice(0,2);
        return (
          <div key={id} title={m.name} style={{
            width:28, height:28, borderRadius:'50%', background:'#e8e0f5',
            color:'#7c5cbf', fontSize:11, fontWeight:700, display:'flex',
            alignItems:'center', justifyContent:'center', border:'2px solid white',
            marginLeft: i === 0 ? 0 : -8, zIndex: shown.length - i,
            position:'relative',
          }}>{initials}</div>
        );
      })}
      {rest > 0 && (
        <div style={{
          width:28, height:28, borderRadius:'50%', background:'#e8e8e8',
          color:'#616161', fontSize:11, fontWeight:700, display:'flex',
          alignItems:'center', justifyContent:'center', border:'2px solid white',
          marginLeft:-8,
        }}>+{rest}</div>
      )}
    </div>
  );
}

export default function ProjectDetail({ project, onClose, onEdit, onUpdateProgress, onUpdateStatus, currentUser, linkedTasks = [] }) {
  const [progress, setProgress] = useState(project.progress);
  const [dragging, setDragging] = useState(false);
  const [checkedMilestones, setCheckedMilestones] = useState({});

  const typeInfo    = PROJECT_TYPES.find(t => t.id === project.type);
  const statusInfo  = PROJECT_STATUSES.find(s => s.id === project.status);
  const lead        = MEMBERS.find(m => m.id === project.leadId);
  const days        = daysLeft(project.deadline);
  const deadlineColor = days < 0 ? '#d42d35' : days <= 7 ? '#ed5e2a' : '#616161';

  const perms = useContext(PermissionsContext);
  const canEdit = perms?.canDo('can_create_project') || currentUser?.id === project.leadId;

  const milestones = MILESTONES_BY_TYPE[project.type] || MILESTONES_BY_TYPE.other;

  const toggleMilestone = (idx) => {
    setCheckedMilestones(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const handleProgressSave = () => {
    if (progress !== project.progress) onUpdateProgress(project.id, progress);
    setDragging(false);
  };

  const getAssigneeLabel = () => {
    if (project.assignScope === 'everyone') return 'Everyone';
    if (project.assignScope === 'team') return `${project.assignTeam} Team`;
    if (!project.assigneeIds?.length) return 'Unassigned';
    return null;
  };

  const assigneeLabel = getAssigneeLabel();

  // Linked tasks summary
  const resolvedLinked = linkedTasks.filter(t => t.status === 'resolved').length;
  const totalLinked = linkedTasks.length;

  return (
    <div style={{
      width:440, flexShrink:0, borderLeft:'1px solid #e8e8e8', background:'white',
      display:'flex', flexDirection:'column', height:'100%', overflowY:'auto',
    }}>
      {/* Header */}
      <div style={{ padding:'20px 24px 16px', borderBottom:'1px solid #f2f2f2', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:12 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, fontWeight:600, color:'#9e9e9e', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>
              {project.id}
            </div>
            <div style={{ fontSize:17, fontWeight:700, color:'#1b1b1b', lineHeight:1.3 }}>
              {project.name}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#9e9e9e', fontSize:18, padding:4, flexShrink:0, lineHeight:1 }}>
            <i className="bi-x-lg"/>
          </button>
        </div>

        {/* Status + Type + Priority chips */}
        <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
          <span style={{
            padding:'4px 10px', borderRadius:128, fontSize:12, fontWeight:600,
            background: statusInfo?.bg, color: statusInfo?.color,
          }}>{statusInfo?.label}</span>
          <span style={{
            padding:'4px 10px', borderRadius:128, fontSize:12, fontWeight:500,
            background:'#f7f5f2', color:'#616161',
          }}>
            <i className={`${typeInfo?.icon}`} style={{ marginRight:4, fontSize:11 }}/>
            {typeInfo?.label}
          </span>
          <span style={{
            padding:'4px 10px', borderRadius:128, fontSize:12, fontWeight:600,
            background: priorityBg[project.priority], color: priorityColors[project.priority],
          }}>
            {project.priority.charAt(0).toUpperCase()+project.priority.slice(1)}
          </span>
        </div>
      </div>

      {/* Progress */}
      <div style={{ padding:'16px 24px', borderBottom:'1px solid #f2f2f2' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <span style={labelStyle}>Progress</span>
          <span style={{ fontSize:14, fontWeight:700, color: progress === 100 ? '#29811e' : '#1b1b1b' }}>{progress}%</span>
        </div>
        <div style={{ position:'relative', height:8, background:'#f2f2f2', borderRadius:128, overflow:'visible' }}>
          <div style={{
            height:'100%', borderRadius:128, transition: dragging ? 'none' : 'width .3s',
            width:`${progress}%`,
            background: progress === 100 ? '#29811e' : progress >= 70 ? '#1f74b3' : progress >= 40 ? '#ed5e2a' : '#d42d35',
          }}/>
        </div>
        {canEdit && (
          <input
            type="range" min={0} max={100} value={progress}
            onChange={e => { setProgress(Number(e.target.value)); setDragging(true); }}
            onMouseUp={handleProgressSave}
            onTouchEnd={handleProgressSave}
            style={{ width:'100%', marginTop:6, accentColor:'#1b1b1b', cursor:'pointer' }}
          />
        )}
        {/* Linked tasks resolved note */}
        {totalLinked > 0 && (
          <div style={{ marginTop:6, fontSize:11, color:'#616161', display:'flex', alignItems:'center', gap:4 }}>
            <i className="bi-link-45deg" style={{ color:'#9e9e9e', fontSize:11 }}/>
            <span><span style={{ fontWeight:700, color:'#1b1b1b' }}>{resolvedLinked}/{totalLinked}</span> linked tasks resolved</span>
          </div>
        )}
      </div>

      {/* Linked Tasks */}
      <div style={{ padding:'16px 24px', borderBottom:'1px solid #f2f2f2' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <span style={labelStyle}>Linked Tasks</span>
          {totalLinked > 0 && (
            <span style={{ background:'#e8f0fe', color:'#1f74b3', fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:128 }}>
              {totalLinked}
            </span>
          )}
        </div>
        {totalLinked === 0 ? (
          <div style={{ display:'flex', alignItems:'center', gap:8, color:'#9e9e9e', fontSize:12 }}>
            <i className="bi-link" style={{ fontSize:14 }}/>
            <span>Link tasks to track progress</span>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {linkedTasks.slice(0, 5).map(t => (
              <div key={t.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', background:'#fafaf9', borderRadius:10, border:'1px solid #f2f2f2' }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background: t.status==='resolved'?'#29811e':'#ed8d00', flexShrink:0 }}/>
                <span style={{ fontSize:12, color:'#1b1b1b', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.subject}</span>
                <span style={{ fontSize:10, color:'#9e9e9e', fontFamily:'monospace', flexShrink:0 }}>{t.id}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Milestones */}
      <div style={{ padding:'16px 24px', borderBottom:'1px solid #f2f2f2' }}>
        <span style={labelStyle}>Milestones</span>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {milestones.map((m, idx) => {
            const checked = !!checkedMilestones[idx];
            return (
              <label key={idx} style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', userSelect:'none' }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleMilestone(idx)}
                  style={{ width:15, height:15, accentColor:'#1f74b3', cursor:'pointer', flexShrink:0 }}
                />
                <span style={{ fontSize:13, color: checked ? '#9e9e9e' : '#1b1b1b', textDecoration: checked ? 'line-through' : 'none', transition:'color .2s' }}>
                  {m}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Meta grid */}
      <div style={{ padding:'16px 24px', borderBottom:'1px solid #f2f2f2', display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
        {/* Lead */}
        <div>
          <span style={labelStyle}>Project Lead</span>
          {lead && (
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{
                width:28, height:28, borderRadius:'50%', background:'#f3eff8',
                color:'#7c5cbf', fontSize:11, fontWeight:700, display:'flex',
                alignItems:'center', justifyContent:'center', flexShrink:0,
              }}>
                {lead.name.split(' ').map(w=>w[0]).join('').slice(0,2)}
              </div>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:'#1b1b1b' }}>{lead.name}</div>
                <div style={{ fontSize:11, color:'#9e9e9e' }}>{lead.role.replace('_',' ')}</div>
              </div>
            </div>
          )}
        </div>

        {/* Deadline */}
        <div>
          <span style={labelStyle}>Deadline</span>
          <div style={{ fontSize:13, fontWeight:600, color: deadlineColor }}>
            <i className="bi-calendar3" style={{ marginRight:5, fontSize:12 }}/>
            {new Date(project.deadline).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
          </div>
          <div style={{ fontSize:11, marginTop:2, color: deadlineColor }}>
            {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d remaining`}
          </div>
        </div>

        {/* Assignees */}
        <div>
          <span style={labelStyle}>Assigned To</span>
          {assigneeLabel ? (
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <i className={assigneeLabel === 'Everyone' ? 'bi-people-fill' : 'bi-people'} style={{ color:'#7c5cbf', fontSize:14 }}/>
              <span style={{ fontSize:13, fontWeight:500, color:'#1b1b1b' }}>{assigneeLabel}</span>
            </div>
          ) : (
            <AvatarStack ids={project.assigneeIds} />
          )}
        </div>

        {/* Created */}
        <div>
          <span style={labelStyle}>Created</span>
          <div style={{ fontSize:13, color:'#616161' }}>
            {new Date(project.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
          </div>
        </div>
      </div>

      {/* Description */}
      {project.description && (
        <div style={{ padding:'16px 24px', borderBottom:'1px solid #f2f2f2' }}>
          <span style={labelStyle}>Description</span>
          <p style={{ fontSize:13, color:'#616161', lineHeight:1.6, margin:0 }}>{project.description}</p>
        </div>
      )}

      {/* Actions */}
      {canEdit && (
        <div style={{ padding:'16px 24px', display:'flex', flexDirection:'column', gap:8 }}>
          <span style={labelStyle}>Actions</span>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button onClick={() => onEdit(project)} style={{
              padding:'8px 16px', borderRadius:128, fontSize:13, fontWeight:500,
              border:'1px solid #e8e8e8', background:'white', color:'#1b1b1b', cursor:'pointer', display:'flex', alignItems:'center', gap:6,
            }}>
              <i className="bi-pencil" style={{ fontSize:12 }}/> Edit
            </button>
            {project.status !== 'completed' && (
              <button onClick={() => onUpdateStatus(project.id, 'completed')} style={{
                padding:'8px 16px', borderRadius:128, fontSize:13, fontWeight:500,
                border:'1px solid #29811e', background:'#e6f4e5', color:'#29811e', cursor:'pointer', display:'flex', alignItems:'center', gap:6,
              }}>
                <i className="bi-check-circle" style={{ fontSize:12 }}/> Mark Complete
              </button>
            )}
            {project.status === 'active' && (
              <button onClick={() => onUpdateStatus(project.id, 'on_hold')} style={{
                padding:'8px 16px', borderRadius:128, fontSize:13, fontWeight:500,
                border:'1px solid #ed5e2a', background:'#fef3ee', color:'#ed5e2a', cursor:'pointer', display:'flex', alignItems:'center', gap:6,
              }}>
                <i className="bi-pause-circle" style={{ fontSize:12 }}/> On Hold
              </button>
            )}
            {project.status === 'on_hold' && (
              <button onClick={() => onUpdateStatus(project.id, 'active')} style={{
                padding:'8px 16px', borderRadius:128, fontSize:13, fontWeight:500,
                border:'1px solid #1f74b3', background:'#e8f0fe', color:'#1f74b3', cursor:'pointer', display:'flex', alignItems:'center', gap:6,
              }}>
                <i className="bi-play-circle" style={{ fontSize:12 }}/> Resume
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
