// ── WorkbenchPanel ──────────────────────────────────────────────────────────
// Shows OpsWorkbench tasks from Deel Admin API, grouped by task type.
// Tabs: By Type (default), By Country, All Tasks
import { useState, useMemo } from 'react';
import { getFlag, getCountryName } from '../../data/constants';
import Avatar from '../ui/Avatar';

const STATUS_CONFIG = {
  ESCALATED:    { label: 'Escalated',    color: '#d42d35', bg: '#fef2f2', icon: 'bi-exclamation-triangle-fill' },
  TO_DO:        { label: 'To Do',        color: '#ed8d00', bg: '#fff8e6', icon: 'bi-circle' },
  IN_PROGRESS:  { label: 'In Progress',  color: '#1d4ed8', bg: '#eff6ff', icon: 'bi-arrow-repeat' },
  ON_HOLD:      { label: 'On Hold',      color: '#616161', bg: '#f3f3f3', icon: 'bi-pause-circle' },
};

const SLA_CONFIG = {
  SLA_BREACHED:     { label: 'Breached', color: '#d42d35', bg: '#fef2f2' },
  SLA_NOT_BREACHED: { label: 'On Track', color: '#29811e', bg: '#e8f5e9' },
  SLA_PAUSED:       { label: 'Paused',   color: '#616161', bg: '#f3f3f3' },
  SLA_NOT_STARTED:  { label: 'Not Started', color: '#9e9e9e', bg: '#f7f5f2' },
};

// Time ago helper
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

// SLA remaining display
function slaDisplay(slaRemaining) {
  if (slaRemaining == null) return '';
  const hrs = Math.floor(slaRemaining / 3600);
  if (hrs >= 24) return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
  if (hrs > 0) return `${hrs}h`;
  const mins = Math.floor(slaRemaining / 60);
  return mins > 0 ? `${mins}m` : '<1m';
}

export default function WorkbenchPanel({
  tasks = [],
  counts = {},
  byTaskType = [],
  byCountry = [],
  loading,
  error,
  onRefresh,
}) {
  const [activeTab, setActiveTab] = useState('byType');
  const [expandedGroups, setExpandedGroups] = useState(new Set(['_all']));
  const [statusFilter, setStatusFilter] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const toggleGroup = (key) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => {
    const keys = activeTab === 'byType'
      ? byTaskType.map(g => g.taskType)
      : byCountry.map(g => g.country);
    const all = new Set(keys);
    all.add('_all');
    setExpandedGroups(all);
  };
  const collapseAll = () => setExpandedGroups(new Set());

  // Apply filters
  const filterItems = (items) => {
    let filtered = items;
    if (statusFilter) filtered = filtered.filter(t => t.status === statusFilter);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(t =>
        (t.name || '').toLowerCase().includes(q) ||
        (t.taskType || '').toLowerCase().includes(q) ||
        (t.assignee?.name || '').toLowerCase().includes(q) ||
        (t.contractOid || '').toLowerCase().includes(q) ||
        (t.country || '').toLowerCase().includes(q)
      );
    }
    return filtered;
  };

  // Filtered groups for byType
  const filteredByType = useMemo(() => {
    return byTaskType.map(g => ({
      ...g,
      items: filterItems(g.items),
    })).filter(g => g.items.length > 0);
  }, [byTaskType, statusFilter, searchTerm]);

  // Filtered groups for byCountry
  const filteredByCountry = useMemo(() => {
    return byCountry.map(g => ({
      ...g,
      items: filterItems(g.items),
    })).filter(g => g.items.length > 0);
  }, [byCountry, statusFilter, searchTerm]);

  // Filtered flat list
  const filteredAll = useMemo(() => filterItems(tasks), [tasks, statusFilter, searchTerm]);

  const totalFiltered = filteredAll.length;

  return (
    <div style={{flex:1,display:'flex',flexDirection:'column',background:'#fafaf9',overflow:'hidden'}}>
      {/* ── Header ── */}
      <div style={{padding:'16px 20px 0',display:'flex',flexDirection:'column',gap:10}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <i className="bi-grid-3x3-gap-fill" style={{fontSize:16,color:'#0369a1'}}/>
            <span style={{fontSize:15,fontWeight:700,color:'#1b1b1b'}}>Workbench</span>
            <span style={{fontSize:12,color:'#9e9e9e',fontWeight:500}}>{counts.total || 0} tasks</span>
          </div>
          <button onClick={onRefresh} disabled={loading}
            style={{display:'flex',alignItems:'center',gap:4,padding:'5px 10px',borderRadius:8,border:'1px solid #e8e8e8',background:'white',fontSize:11,fontWeight:500,color:'#616161',cursor:'pointer'}}>
            <i className={`bi-arrow-clockwise ${loading?'spin':''}`} style={{fontSize:11}}/>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {/* Status summary pills */}
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {[
            { key: null,          label: 'All',         count: counts.total,      color: '#1b1b1b', bg: '#f3f3f3' },
            { key: 'ESCALATED',   label: 'Escalated',   count: counts.escalated,  color: '#d42d35', bg: '#fef2f2' },
            { key: 'TO_DO',       label: 'To Do',       count: counts.toDo,       color: '#ed8d00', bg: '#fff8e6' },
            { key: 'IN_PROGRESS', label: 'In Progress', count: counts.inProgress, color: '#1d4ed8', bg: '#eff6ff' },
            { key: 'ON_HOLD',     label: 'On Hold',     count: counts.onHold,     color: '#616161', bg: '#f3f3f3' },
          ].map(s => (
            <button key={s.label} onClick={() => setStatusFilter(statusFilter === s.key ? null : s.key)}
              style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 10px',borderRadius:128,
                border:`1px solid ${statusFilter===s.key?s.color:'#e8e8e8'}`,
                background:statusFilter===s.key?s.bg:'white',
                color:statusFilter===s.key?s.color:'#616161',
                fontSize:11,fontWeight:statusFilter===s.key?600:400,cursor:'pointer',transition:'all .15s'}}>
              {s.label} <span style={{fontSize:10,opacity:.7}}>{s.count||0}</span>
            </button>
          ))}
        </div>

        {/* Search + tabs */}
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <div style={{flex:1,position:'relative'}}>
            <i className="bi-search" aria-hidden="true" style={{position:'absolute',left:8,top:'50%',transform:'translateY(-50%)',fontSize:11,color:'#9e9e9e',pointerEvents:'none'}}/>
            <input value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}
              placeholder="Search tasks, assignees, contracts..."
              role="searchbox"
              aria-label="Search workbench tasks"
              style={{width:'100%',padding:'6px 10px 6px 26px',border:'1px solid #e8e8e8',borderRadius:8,fontSize:12,outline:'none',boxSizing:'border-box',fontFamily:'inherit',color:'#1b1b1b'}}/>
          </div>
          <div role="tablist" aria-label="Workbench grouping" style={{display:'flex',gap:2,background:'#f3f3f3',borderRadius:8,padding:2}}>
            {[
              { id:'byType',    label:'By Type',    icon:'bi-collection' },
              { id:'byCountry', label:'By Country', icon:'bi-globe2' },
              { id:'all',       label:'All',        icon:'bi-list-ul' },
            ].map(tab=>(
              <button key={tab.id} onClick={()=>{setActiveTab(tab.id);setExpandedGroups(new Set(['_all']));}}
                role="tab"
                aria-selected={activeTab===tab.id}
                aria-label={`Group ${tab.label}`}
                style={{display:'flex',alignItems:'center',gap:3,padding:'4px 10px',borderRadius:6,border:'none',
                  background:activeTab===tab.id?'white':'transparent',
                  color:activeTab===tab.id?'#1b1b1b':'#9e9e9e',
                  fontSize:11,fontWeight:activeTab===tab.id?600:400,cursor:'pointer',
                  boxShadow:activeTab===tab.id?'0 1px 3px rgba(0,0,0,0.08)':'none'}}>
                <i className={tab.icon} aria-hidden="true" style={{fontSize:10}}/> {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Expand/Collapse */}
        {activeTab !== 'all' && (
          <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
            <button onClick={expandAll} style={{fontSize:10,color:'#0369a1',background:'none',border:'none',cursor:'pointer',fontWeight:500}}>Expand all</button>
            <button onClick={collapseAll} style={{fontSize:10,color:'#9e9e9e',background:'none',border:'none',cursor:'pointer'}}>Collapse all</button>
          </div>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{margin:'10px 20px',padding:'10px 14px',borderRadius:8,background:'#fef2f2',border:'1px solid #fca5a5',color:'#d42d35',fontSize:12}}>
          <i className="bi-exclamation-triangle-fill" style={{marginRight:6}}/>
          Failed to load workbench: {error}
        </div>
      )}

      {/* ── Content ── */}
      <div style={{flex:1,overflowY:'auto',padding:'8px 20px 20px'}}>
        {loading && tasks.length === 0 ? (
          <div style={{textAlign:'center',padding:40,color:'#9e9e9e'}}>
            <i className="bi-arrow-clockwise spin" style={{fontSize:24,display:'block',marginBottom:8}}/>
            <div style={{fontSize:13}}>Loading workbench tasks...</div>
          </div>
        ) : totalFiltered === 0 ? (
          <div style={{textAlign:'center',padding:40,color:'#9e9e9e'}}>
            <i className="bi-inbox" style={{fontSize:28,display:'block',marginBottom:8,opacity:.4}}/>
            <div style={{fontSize:13,fontWeight:500}}>No tasks match filters</div>
          </div>
        ) : activeTab === 'byType' ? (
          filteredByType.map(group => (
            <GroupSection key={group.taskType} groupKey={group.taskType}
              label={group.taskType} count={group.items.length}
              badge={group.escalatedCount > 0 ? `${group.escalatedCount} escalated` : null}
              badgeColor="#d42d35" badgeBg="#fef2f2"
              expanded={expandedGroups.has(group.taskType)||expandedGroups.has('_all')}
              onToggle={() => toggleGroup(group.taskType)}
              items={group.items}/>
          ))
        ) : activeTab === 'byCountry' ? (
          filteredByCountry.map(group => (
            <GroupSection key={group.country} groupKey={group.country}
              label={`${getFlag(group.country)} ${getCountryName(group.country)}`}
              count={group.items.length}
              expanded={expandedGroups.has(group.country)||expandedGroups.has('_all')}
              onToggle={() => toggleGroup(group.country)}
              items={group.items}/>
          ))
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:4}}>
            {filteredAll.map(t => <TaskCard key={t.id} task={t}/>)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Group Section ──
function GroupSection({ label, count, badge, badgeColor, badgeBg, expanded, onToggle, items }) {
  const regionId = `workbench-group-${String(label).replace(/\s+/g,'-').toLowerCase()}`;
  return (
    <div style={{marginBottom:8}}>
      <button onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={regionId}
        aria-label={`${label} — ${count} ${count === 1 ? 'item' : 'items'}${badge ? `, ${badge}` : ''}`}
        style={{display:'flex',alignItems:'center',gap:6,width:'100%',padding:'8px 10px',borderRadius:8,
          border:'1px solid #e8e8e8',background:'white',cursor:'pointer',textAlign:'left',transition:'all .12s'}}>
        <i className={expanded?'bi-chevron-down':'bi-chevron-right'} aria-hidden="true" style={{fontSize:10,color:'#9e9e9e',flexShrink:0}}/>
        <span style={{fontSize:13,fontWeight:600,color:'#1b1b1b',flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</span>
        {badge && <span style={{fontSize:10,fontWeight:600,color:badgeColor,background:badgeBg,padding:'1px 8px',borderRadius:128}}>{badge}</span>}
        <span style={{fontSize:11,color:'#9e9e9e',fontWeight:500,flexShrink:0}}>{count}</span>
      </button>
      {expanded && (
        <div id={regionId} role="region" aria-label={`${label} tasks`} style={{display:'flex',flexDirection:'column',gap:4,marginTop:4,paddingLeft:4}}>
          {items.map(t => <TaskCard key={t.id} task={t}/>)}
        </div>
      )}
    </div>
  );
}

// ── Task Card ──
function TaskCard({ task }) {
  const st = STATUS_CONFIG[task.status] || STATUS_CONFIG.TO_DO;
  const sla = SLA_CONFIG[task.slaBreachStatus] || null;
  const isUrgent = task.status === 'ESCALATED' || task.slaBreachStatus === 'SLA_BREACHED';
  const adminUrl = task.contractOid
    ? `https://admin.deel.network/contracts/${task.contractOid}/overview`
    : null;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:4,padding:'10px 12px',borderRadius:8,
      background:'white',border:`1px solid ${isUrgent?'#fca5a5':'#e8e8e8'}`,
      transition:'all .12s',cursor:'default'}}>
      {/* Row 1: Status + Title + SLA */}
      <div style={{display:'flex',alignItems:'flex-start',gap:6}}>
        <span style={{display:'inline-flex',alignItems:'center',gap:3,padding:'2px 8px',borderRadius:128,
          background:st.bg,color:st.color,fontSize:10,fontWeight:600,flexShrink:0,whiteSpace:'nowrap'}}>
          <i className={st.icon} style={{fontSize:8}}/> {st.label}
        </span>
        <span title={task.name||''} style={{flex:1,fontSize:12.5,fontWeight:500,color:'#1b1b1b',lineHeight:1.4,minWidth:0,
          overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>
          {task.name}
        </span>
        {sla && task.slaRemaining != null && (
          <span style={{display:'inline-flex',alignItems:'center',gap:3,padding:'2px 8px',borderRadius:128,
            background:sla.bg,color:sla.color,fontSize:10,fontWeight:600,flexShrink:0,whiteSpace:'nowrap'}}>
            <i className="bi-clock" style={{fontSize:8}}/> {slaDisplay(task.slaRemaining)}
          </span>
        )}
      </div>

      {/* Row 2: Meta info */}
      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
        {task.country && (
          <span style={{display:'flex',alignItems:'center',gap:3,fontSize:11,color:'#616161'}}>
            {getFlag(task.country)} {task.country}
          </span>
        )}
        <span style={{fontSize:11,color:'#9e9e9e',display:'flex',alignItems:'center',gap:3}}>
          <i className="bi-tag" style={{fontSize:9}}/> {task.taskType || 'Other'}
        </span>
        <span style={{fontSize:11,color:'#9e9e9e'}}>
          {timeAgo(task.createdAt)} ago
        </span>
        {task.assignee ? (
          <span style={{display:'flex',alignItems:'center',gap:3,fontSize:11,color:'#616161'}}>
            <Avatar name={task.assignee.name} size={14}/>
            {task.assignee.name.split(' ')[0]}
          </span>
        ) : (
          <span style={{fontSize:11,color:'#d42d35',fontWeight:500}}>Unassigned</span>
        )}
        {task.contractOid && adminUrl && (
          <a href={adminUrl} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}
            style={{fontSize:11,color:'#0369a1',textDecoration:'none',display:'flex',alignItems:'center',gap:2}}>
            <i className="bi-box-arrow-up-right" style={{fontSize:9}}/> {task.contractOid}
          </a>
        )}
        {task.highPriority > 0 && (
          <span style={{fontSize:10,fontWeight:600,color:'#d97706',background:'#fef3c7',padding:'1px 6px',borderRadius:128}}>
            P{task.highPriority > 10000 ? '!' : task.highPriority}
          </span>
        )}
      </div>

      {/* Row 3: Escalation reason if present */}
      {task.reasonForEscalation && (
        <div style={{fontSize:11,color:'#d42d35',background:'#fef2f2',padding:'4px 8px',borderRadius:6,marginTop:2}}>
          <i className="bi-exclamation-circle" style={{fontSize:9,marginRight:4}}/> {task.reasonForEscalation}
        </div>
      )}
    </div>
  );
}
