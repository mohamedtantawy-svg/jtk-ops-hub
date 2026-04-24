import { useState, useEffect, useRef } from 'react';
import { MEMBERS } from '../../data/members';
import { SLA_MINS, FLAGS, TOOLS } from '../../data/constants';

const CreateTaskModal=({onConfirm,onClose,currentUser})=>{
  const [form,setForm]=useState({source:'zendesk',type:'Access Issue',country:'UK',assigneeId:currentUser.id,subject:'',body:'',link:'',deadline:''});
  const [submitted,setSubmitted]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const subjectRef=useRef(null);
  useEffect(()=>{ subjectRef.current?.focus(); },[]);
  const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
  const agents=MEMBERS.filter(m=>m.role==='agent'||m.role==='team_lead');
  const types=Object.keys(SLA_MINS);
  const countries=Object.keys(FLAGS);
  const sources=Object.entries(TOOLS).filter(([k])=>k!=='slack');
  const valid=form.subject.trim().length>3 && !!form.assigneeId;
  const sel={width:'100%',padding:'8px 12px',border:'1px solid #e8e8e8',borderRadius:8,fontSize:13,color:'#1b1b1b',background:'white',cursor:'pointer'};
  const labelStyle={fontSize:12,fontWeight:600,color:'#616161',letterSpacing:'0.05em',display:'block',marginBottom:4};

  const handleSubmit=()=>{
    if(!valid){
      setSubmitted(true);
      return;
    }
    if(submitting) return;
    setSubmitting(true);
    onConfirm(form);
  };

  return(
    <div role="dialog" aria-modal="true" aria-label="Create Task" style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center',padding:16,backdropFilter:'blur(4px)'}} onClick={onClose}>
      <style>{`@keyframes modalIn { from { opacity:0; transform:scale(0.96) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
      <div style={{background:'white',borderRadius:16,width:'100%',maxWidth:520,boxShadow:'0 4px 24px rgba(0,0,0,0.15)',overflow:'hidden',maxHeight:'90vh',display:'flex',flexDirection:'column',animation:'modalIn 0.2s cubic-bezier(0.16,1,0.3,1) both'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'24px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0,borderBottom:'1px solid var(--border)',paddingBottom:'var(--space-4)',marginBottom:'var(--space-4)'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:36,height:36,background:'#e3f2fd',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center'}}><i className="bi-plus-circle-fill" style={{color:'#1565c0',fontSize:16}}></i></div>
            <div><div style={{fontSize:18,fontWeight:700,color:'#1b1b1b'}}>Create Task</div><div style={{fontSize:12,color:'#9e9e9e',marginTop:1}}>Manually add a task to the queue</div></div>
          </div>
          <button aria-label="Close" onClick={onClose} style={{width:32,height:32,borderRadius:'50%',background:'#f2f2f2',border:'none',cursor:'pointer',color:'#616161',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}><i className="bi-x-lg"></i></button>
        </div>
        <div style={{padding:'0 24px 16px 24px',overflowY:'auto',flex:1}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
            <div><label style={labelStyle}>SOURCE</label><select value={form.source} onChange={e=>upd('source',e.target.value)} style={sel}>{sources.map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div>
            <div><label style={labelStyle}>TYPE / FUNCTION</label><select value={form.type} onChange={e=>upd('type',e.target.value)} style={sel}>{types.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
            <div><label style={labelStyle}>COUNTRY</label><select value={form.country} onChange={e=>upd('country',e.target.value)} style={sel}>{countries.map(c=><option key={c} value={c}>{FLAGS[c]} {c}</option>)}</select></div>
            <div><label style={labelStyle}>ASSIGN TO</label><select value={form.assigneeId} onChange={e=>upd('assigneeId',parseInt(e.target.value))} style={sel}>{agents.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          </div>
          <div style={{marginBottom:10}}>
            <label style={labelStyle}>SUBJECT <span style={{color:'#d42d35'}}>*</span></label>
            <input
              autoFocus
              ref={subjectRef}
              type="text"
              value={form.subject}
              onChange={e=>upd('subject',e.target.value)}
              placeholder="Brief description of the task…"
              aria-invalid={submitted && !valid}
              className={submitted && !form.subject.trim() ? 'input-error' : ''}
              style={{width:'100%',padding:'8px 12px',border:`1px solid ${valid?'#1b1b1b':form.subject.length>0?'#d42d35':'#e8e8e8'}`,borderRadius:8,fontSize:13,color:'#1b1b1b',outline:'none',boxSizing:'border-box'}}
            />
            {submitted && !form.subject.trim() && (
              <div className="error-msg"><i className="bi bi-exclamation-circle"/><span>This field is required</span></div>
            )}
          </div>
          {submitted && !form.assigneeId && (
            <div className="error-msg" style={{marginTop:-6,marginBottom:8}}><i className="bi bi-exclamation-circle"/><span>Please select an assignee</span></div>
          )}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
            <div><label style={labelStyle}>LINK (OPTIONAL)</label><input type="url" value={form.link} onChange={e=>upd('link',e.target.value)} placeholder="https://..." style={{width:'100%',padding:'8px 12px',border:'1px solid #e8e8e8',borderRadius:8,fontSize:13,color:'#1b1b1b',outline:'none',boxSizing:'border-box'}}/></div>
            <div><label style={labelStyle}>DEADLINE (OPTIONAL)</label><input type="date" value={form.deadline} onChange={e=>upd('deadline',e.target.value)} style={{width:'100%',padding:'8px 12px',border:'1px solid #e8e8e8',borderRadius:8,fontSize:13,color:'#1b1b1b',outline:'none',boxSizing:'border-box'}}/></div>
          </div>
          <div><label style={labelStyle}>DETAILS (OPTIONAL)</label><textarea className="note-input" value={form.body} onChange={e=>upd('body',e.target.value)} rows={3} placeholder="Employee name, ticket reference, additional context…"/></div>
        </div>
        <div style={{padding:'0 24px 24px 24px',display:'flex',gap:8,justifyContent:'flex-end',flexShrink:0,borderTop:'1px solid var(--border)',paddingTop:'var(--space-4)',marginTop:'var(--space-4)'}}>
          <button onClick={onClose} style={{background:'white',border:'1px solid #dedede',color:'#1b1b1b',borderRadius:128,padding:'10px 24px',fontSize:13,fontWeight:500,cursor:'pointer'}}>Cancel</button>
          <button disabled={submitting} onClick={handleSubmit} style={{background:valid&&!submitting?'#1b1b1b':'#dedede',color:'white',border:'none',borderRadius:128,padding:'10px 24px',fontSize:13,fontWeight:500,cursor:submitting?'not-allowed':'pointer',display:'flex',alignItems:'center',gap:5,opacity:submitting?.6:1}}><i className="bi-plus-circle-fill" style={{fontSize:13}}></i>{submitting?'Creating…':'Create Task'}</button>
        </div>
      </div>
    </div>
  );
};

export default CreateTaskModal;
