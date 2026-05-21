import { useState, useMemo } from 'react';
import { ALL_VIEWS, ALL_ACTIONS, ALL_ADMIN_POWERS, DATA_SCOPES, VIEW_LABELS, ACTION_LABELS, ADMIN_POWER_LABELS, DATA_SCOPE_LABELS } from '../../data/accessControl';
import { MEMBERS } from '../../data/members';
import { TITLES, REGIONS, TEAMS, DEPARTMENTS } from '../../data/orgConfig';
import { FLAGS } from '../../data/constants';
import { useTeamMembers } from '../../hooks/useTeamMembers';

// Map a Settings access-type pick to the canonical base role persisted in
// team_member_overrides.access. Custom IDs (at_hr_hub_admin, at_<custom>)
// are stackable grants on top of an agent baseline — they don't change the
// base role, so we default to 'agent' when no canonical mapping applies.
const ACCESS_TYPE_TO_ROLE = {
  at_admin: 'admin',
  at_regional_mgr: 'regional_manager',
  at_lead: 'team_lead',
  at_agent: 'agent',
};
const deriveBaseRole = (accessTypeId) => ACCESS_TYPE_TO_ROLE[accessTypeId] || 'agent';

const TABS=['Access Types','Access Type Editor','People Directory'];

// ── Styles ───────────────────────────────────────────────────────────────────
const card={background:'var(--surface)',border:'1px solid var(--border)',borderRadius:16,padding:24,marginBottom:16};
const btnPrimary={background:'#1b1b1b',color:'#fff',border:'none',borderRadius:12,padding:'8px 18px',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'};
const btnSecondary={background:'var(--surface)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:12,padding:'8px 18px',fontSize:13,fontWeight:500,cursor:'pointer',fontFamily:'inherit'};
const btnDanger={...btnSecondary,color:'#d32f2f',borderColor:'#f5c6c6'};
const btnSmall={...btnSecondary,padding:'5px 12px',fontSize:12};
const badge=(bg,color)=>({display:'inline-block',fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:8,background:bg,color,marginLeft:8});
const inputStyle={width:'100%',border:'1px solid var(--border)',borderRadius:12,padding:'8px 12px',fontSize:13,outline:'none',fontFamily:'inherit',color:'var(--text)',boxSizing:'border-box'};
const selectStyle={...inputStyle,cursor:'pointer',appearance:'auto'};
const sectionTitle={fontSize:14,fontWeight:600,color:'var(--text)',marginBottom:10,marginTop:20};
const checkboxGrid=(cols)=>({display:'grid',gridTemplateColumns:`repeat(${cols}, 1fr)`,gap:'8px 16px'});
const thStyle={textAlign:'left',padding:'10px 14px',fontSize:12,fontWeight:600,color:'#7a7059',borderBottom:'1px solid #e8e8e8'};
const tdStyle={padding:'10px 14px',verticalAlign:'middle'};
const labelStyle={fontSize:12,fontWeight:600,color:'var(--text)',display:'block',marginBottom:4};
const fieldRow={display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12};

const STATUS_COLORS={
  active:{bg:'#e8f5e3',color:'#29811e'},
  inactive:{bg:'#f5f5f5',color:'var(--text-muted)'},
  offboarding:{bg:'#fff3e0',color:'#ed8d00'},
};

const AccessControlSettings=({accessTypes,setAccessTypes,userAccessMap,setUserAccessMap,addToast,user})=>{
  const [activeTab,setActiveTab]=useState(0);
  const [editingType,setEditingType]=useState(null);
  const [searchTerm,setSearchTerm]=useState('');
  const [editingUser,setEditingUser]=useState(null); // email string or null
  const [addingUser,setAddingUser]=useState(false);
  const [newUser,setNewUser]=useState({email:'',name:'',accessTypeId:'at_agent',title:'',startDate:'',managerEmail:'',region:'',team:'',department:'HR Experience',country:'',status:'active'});
  const [dirFilter,setDirFilter]=useState({region:'all',team:'all',accessType:'all',status:'all'});
  const [dirSort,setDirSort]=useState('name');
  const [savingUser,setSavingUser]=useState(false);

  // ── Persistence bridge to /api/v1/team-members ──────────────────────────
  // Settings → Access Control historically only mutated the local
  // userAccessMap (browser localStorage). New users vanished from every
  // other surface (Team table, Home team summary, Queue scoping) because
  // those read the merged baseline + team_member_overrides roster from the
  // DB. Wire the user-CRUD operations through the same hook that the Team
  // tab uses so additions/edits/removals land in the DB and ripple to all
  // surfaces via roster hydration.
  const { addMember, updateMember, removeMember } = useTeamMembers();

  // --- helpers ---
  const userCountByType=useMemo(()=>{
    const counts={};
    accessTypes.forEach(t=>{counts[t.id]=0;});
    Object.values(userAccessMap).forEach(v=>{counts[v.accessTypeId]=(counts[v.accessTypeId]||0)+1;});
    return counts;
  },[accessTypes,userAccessMap]);

  const currentUserAccessTypeId=useMemo(()=>{
    if(!user?.email||!userAccessMap[user.email])return null;
    return userAccessMap[user.email].accessTypeId;
  },[user,userAccessMap]);

  const allEmails=useMemo(()=>Object.keys(userAccessMap),[userAccessMap]);
  const managerOptions=useMemo(()=>allEmails.filter(e=>{
    const u=userAccessMap[e];
    return u && ['at_admin','at_regional_mgr','at_lead'].includes(u.accessTypeId);
  }).map(e=>({email:e,name:userAccessMap[e]?.name||e})),[allEmails,userAccessMap]);

  // Access type CRUD
  const startCreate=()=>{
    setEditingType({id:null,name:'',description:'',views:[],actions:[],adminPowers:[],dataScope:'own_tasks_only',isDefault:false});
    setActiveTab(1);
  };
  const startEdit=(t)=>{
    setEditingType({...t,views:[...t.views],actions:[...t.actions],adminPowers:[...t.adminPowers]});
    setActiveTab(1);
  };
  const cancelEdit=()=>{setEditingType(null);setActiveTab(0);};

  const saveType=()=>{
    if(!editingType.name.trim()){addToast('error','Error','Name is required');return;}
    if(editingType.id&&editingType.id===currentUserAccessTypeId&&!editingType.adminPowers.includes('can_manage_access_control')){
      addToast('error','Error','Cannot remove "Manage Access Control" from your own access type');
      return;
    }
    if(editingType.id){
      setAccessTypes(prev=>prev.map(t=>t.id===editingType.id?{...editingType}:t));
      addToast('success','Saved','Access type updated');
    }else{
      const newType={...editingType,id:`at_${Date.now()}`};
      setAccessTypes(prev=>[...prev,newType]);
      addToast('success','Created','Access type created');
    }
    setEditingType(null);
    setActiveTab(0);
  };

  const deleteType=(t)=>{
    if(t.isDefault)return;
    const assignedCount=userCountByType[t.id]||0;
    const msg=assignedCount>0
      ?`Delete "${t.name}"? ${assignedCount} user(s) will be reassigned to Agent.`
      :`Delete "${t.name}"?`;
    if(!window.confirm(msg))return;
    if(assignedCount>0){
      setUserAccessMap(prev=>{
        const next={...prev};
        Object.keys(next).forEach(email=>{if(next[email].accessTypeId===t.id)next[email]={...next[email],accessTypeId:'at_agent'};});
        return next;
      });
    }
    setAccessTypes(prev=>prev.filter(x=>x.id!==t.id));
    addToast('success','Deleted',`"${t.name}" deleted`);
  };

  // User CRUD — every mutation persists to team_member_overrides so the
  // change shows up in Team table, Home summary, Queue scoping, etc.
  const saveNewUser=async()=>{
    const email=newUser.email.trim().toLowerCase();
    if(!email||!email.includes('@')){addToast('error','Error','Enter a valid email');return;}
    if(!email.endsWith('@deel.com')){addToast('error','Error','Email must be a valid @deel.com address');return;}
    if(!newUser.name.trim()){addToast('error','Error','Name is required');return;}
    if(userAccessMap[email]){addToast('error','Error','This email already exists');return;}
    setSavingUser(true);
    const result=await addMember({
      email,
      name:newUser.name.trim(),
      access:deriveBaseRole(newUser.accessTypeId),
      title:newUser.title||'HR Experience Specialist',
      managerEmail:newUser.managerEmail||null,
      team:newUser.team||null,
      region:newUser.region||newUser.team||null,
      country:newUser.country||null,
      service:'EOR',
    });
    setSavingUser(false);
    if(!result.ok){addToast('error','Failed to add user',result.error||'Please try again.');return;}
    const initials=newUser.name.trim().split(' ').map(p=>p.charAt(0).toUpperCase()).slice(0,2).join('');
    setUserAccessMap(prev=>({...prev,[email]:{...newUser,email:undefined,initials}}));
    addToast('success','User Added',`${newUser.name} added to the directory`);
    setNewUser({email:'',name:'',accessTypeId:'at_agent',title:'',startDate:'',managerEmail:'',region:'',team:'',department:'HR Experience',country:'',status:'active'});
    setAddingUser(false);
  };

  const saveEditUser=async(email)=>{
    const existing=userAccessMap[email];
    if(!existing)return;
    setSavingUser(true);
    // Persist allocation edits to team_member_overrides. Per-field optimistic
    // updates already touched userAccessMap via updateUserField; this PATCH
    // makes them durable. Custom (non-canonical) accessTypeIds keep living
    // in localStorage userAccessMap — only the base role lands in the DB.
    const result=await updateMember(email,{
      name:existing.name,
      title:existing.title,
      access:deriveBaseRole(existing.accessTypeId),
      managerEmail:existing.managerEmail||null,
      team:existing.team||null,
      region:existing.region||existing.team||null,
      country:existing.country||null,
    });
    setSavingUser(false);
    if(!result.ok){addToast('error','Failed to save',result.error||'Please try again.');return;}
    setUserAccessMap(prev=>({...prev,[email]:{...existing}}));
    addToast('success','Updated',`${existing.name||email} updated`);
    setEditingUser(null);
  };

  const updateUserField=(email,field,value)=>{
    setUserAccessMap(prev=>({...prev,[email]:{...prev[email],[field]:value}}));
  };

  const removeUser=async(email)=>{
    if(email===user?.email){addToast('error','Error','Cannot remove your own account');return;}
    const name=userAccessMap[email]?.name||email;
    if(!window.confirm(`Remove ${name} from the directory?`))return;
    setSavingUser(true);
    const result=await removeMember(email);
    setSavingUser(false);
    if(!result.ok){addToast('error','Failed to remove',result.error||'Please try again.');return;}
    setUserAccessMap(prev=>{const next={...prev};delete next[email];return next;});
    addToast('success','Removed',`${name} removed`);
  };

  // Filtered + sorted people list
  const peopleList=useMemo(()=>{
    let list=Object.entries(userAccessMap).map(([email,data])=>({email,...data}));
    if(dirFilter.region!=='all') list=list.filter(u=>u.region===dirFilter.region);
    if(dirFilter.team!=='all') list=list.filter(u=>u.team===dirFilter.team);
    if(dirFilter.accessType!=='all') list=list.filter(u=>u.accessTypeId===dirFilter.accessType);
    if(dirFilter.status!=='all') list=list.filter(u=>(u.status||'active')===dirFilter.status);
    if(searchTerm.trim()){
      const q=searchTerm.toLowerCase();
      list=list.filter(u=>(u.name||'').toLowerCase().includes(q)||u.email.toLowerCase().includes(q)||(u.title||'').toLowerCase().includes(q));
    }
    list.sort((a,b)=>{
      if(dirSort==='name') return (a.name||a.email).localeCompare(b.name||b.email);
      if(dirSort==='title') return (a.title||'').localeCompare(b.title||'');
      if(dirSort==='startDate') return (a.startDate||'').localeCompare(b.startDate||'');
      if(dirSort==='region') return (a.region||'').localeCompare(b.region||'');
      if(dirSort==='team') return (a.team||'').localeCompare(b.team||'');
      return 0;
    });
    return list;
  },[userAccessMap,dirFilter,searchTerm,dirSort]);

  // checkbox helpers for editor
  const toggleList=(list,item)=>list.includes(item)?list.filter(x=>x!==item):[...list,item];
  const edSet=(field,val)=>setEditingType(prev=>({...prev,[field]:val}));

  // ===================== TAB 0: ACCESS TYPES LIST =====================
  const AccessTypesList=()=>(
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{fontSize:13,color:'var(--text-muted)'}}>{accessTypes.length} access type{accessTypes.length!==1?'s':''}</div>
        <button style={btnPrimary} onClick={startCreate}><i className="bi-plus" style={{marginRight:4}}/>Create Access Type</button>
      </div>
      {accessTypes.map(t=>{
        const count=userCountByType[t.id]||0;
        return(
          <div key={t.id} style={{...card,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:15,fontWeight:600,color:'var(--text)'}}>{t.name}</span>
                {t.isDefault&&<span style={badge('#f0ede8','#7a7059')}>Built-in</span>}
              </div>
              {t.description&&<div style={{fontSize:12,color:'var(--text-muted)',marginTop:3}}>{t.description}</div>}
              <div style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>{count} user{count!==1?'s':''} assigned &middot; {t.views.length} views &middot; {t.actions.length} actions &middot; {DATA_SCOPE_LABELS[t.dataScope]}</div>
            </div>
            <div style={{display:'flex',gap:8,flexShrink:0}}>
              <button style={btnSecondary} onClick={()=>startEdit(t)}>Edit</button>
              {t.isDefault
                ?<button style={{...btnSecondary,opacity:0.4,cursor:'not-allowed'}} disabled title="Built-in types cannot be deleted">Delete</button>
                :<button style={btnDanger} onClick={()=>deleteType(t)}>Delete</button>}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ===================== TAB 1: EDITOR =====================
  const AccessTypeEditor=()=>{
    if(!editingType) return <div style={{...card,textAlign:'center',color:'var(--text-muted)',fontSize:13,padding:40}}>Select an access type to edit, or create a new one.</div>;
    const isCreate=!editingType.id;
    return(
      <div style={card}>
        <div style={{fontSize:16,fontWeight:700,color:'var(--text)',marginBottom:16}}>{isCreate?'Create Access Type':'Edit Access Type'}</div>
        <div style={fieldRow}>
          <div>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} value={editingType.name} onChange={e=>edSet('name',e.target.value)} placeholder="e.g. Senior Agent"/>
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <input style={inputStyle} value={editingType.description||''} onChange={e=>edSet('description',e.target.value)} placeholder="Brief description"/>
          </div>
        </div>

        <div style={sectionTitle}>Views ({editingType.views.length}/{ALL_VIEWS.length})</div>
        <div style={checkboxGrid(4)}>
          {ALL_VIEWS.map(v=>(
            <label key={v} style={{display:'flex',alignItems:'center',gap:6,fontSize:13,color:'var(--text)',cursor:'pointer'}}>
              <input type="checkbox" checked={editingType.views.includes(v)} onChange={()=>edSet('views',toggleList(editingType.views,v))}/>
              {VIEW_LABELS[v]}
            </label>
          ))}
        </div>
        <div style={{marginTop:6,display:'flex',gap:8}}>
          <button style={{...btnSmall,fontSize:11}} onClick={()=>edSet('views',[...ALL_VIEWS])}>Select All</button>
          <button style={{...btnSmall,fontSize:11}} onClick={()=>edSet('views',[])}>Clear All</button>
        </div>

        <div style={sectionTitle}>Actions ({editingType.actions.length}/{ALL_ACTIONS.length})</div>
        <div style={checkboxGrid(3)}>
          {ALL_ACTIONS.map(a=>(
            <label key={a} style={{display:'flex',alignItems:'center',gap:6,fontSize:13,color:'var(--text)',cursor:'pointer'}}>
              <input type="checkbox" checked={editingType.actions.includes(a)} onChange={()=>edSet('actions',toggleList(editingType.actions,a))}/>
              {ACTION_LABELS[a]}
            </label>
          ))}
        </div>
        <div style={{marginTop:6,display:'flex',gap:8}}>
          <button style={{...btnSmall,fontSize:11}} onClick={()=>edSet('actions',[...ALL_ACTIONS])}>Select All</button>
          <button style={{...btnSmall,fontSize:11}} onClick={()=>edSet('actions',[])}>Clear All</button>
        </div>

        <div style={sectionTitle}>Data Scope</div>
        <div style={{display:'flex',gap:20}}>
          {DATA_SCOPES.map(ds=>(
            <label key={ds} style={{display:'flex',alignItems:'center',gap:6,fontSize:13,color:'var(--text)',cursor:'pointer'}}>
              <input type="radio" name="dataScope" checked={editingType.dataScope===ds} onChange={()=>edSet('dataScope',ds)}/>
              {DATA_SCOPE_LABELS[ds]}
            </label>
          ))}
        </div>

        <div style={sectionTitle}>Admin Powers</div>
        <div style={{background:'#fff8e1',border:'1px solid #ffe082',borderRadius:12,padding:'10px 14px',fontSize:12,color:'#8d6e00',marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
          <i className="bi-exclamation-triangle-fill"/>Admin powers grant access to sensitive system configuration
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:20}}>
          {ALL_ADMIN_POWERS.map(ap=>{
            const isLockout=editingType.id===currentUserAccessTypeId&&ap==='can_manage_access_control';
            return(
              <label key={ap} style={{display:'flex',alignItems:'center',gap:6,fontSize:13,color:isLockout?'#9e9e9e':'#1b1b1b',cursor:isLockout?'not-allowed':'pointer'}}>
                <input type="checkbox" checked={editingType.adminPowers.includes(ap)} disabled={isLockout} onChange={()=>edSet('adminPowers',toggleList(editingType.adminPowers,ap))}/>
                {ADMIN_POWER_LABELS[ap]}
                {isLockout&&<span style={{fontSize:11,color:'#d32f2f',marginLeft:2}}>(required)</span>}
              </label>
            );
          })}
        </div>

        <div style={{display:'flex',gap:10,marginTop:28}}>
          <button style={btnPrimary} onClick={saveType}>{isCreate?'Create':'Save Changes'}</button>
          <button style={btnSecondary} onClick={cancelEdit}>Cancel</button>
        </div>
      </div>
    );
  };

  // ===================== TAB 2: PEOPLE DIRECTORY =====================
  const PeopleDirectory=()=>{
    const summary=accessTypes.map(t=>({name:t.name,count:userCountByType[t.id]||0})).filter(x=>x.count>0);
    const totalPeople=Object.keys(userAccessMap).length;
    const activeCount=Object.values(userAccessMap).filter(u=>(u.status||'active')==='active').length;

    return(
      <div>
        {/* Summary stats */}
        <div style={{display:'flex',gap:16,marginBottom:16,flexWrap:'wrap'}}>
          <div style={{...card,padding:'14px 20px',marginBottom:0,flex:'1 1 120px',minWidth:120,textAlign:'center'}}>
            <div style={{fontSize:24,fontWeight:700,color:'var(--text)'}}>{totalPeople}</div>
            <div style={{fontSize:11,color:'var(--text-muted)',fontWeight:500}}>Total People</div>
          </div>
          <div style={{...card,padding:'14px 20px',marginBottom:0,flex:'1 1 120px',minWidth:120,textAlign:'center'}}>
            <div style={{fontSize:24,fontWeight:700,color:'#29811e'}}>{activeCount}</div>
            <div style={{fontSize:11,color:'var(--text-muted)',fontWeight:500}}>Active</div>
          </div>
          {summary.map(s=>(
            <div key={s.name} style={{...card,padding:'14px 20px',marginBottom:0,flex:'1 1 120px',minWidth:120,textAlign:'center'}}>
              <div style={{fontSize:24,fontWeight:700,color:'var(--text)'}}>{s.count}</div>
              <div style={{fontSize:11,color:'var(--text-muted)',fontWeight:500}}>{s.name}{s.count!==1?'s':''}</div>
            </div>
          ))}
        </div>

        {/* Filters + Search + Add */}
        <div style={{display:'flex',gap:10,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
          <div style={{position:'relative',flex:'1 1 200px'}}>
            <i className="bi-search" style={{position:'absolute',left:12,top:10,fontSize:13,color:'var(--text-muted)'}}/>
            <input style={{...inputStyle,paddingLeft:34}} placeholder="Search by name, email, or title..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}/>
          </div>
          <select style={{...selectStyle,width:130}} value={dirFilter.region} onChange={e=>setDirFilter(p=>({...p,region:e.target.value}))}>
            <option value="all">All Regions</option>
            {REGIONS.map(r=><option key={r} value={r}>{r}</option>)}
          </select>
          <select style={{...selectStyle,width:140}} value={dirFilter.team} onChange={e=>setDirFilter(p=>({...p,team:e.target.value}))}>
            <option value="all">All Teams</option>
            {TEAMS.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
          <select style={{...selectStyle,width:150}} value={dirFilter.accessType} onChange={e=>setDirFilter(p=>({...p,accessType:e.target.value}))}>
            <option value="all">All Roles</option>
            {accessTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select style={{...selectStyle,width:120}} value={dirFilter.status} onChange={e=>setDirFilter(p=>({...p,status:e.target.value}))}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="offboarding">Offboarding</option>
          </select>
          <button style={btnPrimary} onClick={()=>setAddingUser(true)}><i className="bi-person-plus" style={{marginRight:4}}/>Add Person</button>
        </div>

        {/* Add User Form */}
        {addingUser&&(
          <div style={{...card,border:'2px solid #c4b1f9',padding:20}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>Add New Person</div>
              <button style={{...btnSmall,padding:'4px 10px'}} onClick={()=>setAddingUser(false)}><i className="bi-x-lg"/></button>
            </div>
            <div style={fieldRow}>
              <div><label style={labelStyle}>Full Name *</label><input style={inputStyle} value={newUser.name} onChange={e=>setNewUser(p=>({...p,name:e.target.value}))} placeholder="John Doe"/></div>
              <div><label style={labelStyle}>Email *</label><input style={inputStyle} value={newUser.email} onChange={e=>setNewUser(p=>({...p,email:e.target.value}))} placeholder="john.doe@deel.com"/></div>
            </div>
            <div style={fieldRow}>
              <div><label style={labelStyle}>Title</label>
                <select style={selectStyle} value={newUser.title} onChange={e=>setNewUser(p=>({...p,title:e.target.value}))}>
                  <option value="">Select title...</option>
                  {TITLES.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><label style={labelStyle}>Access Type</label>
                <select style={selectStyle} value={newUser.accessTypeId} onChange={e=>setNewUser(p=>({...p,accessTypeId:e.target.value}))}>
                  {accessTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            <div style={fieldRow}>
              <div><label style={labelStyle}>Start Date</label><input type="date" style={inputStyle} value={newUser.startDate} onChange={e=>setNewUser(p=>({...p,startDate:e.target.value}))}/></div>
              <div><label style={labelStyle}>Manager</label>
                <select style={selectStyle} value={newUser.managerEmail} onChange={e=>setNewUser(p=>({...p,managerEmail:e.target.value}))}>
                  <option value="">No manager</option>
                  {managerOptions.map(m=><option key={m.email} value={m.email}>{m.name}</option>)}
                </select>
              </div>
            </div>
            <div style={fieldRow}>
              <div><label style={labelStyle}>Region</label>
                <select style={selectStyle} value={newUser.region} onChange={e=>setNewUser(p=>({...p,region:e.target.value}))}>
                  <option value="">Select region...</option>
                  {REGIONS.map(r=><option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div><label style={labelStyle}>Team</label>
                <select style={selectStyle} value={newUser.team} onChange={e=>setNewUser(p=>({...p,team:e.target.value}))}>
                  <option value="">Select team...</option>
                  {TEAMS.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div style={fieldRow}>
              <div><label style={labelStyle}>Department</label>
                <select style={selectStyle} value={newUser.department} onChange={e=>setNewUser(p=>({...p,department:e.target.value}))}>
                  {DEPARTMENTS.map(d=><option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div><label style={labelStyle}>Country Code</label><input style={inputStyle} value={newUser.country} onChange={e=>setNewUser(p=>({...p,country:e.target.value.toUpperCase()}))} placeholder="e.g. UK, US, DE" maxLength={3}/></div>
            </div>
            <div style={{display:'flex',gap:10,marginTop:8}}>
              <button style={{...btnPrimary,opacity:savingUser?0.6:1,cursor:savingUser?'wait':'pointer'}} onClick={saveNewUser} disabled={savingUser}>{savingUser?'Adding…':'Add Person'}</button>
              <button style={btnSecondary} onClick={()=>setAddingUser(false)} disabled={savingUser}>Cancel</button>
            </div>
          </div>
        )}

        {/* Sort */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div style={{fontSize:12,color:'var(--text-muted)'}}>{peopleList.length} of {totalPeople} people</div>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{fontSize:12,color:'var(--text-muted)'}}>Sort by</span>
            <select style={{...selectStyle,width:110,padding:'4px 8px',fontSize:12}} value={dirSort} onChange={e=>setDirSort(e.target.value)}>
              <option value="name">Name</option>
              <option value="title">Title</option>
              <option value="startDate">Start Date</option>
              <option value="region">Region</option>
              <option value="team">Team</option>
            </select>
          </div>
        </div>

        {/* People table */}
        <div style={{...card,padding:0,overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{background:'var(--surface-3)'}}>
                <th style={thStyle}>Person</th>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Manager</th>
                <th style={thStyle}>Region</th>
                <th style={thStyle}>Team</th>
                <th style={thStyle}>Start Date</th>
                <th style={{...thStyle,width:120}}>Access Type</th>
                <th style={{...thStyle,width:100}}>Status</th>
                <th style={{...thStyle,width:80}}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {peopleList.map(u=>{
                const atId=u.accessTypeId||'at_agent';
                const isEditing=editingUser===u.email;
                const mgrName=u.managerEmail?userAccessMap[u.managerEmail]?.name||u.managerEmail:'—';
                const statusColors=STATUS_COLORS[u.status||'active']||STATUS_COLORS.active;
                const flag=FLAGS?.[u.country]||'';
                const initials=(u.name||u.email).split(/[\s.@]/).filter(Boolean).map(p=>p.charAt(0).toUpperCase()).slice(0,2).join('');

                if(isEditing) return(
                  <tr key={u.email} style={{borderBottom:'1px solid #f0ede8',background:'#faf8f5'}}>
                    <td style={tdStyle} colSpan={9}>
                      <div style={{padding:8}}>
                        <div style={{fontSize:14,fontWeight:600,color:'var(--text)',marginBottom:12}}>Editing: {u.name||u.email}</div>
                        <div style={fieldRow}>
                          <div><label style={labelStyle}>Name</label><input style={inputStyle} value={u.name||''} onChange={e=>updateUserField(u.email,'name',e.target.value)}/></div>
                          <div><label style={labelStyle}>Email</label><input style={inputStyle} value={u.email} disabled/></div>
                        </div>
                        <div style={fieldRow}>
                          <div><label style={labelStyle}>Title</label>
                            <select style={selectStyle} value={u.title||''} onChange={e=>updateUserField(u.email,'title',e.target.value)}>
                              <option value="">Select title...</option>
                              {TITLES.map(t=><option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div><label style={labelStyle}>Access Type</label>
                            <select style={selectStyle} value={atId} onChange={e=>updateUserField(u.email,'accessTypeId',e.target.value)}>
                              {accessTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </div>
                        </div>
                        <div style={fieldRow}>
                          <div><label style={labelStyle}>Start Date</label><input type="date" style={inputStyle} value={u.startDate||''} onChange={e=>updateUserField(u.email,'startDate',e.target.value)}/></div>
                          <div><label style={labelStyle}>Manager</label>
                            <select style={selectStyle} value={u.managerEmail||''} onChange={e=>updateUserField(u.email,'managerEmail',e.target.value)}>
                              <option value="">No manager</option>
                              {managerOptions.filter(m=>m.email!==u.email).map(m=><option key={m.email} value={m.email}>{m.name}</option>)}
                            </select>
                          </div>
                        </div>
                        <div style={fieldRow}>
                          <div><label style={labelStyle}>Region</label>
                            <select style={selectStyle} value={u.region||''} onChange={e=>updateUserField(u.email,'region',e.target.value)}>
                              <option value="">Select...</option>
                              {REGIONS.map(r=><option key={r} value={r}>{r}</option>)}
                            </select>
                          </div>
                          <div><label style={labelStyle}>Team</label>
                            <select style={selectStyle} value={u.team||''} onChange={e=>updateUserField(u.email,'team',e.target.value)}>
                              <option value="">Select...</option>
                              {TEAMS.map(t=><option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                        </div>
                        <div style={fieldRow}>
                          <div><label style={labelStyle}>Department</label>
                            <select style={selectStyle} value={u.department||''} onChange={e=>updateUserField(u.email,'department',e.target.value)}>
                              {DEPARTMENTS.map(d=><option key={d} value={d}>{d}</option>)}
                            </select>
                          </div>
                          <div><label style={labelStyle}>Status</label>
                            <select style={selectStyle} value={u.status||'active'} onChange={e=>updateUserField(u.email,'status',e.target.value)}>
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                              <option value="offboarding">Offboarding</option>
                            </select>
                          </div>
                        </div>
                        <div style={fieldRow}>
                          <div><label style={labelStyle}>Country Code</label><input style={inputStyle} value={u.country||''} onChange={e=>updateUserField(u.email,'country',e.target.value.toUpperCase())} maxLength={3}/></div>
                          <div/>
                        </div>
                        <div style={{display:'flex',gap:10,marginTop:8}}>
                          <button style={{...btnPrimary,opacity:savingUser?0.6:1,cursor:savingUser?'wait':'pointer'}} onClick={()=>saveEditUser(u.email)} disabled={savingUser}>{savingUser?'Saving…':'Done'}</button>
                          <button style={btnSecondary} onClick={()=>setEditingUser(null)} disabled={savingUser}>Cancel</button>
                          {u.email!==user?.email&&<button style={{...btnDanger,opacity:savingUser?0.6:1,cursor:savingUser?'wait':'pointer'}} onClick={()=>{removeUser(u.email);setEditingUser(null);}} disabled={savingUser}>Remove</button>}
                        </div>
                      </div>
                    </td>
                  </tr>
                );

                return(
                  <tr key={u.email} style={{borderBottom:'1px solid #f0ede8'}}>
                    <td style={tdStyle}>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        <div style={{width:32,height:32,borderRadius:'50%',background:'#f0ede8',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#7a7059',flexShrink:0}}>{initials}</div>
                        <div>
                          <div style={{fontWeight:600,color:'var(--text)',fontSize:13}}>{flag} {u.name||u.email}</div>
                          <div style={{fontSize:11,color:'var(--text-muted)'}}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{...tdStyle,fontSize:12,color:'var(--text-secondary)'}}>{u.title||'—'}</td>
                    <td style={{...tdStyle,fontSize:12,color:'var(--text-secondary)'}}>{mgrName}</td>
                    <td style={{...tdStyle,fontSize:12,color:'var(--text-secondary)'}}>{u.region||'—'}</td>
                    <td style={{...tdStyle,fontSize:12,color:'var(--text-secondary)'}}>{u.team||'—'}</td>
                    <td style={{...tdStyle,fontSize:12,color:'var(--text-secondary)'}}>{u.startDate||'—'}</td>
                    <td style={tdStyle}>
                      <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:8,background:'#f0ede8',color:'#7a7059'}}>
                        {accessTypes.find(t=>t.id===atId)?.name||'Agent'}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:8,background:statusColors.bg,color:statusColors.color,textTransform:'capitalize'}}>
                        {u.status||'active'}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <button style={{...btnSmall,padding:'4px 10px',fontSize:11}} onClick={()=>setEditingUser(u.email)}>
                        <i className="bi-pencil" style={{marginRight:3}}/>Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
              {peopleList.length===0&&(
                <tr><td colSpan={9} style={{...tdStyle,textAlign:'center',color:'var(--text-muted)',padding:40}}>No people found matching your filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return(
    <div>
      {/* Tabs */}
      <div style={{display:'flex',gap:0,borderBottom:'2px solid #e8e8e8',marginBottom:20}}>
        {TABS.map((t,i)=>{
          if(i===1&&!editingType)return null;
          const active=activeTab===i;
          return(
            <button key={t} onClick={()=>setActiveTab(i)} style={{background:'none',border:'none',borderBottom:active?'2px solid #1b1b1b':'2px solid transparent',padding:'10px 20px',fontSize:13,fontWeight:active?600:500,color:active?'#1b1b1b':'#9e9e9e',cursor:'pointer',fontFamily:'inherit',marginBottom:-2,transition:'all .15s'}}>
              {t}
            </button>
          );
        })}
      </div>

      {activeTab===0&&AccessTypesList()}
      {activeTab===1&&AccessTypeEditor()}
      {activeTab===2&&PeopleDirectory()}
    </div>
  );
};

export default AccessControlSettings;
