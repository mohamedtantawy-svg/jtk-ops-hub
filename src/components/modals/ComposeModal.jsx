import { useState, useRef } from 'react';
import { COMMS_TYPES, AUDIENCES, AUDIENCE_LABELS, SOUND_PRESETS } from '../../data/comms';
import { isApprover } from '../../data/approvers';
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

// Resize + compress an uploaded image before embedding it as a data URL.
// Why: the backend receives the image inline inside a JSON body, and the
// ingress caps request size (~10 MB). Raw camera photos or high-DPI PNGs can
// easily break that ceiling. By downscaling to 1200px max + re-encoding as
// JPEG at q=0.85 we guarantee the payload stays small (<500 KB typical) and
// the 503s the user hit go away.
//
// Falls back to the original data URL if compression fails for any reason
// (e.g. PNG with transparency the user wants to keep, browser Canvas error).
function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('No file')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = (ev) => {
      const original = ev.target.result;
      const img = new Image();
      img.onerror = () => resolve(original); // fall back to raw data URL
      img.onload = () => {
        try {
          const MAX = 1200;
          let { width, height } = img;
          if (width > MAX || height > MAX) {
            if (width >= height) {
              height = Math.round((height / width) * MAX);
              width = MAX;
            } else {
              width = Math.round((width / height) * MAX);
              height = MAX;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          // Preserve PNG if the source is PNG (transparency, text screenshots).
          // JPEG for everything else — best size/quality ratio.
          const isPng = /^data:image\/png/i.test(original);
          const out = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85);
          // Safety net: if the "compressed" output is somehow larger than the
          // original (tiny PNGs sometimes inflate as JPEG), keep the original.
          resolve(out.length < original.length ? out : original);
        } catch (e) {
          resolve(original);
        }
      };
      img.src = original;
    };
    reader.readAsDataURL(file);
  });
}

// Convert a Date to a value suitable for <input type="datetime-local"> in the
// user's locale. We strip TZ info — the datetime-local control is TZ-naive.
function toDatetimeLocal(d) {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

// Default scheduled-for = now + 1h rounded up to next 15 minutes
function defaultScheduledFor() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 60);
  const over = d.getMinutes() % 15;
  if (over) d.setMinutes(d.getMinutes() + (15 - over));
  d.setSeconds(0, 0);
  return toDatetimeLocal(d);
}

const ComposeModal = ({ onClose, onSend, draft, currentUser, onSubmitRequest }) => {
  const [type,setType]=useState(draft?.type||'announce');
  const [title,setTitle]=useState(draft?.title||'');
  const [body,setBody]=useState(draft?.body||'');
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
  const [dragActive,setDragActive]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const [errorMsg,setErrorMsg]=useState('');
  const fileInputRef=useRef(null);

  // Scheduling + approval controls
  const [scheduleLater,setScheduleLater]=useState(!!draft?.scheduledFor);
  const [scheduledFor,setScheduledFor]=useState(
    draft?.scheduledFor ? toDatetimeLocal(draft.scheduledFor) : defaultScheduledFor()
  );
  const [urgentOverride,setUrgentOverride]=useState(!!draft?.urgentOverride);

  const approver = isApprover(currentUser?.email);
  const canBypassQueue = approver; // only approvers & admin-roled RMs/TLs; kept simple
  const valid = title.trim().length > 0 && (body.trim().length > 0 || !!imageUrl);

  const buildDraft = (status, extra = {}) => ({
    type, title, body, target, priority, status,
    isPopup, imageUrl, link, soundKey,
    scheduledFor: scheduleLater ? new Date(scheduledFor).toISOString() : null,
    urgentOverride: canBypassQueue && urgentOverride,
    ...extra,
  });

  // Pending: send directly (approvers only). If popup, show preview first.
  const handleDirectSend = async () => {
    if (!valid || submitting) return;
    if (isPopup && !showPreview) { setShowPreview(true); return; }
    setSubmitting(true);
    setErrorMsg('');
    try {
      await onSend(buildDraft('sent', { mode: 'direct' }));
      onClose();
    } catch (err) {
      setErrorMsg(err?.message || 'Failed to send');
      setSubmitting(false);
    }
  };

  const handleConfirmFromPreview = async () => {
    setShowPreview(false);
    await handleDirectSend();
  };

  // Pending: submit for approval (any user)
  const handleSubmitForApproval = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setErrorMsg('');
    try {
      if (!onSubmitRequest) throw new Error('Approval flow not wired up');
      await onSubmitRequest(buildDraft('pending', { mode: 'request' }));
      onClose();
    } catch (err) {
      setErrorMsg(err?.message || 'Failed to submit for approval');
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!valid) return;
    // Drafts go through the normal onSend path with status='draft'
    try {
      await onSend(buildDraft('draft', { mode: 'draft' }));
      onClose();
    } catch (err) {
      setErrorMsg(err?.message || 'Failed to save draft');
    }
  };

  if (showPreview) {
    return (
      <PreviewPopup
        draft={{ ...buildDraft('sent'), author: { id: currentUser?.id, name: currentUser?.name || 'You' } }}
        onClose={() => setShowPreview(false)}
        onConfirmSend={handleConfirmFromPreview}
      />
    );
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onClose}>
      <div style={{background:'white',borderRadius:16,width:'100%',maxWidth:620,maxHeight:'90vh',display:'flex',flexDirection:'column',boxShadow:'0 4px 24px rgba(0,0,0,0.15)',overflow:'hidden',animation:'modalIn .18s cubic-bezier(.34,1.56,.64,1) forwards'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'24px 24px 0',display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:36,height:36,borderRadius:9,background:'#e3f2fd',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <i className="bi-pencil-square" style={{color:'#1565c0',fontSize:16}}></i>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:18,fontWeight:700,color:'#1b1b1b'}}>{draft?.id?'Edit Draft':'New Announcement'}</div>
            <div style={{fontSize:12,color:'#9e9e9e'}}>
              {canBypassQueue
                ? 'You can send directly or submit for approval.'
                : 'Your request will go to the approval queue.'}
            </div>
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
                <button onClick={()=>{setImageUrl('');if(fileInputRef.current)fileInputRef.current.value='';}} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',color:'#d42d35',fontSize:10,fontWeight:600,display:'flex',alignItems:'center',gap:3,padding:0}}>
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
                    if(file.size>10*1024*1024){alert('Image must be under 10MB');return;}
                    compressImageFile(file).then(setImageUrl).catch(()=>{
                      const reader=new FileReader();
                      reader.onload=ev=>setImageUrl(ev.target.result);
                      reader.readAsDataURL(file);
                    });
                  }
                }}
                style={{border:`2px dashed ${dragActive?'#6b3fa0':'#e0e0e0'}`,borderRadius:12,padding:'20px 16px',textAlign:'center',background:dragActive?'#f9f5ff':'#fafaf9',cursor:'pointer',transition:'all .15s'}}
                onClick={()=>fileInputRef.current?.click()}
              >
                <input ref={fileInputRef} type="file" accept="image/*" style={{display:'none'}} onChange={e=>{
                  const file=e.target.files?.[0];
                  if(file&&file.type.startsWith('image/')){
                    if(file.size>10*1024*1024){alert('Image must be under 10MB');return;}
                    compressImageFile(file).then(setImageUrl).catch(()=>{
                      const reader=new FileReader();
                      reader.onload=ev=>setImageUrl(ev.target.result);
                      reader.readAsDataURL(file);
                    });
                  }
                }}/>
                <i className="bi-cloud-arrow-up" style={{fontSize:24,color:dragActive?'#6b3fa0':'#b5b5b5',display:'block',marginBottom:6}}></i>
                <div style={{fontSize:12,fontWeight:600,color:'#616161'}}>Click to upload or drag & drop</div>
                <div style={{fontSize:11,color:'#9e9e9e',marginTop:3}}>PNG, JPG, GIF, WebP up to 10MB — we'll compress it for you</div>
                <div style={{display:'flex',alignItems:'center',gap:8,justifyContent:'center',marginTop:10}}>
                  <div style={{height:1,flex:1,background:'#e8e8e8'}}></div>
                  <span style={{fontSize:10,color:'#9e9e9e',fontWeight:600}}>OR</span>
                  <div style={{height:1,flex:1,background:'#e8e8e8'}}></div>
                </div>
                <div style={{marginTop:8}} onClick={e=>e.stopPropagation()}>
                  <input placeholder="Paste image URL here..." onKeyDown={e=>{if(e.key==='Enter'){const safe=sanitizeImageUrl(e.target.value);if(safe)setImageUrl(safe);}}}
                    onBlur={e=>{const safe=sanitizeImageUrl(e.target.value);if(safe)setImageUrl(safe);}}
                    style={{width:'100%',border:'1px solid #e8e8e8',borderRadius:8,padding:'7px 10px',fontSize:12,outline:'none',boxSizing:'border-box',fontFamily:'inherit',color:'#1b1b1b',textAlign:'center',maxWidth:320}}
                  />
                </div>
              </div>
            ):(
              <div style={{position:'relative',borderRadius:12,overflow:'hidden',border:'1px solid #e8e8e8',background:'#fafaf9'}}>
                <img src={sanitizeImageUrl(imageUrl)} alt="Preview" style={{width:'100%',objectFit:'contain',maxHeight:240,display:'block',margin:'0 auto'}} onError={()=>setImageUrl('')} />
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
          <div style={{marginBottom:10,padding:'12px 14px',borderRadius:10,background:'#fafaf9',border:'1px solid #e8e8e8'}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div onClick={()=>setIsPopup(!isPopup)}
                style={{width:40,height:22,borderRadius:12,background:isPopup?'#1b1b1b':'#d1d5db',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
                <div style={{width:18,height:18,borderRadius:'50%',background:'white',position:'absolute',top:2,left:isPopup?20:2,transition:'left .2s',boxShadow:'0 1px 3px rgba(0,0,0,0.15)'}}/>
              </div>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:'#1b1b1b'}}>
                  <i className="bi-window-stack" style={{fontSize:12,marginRight:6}}></i>
                  Send as Popup
                </div>
                <div style={{fontSize:11,color:'#9e9e9e',marginTop:2}}>Recipients must acknowledge before dismissing. Plays a notification sound.</div>
              </div>
            </div>
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

          {/* Schedule for later */}
          <div style={{marginBottom:10,padding:'12px 14px',borderRadius:10,background:'#fafaf9',border:'1px solid #e8e8e8'}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div onClick={()=>setScheduleLater(!scheduleLater)}
                style={{width:40,height:22,borderRadius:12,background:scheduleLater?'#1b1b1b':'#d1d5db',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
                <div style={{width:18,height:18,borderRadius:'50%',background:'white',position:'absolute',top:2,left:scheduleLater?20:2,transition:'left .2s',boxShadow:'0 1px 3px rgba(0,0,0,0.15)'}}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:'#1b1b1b'}}>
                  <i className="bi-clock" style={{fontSize:12,marginRight:6}}></i>
                  Schedule for later
                </div>
                <div style={{fontSize:11,color:'#9e9e9e',marginTop:2}}>
                  Pick a date & time. We'll publish automatically at that moment.
                </div>
              </div>
            </div>
            {scheduleLater && (
              <div style={{marginTop:10,paddingTop:10,borderTop:'1px dashed #e0e0e0',display:'flex',alignItems:'center',gap:10}}>
                <i className="bi-calendar-event" style={{fontSize:13,color:'#616161'}}></i>
                <input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={e=>setScheduledFor(e.target.value)}
                  style={{flex:1,border:'1px solid #e8e8e8',borderRadius:6,padding:'6px 10px',fontSize:13,outline:'none',fontFamily:'inherit',color:'#1b1b1b'}}
                />
              </div>
            )}
          </div>

          {/* Urgent override — approvers only */}
          {canBypassQueue && (
            <div style={{marginBottom:10,padding:'10px 14px',borderRadius:10,background:'#fff7e6',border:'1px solid #fcd79a'}}>
              <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
                <input type="checkbox" checked={urgentOverride} onChange={e=>setUrgentOverride(e.target.checked)} />
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:'#8a5a00'}}>
                    <i className="bi-exclamation-triangle" style={{fontSize:12,marginRight:6}}></i>
                    Urgent — override publishing limits
                  </div>
                  <div style={{fontSize:11,color:'#a17a2c',marginTop:2}}>Skips the 2-per-day cap and 4-hour gap rule. Only use for time-critical communications.</div>
                </div>
              </label>
            </div>
          )}

          {/* Error surface */}
          {errorMsg && (
            <div style={{padding:'10px 14px',borderRadius:10,background:'#fdecea',border:'1px solid #f5bcbc',color:'#b02020',fontSize:12,marginBottom:8}}>
              <i className="bi-exclamation-octagon" style={{marginRight:6}}></i>
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{padding:'16px 24px 24px',display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid #f2f2f2',background:'#fafaf9'}}>
          <button onClick={handleSaveDraft} disabled={!valid||submitting} style={{background:'white',border:'1px solid #dedede',color:valid?'#1b1b1b':'#dedede',borderRadius:128,padding:'10px 20px',fontSize:13,cursor:valid?'pointer':'not-allowed',fontWeight:500}}>
            Save Draft
          </button>
          {canBypassQueue && (
            <button onClick={handleSubmitForApproval} disabled={!valid||submitting} style={{background:'white',border:'1px solid #dedede',color:valid?'#1b1b1b':'#dedede',borderRadius:128,padding:'10px 20px',fontSize:13,cursor:valid?'pointer':'not-allowed',fontWeight:500}}>
              <i className="bi-inbox" style={{fontSize:11,marginRight:4}}></i>
              Submit for approval
            </button>
          )}
          {canBypassQueue ? (
            <button onClick={handleDirectSend} disabled={!valid||submitting} style={{background:valid&&!submitting?'#1b1b1b':'#dedede',color:'white',border:'none',borderRadius:128,padding:'10px 22px',fontSize:13,cursor:valid&&!submitting?'pointer':'not-allowed',fontWeight:600,display:'flex',alignItems:'center',gap:6,opacity:submitting?.6:1}}>
              {isPopup&&<i className="bi-eye" style={{fontSize:11}}></i>}
              <i className={scheduleLater?'bi-calendar-event':'bi-send-fill'} style={{fontSize:11}}></i>
              {submitting?'Sending…':scheduleLater?'Schedule send':isPopup?'Preview & Send':'Send now'}
            </button>
          ) : (
            <button onClick={handleSubmitForApproval} disabled={!valid||submitting} style={{background:valid&&!submitting?'#1b1b1b':'#dedede',color:'white',border:'none',borderRadius:128,padding:'10px 22px',fontSize:13,cursor:valid&&!submitting?'pointer':'not-allowed',fontWeight:600,display:'flex',alignItems:'center',gap:6,opacity:submitting?.6:1}}>
              <i className="bi-inbox" style={{fontSize:11}}></i>
              {submitting?'Submitting…':'Submit for approval'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ComposeModal;
