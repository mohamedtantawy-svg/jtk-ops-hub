import { useState } from 'react';
import Avatar from '../ui/Avatar';

const MAX_NOTE_CHARS=500;

const NotesTab=({taskId,notes,setNotes,currentUser,setActivity})=>{
  const [text,setText]=useState('');
  const taskNotes=notes[taskId]||[];
  const charCount=text.length;
  // Submit handler — debounce recommended for production
  const submit=()=>{
    if(!text.trim())return;
    const now=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    const n={id:Date.now(),author:currentUser.name,text:text.trim(),time:now};
    const trimmed=text.trim();
    setText('');
    setNotes(prev=>({...prev,[taskId]:[...(prev[taskId]||[]),n]}));
    if(setActivity)setActivity(prev=>({...prev,[taskId]:[...(prev[taskId]||[]),{type:'note',text:trimmed.slice(0,80)+(trimmed.length>80?'…':''),user:currentUser.name,time:now}]}));
  };
  return(
    <div style={{padding:'12px 15px',display:'flex',flexDirection:'column',gap:12}}>
      <div style={{background:'var(--orange-light, #fffbeb)',border:'1px solid #ffe27c',borderRadius:8,padding:'8px 12px',display:'flex',gap:6,alignItems:'flex-start'}}>
        <i className="bi-lock-fill" style={{color:'#ed8d00',fontSize:12,marginTop:2}}></i>
        <span style={{fontSize:12,color:'#92400E',fontWeight:500}}>Internal only — not visible to the employee or in the source tool.</span>
      </div>
      {taskNotes.length===0&&<div style={{textAlign:'center',padding:'20px 0',color:'#9e9e9e',fontSize:14}}><i className="bi-sticky" style={{fontSize:48,display:'block',marginBottom:8}}></i>No notes yet</div>}
      {taskNotes.map(n=>(
        <div key={n.id} style={{display:'flex',gap:8}}>
          <Avatar name={n.author} size={26}/>
          <div style={{flex:1}}>
            <div style={{display:'flex',gap:6,alignItems:'baseline',marginBottom:4}}>
              <span style={{fontWeight:600,fontSize:'var(--font-sm, 12px)',color:'#1b1b1b'}}>{n.author}</span>
              <span style={{color:'#9e9e9e',fontSize:11}}>{n.time}</span>
            </div>
            <div style={{background:'var(--surface, #fff)',borderRadius:8,padding:'9px 11px',fontSize:13,color:'#616161',lineHeight:'var(--lh-base, 1.5)',border:'1px solid #e8e8e8'}}>{n.text}</div>
          </div>
        </div>
      ))}
      <div style={{marginTop:4}}>
        <textarea className="note-input" value={text} onChange={e=>setText(e.target.value.slice(0,MAX_NOTE_CHARS))} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter')submit();}} rows={3} placeholder="Add an internal note… (Cmd+Enter to save)" aria-label="Internal note"/>
        {/* @mention hint */}
        <div style={{fontSize:11,color:'#9e9e9e',marginTop:4,marginBottom:4}}>
          <i className="bi-at" style={{marginRight:3,fontSize:10}}></i>Tip: Start with @name to flag for a colleague
        </div>
        {/* Character count */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:2}}>
          <span style={{fontSize:11,color:charCount>=MAX_NOTE_CHARS?'#d42d35':charCount>MAX_NOTE_CHARS*0.8?'#ed8d00':'#9e9e9e',fontWeight:charCount>=MAX_NOTE_CHARS?600:400}}>
            {charCount} / {MAX_NOTE_CHARS} characters
          </span>
          <button onClick={submit} style={{background:text.trim()?'#1b1b1b':'#dedede',color:'white',border:'none',borderRadius:128,padding:'8px 20px',fontSize:12.5,fontWeight:500,cursor:text.trim()?'pointer':'not-allowed'}} disabled={!text.trim()}>
            <i className="bi-sticky-fill" style={{marginRight:5,fontSize:11}}></i>Save Note
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotesTab;
