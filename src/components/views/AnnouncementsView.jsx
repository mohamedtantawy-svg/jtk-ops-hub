import { useState, useContext, useMemo, useCallback, useEffect, useRef } from 'react';
import { PermissionsContext, SettingsContext } from '../../App';
import { COMMS_TYPES, matchesAudience } from '../../data/comms';
import { MEMBERS } from '../../data/members';
import { scopeAckMembers } from '../../utils/permissions';
import Avatar from '../ui/Avatar';
import EmptyState from '../ui/EmptyState';
import ComposeModal from '../modals/ComposeModal';
import AnnouncementPopup from '../modals/AnnouncementPopup';
import { isApprover } from '../../data/approvers';
import { createRequest as apiCreateRequest } from '../../services/announcementRequestsApi';
import { useAnnouncementRequests } from '../../hooks/useAnnouncementRequests';
import ApprovalQueueView from './ApprovalQueueView';

/*
  Announcements — clean table view.
  Pending items get a "Start Acknowledging" button that walks through each
  unacknowledged announcement as a popup, one by one.
*/
const AnnouncementsView = ({ user, serverUserId, serverUserEmail, comms, setComms, addToast, tasks, apiAcknowledge, apiCreate, apiSend, apiUpdate, apiArchive, apiRemove, apiTogglePin, openCompose, onComposeOpened, apiUnarchive, apiComments, apiSetComments, apiLoadComments, apiAddComment, apiDeleteComment, apiLinks, apiLoadLinks, apiLinkAnnouncement, apiUnlinkAnnouncement, apiReact }) => {
  const perms = useContext(PermissionsContext);
  const settings = useContext(SettingsContext);
  const isLA = perms?.canDo('can_compose_comms')||perms?.canDo('can_compose_announcements')||isApprover(user?.email)||false;
  const canPin = perms?.canDo('can_pin_announcement')||false;
  // Approvers and admin-role users can send direct; everyone else submits a request.
  const canComposeRequest = true; // any authenticated user can ASK
  const isApproverUser = isApprover(user?.email);

  // ── State ──
  const [filter,setFilter]=useState('all');
  const [showCompose,setShowCompose]=useState(false);
  const [editDraft,setEditDraft]=useState(null);

  // ── Announcement requests (for the "Pending Approval" tab + badge) ─────
  // Backend auto-scopes: approvers see the whole queue, requesters see only
  // their own submissions. We just count pending+needs_info for the tab badge.
  const { items: pendingApprovalItems } = useAnnouncementRequests();
  const pendingApprovalCount = useMemo(() => (
    Array.isArray(pendingApprovalItems)
      ? pendingApprovalItems.filter(r => r?.status === 'pending' || r?.status === 'needs_info').length
      : 0
  ), [pendingApprovalItems]);

  // Auto-open compose when triggered from top nav (any user — non-approvers
  // get routed through the approval queue on submit)
  useEffect(()=>{
    if(openCompose&&canComposeRequest){ setShowCompose(true); onComposeOpened?.(); }
  },[openCompose]); // eslint-disable-line react-hooks/exhaustive-deps
  const [reminderSent,setReminderSent]=useState({});
  const [expandedAck,setExpandedAck]=useState(null); // which row has ack tracker open
  const [walkthrough,setWalkthrough]=useState(false); // popup walkthrough mode
  const [walkthroughDismissed,setWalkthroughDismissed]=useState([]); // dismissed during this walkthrough
  const [detailId,setDetailId]=useState(null); // single item detail popup

  const enabledTypes=settings.comms_types_enabled||{alert:true,announce:true,update:true,guidance:true,kudos:true};

  // Audience match uses the canonical matcher so NAM/LATAM/AMERICAS and
  // LATAM+NAM dual-region members all resolve correctly.
  const targetMatch=(c)=>{
    if(Array.isArray(c.target)&&c.target.includes(user.id))return true;
    return matchesAudience(c.target, user.team);
  };
  const canSee=(c)=>{
    if(c.author&&c.author.id===user.id)return true;
    if(isLA)return true;
    return targetMatch(c);
  };

  // "Scheduled" tab — visible to approvers (who can manage anyone's) and to
  // requesters who have scheduled items of their own. Uses the author match
  // so a non-approver still sees their own pending-to-go-out announcements.
  const canSeeScheduled = (c) => {
    if (c.status !== 'scheduled') return false;
    if (isApproverUser || isLA) return true;
    return c.author && (c.author.id === user.id || c.author.id === serverUserId);
  };

  const visible=useMemo(()=>comms.filter(c=>{
    if(filter==='drafts')return c.status==='draft'&&isLA;
    if(filter==='archived')return c.status==='archived'&&isLA;
    if(filter==='scheduled')return canSeeScheduled(c);
    if(filter!=='all')return c.type===filter&&c.status==='sent'&&canSee(c);
    return c.status==='sent'&&canSee(c);
  }),[comms,filter,isLA,user,serverUserId,isApproverUser]); // eslint-disable-line react-hooks/exhaustive-deps

  const uid=Number(user.id);
  // Ack check (three-axis, email-preferred) — mirrors App.jsx. We match on
  // email FIRST because the static MEMBERS array uses array-position ids that
  // can drift from the DB's members.id. Email is stable across re-seeds.
  const serverUid = serverUserId ? Number(serverUserId) : null;
  const myEmailLc = (user.email || '').toLowerCase() || null;
  const serverEmailLc = serverUserEmail ? String(serverUserEmail).toLowerCase() : null;
  const isAckedByMe = (c) => {
    if (Array.isArray(c.ackEmails)) {
      if (myEmailLc && c.ackEmails.includes(myEmailLc)) return true;
      if (serverEmailLc && c.ackEmails.includes(serverEmailLc)) return true;
    }
    if (Array.isArray(c.acks)) {
      if (uid && c.acks.includes(uid)) return true;
      if (serverUid && c.acks.includes(serverUid)) return true;
    }
    return false;
  };
  const pendingForMe=useMemo(()=>comms.filter(c=>c.status==='sent'&&targetMatch(c)&&!isAckedByMe(c)&&!(c.author&&c.author.id===user.id)),[comms,user,uid,serverUid,myEmailLc,serverEmailLc]); // eslint-disable-line react-hooks/exhaustive-deps

  const acknowledge=(id)=>{
    // Always pass both axes to the API — the hook uses email first in its
    // optimistic update so the popup/tracker state flips immediately.
    if(apiAcknowledge) apiAcknowledge(id, uid, user.email);
    else setComms(prev=>prev.map(c=>{
      if (c.id !== id) return c;
      const nextAcks = uid && !c.acks.includes(uid) ? [...c.acks, uid] : c.acks;
      const existingEmails = Array.isArray(c.ackEmails) ? c.ackEmails : [];
      const nextEmails = myEmailLc && !existingEmails.includes(myEmailLc)
        ? [...existingEmails, myEmailLc]
        : existingEmails;
      return { ...c, acks: nextAcks, ackEmails: nextEmails };
    }));
  };
  const acknowledgeAll=()=>{
    pendingForMe.forEach(c=>acknowledge(c.id));
  };

  const archiveComm=(id)=>{
    if(!isLA)return;
    if(apiArchive) apiArchive(id);
    else setComms(prev=>prev.map(c=>c.id===id?{...c,status:'archived'}:c));
    if(addToast)addToast('info','Archived','Communication archived');
  };

  const unarchiveComm=(id)=>{
    if(!isLA)return;
    if(apiUnarchive) apiUnarchive(id);
    else setComms(prev=>prev.map(c=>c.id===id?{...c,status:'sent'}:c));
    if(addToast)addToast('info','Unarchived','Communication restored to sent');
  };

  const togglePin=(id)=>{
    if(!canPin)return;
    if(apiTogglePin) apiTogglePin(id);
    else setComms(prev=>prev.map(c=>c.id===id?{...c,isPinned:!c.isPinned}:c));
  };

  const sendReminder=(comm)=>{
    if(!perms?.canDo('can_send_reminder'))return;
    setReminderSent(prev=>({...prev,[comm.id]:true}));
    setTimeout(()=>setReminderSent(prev=>({...prev,[comm.id]:false})),3000);
    if(addToast) addToast('info','Reminder Sent',`Nudge sent for: ${comm.title.slice(0,40)}`);
  };

  const handleSend=async (payload)=>{
    const {type,title,body,target,priority,status,isPopup,imageUrl,link,soundKey,scheduledFor,urgentOverride} = payload;
    const now=new Date().toISOString().slice(0,10);
    const draft={type,title,body,target,priority,isPopup:isPopup||false,imageUrl:imageUrl||'',link:link||'',soundKey:soundKey||'chime',scheduledFor:scheduledFor||null,urgentOverride:urgentOverride||false,author:{id:user.id,name:user.name}};
    try {
      if(editDraft){
        if(apiUpdate) await apiUpdate(editDraft.id, draft);
        setComms(prev=>prev.map(c=>c.id===editDraft.id?{...c,...draft,status,sentAt:status==='sent'?now:c.sentAt}:c));
        if(status==='sent'&&editDraft.status==='draft'&&apiSend) await apiSend(editDraft.id);
      } else {
        if(apiCreate){
          const created=await apiCreate(draft);
          if(status==='sent'&&created&&apiSend) await apiSend(created.id);
        }
      }
      if(status==='sent' && addToast){
        addToast('success', scheduledFor?'Scheduled':'Sent', scheduledFor?`Will publish at ${new Date(scheduledFor).toLocaleString()}`:'Announcement sent to recipients');
      }
    } catch(err) {
      console.error('[announcements] handleSend failed:', err.message);
      if(addToast) addToast('error','Send Failed', err.body?.error || err.message || 'Could not save announcement. Check console.');
      throw err;
    }
    setEditDraft(null);
  };

  // Submit for approval — used by non-approvers AND approvers who want another
  // set of eyes on it. Always posts to the request queue; approval happens
  // in the Approval Queue view.
  const handleSubmitRequest=async (payload)=>{
    const {type,title,body,target,priority,isPopup,imageUrl,link,soundKey,scheduledFor} = payload;
    try {
      await apiCreateRequest({
        type,title,body,target,priority,
        isPopup:!!isPopup,imageUrl:imageUrl||null,link:link||null,soundKey:soundKey||'chime',
        scheduledFor: scheduledFor || null,
      });
      if(addToast) addToast('success','Submitted for approval','Approvers will review your request shortly');
    } catch(err) {
      console.error('[announcement-requests] submit failed:', err.message);
      if(addToast) addToast('error','Submit Failed', err.body?.error || err.message || 'Could not submit request.');
      throw err;
    }
  };

  const deleteDraft=(id)=>{
    if(!isLA)return;
    if(apiRemove) apiRemove(id);
    else setComms(prev=>prev.filter(c=>c.id!==id));
  };

  // 1) Expand the announcement's audience → the full list of recipient members
  //    (using the canonical matcher so AMERICAS = NAM ∪ LATAM etc).
  // 2) Role-scope that list so TLs only see their team, agents only see self,
  //    while admins and regional managers see everyone.
  // 3) Compute `acked` per member by checking EMAIL against the server's
  //    `ackEmails` list first, then falling back to id matching. Emails are
  //    the drift-proof identifier — this is what makes the Acknowledgement
  //    Tracker reflect who actually clicked, even if the static MEMBERS
  //    array's id drifts from the DB's members.id.
  const accessType=perms?.raw;
  const getAckMembers=(comm)=>{
    let audienceMembers;
    if (Array.isArray(comm.target)) {
      const set=new Set(comm.target);
      audienceMembers=MEMBERS.filter(m=>set.has(m.id));
    } else {
      audienceMembers=MEMBERS.filter(m=>matchesAudience(comm.target, m.team));
    }
    const scoped=scopeAckMembers(audienceMembers, user, accessType, comm);
    const ackEmailSet = new Set(
      (Array.isArray(comm.ackEmails) ? comm.ackEmails : []).map(e => String(e || '').toLowerCase())
    );
    const ackIdSet = new Set(Array.isArray(comm.acks) ? comm.acks : []);
    return scoped.map(m => {
      const memberEmailLc = String(m.email || '').toLowerCase();
      const ackedByEmail = memberEmailLc && ackEmailSet.has(memberEmailLc);
      const ackedById = ackIdSet.has(m.id);
      return { member: m, acked: ackedByEmail || ackedById };
    });
  };

  const ackDeadlineHrs=settings.comms_ack_deadline_hrs||48;
  const isOverdue=(comm)=>{
    if(!comm.sentAt)return false;
    const hrs=(new Date()-new Date(comm.sentAt))/(1000*60*60);
    return hrs>ackDeadlineHrs;
  };

  const PRIO_COLORS={high:'#d42d35',medium:'#ed8d00',low:'#29811e',critical:'#d42d35'};

  // Approval queue tab — label adapts to role. Approvers see org-wide queue,
  // requesters see only their own submissions (backend auto-scopes).
  const approvalTabLabel = isApproverUser ? 'Pending Approval' : 'My Requests';
  const FILTERS=[
    {id:'all',label:'All',icon:'bi-grid'},
    ...(enabledTypes.alert!==false?[{id:'alert',label:'Alerts',icon:'bi-exclamation-triangle-fill'}]:[]),
    ...(enabledTypes.announce!==false?[{id:'announce',label:'Announcements',icon:'bi-megaphone-fill'}]:[]),
    ...(enabledTypes.update!==false?[{id:'update',label:'Updates',icon:'bi-arrow-up-circle-fill'}]:[]),
    ...(enabledTypes.guidance!==false?[{id:'guidance',label:'Guidance',icon:'bi-book-half'}]:[]),
    ...(enabledTypes.kudos!==false?[{id:'kudos',label:'Kudos',icon:'bi-trophy-fill'}]:[]),
    // Pending Approval lives in-tab so users don't have to context-switch to
    // see or action requests. Visible to everyone.
    {id:'pending-approval',label:approvalTabLabel,icon:'bi-clipboard-check',highlight:true},
    // Scheduled — anything approved-and-queued but not yet sent. Shown when
    // there's at least one scheduled item the caller can see, so the tab doesn't
    // pollute the filter bar for regular members.
    ...(comms.some(c => canSeeScheduled(c)) ? [{id:'scheduled',label:'Scheduled',icon:'bi-clock-history'}] : []),
    ...(isLA&&settings.comms_show_drafts_tab!==false?[{id:'drafts',label:'Drafts',icon:'bi-pencil'}]:[]),
    ...(isLA?[{id:'archived',label:'Archived',icon:'bi-archive'}]:[]),
  ];

  // ── Walkthrough popup logic ──
  const walkthroughQueue = useMemo(()=>{
    if(!walkthrough) return [];
    return pendingForMe.filter(c => !walkthroughDismissed.includes(c.id));
  },[walkthrough, pendingForMe, walkthroughDismissed]);

  const handleWalkthroughAck = useCallback((commId) => {
    setWalkthroughDismissed(prev => [...prev, commId]);
    acknowledge(commId);
  },[]);

  const handleWalkthroughSkip = useCallback(() => {
    if (walkthroughQueue.length > 0) {
      setWalkthroughDismissed(prev => [...prev, walkthroughQueue[0].id]);
    }
  },[walkthroughQueue]);

  const handleWalkthroughExit = useCallback(() => {
    setWalkthrough(false);
    setWalkthroughDismissed([]);
  },[]);

  // When walkthrough queue empties, auto-close
  if (walkthrough && walkthroughQueue.length === 0) {
    // Use setTimeout to avoid setState during render
    setTimeout(() => { setWalkthrough(false); setWalkthroughDismissed([]); }, 0);
  }

  // ── Detail popup (view single announcement) ──
  const detailComm = detailId ? comms.find(c => c.id === detailId) : null;

  if (settings.announcements_enabled===false) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#9e9e9e' }}>
        <i className="bi-megaphone" style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }}></i>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Announcements are disabled</div>
        <div style={{ fontSize: 13, marginTop: 4 }}>This feature has been turned off by an administrator.</div>
      </div>
    );
  }

  const tabBtnStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '6px 14px', borderRadius: 8,
    border: 'none', background: active ? '#f3eff8' : 'transparent',
    color: active ? '#6b3fa0' : '#616161', fontSize: 13,
    cursor: 'pointer', fontWeight: active ? 600 : 500,
    whiteSpace: 'nowrap', transition: 'all .15s',
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ padding: '16px 32px 12px', background: 'white', borderBottom: '1px solid #e8e8e8', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="bi-megaphone-fill" style={{ fontSize: 18, color: '#6b3fa0' }}></i>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#1b1b1b' }}>Announcements</span>
          </div>
          <span style={{ fontSize: 12, color: '#9e9e9e', display: 'flex', alignItems: 'center', gap: 5 }}>
            <i className="bi-people" style={{ fontSize: 11 }}></i>
            {comms.filter(c=>c.status==='sent').length} sent
          </span>
          {pendingForMe.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4, background: '#fff8e6', border: '1px solid #ffe27c', borderRadius: 128, padding: '4px 12px' }}>
              <i className="bi-exclamation-circle-fill" style={{ color: '#ed8d00', fontSize: 12 }}></i>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#92400E' }}>{pendingForMe.length} pending</span>
            </div>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {pendingForMe.length > 0 && (
              <button onClick={() => { setWalkthrough(true); setWalkthroughDismissed([]); }}
                style={{ height: 36, padding: '0 18px', borderRadius: 128, border: 'none', background: '#6b3fa0', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
                <i className="bi-play-circle-fill" style={{ fontSize: 14 }}></i>
                Start Acknowledging ({pendingForMe.length})
              </button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 2, overflowX: 'auto' }}>
          {FILTERS.map(f => {
            let ct;
            if (f.id === 'all') ct = visible.length;
            else if (f.id === 'drafts') ct = comms.filter(c => c.status === 'draft').length;
            else if (f.id === 'archived') ct = comms.filter(c => c.status === 'archived').length;
            else if (f.id === 'scheduled') ct = comms.filter(c => canSeeScheduled(c)).length;
            else if (f.id === 'pending-approval') ct = pendingApprovalCount;
            else ct = comms.filter(c => c.type === f.id && c.status === 'sent').length;
            const isPendingTab = f.id === 'pending-approval';
            // Pending-Approval tab gets a red badge (urgency cue) when count > 0.
            const badgeBg = isPendingTab && ct > 0
              ? '#fce8ea'
              : filter === f.id ? 'rgba(107,63,160,0.15)' : '#f2f2f2';
            const badgeColor = isPendingTab && ct > 0
              ? '#d42d35'
              : filter === f.id ? '#6b3fa0' : '#616161';
            return (
              <button key={f.id} onClick={() => setFilter(f.id)} style={tabBtnStyle(filter === f.id)}>
                <i className={f.icon} style={{ fontSize: 11 }}></i>{f.label}
                {ct > 0 && <span style={{ background: badgeBg, color: badgeColor, borderRadius: 128, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{ct}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Table ── */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#fafaf9' }}>
        {filter === 'pending-approval' ? (
          <ApprovalQueueView user={user} addToast={addToast} embedded />
        ) : visible.length === 0 ? (
          <EmptyState icon="bi-inbox" title="No announcements" subtitle="All clear!" />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f5f4f2', position: 'sticky', top: 0, zIndex: 2 }}>
                <th style={thStyle}>Type</th>
                <th style={{ ...thStyle, textAlign: 'left', minWidth: 200 }}>Title</th>
                <th style={thStyle}>Priority</th>
                <th style={thStyle}>Author</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Target</th>
                <th style={thStyle}>Status</th>
                {isLA && <th style={thStyle}>Ack Rate</th>}
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(comm => {
                const t = COMMS_TYPES[comm.type] || COMMS_TYPES.update;
                // Use the shared, email-preferred check so the per-row badge
                // matches what the popup/pending counter says. Avoids the
                // "Pending" label sticking after I acked via popup.
                const iAcked = isAckedByMe(comm);
                const overdue = !iAcked && isOverdue(comm);
                const ackMembers = getAckMembers(comm);
                // Count from the scoped ackMembers list directly — every member
                // row already has `acked` computed from emails-first. This
                // replaces the old id-intersection count that under-reported
                // when the DB id didn't line up with the static MEMBERS id.
                const ackedCount = ackMembers.filter(x => x.acked).length;
                const ackPct = ackMembers.length ? Math.round(ackedCount / ackMembers.length * 100) : 0;
                const isAckOpen = expandedAck === comm.id;

                return [
                  <tr key={comm.id}
                    style={{ borderBottom: '1px solid #f0efed', background: isAckOpen ? '#f9f8f6' : 'white', cursor: 'pointer', transition: 'background .1s' }}
                    onMouseEnter={e => { if (!isAckOpen) e.currentTarget.style.background = '#fafaf9'; }}
                    onMouseLeave={e => { if (!isAckOpen) e.currentTarget.style.background = 'white'; }}
                    onClick={() => setDetailId(comm.id)}
                  >
                    {/* Type */}
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: t.bg, color: t.color, border: `1px solid ${t.border}`, borderRadius: 128, padding: '3px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        <i className={t.icon} style={{ fontSize: 10 }}></i>{t.label}
                      </span>
                    </td>
                    {/* Title */}
                    <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600, color: '#1b1b1b', maxWidth: 320 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{comm.title}</span>
                        {comm.isPopup && comm.status === 'sent' && <span style={{ background: '#f3eff8', color: '#6b3fa0', borderRadius: 128, padding: '1px 6px', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>POPUP</span>}
                        {comm.isPinned && <i className="bi-pin-fill" style={{ color: '#ed8d00', fontSize: 9, flexShrink: 0 }}></i>}
                        {comm.status === 'draft' && <span style={{ background: '#f7f5f2', color: '#616161', borderRadius: 128, padding: '1px 6px', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>DRAFT</span>}
                        {(comm.comments||[]).length > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: '#9e9e9e', fontSize: 10, flexShrink: 0 }}><i className="bi-chat-dots" style={{ fontSize: 9 }}></i>{comm.comments.length}</span>}
                        {(comm.linkedIds||[]).length > 0 && <i className="bi-link-45deg" style={{ color: '#6b3fa0', fontSize: 11, flexShrink: 0 }} title={`${comm.linkedIds.length} linked`}></i>}
                      </div>
                    </td>
                    {/* Priority */}
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: PRIO_COLORS[comm.priority] || '#ed8d00', flexShrink: 0 }}></span>
                        <span style={{ fontSize: 11, color: '#616161', textTransform: 'capitalize' }}>{comm.priority}</span>
                      </span>
                    </td>
                    {/* Author */}
                    <td style={{ ...tdStyle, color: '#616161' }}>{comm.author?.name || '—'}</td>
                    {/* Date */}
                    <td style={{ ...tdStyle, color: '#9e9e9e', fontSize: 12 }}>{comm.sentAt || '—'}</td>
                    {/* Target */}
                    <td style={tdStyle}>
                      <span style={{ fontSize: 11, color: '#616161' }}>{comm.target === 'all' ? 'All' : comm.target}</span>
                    </td>
                    {/* Ack status */}
                    <td style={tdStyle}>
                      {comm.status === 'draft' ? (
                        <span style={{ color: '#9e9e9e', fontSize: 11 }}>Draft</span>
                      ) : comm.status === 'archived' ? (
                        <span style={{ color: '#9e9e9e', fontSize: 11 }}>Archived</span>
                      ) : comm.status === 'scheduled' ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#0a66c2', fontWeight: 600 }}>
                          <i className="bi-clock-history" style={{ fontSize: 10 }}></i>
                          {comm.scheduledFor ? new Date(comm.scheduledFor).toLocaleString() : 'Scheduled'}
                        </span>
                      ) : !isLA ? (
                        iAcked
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: '#29811e', fontWeight: 600 }}><i className="bi-check-circle-fill" style={{ fontSize: 10 }}></i>Done</span>
                          : overdue
                            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: '#d42d35', fontWeight: 600 }}><i className="bi-clock-fill" style={{ fontSize: 10 }}></i>Overdue</span>
                            : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: '#ed8d00', fontWeight: 600 }}><i className="bi-clock" style={{ fontSize: 10 }}></i>Pending</span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#616161', fontWeight: 600 }}>Sent</span>
                      )}
                    </td>
                    {/* Ack rate (leads) */}
                    {isLA && (
                      <td style={tdStyle}>
                        {comm.status === 'sent' && ackMembers.length > 0 ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 48, background: '#e8e8e8', borderRadius: 128, height: 4, overflow: 'hidden' }}>
                              <div style={{ height: '100%', borderRadius: 128, background: ackPct === 100 ? '#29811e' : '#6b3fa0', width: ackPct + '%', transition: 'width .3s' }}></div>
                            </div>
                            <span style={{ fontSize: 11, color: '#616161', fontVariantNumeric: 'tabular-nums' }}>{ackPct}%</span>
                          </div>
                        ) : <span style={{ color: '#d5d5d5' }}>—</span>}
                      </td>
                    )}
                    {/* Actions — role-appropriate */}
                    <td style={tdStyle} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                        {/* Scheduled: "Send now" — visible to approver OR the
                            original author (requester). Calls PATCH /send
                            which clears scheduled_for and flips status='sent'. */}
                        {comm.status === 'scheduled' && (
                          isApproverUser || isLA
                            || (comm.author && (comm.author.id === user.id || (serverUserId && comm.author.id === serverUserId)))
                        ) && (
                          <button
                            onClick={() => {
                              if (!apiSend) return;
                              if (!window.confirm('Publish this announcement right now? The scheduled time will be cleared.')) return;
                              Promise.resolve(apiSend(comm.id)).then(() => {
                                if (addToast) addToast('success', 'Published', 'Announcement sent to audience');
                              }).catch(err => {
                                if (addToast) addToast('error', 'Send failed', err?.body?.error || err?.message || 'Could not publish');
                              });
                            }}
                            title="Send now (cancels the schedule)"
                            style={actionBtnStyle('#e6f4ff', '#0a66c2')}>
                            <i className="bi-lightning-fill" style={{ fontSize: 11 }}></i>
                          </button>
                        )}
                        {/* Everyone: open detail / comment */}
                        {comm.status === 'sent' && (
                          <button onClick={() => setDetailId(comm.id)} title="View & Comment"
                            style={actionBtnStyle('#f2f2f2', '#616161')}>
                            <i className="bi-chat-dots" style={{ fontSize: 11 }}></i>
                          </button>
                        )}
                        {/* Leads: expand ack tracker */}
                        {isLA && comm.status === 'sent' && ackMembers.length > 0 && settings.comms_show_member_ack_list !== false && (
                          <button onClick={() => setExpandedAck(isAckOpen ? null : comm.id)} title="Ack details"
                            style={actionBtnStyle(isAckOpen ? '#6b3fa0' : '#f2f2f2', isAckOpen ? 'white' : '#616161')}>
                            <i className={isAckOpen ? 'bi-chevron-up' : 'bi-people'} style={{ fontSize: 11 }}></i>
                          </button>
                        )}
                        {/* Leads: remind */}
                        {isLA && comm.status === 'sent' && ackPct < 100 && (
                          <button onClick={() => sendReminder(comm)} title="Send reminder"
                            style={actionBtnStyle(reminderSent[comm.id] ? '#e8f5e3' : '#f2f2f2', reminderSent[comm.id] ? '#29811e' : '#616161')}>
                            <i className={reminderSent[comm.id] ? 'bi-check2' : 'bi-bell'} style={{ fontSize: 11 }}></i>
                          </button>
                        )}
                        {/* Pin */}
                        {canPin && comm.status === 'sent' && (
                          <button onClick={() => togglePin(comm.id)} title={comm.isPinned ? 'Unpin' : 'Pin'}
                            style={actionBtnStyle(comm.isPinned ? '#fff8e6' : '#f2f2f2', comm.isPinned ? '#ed8d00' : '#9e9e9e')}>
                            <i className={comm.isPinned ? 'bi-pin-fill' : 'bi-pin'} style={{ fontSize: 11 }}></i>
                          </button>
                        )}
                        {/* Draft actions (leads only) */}
                        {comm.status === 'draft' && isLA && (
                          <>
                            <button onClick={() => { setEditDraft(comm); setShowCompose(true); }} title="Edit"
                              style={actionBtnStyle('#f2f2f2', '#616161')}>
                              <i className="bi-pencil" style={{ fontSize: 10 }}></i>
                            </button>
                            <button onClick={() => { if(apiSend) apiSend(comm.id); setComms(prev => prev.map(c => c.id === comm.id ? { ...c, status: 'sent', sentAt: new Date().toISOString().slice(0, 10) } : c)); }} title="Send"
                              style={actionBtnStyle('#1b1b1b', 'white')}>
                              <i className="bi-send-fill" style={{ fontSize: 10 }}></i>
                            </button>
                            <button onClick={() => deleteDraft(comm.id)} title="Delete"
                              style={actionBtnStyle('#ffe2de', '#d42d35')}>
                              <i className="bi-trash" style={{ fontSize: 10 }}></i>
                            </button>
                          </>
                        )}
                        {/* Edit sent (leads/admins only) */}
                        {comm.status === 'sent' && isLA && (
                          <button onClick={() => { setEditDraft(comm); setShowCompose(true); }} title="Edit"
                            style={actionBtnStyle('#f2f2f2', '#616161')}>
                            <i className="bi-pencil" style={{ fontSize: 10 }}></i>
                          </button>
                        )}
                        {/* Archive */}
                        {comm.status === 'sent' && isLA && (
                          <button onClick={() => archiveComm(comm.id)} title="Archive"
                            style={actionBtnStyle('#f2f2f2', '#9e9e9e')}>
                            <i className="bi-archive" style={{ fontSize: 10 }}></i>
                          </button>
                        )}
                        {/* Unarchive */}
                        {comm.status === 'archived' && isLA && (
                          <button onClick={() => unarchiveComm(comm.id)} title="Unarchive"
                            style={actionBtnStyle('#f3eff8', '#6b3fa0')}>
                            <i className="bi-arrow-counterclockwise" style={{ fontSize: 11 }}></i>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>,
                  // Expanded ack tracker row
                  isAckOpen && isLA && (
                    <tr key={comm.id + '-ack'}>
                      <td colSpan={isLA ? 10 : 9} style={{ padding: '0 16px 16px', background: '#f9f8f6', borderBottom: '1px solid #e8e8e8' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, paddingTop: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#1b1b1b' }}>Acknowledgement Tracker</span>
                          <span style={{ fontSize: 11, color: '#616161', fontVariantNumeric: 'tabular-nums' }}>{ackedCount}/{ackMembers.length}</span>
                          {settings.comms_show_ack_progress !== false && (
                            <div style={{ width: 100, background: '#e8e8e8', borderRadius: 128, height: 5, overflow: 'hidden' }}>
                              <div style={{ height: '100%', borderRadius: 128, background: ackPct === 100 ? '#29811e' : '#6b3fa0', width: ackPct + '%', transition: 'width .4s ease' }}></div>
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {ackMembers.slice().sort((a, b) => b.acked - a.acked).map(({ member, acked }) => (
                            <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 10, background: acked ? 'white' : '#fffcf0', border: `1px solid ${acked ? '#e8e8e8' : '#ffe27c'}`, minWidth: 180 }}>
                              <Avatar name={member.name} size={24} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: '#1b1b1b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.name}</div>
                                <div style={{ fontSize: 10, color: '#9e9e9e' }}>{member.team}</div>
                              </div>
                              {acked
                                ? <i className="bi-check-circle-fill" style={{ color: '#29811e', fontSize: 12 }}></i>
                                : <i className="bi-clock" style={{ color: '#ed8d00', fontSize: 11 }}></i>
                              }
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Walkthrough popup — shows pending announcements one by one ── */}
      {walkthrough && walkthroughQueue.length > 0 && (
        <WalkthroughOverlay
          key={walkthroughQueue[0].id}
          comm={walkthroughQueue[0]}
          remaining={walkthroughQueue.length}
          onAcknowledge={handleWalkthroughAck}
          onSkip={handleWalkthroughSkip}
          onExit={handleWalkthroughExit}
          onReact={(commId, emoji) => {
            if (apiReact) { apiReact(commId, emoji); }
            else {
              setComms(prev => prev.map(c => {
                if (c.id !== commId) return c;
                const reactions = { ...(c.reactions || {}) };
                reactions[emoji] = (reactions[emoji] || 0) + 1;
                return { ...c, reactions };
              }));
            }
          }}
        />
      )}

      {/* ── Detail popup — view single announcement ── */}
      {detailComm && !walkthrough && (
        <DetailOverlay
          comm={detailComm}
          user={user}
          isLA={isLA}
          onAcknowledge={acknowledge}
          onClose={() => setDetailId(null)}
          comms={comms}
          setComms={setComms}
          apiComments={apiComments}
          apiSetComments={apiSetComments}
          apiLoadComments={apiLoadComments}
          apiAddComment={apiAddComment}
          apiDeleteComment={apiDeleteComment}
          apiLinks={apiLinks}
          apiLoadLinks={apiLoadLinks}
          apiLinkAnnouncement={apiLinkAnnouncement}
          apiUnlinkAnnouncement={apiUnlinkAnnouncement}
          setDetailId={setDetailId}
          onReact={(commId, emoji) => {
            if (apiReact) { apiReact(commId, emoji); }
            else {
              setComms(prev => prev.map(c => {
                if (c.id !== commId) return c;
                const reactions = { ...(c.reactions || {}) };
                reactions[emoji] = (reactions[emoji] || 0) + 1;
                return { ...c, reactions };
              }));
            }
          }}
        />
      )}

      {showCompose && <ComposeModal onClose={() => { setShowCompose(false); setEditDraft(null); }} onSend={handleSend} onSubmitRequest={handleSubmitRequest} draft={editDraft} currentUser={user} />}
    </div>
  );
};

// ── Styles ──
const thStyle = { padding: '10px 12px', fontSize: 11, fontWeight: 600, color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '1px solid #e8e8e8' };
const tdStyle = { padding: '12px 12px', textAlign: 'center', verticalAlign: 'middle' };
const actionBtnStyle = (bg, color) => ({ width: 28, height: 28, borderRadius: '50%', border: 'none', background: bg, color, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, transition: 'opacity .15s' });

// ── Emoji reactions config ──
const REACTION_EMOJIS = [
  { emoji: '\uD83D\uDD25', label: 'Fire' },
  { emoji: '\uD83D\uDE4C', label: 'Praise' },
  { emoji: '\uD83D\uDCA1', label: 'Insightful' },
  { emoji: '\uD83D\uDC4D', label: 'Like' },
  { emoji: '\u2764\uFE0F', label: 'Love' },
  { emoji: '\uD83D\uDC4E', label: 'Thumbs Down' },
  { emoji: '\uD83D\uDE02', label: 'Crying Laughing' },
  { emoji: '\uD83D\uDE22', label: 'Crying' },
  { emoji: '\uD83D\uDE21', label: 'Angry' },
];

const MAX_FLOATERS = 60;

// ── Single floating emoji — floats up, fades out, then self-removes from DOM ──
function FloatingEmoji({ emoji, id, onDone }) {
  const ref = useRef(null);
  const [style] = useState(() => {
    const zone = Math.random();
    let x;
    if (zone < 0.35) x = Math.random() * 22 + 1;
    else if (zone < 0.7) x = Math.random() * 22 + 77;
    else x = Math.random() * 60 + 20;
    const startY = Math.random() * 40 + 50;
    const size = 20 + Math.random() * 22;
    const drift = (Math.random() - 0.5) * 80;
    const dur = 2.5 + Math.random() * 2;
    const delay = Math.random() * 0.2;
    return {
      position: 'absolute', left: `${x}%`, top: `${startY}%`,
      fontSize: size, pointerEvents: 'none', zIndex: 100000,
      filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.15))',
      opacity: 0, willChange: 'transform, opacity',
      animation: `floatEmoji ${dur}s ${delay}s ease-out forwards`,
      '--drift': `${drift}px`,
    };
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => { if (onDone) onDone(id); };
    el.addEventListener('animationend', handler);
    return () => el.removeEventListener('animationend', handler);
  }, [id, onDone]);
  return <span ref={ref} style={style}>{emoji}</span>;
}

// ── Walkthrough overlay — full-screen popup for reading + acknowledging ──
function WalkthroughOverlay({ comm, remaining, onAcknowledge, onSkip, onExit, onReact }) {
  const t = COMMS_TYPES[comm.type] || COMMS_TYPES.update;
  const [acking, setAcking] = useState(false);
  const [floaters, setFloaters] = useState([]);
  const floatIdRef = useRef(0);

  // Seed initial floaters from existing reactions on mount
  useEffect(() => {
    const reactions = comm.reactions || {};
    const initial = [];
    Object.entries(reactions).forEach(([emoji, count]) => {
      const show = Math.min(count, 12);
      for (let i = 0; i < show; i++) {
        initial.push({ id: floatIdRef.current++, emoji });
      }
    });
    if (initial.length) setFloaters(initial.slice(-MAX_FLOATERS));
  }, [comm.id]);

  // Remove a single floater when its animation ends — zero stale DOM nodes
  const removeFloater = useCallback((fid) => {
    setFloaters(prev => prev.filter(f => f.id !== fid));
  }, []);

  const handleReact = (emoji) => {
    const newFloaters = Array.from({ length: 3 }, () => ({
      id: floatIdRef.current++, emoji,
    }));
    setFloaters(prev => {
      const next = [...prev, ...newFloaters];
      return next.length > MAX_FLOATERS ? next.slice(-MAX_FLOATERS) : next;
    });
    if (onReact) onReact(comm.id, emoji);
  };

  const handleAck = () => {
    setAcking(true);
    setTimeout(() => onAcknowledge(comm.id), 350);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)', padding: 24 }}>

      {/* Floating emojis layer — covers full screen behind the emoji bar but above backdrop */}
      {floaters.map(f => <FloatingEmoji key={f.id} emoji={f.emoji} id={f.id} onDone={removeFloater} />)}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, maxWidth: 580, width: '100%' }}>
        {/* Main popup card */}
        <div style={{ backgroundColor: '#fff', borderRadius: 16, width: '100%', maxHeight: '75vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.18)', overflow: 'hidden', animation: 'popupFadeIn 0.2s ease-out', position: 'relative', zIndex: 100001 }}>
          {/* Top bar */}
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #f2f2f2', display: 'flex', alignItems: 'center', gap: 10, background: '#fafaf9' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: t.bg, color: t.color, border: `1px solid ${t.border}`, borderRadius: 128, padding: '3px 12px', fontSize: 11, fontWeight: 600 }}>
              <i className={t.icon} style={{ fontSize: 11 }}></i>{t.label}
            </span>
            <span style={{ fontSize: 12, color: '#9e9e9e', marginLeft: 'auto' }}>{remaining} remaining</span>
            <button onClick={onExit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9e9e9e', fontSize: 16, padding: 4, display: 'flex' }}>
              <i className="bi-x-lg"></i>
            </button>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
            <h2 style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 700, color: '#1b1b1b', lineHeight: 1.3 }}>{comm.title}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#9e9e9e', marginBottom: 20 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><i className="bi-person-circle" style={{ fontSize: 11 }}></i>{comm.author?.name}</span>
              {comm.sentAt && <><span>·</span><span>{comm.sentAt}</span></>}
              <span>·</span>
              <span>{comm.target === 'all' ? 'All Teams' : comm.target}</span>
            </div>
            {comm.imageUrl && (
              <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #e8e8e8', marginBottom: 16, background: '#fafaf9', textAlign: 'center' }}>
                <img src={comm.imageUrl} alt="" style={{ maxWidth: '100%', maxHeight: 400, objectFit: 'contain', display: 'block', margin: '0 auto' }} />
              </div>
            )}
            {comm.body && (
            <div style={{ fontSize: 14, color: '#4b5563', lineHeight: 1.7 }}>
              {comm.body.split('\n').map((line, i) => (
                line.trim() === ''
                  ? <div key={i} style={{ height: 8 }}></div>
                  : (line.trim().startsWith('\u2022') || line.trim().startsWith('-'))
                    ? <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, paddingLeft: 4 }}><span style={{ color: t.color, fontWeight: 700 }}>{'\u2022'}</span><span>{line.trim().replace(/^[\u2022\-]\s*/, '')}</span></div>
                    : <div key={i} style={{ marginBottom: 3 }}>{line}</div>
              ))}
            </div>
            )}
            {comm.link && (
              <a href={comm.link} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.color, fontWeight: 600, textDecoration: 'none', background: t.bg, border: `1px solid ${t.border}`, borderRadius: 128, padding: '6px 14px', marginTop: 12 }}>
                <i className="bi-link-45deg" style={{ fontSize: 12 }}></i>Open Link <i className="bi-box-arrow-up-right" style={{ fontSize: 9 }}></i>
              </a>
            )}
          </div>

          {/* Bottom actions */}
          <div style={{ padding: '14px 28px 20px', borderTop: '1px solid #f2f2f2', display: 'flex', gap: 10 }}>
            <button onClick={onSkip}
              style={{ flex: 1, height: 44, borderRadius: 128, border: '1px solid #e8e8e8', background: 'white', color: '#616161', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <i className="bi-arrow-right" style={{ fontSize: 14 }}></i>
              Skip
            </button>
            <button onClick={handleAck} disabled={acking}
              style={{ flex: 2, height: 44, borderRadius: 128, border: 'none', background: acking ? '#29811e' : '#1b1b1b', color: 'white', fontSize: 14, fontWeight: 700, cursor: acking ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'background .2s' }}>
              <i className={acking ? 'bi-check-lg' : 'bi-check2-circle'} style={{ fontSize: 15 }}></i>
              {acking ? 'Acknowledged!' : 'Acknowledge'}
            </button>
          </div>
        </div>

        {/* ── Emoji reaction bar — outside the popup card ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)', borderRadius: 128, border: '1px solid rgba(255,255,255,0.15)', position: 'relative', zIndex: 100001 }}>
          {REACTION_EMOJIS.map(r => {
            return (
              <button key={r.emoji} onClick={() => handleReact(r.emoji)} title={r.label}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 12, transition: 'transform 0.15s, background 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.25)'; e.currentTarget.style.background = 'rgba(255,255,255,0.2)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = 'none'; }}
              >
                <span style={{ fontSize: 26, lineHeight: 1, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' }}>{r.emoji}</span>
              </button>
            );
          })}
        </div>
      </div>

    </div>
  );
}

// ── Detail overlay — view single announcement ──
function DetailOverlay({ comm, user, isLA, onAcknowledge, onClose, comms, setComms, apiComments, apiSetComments, apiLoadComments, apiAddComment, apiDeleteComment, apiLinks, apiLoadLinks, apiLinkAnnouncement, apiUnlinkAnnouncement, setDetailId, onReact }) {
  const t = COMMS_TYPES[comm.type] || COMMS_TYPES.update;
  // Email-first ack check to match the rest of the UI — otherwise users saw
  // the "Acknowledge" button stay active in Detail view even after clicking it
  // via the popup (because the DB id differed from the local MEMBERS id).
  const myEmailLc = (user.email || '').toLowerCase();
  const iAcked = (Array.isArray(comm.ackEmails) && myEmailLc && comm.ackEmails.includes(myEmailLc))
    || comm.acks.includes(Number(user.id));
  const PRIO_COLORS={high:'#d42d35',medium:'#ed8d00',low:'#29811e',critical:'#d42d35'};

  // ── Emoji floaters ──
  const [floaters, setFloaters] = useState([]);
  const floatIdRef = useRef(0);

  // Seed initial floaters from existing reactions on mount
  useEffect(() => {
    const reactions = comm.reactions || {};
    const initial = [];
    Object.entries(reactions).forEach(([emoji, count]) => {
      const show = Math.min(count, 12);
      for (let i = 0; i < show; i++) {
        initial.push({ id: floatIdRef.current++, emoji });
      }
    });
    if (initial.length) setFloaters(initial.slice(-MAX_FLOATERS));
  }, [comm.id]);

  // Remove a single floater when its animation ends
  const removeFloater = useCallback((fid) => {
    setFloaters(prev => prev.filter(f => f.id !== fid));
  }, []);

  const handleReact = (emoji) => {
    const newFloaters = Array.from({ length: 3 }, () => ({
      id: floatIdRef.current++, emoji,
    }));
    setFloaters(prev => {
      const next = [...prev, ...newFloaters];
      return next.length > MAX_FLOATERS ? next.slice(-MAX_FLOATERS) : next;
    });
    if (onReact) onReact(comm.id, emoji);
  };

  // ── Comments state ──
  const [localComments, setLocalComments] = useState(comm.comments || []);
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [replyText, setReplyText] = useState('');

  // Load comments on mount
  useEffect(() => {
    if (apiLoadComments) apiLoadComments(comm.id);
  }, [comm.id, apiLoadComments]);

  // Sync from apiComments when available
  useEffect(() => {
    if (apiComments && apiComments[comm.id]) {
      setLocalComments(apiComments[comm.id]);
    }
  }, [apiComments, comm.id]);

  const handleAddComment = (body, parentId) => {
    if (!body.trim()) return;
    const cmt = {
      id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      body: body.trim(),
      parentId: parentId || null,
      authorId: user.id,
      authorName: user.name,
      createdAt: new Date().toISOString(),
    };
    const updated = [...localComments, cmt];
    setLocalComments(updated);
    // Persist to comms state
    setComms(prev => prev.map(c => c.id === comm.id ? { ...c, comments: updated } : c));
    if (apiSetComments) apiSetComments(prev => ({ ...prev, [comm.id]: updated }));
    if (apiAddComment) apiAddComment(comm.id, body.trim(), parentId || null);
    setNewComment('');
    setReplyTo(null);
    setReplyText('');
  };

  const handleDeleteComment = (commentId) => {
    const updated = localComments.filter(c => c.id !== commentId && c.parentId !== commentId);
    setLocalComments(updated);
    setComms(prev => prev.map(c => c.id === comm.id ? { ...c, comments: updated } : c));
    if (apiSetComments) apiSetComments(prev => ({ ...prev, [comm.id]: updated }));
    if (apiDeleteComment) apiDeleteComment(comm.id, commentId);
  };

  const topLevelComments = localComments.filter(c => !c.parentId);
  const getReplies = (parentId) => localComments.filter(c => c.parentId === parentId);

  // ── Linked announcements ──
  const linkedIds = comm.linkedIds || [];
  const linkedComms = linkedIds.map(lid => comms.find(c => c.id === lid)).filter(Boolean);
  const [showLinkSearch, setShowLinkSearch] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');

  useEffect(() => {
    if (apiLoadLinks) apiLoadLinks(comm.id);
  }, [comm.id, apiLoadLinks]);

  const linkableComms = comms.filter(c => c.id !== comm.id && !linkedIds.includes(c.id) && c.status === 'sent' && (linkSearch ? c.title.toLowerCase().includes(linkSearch.toLowerCase()) : true));

  const handleLink = (targetId) => {
    if (apiLinkAnnouncement) apiLinkAnnouncement(comm.id, targetId);
    else {
      setComms(prev => prev.map(c => {
        if (c.id === comm.id) return { ...c, linkedIds: [...(c.linkedIds || []), targetId] };
        if (c.id === targetId) return { ...c, linkedIds: [...(c.linkedIds || []), comm.id] };
        return c;
      }));
    }
    setShowLinkSearch(false);
    setLinkSearch('');
  };

  const handleUnlink = (targetId) => {
    if (apiUnlinkAnnouncement) apiUnlinkAnnouncement(comm.id, targetId);
    else {
      setComms(prev => prev.map(c => {
        if (c.id === comm.id) return { ...c, linkedIds: (c.linkedIds || []).filter(x => x !== targetId) };
        if (c.id === targetId) return { ...c, linkedIds: (c.linkedIds || []).filter(x => x !== comm.id) };
        return c;
      }));
    }
  };

  const timeAgo = (iso) => {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  // Render comment body with bullet point + emoji support
  const renderCommentBody = (body) => {
    return body.split('\n').map((line, i) => {
      if (line.trim() === '') return null;
      if (line.trim().startsWith('\u2022') || line.trim().startsWith('-')) {
        const text = line.trim().replace(/^[\u2022\-]\s*/, '');
        return <div key={i} style={{ display: 'flex', gap: 5, paddingLeft: 2 }}><span style={{ color: '#6b3fa0', fontWeight: 700 }}>{'\u2022'}</span><span>{text}</span></div>;
      }
      return <div key={i}>{line}</div>;
    });
  };

  const CommentItem = ({ cmt, depth = 0 }) => {
    const replies = getReplies(cmt.id);
    const isOwn = cmt.authorId === user.id;
    return (
      <div style={{ marginLeft: depth > 0 ? 20 : 0 }}>
        <div style={{ display: 'flex', gap: 6, padding: '5px 0' }}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', background: depth > 0 ? '#f2f2f2' : '#f3eff8', color: depth > 0 ? '#616161' : '#6b3fa0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>
            {(cmt.authorName || 'U').charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#1b1b1b' }}>{cmt.authorName || 'User'}</span>
              <span style={{ fontSize: 9, color: '#b5b5b5' }}>{timeAgo(cmt.createdAt)}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto' }}>
                <button onClick={() => { setReplyTo(replyTo === cmt.id ? null : cmt.id); setReplyText(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9e9e9e', fontSize: 9, padding: '0 3px' }} title="Reply">
                  <i className="bi-reply" style={{ fontSize: 10 }}></i>
                </button>
                {isOwn && (
                  <button onClick={() => handleDeleteComment(cmt.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d42d35', fontSize: 9, padding: '0 3px', opacity: 0.5 }} title="Delete">
                    <i className="bi-trash" style={{ fontSize: 9 }}></i>
                  </button>
                )}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.4, marginTop: 1 }}>{renderCommentBody(cmt.body)}</div>
            {replyTo === cmt.id && (
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <textarea value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Write a reply… (supports emojis & bullet points)"
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && replyText.trim()) { e.preventDefault(); handleAddComment(replyText, cmt.id); } }}
                  rows={1}
                  style={{ flex: 1, minHeight: 28, maxHeight: 80, borderRadius: 8, border: '1px solid #e8e8e8', padding: '5px 8px', fontSize: 11, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
                />
                <button onClick={() => { if (replyText.trim()) handleAddComment(replyText, cmt.id); }}
                  style={{ height: 28, padding: '0 8px', borderRadius: 8, border: 'none', background: '#6b3fa0', color: 'white', fontSize: 10, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-end' }}>
                  Send
                </button>
              </div>
            )}
          </div>
        </div>
        {replies.map(r => <CommentItem key={r.id} cmt={r} depth={depth + 1} />)}
      </div>
    );
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 99998, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(1px)', padding: 24 }}>

      {/* Floating emojis layer */}
      {floaters.map(f => <FloatingEmoji key={f.id} emoji={f.emoji} id={f.id} onDone={removeFloater} />)}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, maxWidth: 640, width: '100%' }}>
      <div onClick={e => e.stopPropagation()} style={{ backgroundColor: '#fff', borderRadius: 16, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 40px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #f2f2f2', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className={t.icon} style={{ color: t.color, fontSize: 16 }}></i>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ background: t.bg, color: t.color, border: `1px solid ${t.border}`, borderRadius: 128, padding: '2px 9px', fontSize: 10, fontWeight: 700 }}>{t.label}</span>
              {comm.isPopup && <span style={{ background: '#f3eff8', color: '#6b3fa0', borderRadius: 128, padding: '2px 7px', fontSize: 9, fontWeight: 700 }}>POPUP</span>}
              <span style={{ background: (PRIO_COLORS[comm.priority]||'#ed8d00')+'18', color: PRIO_COLORS[comm.priority]||'#ed8d00', borderRadius: 128, padding: '2px 9px', fontSize: 10, fontWeight: 700, textTransform: 'capitalize' }}>{comm.priority}</span>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#1b1b1b', lineHeight: 1.3 }}>{comm.title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#9e9e9e', marginTop: 6 }}>
              <span>{comm.author?.name}</span>
              {comm.sentAt && <><span>·</span><span>{comm.sentAt}</span></>}
              <span>·</span>
              <span>{comm.target === 'all' ? 'All Teams' : comm.target}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: '#f2f2f2', border: 'none', cursor: 'pointer', color: '#9e9e9e', width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
            <i className="bi-x-lg"></i>
          </button>
        </div>
        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {comm.imageUrl && (
            <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #e8e8e8', marginBottom: 16, background: '#fafaf9', textAlign: 'center' }}>
              <img src={comm.imageUrl} alt="" style={{ maxWidth: '100%', maxHeight: 320, objectFit: 'contain', display: 'block', margin: '0 auto' }} />
            </div>
          )}
          {comm.body && (
          <div style={{ fontSize: 14, color: '#4b5563', lineHeight: 1.7 }}>
            {comm.body.split('\n').map((line, i) => (
              line.trim() === ''
                ? <div key={i} style={{ height: 8 }}></div>
                : (line.trim().startsWith('\u2022') || line.trim().startsWith('-'))
                  ? <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, paddingLeft: 4 }}><span style={{ color: t.color, fontWeight: 700 }}>{'\u2022'}</span><span>{line.trim().replace(/^[\u2022\-]\s*/, '')}</span></div>
                  : <div key={i} style={{ marginBottom: 3 }}>{line}</div>
            ))}
          </div>
          )}
          {comm.link && (
            <a href={comm.link} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.color, fontWeight: 600, textDecoration: 'none', background: t.bg, border: `1px solid ${t.border}`, borderRadius: 128, padding: '6px 14px', marginTop: 12 }}>
              <i className="bi-link-45deg" style={{ fontSize: 12 }}></i>Open Link <i className="bi-box-arrow-up-right" style={{ fontSize: 9 }}></i>
            </a>
          )}

          {/* ── Linked Announcements ── */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #f2f2f2' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <i className="bi-link-45deg" style={{ fontSize: 13, color: '#6b3fa0' }}></i>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#1b1b1b' }}>Linked Announcements</span>
              <span style={{ fontSize: 10, color: '#9e9e9e' }}>({linkedComms.length})</span>
              {isLA && (
                <button onClick={() => setShowLinkSearch(!showLinkSearch)} style={{ marginLeft: 'auto', background: '#f3eff8', border: 'none', cursor: 'pointer', color: '#6b3fa0', borderRadius: 128, padding: '3px 10px', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <i className="bi-plus" style={{ fontSize: 11 }}></i>Link
                </button>
              )}
            </div>
            {showLinkSearch && isLA && (
              <div style={{ marginBottom: 10, position: 'relative' }}>
                <input value={linkSearch} onChange={e => setLinkSearch(e.target.value)} placeholder="Search announcements to link..."
                  style={{ width: '100%', height: 32, borderRadius: 8, border: '1px solid #e8e8e8', padding: '0 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                />
                {linkableComms.length > 0 && (
                  <div style={{ position: 'absolute', top: 36, left: 0, right: 0, background: 'white', border: '1px solid #e8e8e8', borderRadius: 10, maxHeight: 160, overflowY: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                    {linkableComms.slice(0, 6).map(lc => {
                      const lt = COMMS_TYPES[lc.type] || COMMS_TYPES.update;
                      return (
                        <div key={lc.id} onClick={() => handleLink(lc.id)} style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #f9f9f9', fontSize: 12 }}
                          onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                          <span style={{ background: lt.bg, color: lt.color, borderRadius: 128, padding: '1px 6px', fontSize: 9, fontWeight: 700 }}>{lt.label}</span>
                          <span style={{ color: '#1b1b1b', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lc.title}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {linkedComms.length === 0 && !showLinkSearch && (
              <div style={{ fontSize: 12, color: '#9e9e9e', padding: '4px 0' }}>No linked announcements</div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {linkedComms.map(lc => {
                const lt = COMMS_TYPES[lc.type] || COMMS_TYPES.update;
                return (
                  <div key={lc.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fafaf9', border: '1px solid #e8e8e8', borderRadius: 128, padding: '4px 10px 4px 8px', cursor: 'pointer' }}
                    onClick={() => setDetailId(lc.id)}>
                    <span style={{ background: lt.bg, color: lt.color, borderRadius: 128, padding: '1px 6px', fontSize: 9, fontWeight: 700 }}>{lt.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#1b1b1b', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lc.title}</span>
                    {isLA && (
                      <button onClick={(e) => { e.stopPropagation(); handleUnlink(lc.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9e9e9e', fontSize: 11, padding: 0, display: 'flex', lineHeight: 1 }} title="Unlink">
                        <i className="bi-x" style={{ fontSize: 13 }}></i>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Comments Section (compact) ── */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #f2f2f2' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <i className="bi-chat-dots" style={{ fontSize: 11, color: '#6b3fa0' }}></i>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#1b1b1b' }}>Comments</span>
              <span style={{ fontSize: 9, color: '#9e9e9e' }}>({localComments.length})</span>
            </div>
            {topLevelComments.length === 0 && (
              <div style={{ fontSize: 11, color: '#b5b5b5', padding: '2px 0 6px' }}>No comments yet. Be the first to comment.</div>
            )}
            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
              {topLevelComments.map(cmt => <CommentItem key={cmt.id} cmt={cmt} />)}
            </div>
            {/* Add new comment — textarea for multi-line, emojis, bullet points */}
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'flex-end' }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#f3eff8', color: '#6b3fa0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                {(user.name || 'U').charAt(0).toUpperCase()}
              </div>
              <textarea value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Add a comment… (Shift+Enter for new line, supports emojis & bullet points)"
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && newComment.trim()) { e.preventDefault(); handleAddComment(newComment, null); } }}
                rows={1}
                style={{ flex: 1, minHeight: 30, maxHeight: 80, borderRadius: 10, border: '1px solid #e8e8e8', padding: '6px 10px', fontSize: 11, outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.4 }}
              />
              <button onClick={() => { if (newComment.trim()) handleAddComment(newComment, null); }} disabled={!newComment.trim()}
                style={{ height: 30, padding: '0 10px', borderRadius: 10, border: 'none', background: newComment.trim() ? '#6b3fa0' : '#e8e8e8', color: newComment.trim() ? 'white' : '#9e9e9e', fontSize: 11, fontWeight: 600, cursor: newComment.trim() ? 'pointer' : 'default', flexShrink: 0 }}>
                <i className="bi-send" style={{ fontSize: 10 }}></i>
              </button>
            </div>
          </div>
        </div>
        {/* Ack footer */}
        {comm.status === 'sent' && !isLA && (
          <div style={{ padding: '14px 24px', borderTop: '1px solid #f2f2f2', background: iAcked ? '#f9faf9' : '#fffcf0' }}>
            {iAcked ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                <i className="bi-check-circle-fill" style={{ color: '#29811e', fontSize: 16 }}></i>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#29811e' }}>Acknowledged</span>
              </div>
            ) : (
              <button onClick={() => onAcknowledge(comm.id)}
                style={{ width: '100%', height: 42, borderRadius: 128, border: 'none', background: '#1b1b1b', color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                <i className="bi-check2-circle" style={{ fontSize: 14 }}></i>Acknowledge
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Emoji reaction bar — outside the popup card ── */}
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)', borderRadius: 128, border: '1px solid rgba(255,255,255,0.15)', position: 'relative', zIndex: 100001 }}>
        {REACTION_EMOJIS.map(r => (
          <button key={r.emoji} onClick={() => handleReact(r.emoji)} title={r.label}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 12, transition: 'transform 0.15s, background 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.25)'; e.currentTarget.style.background = 'rgba(255,255,255,0.2)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = 'none'; }}
          >
            <span style={{ fontSize: 26, lineHeight: 1, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' }}>{r.emoji}</span>
          </button>
        ))}
      </div>
      </div>

    </div>
  );
}

export default AnnouncementsView;
