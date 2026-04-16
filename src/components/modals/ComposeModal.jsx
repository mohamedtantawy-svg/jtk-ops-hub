import { useState, useRef } from 'react';
import { MEMBERS } from '../../data/members';
import { FLAGS } from '../../data/constants';
import { COMMS_TYPES, AUDIENCES, AUDIENCE_LABELS, SOUND_PRESETS } from '../../data/comms';
import PreviewPopup from './PreviewPopup';

const sanitizeImageUrl=(url)=>{
  if(!url)return '';
  try{
    const parsed=new URL(url.trim());
    if(parsed.protocol==='http:'||parsed.protocol==='https:')return parsed.href;
    if(parsed.protocol==='data:'&&parsed.href.startsWith('data:image/'))return parsed.href;
  }catch(e){}
  return '';
};

const ComposeModal=({onClose,onSend,draft,currentUser})=>{
  const [type,setType]=useState(draft?.type||'announce');
  const [title,setTitle]=useState(draft?.title||'');
  const [body,setBody]=useState(draft?.body||'');
  // Target is canonical lowercase; legacy drafts may be 'EMEA' etc — normalise
  const normaliseTarget = (t) => {
    const v = String(t || 'global').toLowerCase();
    if (v === 'all') return 'global';
    if (v === 'amer') return 'americas';
    return v;
  };
  const [target,setTarget]=useState(normaliseTarget(draft?.target));
  const [priority,setPriority]=useState(draft?.priority||'medium');
  const [isPopup,setIsPopup]=useState(draft?.isPopup||false);
  const [soundKey,setSoundKey]=useState(draft?.soundKey||'chime');
  const [imageUrl,setImageUrl]=useState(draft?.imageUrl||'');
  const [link,setLink]=useState(draft?.link||'');
  const [showPreview,setShowPreview]=useState(false);
  const [imageMode,setImageMode]=useState(draft?.imageUrl?'url':'none'); // 'none' | 'upload' | 'url'
  const [dragActive,setDragActive]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const fileInputRef=useRef(null);
  // Valid if title + (body or image)
  const valid=title.trim().length>0&&(body.trim().length>0||!!imageUrl);

  const buildDraft=(status)=>({type,title,body,target,priority,status,isPopup,imageUrl,link,soundKey});

  const handleSendWithPreview=()=>{
    if(!valid||submitting)return;
    if(isPopup){
      setShowPreview(true);
    } else {
      setSubmitting(true);
      onSend(buildDraft('sent'));
      onClose();
    }
  };

  const handleConfirmFromPreview=()=>{
    onSend(buildDraft('sent'));
    setShowPreview(false);
    onClose();
  };

  if(showPreview){
    return <PreviewPopup
      draft={{...buildDraft('sent'),author:{id:currentUser?.id,name:currentUser?.name||'You'}}}
      onClose={()=>setShowPreview(false)}
      onConfirmSend={handleConfirmFromPreview}
    />;
  }

  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onClose}>
      <div style={{background:'white',borderRadius:16,width:'100%',maxWidth:560,maxHeight:'90vh',display:'flex',flexDirection:'column',boxShadow:'0 4px 24px rgba(0,0,0,0.15)',overflow:'hidden',animation:'modalIn .18s cubic-bezier(.34,1.56,.64,1) forwards'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'24px 24px 0',display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:36,height:36,borderRadius:9,background:'#e3f2fd',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <i className="bi-pencil-square" style={{color:'#1565c0',fontSize:16}}></i>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:18,fontWeight:700,color:'#1b1b1b'}}>{draft?.id?'Edit Draft':'New Communication'}</div>
            <div style={{fontSize:12,color:'#9e9e9e'}}>Draft · Compose · Send to team</div>
          </div>
          <button aria-label="Close" onClick={onClose} style={{width:32,height:32,borderRadius:'50%',background:'#f2f2f2',border:'none',cursor:'pointer',color:'#616161',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}><i className="bi-x-lg"></i></button>
        </div>
        <div style={{flex:1,overflowY:'auto',padding:'16px 24px'}}>
          {/* Type */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:'#616161',letterSpacing:'.05em',marginBottom:6}}>TYPE</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {Object.entries(COMMS_TYPES).map(([k,v])=>(
                <button key={k} onClick={()=>setType(k)} style={{display:'inline-flex',alignItems:'center',gap:5,height:30,padding:'0 12px',borderRadius:128,border:`1px solid ${type===k?v.color:v.border}`,background:type===k?v.bg:'white',color:type===k?v.color:'#616161',fontSize:12,cursor:'pointer',fontWeight:type===k?700:400,transition:'all .15s'}}>
                  <i className={v.icon} style={{fontSize:11}}></i>{v.label}
                </button>
              ))}
            </div>
          </div>
          {/* Title */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:'#616161',letterSpacing:'.05em',marginBottom:5}}>TITLE</div>
            <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Updated SOP: Termination Ownership Transfer" style={{width:'100%',border:'1px solid #e8e8e8',borderRadius:8,padding:'9px 12px',fontSize:13,outline:'none',boxSizing:'border-box',fontFamily:'inherit',color:'#1b1b1b'}} />
          </div>
          {/* Body */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:'#616161',letterSpacing:'.05em',marginBottom:5}}>MESSAGE {imageUrl&&<span style={{fontWeight:400,color:'#9e9e9e'}}>(optional if image attached)</span>}</div>
            <textarea value={body} onChange={e=>setBody(e.target.value)} rows={5} placeholder={imageUrl?"Add a caption or message (optional)...":"Write your announcement, update, or guidance here..."} style={{width:'100%',border:'1px solid #e8e8e8',borderRadius:8,padding:'9px 12px',fontSize:13,outline:'none',boxSizing:'border-box',resize:'vertical',fontFamily:'inherit',color:'#1b1b1b',lineHeight:1.6}}/>
          </div>
          {/* Image (upload or URL) */}
          <div style={{marginBottom:12}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
              <div style={{fontSize:11,fontWeight:700,color:'#616161',letterSpacing:'.05em'}}>IMAGE <span style={{fontWeight:400,color:'#9e9e9e'}}>(optional)</span></div>
              {imageUrl&&(
                <button onClick={()=>{setImageUrl('');setImageMode('none');if(fileInputRef.current)fileInputRef.current.value='';}} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',color:'#d42d35',fontSize:10,fontWeight:600,display:'flex',alignItems:'center',gap:3,padding:0}}>
                  <i className="bi-trash" style={{fontSize:10}}></i>Remove
                </button>
              )}
            </div>
            {!imageUrl?(
              <div
                onDragOver={e=>{e.preventDefault();setDragActive(true);}}
                onDragLeave={()=>setDragActive(false)}
                onDrop={e=>{
                  e.preventDefault();setDragActive(false);
                  const file=e.dataTransfer.files?.[0];
                  if(file&&file.type.startsWith('image/')){
                    if(file.size>5*1024*1024){alert('Image must be under 5MB');return;}
                    const reader=new FileReader();
                    reader.onload=ev=>{setImageUrl(ev.target.result);setImageMode('upload');};
                    reader.readAsDataURL(file);
                  }
                }}
                style={{border:`2px dashed ${dragActive?'#6b3fa0':'#e0e0e0'}`,borderRadius:12,padding:'20px 16px',textAlign:'center',background:dragActive?'#f9f5ff':'#fafaf9',cursor:'pointer',transition:'all .15s'}}
                onClick={()=>fileInputRef.current?.click()}
              >
                <input ref={fileInputRef} type="file" accept="image/*" style={{display:'none'}} onChange={e=>{
                  const file=e.target.files?.[0];
                  if(file&&file.type.startsWith('image/')){
                    if(file.size>5*1024*1024){alert('Image must be under 5MB');return;}
                    const reader=new FileReader();
                    reader.onload=ev=>{setImageUrl(ev.target.result);setImageMode('upload');};
                    reader.readAsDataURL(file);
                  }
                }}/>
                <i className="bi-cloud-arrow-up" style={{fontSize:24,color:dragActive?'#6b3fa0':'#b5b5b5',display:'block',marginBottom:6}}></i>
                <div style={{fontSize:12,fontWeight:600,color:'#616161'}}>Click to upload or drag & drop</div>
                <div style={{fontSize:11,color:'#9e9e9e',marginTop:3}}>PNG, JPG, GIF, WebP up to 5MB</div>
                <div style={{display:'flex',alignItems:'center',gap:8,justifyContent:'center',marginTop:10}}>
                  <div style={{height:1,flex:1,background:'#e8e8e8'}}></div>
                  <span style={{fontSize:10,color:'#9e9e9e',fontWeight:600}}>OR</span>
                  <div style={{height:1,flex:1,background:'#e8e8e8'}}></div>
                </div>
                <div style={{marginTop:8}} onClick={e=>e.stopPropagation()}>
                  <input placeholder="Paste image URL here..." onKeyDown={e=>{if(e.key==='Enter'){const safe=sanitizeImageUrl(e.target.value);if(safe){setImageUrl(safe);setImageMode('url');}}}}
                    onBlur={e=>{const safe=sanitizeImageUrl(e.target.value);if(safe){setImageUrl(safe);setImageMode('url');}}}
                    style={{width:'100%',border:'1px solid #e8e8e8',borderRadius:8,padding:'7px 10px',fontSize:12,outline:'none',boxSizing:'border-box',fontFamily:'inherit',color:'#1b1b1b',textAlign:'center',maxWidth:320}}
                  />
                </div>
              </div>
            ):(
              <div style={{position:'relative',borderRadius:12,overflow:'hidden',border:'1px solid #e8e8e8',background:'#fafaf9'}}>
                <img src={sanitizeImageUrl(imageUrl)} alt="Preview" style={{width:'100%',objectFit:'contain',maxHeight:240,display:'block',margin:'0 auto'}} onError={()=>{setImageUrl('');setImageMode('none');}} />

              </div>
            )}
          </div>
          {/* Hyperlink */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:'#616161',letterSpacing:'.05em',marginBottom:5}}>LINK <span style={{fontWeight:400,color:'#9e9e9e'}}>(optional)</span></div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <i className="bi-link-45deg" style={{color:'#9e9e9e',fontSize:16,flexShrink:0}}></i>
              <input value={link} onChange={e=>setLink(e.target.value)} placeholder="https://slack.com/archives/..." style={{width:'100%',border:'1px solid #e8e8e8',borderRadius:8,padding:'9px 12px',fontSize:13,outline:'none',boxSizing:'border-box',fontFamily:'inherit',color:'#1b1b1b'}} />
            </div>
          </div>
          {/* Target + Priority */}
          <div style={{display:'flex',gap:12,marginBottom:12}}>
            <div style={{flex:1}}>
              <div style={{fontSize:11,fontWeight:700,color:'#616161',letterSpacing:'.05em',marginBottom:5}}>SEND TO</div>
              <select value={target} onChange={e=>setTarget(e.target.value)} style={{width:'100%',border:'1px solid #e8e8e8',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',fontFamily:'inherit',color:'#1b1b1b',cursor:'pointer'}}>
                {AUDIENCES.map(k => (
                  <option key={k} value={k}>{AUDIENCE_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:11,fontWeight:700,color:'#616161',letterSpacing:'.05em',marginBottom:5}}>PRIORITY</div>
              <select value={priority} onChange={e=>setPriority(e.target.value)} style={{width:'100%',border:'1px solid #e8e8e8',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',fontFamily:'inherit',color:'#1b1b1b',cursor:'pointer'}}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          {/* Popup toggle */}
          <div style={{marginBottom:4,padding:'12px 14px',borderRadius:10,background:'#fafaf9',border:'1px solid #e8e8e8'}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div
                onClick={()=>setIsPopup(!isPopup)}
                style={{width:40,height:22,borderRadius:12,background:isPopup?'#1b1b1b':'#d1d5db',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}
              >
                <div style={{width:18,height:18,borderRadius:'50%',background:'white',position:'absolute',top:2,left:isPopup?20:2,transition:'left .2s',boxShadow:'0 1px 3px rgba(0,0,0,0.15)'}}/>
              </div>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:'#1b1b1b'}}>
                  <i className="bi-window-stack" style={{fontSize:12,marginRight:6}}></i>
                  Send as Popup
                </div>
                <div style={{fontSize:11,color:'#9e9e9e',marginTop:2}}>Recipients must acknowledge before they can dismiss. Plays a notification sound.</div>
              </div>
            </div>
            {/* Sound picker — only relevant for popup announcements */}
            {isPopup && (
              <div style={{marginTop:10,paddingTop:10,borderTop:'1px dashed #e0e0e0',display:'flex',alignItems:'center',gap:10}}>
                <i className="bi-music-note-beamed" style={{fontSize:13,color:'#616161'}}></i>
                <div style={{fontSize:12,fontWeight:600,color:'#616161',flexShrink:0}}>Notification Sound</div>
                <select value={soundKey} onChange={e=>setSoundKey(e.target.value)} style={{flex:1,border:'1px solid #e8e8e8',borderRadius:6,padding:'5px 8px',fontSize:12,outline:'none',fontFamily:'inherit',color:'#1b1b1b',cursor:'pointer',background:'white'}}>
                  {Object.entries(SOUND_PRESETS).map(([k,v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
        <div style={{padding:'16px 24px 24px',display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={()=>{if(valid){onSend(buildDraft('draft'));setTimeout(()=>onClose(),200);}}} disabled={!valid} style={{background:'white',border:'1px solid #dedede',color:valid?'#1b1b1b':'#dedede',borderRadius:128,padding:'10px 24px',fontSize:13,cursor:valid?'pointer':'not-allowed',fontWeight:500}}>
            Save Draft
          </button>
          <button onClick={handleSendWithPreview} disabled={!valid||submitting} style={{background:valid&&!submitting?'#1b1b1b':'#dedede',color:'white',border:'none',borderRadius:128,padding:'10px 24px',fontSize:13,cursor:valid&&!submitting?'pointer':'not-allowed',fontWeight:500,display:'flex',alignItems:'center',gap:6,opacity:submitting?.6:1}}>
            {isPopup&&<i className="bi-eye" style={{fontSize:11}}></i>}
            <i className="bi-send-fill" style={{fontSize:11}}></i>
            {submitting?'Sending…':isPopup?'Preview & Send':'Send Now'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComposeModal;
