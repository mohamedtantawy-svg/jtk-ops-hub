import { TOOLS } from '../../data/constants';
import { MEMBERS } from '../../data/members';

const TimelineTab=({taskId,task,activity,escalation})=>{
  // Events derive from activity state — memoize in production
  const baseEvents=activity[taskId]||[{type:'created',text:`Task received from ${TOOLS[task.source]?.label}`,user:'System',time:task.receivedAt},{type:'assigned',text:`Assigned to ${MEMBERS.find(m=>m.id===task.assigneeId)?.name||task.assigneeName||'Unassigned'}`,user:'System',time:task.receivedAt}];
  // Append escalation events to timeline
  const escEvents=[];
  if(escalation){
    escEvents.push({type:'escalation',text:`Escalated to ${escalation.managerName}: "${escalation.reason}"`,user:escalation.escalatedBy,time:escalation.escalatedAt});
    if(escalation.managerResponseStatus==='responded'&&escalation.managerResponse){
      escEvents.push({type:'escalation_response',text:`Manager response: "${escalation.managerResponse}"`,user:escalation.managerRespondedBy,time:escalation.managerRespondedAt});
    }
    if(escalation.status==='resolved'&&escalation.resolvedBy){
      escEvents.push({type:'escalation_resolved',text:'Escalation resolved',user:escalation.resolvedBy,time:escalation.resolvedAt});
    }
  }
  const events=[...baseEvents,...escEvents];
  const icons={created:'bi-plus-circle-fill',assigned:'bi-person-fill',status:'bi-arrow-repeat',note:'bi-sticky-fill',sent:'bi-send-fill',escalation:'bi-arrow-up-circle-fill',escalation_response:'bi-reply-fill',escalation_resolved:'bi-check-circle-fill'};
  const colors={created:'#1565c0',assigned:'#1565c0',status:'#e65100',note:'#616161',sent:'#29811e',escalation:'#d42d35',escalation_response:'#1565c0',escalation_resolved:'#29811e'};
  return(
    <div style={{padding:'12px 15px'}}>
      {events.map((e,i)=>(
        <div key={i} style={{display:'flex',gap:'var(--space-3, 12px)',marginBottom:i<events.length-1?16:0}}>
          <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
            <div style={{width:26,height:26,borderRadius:'50%',background:`${colors[e.type]}15`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <i className={icons[e.type]||'bi-circle-fill'} style={{color:colors[e.type]||'#9e9e9e',fontSize:'var(--font-xs, 11px)'}}></i>
            </div>
            {i<events.length-1&&<div style={{width:1,flex:1,background:'#e8e8e8',marginTop:4,marginBottom:-4}}></div>}
          </div>
          <div style={{flex:1,paddingTop:2}}>
            <div style={{fontSize:13,color:'#1b1b1b',lineHeight:1.5}}>
              {e.text}
              {/* Reassign / assignment events surface the actor inline so
                  the recipient can see at a glance WHO handed the ticket
                  to them (Bug 5 — Fernanda 2026-04-28). */}
              {(e.type==='assigned'||e.type==='reassigned')&&e.user&&e.user!=='System'&&(
                <span style={{color:'#616161',fontWeight:400}}> by <span style={{color:'#1b1b1b',fontWeight:600}}>{e.user}</span></span>
              )}
            </div>
            <div style={{fontSize:'var(--font-xs, 11px)',color:'#9e9e9e',marginTop:2}}>
              {e.user&&e.user!=='System'&&!(e.type==='assigned'||e.type==='reassigned')?<><span style={{fontWeight:500,color:'#616161'}}>{e.user}</span> · </>:''}
              {e.time}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default TimelineTab;
