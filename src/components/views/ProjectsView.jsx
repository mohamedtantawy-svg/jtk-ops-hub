import { useState, useMemo, useContext } from 'react';
import { MEMBERS } from '../../data/members';
import { PROJECT_TYPES, PROJECT_STATUSES } from '../../data/projects';
import ProjectDetail from '../projects/ProjectDetail';
import { PermissionsContext } from '../../App';

const priorityColors = { low:'#29811e', medium:'#1f74b3', high:'#ed5e2a', critical:'#d42d35' };
const priorityBg    = { low:'#e6f4e5', medium:'#e8f0fe', high:'#fef3ee', critical:'#fce9ea' };

const PROJECT_STATUS_STYLES = {
  active:    { background:'var(--green-light)',  color:'var(--green)' },
  planning:  { background:'var(--blue-light)',   color:'var(--blue)' },
  on_hold:   { background:'var(--orange-light)', color:'var(--orange)' },
  completed: { background:'var(--surface-3)',    color:'var(--text-secondary)' },
  cancelled: { background:'var(--red-light)',    color:'var(--red)' },
};

function daysLeft(deadline) {
  return Math.ceil((new Date(deadline) - new Date()) / 86400000);
}

function AvatarStack({ ids, scope, team, max = 4 }) {
  if (scope === 'everyone') return (
    <div style={{ display:'flex', alignItems:'center', gap:5 }}>
      <i className="bi-people-fill" style={{ color:'#7c5cbf', fontSize:13 }}/>
      <span style={{ fontSize:12, color:'#616161' }}>Everyone</span>
    </div>
  );
  if (scope === 'team') return (
    <div style={{ display:'flex', alignItems:'center', gap:5 }}>
      <i className="bi-people" style={{ color:'#1f74b3', fontSize:13 }}/>
      <span style={{ fontSize:12, color:'#616161' }}>{team} Team</span>
    </div>
  );
  if (!ids?.length) return <span style={{ fontSize:12, color:'#9e9e9e' }}>Unassigned</span>;

  const shown = ids.slice(0, max);
  const rest  = ids.length - max;
  return (
    <div style={{ display:'flex', alignItems:'center' }}>
      {shown.map((id, i) => {
        const m = MEMBERS.find(x => x.id === id);
        if (!m) return null;
        const initials = m.name.split(' ').map(w=>w[0]).join('').slice(0,2);
        return (
          <div key={id} title={m.name} style={{
            width:24, height:24, borderRadius:'50%', background:'#e8e0f5',
            color:'#7c5cbf', fontSize:10, fontWeight:700, display:'flex',
            alignItems:'center', justifyContent:'center', border:'2px solid white',
            marginLeft: i===0 ? 0 : -7, zIndex: shown.length - i, position:'relative',
          }}>{initials}</div>
        );
      })}
      {rest > 0 && (
        <div style={{
          width:24, height:24, borderRadius:'50%', background:'#e8e8e8',
          color:'#616161', fontSize:10, fontWeight:700, display:'flex',
          alignItems:'center', justifyContent:'center', border:'2px solid white', marginLeft:-7,
        }}>+{rest}</div>
      )}
    </div>
  );
}

function ProgressBar({ value }) {
  const color = value === 100 ? '#29811e' : value >= 70 ? '#1f74b3' : value >= 40 ? '#ed5e2a' : '#d42d35';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <div style={{ flex:1, height:6, background:'#f2f2f2', borderRadius:3, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${Math.max(4, value)}%`, background:color, borderRadius:3, transition:'width .3s' }}/>
      </div>
      <span style={{ fontSize:12, fontWeight:600, color, minWidth:30, textAlign:'right' }}>{value}%</span>
    </div>
  );
}

const SUB_TABS = ['All Projects','My Projects','Active','Completed'];

// Derive linked tasks for a project based on type matching
function getLinkedTasks(project, tasks = []) {
  const typeMap = {
    onboarding:          'onboarding',
    offboarding:         'offboarding',
    compliance:          'compliance',
    process_improvement: 'process_improvement',
    reporting:           'reporting',
    audit:               'audit',
  };
  const matchType = typeMap[project.type];
  if (!matchType) return [];
  return tasks.filter(t => t.type === matchType).slice(0, 5);
}

function getCommentCount(projectId) {
  const num = parseInt((projectId || '0').replace(/\D/g, ''), 10) || 0;
  return (num * 3) % 12 + 1;
}

export default function ProjectsView({ projects, setProjects, user, onNewProject, onEditProject, tasks = [] }) {
  const perms = useContext(PermissionsContext);
  const [selProject, setSelProject] = useState(null);
  const [subTab, setSubTab]         = useState('All Projects');
  const [typeFilter, setTypeFilter] = useState(null);
  const [search, setSearch]         = useState('');
  const [sortKey, setSortKey]       = useState('deadline');

  const filtered = useMemo(() => {
    let list = [...projects];

    if (subTab === 'My Projects') {
      list = list.filter(p =>
        p.leadId === user?.id ||
        p.assigneeIds?.includes(user?.id) ||
        p.assignScope === 'everyone' ||
        (p.assignScope === 'team' && p.assignTeam === user?.team)
      );
    } else if (subTab === 'Active') {
      list = list.filter(p => p.status === 'active');
    } else if (subTab === 'Completed') {
      list = list.filter(p => p.status === 'completed');
    }

    if (typeFilter) list = list.filter(p => p.type === typeFilter);
    if (search.trim()) list = list.filter(p =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description?.toLowerCase().includes(search.toLowerCase())
    );

    list.sort((a, b) => {
      if (sortKey === 'deadline') return new Date(a.deadline) - new Date(b.deadline);
      if (sortKey === 'progress') return b.progress - a.progress;
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'status') return a.status.localeCompare(b.status);
      return 0;
    });

    return list;
  }, [projects, subTab, typeFilter, search, sortKey, user]);

  const handleUpdateProgress = (id, value) => {
    if (!perms?.canDo('can_update_project')) return;
    setProjects(prev => prev.map(p => p.id === id ? { ...p, progress: value, updatedAt: new Date().toISOString().split('T')[0] } : p));
    if (selProject?.id === id) setSelProject(prev => ({ ...prev, progress: value }));
  };

  const handleDelete = (id, name, e) => {
    e.stopPropagation();
    if (!perms?.canDo('can_delete_project')) return;
    if (!window.confirm(`Delete project "${name}"? This cannot be undone.`)) return;
    setProjects(prev => prev.filter(p => p.id !== id));
    if (selProject?.id === id) setSelProject(null);
  };

  const handleUpdateStatus = (id, status) => {
    if (!perms?.canDo('can_update_project')) return;
    setProjects(prev => prev.map(p => p.id === id
      ? { ...p, status, progress: status === 'completed' ? 100 : p.progress, updatedAt: new Date().toISOString().split('T')[0] }
      : p
    ));
    if (selProject?.id === id) setSelProject(prev => ({ ...prev, status, progress: status === 'completed' ? 100 : prev.progress }));
  };

  const thStyle = {
    padding:'10px 16px', fontSize:13, fontWeight:500, color:'#9e9e9e',
    textTransform:'none', letterSpacing:'normal', textAlign:'left',
    whiteSpace:'nowrap', userSelect:'none', cursor:'pointer',
  };

  return (
    <div style={{ display:'flex', flex:1, overflow:'hidden', height:'100%' }}>
      {/* Main panel */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Sub-nav tabs */}
        <div style={{ height:44, background:'white', borderBottom:'1px solid #e8e8e8', display:'flex', alignItems:'stretch', paddingLeft:16 }}>
          {SUB_TABS.map(tab => {
            const active = subTab === tab;
            return (
              <div key={tab} onClick={() => setSubTab(tab)} style={{
                padding:'8px 14px', fontSize:13, fontWeight: active ? 600 : 500,
                color: active ? '#6b3fa0' : '#616161',
                background: active ? '#f3eff8' : 'transparent',
                borderRadius: 8,
                borderBottom: 'none',
                cursor:'pointer', display:'flex', alignItems:'center', marginRight:4, transition:'all .15s',
              }}>{tab}</div>
            );
          })}
        </div>

        {/* Filter bar */}
        <div style={{ padding:'16px 24px 0', flexShrink:0 }}>
          <div style={{ display:'flex', gap:10, marginBottom:20, alignItems:'center', flexWrap:'wrap' }}>
            {/* Search */}
            <div style={{ position:'relative', flex:1, minWidth:200, maxWidth:320 }}>
              <i className="bi-search" style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'#9e9e9e', fontSize:13, pointerEvents:'none' }}/>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search projects…"
                style={{
                  width:'100%', padding:'7px 10px 7px 32px', border:'1px solid #e8e8e8',
                  borderRadius:128, fontSize:13, color:'#1b1b1b', background:'white',
                  outline:'none', boxSizing:'border-box',
                }}
              />
            </div>

            {/* Type filter chips */}
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <button
                onClick={() => setTypeFilter(null)}
                style={{
                  padding:'6px 14px', borderRadius:128, fontSize:12, fontWeight:500, cursor:'pointer',
                  border:'1px solid', transition:'all .15s',
                  borderColor: !typeFilter ? '#1b1b1b' : '#e8e8e8',
                  background: !typeFilter ? '#1b1b1b' : 'white',
                  color: !typeFilter ? 'white' : '#616161',
                }}
              >All Types</button>
              {PROJECT_TYPES.map(t => (
                <button key={t.id} onClick={() => setTypeFilter(typeFilter === t.id ? null : t.id)} style={{
                  padding:'6px 14px', borderRadius:128, fontSize:12, fontWeight:500, cursor:'pointer',
                  border:'1px solid', transition:'all .15s',
                  borderColor: typeFilter === t.id ? '#1f74b3' : '#e8e8e8',
                  background: typeFilter === t.id ? '#e8f0fe' : 'white',
                  color: typeFilter === t.id ? '#1f74b3' : '#616161',
                }}>
                  <i className={t.icon} style={{ marginRight:5, fontSize:11 }}/>{t.label}
                </button>
              ))}
            </div>

            {/* Sort */}
            <select
              value={sortKey} onChange={e => setSortKey(e.target.value)}
              style={{
                padding:'7px 12px', border:'1px solid #e8e8e8', borderRadius:128, fontSize:12,
                color:'#616161', background:'white', outline:'none', cursor:'pointer', fontFamily:'inherit',
              }}
            >
              <option value="deadline">Sort: Deadline</option>
              <option value="progress">Sort: Progress</option>
              <option value="name">Sort: Name</option>
              <option value="status">Sort: Status</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div style={{ flex:1, overflow:'auto', paddingBottom:24 }}>
          {filtered.length === 0 ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:300, color:'#9e9e9e' }}>
              <i className="bi-kanban" style={{ fontSize:40, marginBottom:12, opacity:.4 }}/>
              <div style={{ fontSize:15, fontWeight:600 }}>No projects found</div>
              <div style={{ fontSize:13, marginTop:4 }}>Try adjusting your filters or create a new project</div>
            </div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed' }}>
              <colgroup>
                <col style={{ width:'22%' }}/>
                <col style={{ width:'9%' }}/>
                <col style={{ width:'11%' }}/>
                <col style={{ width:'11%' }}/>
                <col style={{ width:'9%' }}/>
                <col style={{ width:'9%' }}/>
                <col style={{ width:'10%' }}/>
                <col style={{ width:'7%' }}/>
                <col style={{ width:'5%' }}/>
              </colgroup>
              <thead>
                <tr style={{ background:'#fafaf9', borderBottom:'1px solid #e8e8e8' }}>
                  {[['name','Project'],['type','Type'],['leadId','Lead'],['assigneeIds','Assignees'],['deadline','Deadline'],['status','Status'],['progress','Progress'],['','Comments'],['','']].map(([key,label]) => (
                    <th key={label} style={thStyle} onClick={key ? () => setSortKey(key) : undefined}>
                      {label}{key && sortKey === key && <i className="bi-chevron-down" style={{ marginLeft:4, fontSize:9 }}/>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(project => {
                  const lead       = MEMBERS.find(m => m.id === project.leadId);
                  const statusInfo = PROJECT_STATUSES.find(s => s.id === project.status);
                  const typeInfo   = PROJECT_TYPES.find(t => t.id === project.type);
                  const days       = daysLeft(project.deadline);
                  const isSelected = selProject?.id === project.id;

                  const isCompleted = project.status === 'completed';

                  return (
                    <tr
                      key={project.id}
                      onClick={() => setSelProject(isSelected ? null : project)}
                      style={{
                        borderBottom:'1px solid #f2f2f2', cursor:'pointer', transition:'background 0.1s',
                        background: isSelected ? '#f3eff8' : 'white',
                        opacity: isCompleted ? 0.7 : 1,
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background='var(--surface-2, #f9f8f6)'; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background=isSelected?'#f3eff8':'white'; }}
                    >
                      {/* Name */}
                      <td style={{ padding:'14px 16px' }}>
                        <div style={{ fontSize:14, fontWeight:600, color:'#1b1b1b', marginBottom:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {project.name}
                        </div>
                        <div style={{ fontSize:11, color:'#9e9e9e' }}>{project.id}</div>
                      </td>

                      {/* Type */}
                      <td style={{ padding:'14px 16px' }}>
                        <span style={{ fontSize:12, color:'#616161', display:'flex', alignItems:'center', gap:4 }}>
                          <i className={typeInfo?.icon} style={{ fontSize:11 }}/>{typeInfo?.label}
                        </span>
                      </td>

                      {/* Lead */}
                      <td style={{ padding:'14px 16px' }}>
                        {lead && (
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                            <div style={{
                              width:24, height:24, borderRadius:'50%', background:'#f3eff8',
                              color:'#7c5cbf', fontSize:10, fontWeight:700, display:'flex',
                              alignItems:'center', justifyContent:'center', flexShrink:0,
                            }}>
                              {lead.name.split(' ').map(w=>w[0]).join('').slice(0,2)}
                            </div>
                            <span style={{ fontSize:13, color:'#1b1b1b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {lead.name.split(' ')[0]}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Assignees */}
                      <td style={{ padding:'14px 16px', minWidth:80, flexShrink:0 }}>
                        <AvatarStack ids={project.assigneeIds} scope={project.assignScope} team={project.assignTeam} />
                      </td>

                      {/* Deadline */}
                      <td style={{ padding:'14px 16px' }}>
                        <div style={{ fontSize:12, fontWeight:500, color: isCompleted ? 'var(--text-muted)' : days < 0 ? '#d42d35' : days <= 7 ? '#ed5e2a' : '#1b1b1b', textDecoration: isCompleted ? 'line-through' : 'none' }}>
                          {new Date(project.deadline).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}
                        </div>
                        <div style={{ fontSize:11, color: days < 0 ? '#d42d35' : '#9e9e9e' }}>
                          {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d`}
                        </div>
                      </td>

                      {/* Status — use PROJECT_STATUS_STYLES tokens */}
                      <td style={{ padding:'14px 16px' }}>
                        {(()=>{const ps=PROJECT_STATUS_STYLES[project.status]||{background:'#f2f2f2',color:'#616161'};return(<span style={{padding:'3px 10px',borderRadius:128,fontSize:11,fontWeight:600,whiteSpace:'nowrap',...ps}}>{statusInfo?.label}</span>);})()}
                      </td>

                      {/* Progress */}
                      <td style={{ padding:'14px 16px' }}>
                        <ProgressBar value={project.progress} />
                      </td>

                      {/* Comments */}
                      <td style={{ padding:'14px 16px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:4, color:'#616161' }}>
                          <i className="bi-chat" style={{ fontSize:12, color:'#9e9e9e' }}/>
                          <span style={{ fontSize:13, fontWeight:500, fontVariantNumeric:'tabular-nums' }}>{getCommentCount(project.id)}</span>
                        </div>
                      </td>

                      {/* Delete */}
                      <td style={{ padding:'14px 8px', textAlign:'center' }}>
                        <button
                          onClick={(e) => handleDelete(project.id, project.name, e)}
                          title="Delete project"
                          style={{ background:'none', border:'none', cursor:'pointer', color:'#d42d35', opacity:.55, padding:'4px 6px', borderRadius:6, transition:'opacity .15s' }}
                          onMouseEnter={e => e.currentTarget.style.opacity='1'}
                          onMouseLeave={e => e.currentTarget.style.opacity='.55'}
                        >
                          <i className="bi-trash" style={{ fontSize:13 }}/>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selProject && (
        <ProjectDetail
          project={selProject}
          currentUser={user}
          onClose={() => setSelProject(null)}
          onEdit={onEditProject}
          onUpdateProgress={handleUpdateProgress}
          onUpdateStatus={handleUpdateStatus}
          linkedTasks={getLinkedTasks(selProject, tasks)}
        />
      )}
    </div>
  );
}
