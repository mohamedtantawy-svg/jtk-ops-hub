import { useState, useRef, useEffect } from 'react';
import { COMMS_TYPES, AUDIENCES, AUDIENCE_LABELS, SOUND_PRESETS } from '../../data/comms';
import { isApprover } from '../../data/approvers';
import { listMentionGroups } from '../../services/mentionGroupsApi';
import PreviewPopup from './PreviewPopup';
import AnnouncementMedia, { isAnnouncementVideo } from '../ui/AnnouncementMedia';

// Accept image AND video data URLs — the same DB field carries both, the
// popup renderer picks `<video>` vs `<img>` based on the prefix.
const sanitizeImageUrl=(url)=>{
  if(!url)return '';
  try{
    const parsed=new URL(url.trim());
    if(parsed.protocol==='http:'||parsed.protocol==='https:')return parsed.href;
    if(parsed.protocol==='data:'){
      if(parsed.href.startsWith('data:image/')) return parsed.href;
      if(parsed.href.startsWith('data:video/')) return parsed.href;
    }
  }catch(e){}
  return '';
};

const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']);

// Video can't be canvas-compressed like images. Just enforce the size cap
// and read it as a data URL. Returns null for unsupported types so the
// drop/upload handlers can surface a clean error.
function videoFileToDataUrl(file) {
  return new Promise((resolve) => {
    if (!file || !VIDEO_MIMES.has(file.type)) { resolve(null); return; }
    if (file.size > MEDIA_MAX_BYTES) { resolve(null); return; }
    const r = new FileReader();
    r.onerror = () => resolve(null);
    r.onload = () => resolve(r.result || null);
    r.readAsDataURL(file);
  });
}

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
  // Tag-group id when the target is a custom group. Stays null for region/
  // role audiences; set when the picker selects a "Tag Group" option.
  const [targetGroupId,setTargetGroupId]=useState(draft?.targetGroupId || null);
  // Mention groups list — loaded once when the modal opens so the picker
  // can include them alongside the region audiences. Best-effort: if the
  // call fails (network blip, no groups yet), the picker still works with
  // only the canonical audiences.
  const [mentionGroups,setMentionGroups]=useState([]);
  useEffect(()=>{
    let cancelled=false;
    listMentionGroups()
      .then(res=>{
        // /api/v1/mention-groups returns { groups: [...] } (verified live
        // 2026-05-11). The original `res?.items` read silently produced an
        // empty array even when groups existed, so the Tag Groups optgroup
        // never rendered. Matches the existing reader in
        // ManageMentionGroupsModal.jsx.
        if (cancelled) return;
        const list = Array.isArray(res?.groups) ? res.groups
                   : Array.isArray(res?.items)  ? res.items
                   : [];
        setMentionGroups(list);
      })
      .catch(()=>{ /* swallow — picker falls back to audience-only options */ });
    return ()=>{ cancelled=true; };
  },[]);
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
  // Body textarea ref + popover state for inline-link insertion. Inserts a
  // `[label](url)` markdown token at the caret so the renderer (see
  // src/utils/renderRichText.jsx) shows it as a real <a> tag in the published
  // announcement.
  const bodyRef=useRef(null);
  const [showLinkInsert,setShowLinkInsert]=useState(false);
  const [linkInsertLabel,setLinkInsertLabel]=useState('');
  const [linkInsertUrl,setLinkInsertUrl]=useState('');
  const insertBodyLink=()=>{
    const label=(linkInsertLabel||'').trim();
    const rawUrl=(linkInsertUrl||'').trim();
    if(!rawUrl)return;
    let url=rawUrl;
    // Make the link safe: require http/https. Reject anything else (incl.
    // `javascript:` and `data:` payloads) so a malicious composer can't
    // craft a clickable XSS vector for every recipient.
    if(!/^https?:\/\//i.test(url))url=`https://${url}`;
    try{
      const parsed=new URL(url);
      if(parsed.protocol!=='http:'&&parsed.protocol!=='https:')return;
    }catch{return;}
    const visible=label||url;
    const token=`[${visible}](${url})`;
    const ta=bodyRef.current;
    if(ta&&typeof ta.selectionStart==='number'){
      const start=ta.selectionStart;
      const end=ta.selectionEnd||start;
      const before=body.slice(0,start);
      const after=body.slice(end);
      // If the user had selected text, treat it as the label so they can
      // turn an existing word into a link without retyping.
      const inserted=(end>start&&!label)?`[${body.slice(start,end)}](${url})`:token;
      const next=`${before}${inserted}${after}`;
      setBody(next);
      requestAnimationFrame(()=>{
        try{ta.focus();const caret=before.length+inserted.length;ta.setSelectionRange(caret,caret);}catch{}
      });
    }else{
      setBody(prev=>prev?`${prev}${prev.endsWith(' ')?'':' '}${token}`:token);
    }
    setShowLinkInsert(false);
    setLinkInsertLabel('');
    setLinkInsertUrl('');
  };

  // Scheduling + approval controls
  const [scheduleLater,setScheduleLater]=useState(!!draft?.scheduledFor);
  const [scheduledFor,setScheduledFor]=useState(
    draft?.scheduledFor ? toDatetimeLocal(draft.scheduledFor) : defaultScheduledFor()
  );
  // ── Poll (2026-06-03, Laura Llopis "Polls in Ops Hub") ─────────────────────
  // An optional poll rides the announcement; the title above is its question.
  // Offered only on the direct-send path (canBypassQueue) for v1 — the
  // approval-queue request flow doesn't carry a poll yet, so we hide the editor
  // for queue-only authors rather than silently drop their poll on submit.
  const [pollEnabled,setPollEnabled]=useState(!!draft?.poll);
  const [pollOptions,setPollOptions]=useState(
    Array.isArray(draft?.poll?.options) && draft.poll.options.length >= 2
      ? draft.poll.options.map(o => (typeof o === 'string' ? o : (o?.label || '')))
      : ['', '']
  );
  const [pollMultiple,setPollMultiple]=useState(!!draft?.poll?.allowMultiple);
  const [pollClosesEnabled,setPollClosesEnabled]=useState(!!draft?.poll?.closesAt);
  const [pollClosesAt,setPollClosesAt]=useState(
    draft?.poll?.closesAt ? toDatetimeLocal(new Date(draft.poll.closesAt)) : defaultScheduledFor()
  );
  const approver = isApprover(currentUser?.email);
  // `canBypassQueue` historically also gated the urgent-override UI
  // (since removed 2026-05-14). It now only controls whether the
  // composer offers a direct-send path vs queueing for approval — the
  // approval workflow itself is unchanged.
  const canBypassQueue = approver;
  // Trimmed, non-empty poll option labels — drives both validation and the
  // payload. A poll needs ≥ 2 real options before the announcement can publish.
  const pollOptionLabels = pollOptions.map(o => o.trim()).filter(Boolean);
  const pollValid = !pollEnabled || pollOptionLabels.length >= 2;
  const valid =
    title.trim().length > 0 &&
    (body.trim().length > 0 || !!imageUrl) &&
    pollValid;

  const buildDraft = (status, extra = {}) => ({
    type, title, body,
    target,
    // Only send a group id when the audience IS a group — clears any
    // stale id left over from a previous picker session.
    targetGroupId: target === 'group' ? (targetGroupId || null) : null,
    priority, status,
    isPopup, imageUrl, link, soundKey,
    scheduledFor: scheduleLater ? new Date(scheduledFor).toISOString() : null,
    // Optional poll. Server assigns stable option ids; we send labels only.
    // null when disabled or under-specified so a half-built poll never ships.
    poll: (pollEnabled && pollOptionLabels.length >= 2)
      ? {
          options: pollOptionLabels.map(label => ({ label })),
          allowMultiple: pollMultiple,
          closesAt: (pollClosesEnabled && pollClosesAt) ? new Date(pollClosesAt).toISOString() : null,
        }
      : null,
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
    <div
      style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center'}}
      // 2026-05-22 — Olga Pastuszak "The Announcement window vanishes
      // while editing text". Drag-selecting text inside an input/textarea
      // and releasing the mouse outside the modal used to fire a `click`
      // on the backdrop (browsers fire click on the common ancestor of
      // mousedown + mouseup, which is the backdrop when one foot is
      // outside) — `onClick={onClose}` then discarded the draft. Switch
      // to mousedown-on-backdrop-ONLY: only fire close when the gesture
      // actually started on the backdrop (`e.target === e.currentTarget`).
      // Mirrors CreateFeedbackModal / CreateLeaderAlertModal etc., which
      // use the same pattern. Clicks/drags that originate inside the
      // modal never reach this handler with target === currentTarget.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{background:'var(--surface)',borderRadius:16,width:'100%',maxWidth:620,maxHeight:'90vh',display:'flex',flexDirection:'column',boxShadow:'0 4px 24px rgba(0,0,0,0.15)',overflow:'hidden',animation:'modalIn .18s cubic-bezier(.34,1.56,.64,1) forwards'}} onMouseDown={e=>e.stopPropagation()}>
        <div style={{padding:'24px 24px 0',display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:36,height:36,borderRadius:9,background:'#e3f2fd',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <i className="bi-pencil-square" style={{color:'#1565c0',fontSize:16}}></i>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:18,fontWeight:700,color:'var(--text)'}}>{draft?.id?'Edit Draft':'New Announcement'}</div>
            <div style={{fontSize:12,color:'var(--text-muted)'}}>
              {canBypassQueue
                ? 'You can send directly or submit for approval.'
                : 'Your request will go to the approval queue.'}
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} style={{width:32,height:32,borderRadius:'50%',background:'#f2f2f2',border:'none',cursor:'pointer',color:'var(--text-secondary)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}><i className="bi-x-lg"></i></button>
        </div>

        <div style={{flex:1,overflowY:'auto',padding:'16px 24px'}}>
          {/* Type */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:'var(--text-secondary)',letterSpacing:'.05em',marginBottom:6}}>TYPE</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {Object.entries(COMMS_TYPES).map(([k,v])=>(
                <button key={k} onClick={()=>setType(k)} style={{display:'inline-flex',alignItems:'center',gap:5,height:30,padding:'0 12px',borderRadius:128,border:`1px solid ${type===k?v.color:v.border}`,background:type===k?v.bg:'white',color:type===k?v.color:'var(--text-secondary)',fontSize:12,cursor:'pointer',fontWeight:type===k?700:400,transition:'all .15s'}}>
                  <i className={v.icon} style={{fontSize:11}}></i>{v.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:'var(--text-secondary)',letterSpacing:'.05em',marginBottom:5}}>TITLE</div>
            <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Updated SOP: Termination Ownership Transfer" style={{width:'100%',border:'1px solid var(--border)',borderRadius:8,padding:'9px 12px',fontSize:13,outline:'none',boxSizing:'border-box',fontFamily:'inherit',color:'var(--text)'}} />
          </div>

          {/* Body */}
          <div style={{marginBottom:12}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:5}}>
              <div style={{fontSize:11,fontWeight:700,color:'var(--text-secondary)',letterSpacing:'.05em'}}>MESSAGE {imageUrl&&<span style={{fontWeight:400,color:'var(--text-muted)'}}>(optional if image attached)</span>}</div>
              <span style={{flex:1}} />
              <button
                type="button"
                onClick={()=>setShowLinkInsert(v=>!v)}
                title="Insert a link inside the message — recipients see the label as a clickable hyperlink"
                style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 10px',borderRadius:128,border:'1px solid var(--border)',background:showLinkInsert?'#f3eff8':'white',color:showLinkInsert?'#6b3fa0':'#616161',fontSize:11,fontWeight:600,cursor:'pointer',transition:'all .12s'}}
              >
                <i className="bi-link-45deg" style={{fontSize:12}} />
                Insert link
              </button>
            </div>
            <textarea ref={bodyRef} value={body} onChange={e=>setBody(e.target.value)} rows={5} placeholder={imageUrl?"Add a caption or message (optional)...":"Write your announcement, update, or guidance here..."} style={{width:'100%',border:'1px solid var(--border)',borderRadius:8,padding:'9px 12px',fontSize:13,outline:'none',boxSizing:'border-box',resize:'vertical',fontFamily:'inherit',color:'var(--text)',lineHeight:1.6}}/>
            {showLinkInsert && (
              <div style={{marginTop:8,padding:'10px 12px',background:'#fbfafc',border:'1px solid #ebe5f4',borderRadius:10}}>
                <div style={{fontSize:11,fontWeight:700,color:'#6b3fa0',letterSpacing:'.05em',marginBottom:6,display:'flex',alignItems:'center',gap:6}}>
                  <i className="bi-link-45deg" style={{fontSize:11}} />
                  Insert hyperlink
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1.4fr auto',gap:8,alignItems:'center'}}>
                  <input
                    value={linkInsertLabel}
                    onChange={e=>setLinkInsertLabel(e.target.value)}
                    placeholder="Visible text (e.g. Open SOP)"
                    style={{border:'1px solid var(--border)',borderRadius:8,padding:'7px 10px',fontSize:12,outline:'none',boxSizing:'border-box',fontFamily:'inherit',color:'var(--text)'}}
                  />
                  <input
                    value={linkInsertUrl}
                    onChange={e=>setLinkInsertUrl(e.target.value)}
                    onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); insertBodyLink(); } }}
                    placeholder="https://..."
                    style={{border:'1px solid var(--border)',borderRadius:8,padding:'7px 10px',fontSize:12,outline:'none',boxSizing:'border-box',fontFamily:'inherit',color:'var(--text)'}}
                  />
                  <button
                    type="button"
                    onClick={insertBodyLink}
                    disabled={!linkInsertUrl.trim()}
                    style={{padding:'7px 14px',borderRadius:8,border:'none',background:linkInsertUrl.trim()?'#6b3fa0':'#e8e8e8',color:linkInsertUrl.trim()?'white':'#9e9e9e',fontSize:12,fontWeight:700,cursor:linkInsertUrl.trim()?'pointer':'default',whiteSpace:'nowrap'}}
                  >
                    Insert
                  </button>
                </div>
                <div style={{fontSize:10,color:'var(--text-muted)',marginTop:6,lineHeight:1.5}}>
                  Tip: select text first to turn it into a link, or paste a bare URL — recipients can click it directly. Use <code style={{background:'var(--surface)',padding:'1px 5px',borderRadius:4,border:'1px solid #ebe5f4',fontSize:10}}>[label](https://…)</code> syntax to type one inline.
                </div>
              </div>
            )}
          </div>

          {/* Media (image or video — upload or URL) */}
          <div style={{marginBottom:12}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
              <div style={{fontSize:11,fontWeight:700,color:'var(--text-secondary)',letterSpacing:'.05em'}}>MEDIA <span style={{fontWeight:400,color:'var(--text-muted)'}}>(optional · image or video)</span></div>
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
                onDrop={async e=>{
                  e.preventDefault();setDragActive(false);
                  const file=e.dataTransfer.files?.[0];
                  if(!file)return;
                  if(file.type.startsWith('image/')){
                    if(file.size>MEDIA_MAX_BYTES){alert('Image must be under 10MB');return;}
                    compressImageFile(file).then(setImageUrl).catch(()=>{
                      const reader=new FileReader();
                      reader.onload=ev=>setImageUrl(ev.target.result);
                      reader.readAsDataURL(file);
                    });
                  } else if(file.type.startsWith('video/')){
                    const dataUrl=await videoFileToDataUrl(file);
                    if(!dataUrl){alert('Video must be MP4 / WebM / MOV under 10MB');return;}
                    setImageUrl(dataUrl);
                  }
                }}
                style={{border:`2px dashed ${dragActive?'#6b3fa0':'#e0e0e0'}`,borderRadius:12,padding:'20px 16px',textAlign:'center',background:dragActive?'#f9f5ff':'#fafaf9',cursor:'pointer',transition:'all .15s'}}
                onClick={()=>fileInputRef.current?.click()}
              >
                <input ref={fileInputRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime,video/x-m4v" style={{display:'none'}} onChange={async e=>{
                  const file=e.target.files?.[0];
                  if(!file)return;
                  if(file.type.startsWith('image/')){
                    if(file.size>MEDIA_MAX_BYTES){alert('Image must be under 10MB');return;}
                    compressImageFile(file).then(setImageUrl).catch(()=>{
                      const reader=new FileReader();
                      reader.onload=ev=>setImageUrl(ev.target.result);
                      reader.readAsDataURL(file);
                    });
                  } else if(file.type.startsWith('video/')){
                    const dataUrl=await videoFileToDataUrl(file);
                    if(!dataUrl){alert('Video must be MP4 / WebM / MOV under 10MB');return;}
                    setImageUrl(dataUrl);
                  }
                }}/>
                <i className="bi-cloud-arrow-up" style={{fontSize:24,color:dragActive?'#6b3fa0':'#b5b5b5',display:'block',marginBottom:6}}></i>
                <div style={{fontSize:12,fontWeight:600,color:'var(--text-secondary)'}}>Click to upload or drag & drop</div>
                <div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>PNG, JPG, GIF, WebP, MP4, WebM, MOV up to 10MB</div>
                <div style={{display:'flex',alignItems:'center',gap:8,justifyContent:'center',marginTop:10}}>
                  <div style={{height:1,flex:1,background:'#e8e8e8'}}></div>
                  <span style={{fontSize:10,color:'var(--text-muted)',fontWeight:600}}>OR</span>
                  <div style={{height:1,flex:1,background:'#e8e8e8'}}></div>
                </div>
                <div style={{marginTop:8}} onClick={e=>e.stopPropagation()}>
                  <input placeholder="Paste image URL here..." onKeyDown={e=>{if(e.key==='Enter'){const safe=sanitizeImageUrl(e.target.value);if(safe)setImageUrl(safe);}}}
                    onBlur={e=>{const safe=sanitizeImageUrl(e.target.value);if(safe)setImageUrl(safe);}}
                    style={{width:'100%',border:'1px solid var(--border)',borderRadius:8,padding:'7px 10px',fontSize:12,outline:'none',boxSizing:'border-box',fontFamily:'inherit',color:'var(--text)',textAlign:'center',maxWidth:320}}
                  />
                </div>
              </div>
            ):(
              <div style={{position:'relative',borderRadius:12,overflow:'hidden',border:'1px solid var(--border)',background:'var(--surface-2)'}}>
                <AnnouncementMedia
                  src={sanitizeImageUrl(imageUrl)}
                  alt="Preview"
                  style={{width:'100%',objectFit:'contain',maxHeight:240,display:'block',margin:'0 auto'}}
                />
              </div>
            )}
          </div>

          {/* Hyperlink */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:'var(--text-secondary)',letterSpacing:'.05em',marginBottom:5}}>LINK <span style={{fontWeight:400,color:'var(--text-muted)'}}>(optional)</span></div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <i className="bi-link-45deg" style={{color:'var(--text-muted)',fontSize:16,flexShrink:0}}></i>
              <input value={link} onChange={e=>setLink(e.target.value)} placeholder="https://slack.com/archives/..." style={{width:'100%',border:'1px solid var(--border)',borderRadius:8,padding:'9px 12px',fontSize:13,outline:'none',boxSizing:'border-box',fontFamily:'inherit',color:'var(--text)'}} />
            </div>
          </div>

          {/* Poll (optional) — direct-send authors only for v1 (the approval
              queue doesn't carry a poll yet, so we hide it for queue-only
              authors rather than drop their poll silently on submit). */}
          {canBypassQueue && (
          <div style={{marginBottom:12}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:pollEnabled?8:0}}>
              <div style={{fontSize:11,fontWeight:700,color:'var(--text-secondary)',letterSpacing:'.05em'}}>POLL <span style={{fontWeight:400,color:'var(--text-muted)'}}>(optional)</span></div>
              <span style={{flex:1}} />
              <label style={{display:'inline-flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,fontWeight:600,color:'var(--text-secondary)'}}>
                <input type="checkbox" checked={pollEnabled} onChange={e=>setPollEnabled(e.target.checked)} />
                Add a poll
              </label>
            </div>
            {pollEnabled && (
              <div style={{padding:12,border:'1px solid var(--border)',borderRadius:10,background:'var(--surface-2)'}}>
                <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:8}}>Recipients vote inline. The title above is the poll question.</div>
                {pollOptions.map((opt,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                    <i className="bi-circle" style={{fontSize:12,color:'var(--text-muted)',flexShrink:0}} />
                    <input
                      value={opt}
                      onChange={e=>setPollOptions(prev=>prev.map((o,idx)=>idx===i?e.target.value:o))}
                      placeholder={`Option ${i+1}`}
                      maxLength={200}
                      style={{flex:1,minWidth:0,border:'1px solid var(--border)',borderRadius:8,padding:'7px 10px',fontSize:13,outline:'none',boxSizing:'border-box',fontFamily:'inherit',color:'var(--text)',background:'var(--surface)'}}
                    />
                    {pollOptions.length>2 && (
                      <button type="button" onClick={()=>setPollOptions(prev=>prev.filter((_,idx)=>idx!==i))} aria-label={`Remove option ${i+1}`} title="Remove option" style={{background:'none',border:'none',cursor:'pointer',color:'#d42d35',fontSize:13,flexShrink:0,padding:4,lineHeight:1}}>
                        <i className="bi-x-lg" />
                      </button>
                    )}
                  </div>
                ))}
                {pollOptions.length<10 && (
                  <button type="button" onClick={()=>setPollOptions(prev=>[...prev,''])} style={{display:'inline-flex',alignItems:'center',gap:5,background:'none',border:'none',cursor:'pointer',color:'#6b3fa0',fontSize:12,fontWeight:600,padding:'2px 0'}}>
                    <i className="bi-plus-lg" style={{fontSize:11}} /> Add option
                  </button>
                )}
                <div style={{display:'flex',alignItems:'center',gap:16,marginTop:10,flexWrap:'wrap'}}>
                  <label style={{display:'inline-flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:'var(--text-secondary)'}}>
                    <input type="checkbox" checked={pollMultiple} onChange={e=>setPollMultiple(e.target.checked)} />
                    Allow multiple answers
                  </label>
                  <label style={{display:'inline-flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:'var(--text-secondary)'}}>
                    <input type="checkbox" checked={pollClosesEnabled} onChange={e=>setPollClosesEnabled(e.target.checked)} />
                    Set a close date
                  </label>
                  {pollClosesEnabled && (
                    <input type="datetime-local" value={pollClosesAt} onChange={e=>setPollClosesAt(e.target.value)} style={{border:'1px solid var(--border)',borderRadius:8,padding:'6px 10px',fontSize:12,outline:'none',fontFamily:'inherit',color:'var(--text)',background:'var(--surface)'}} />
                  )}
                </div>
                {!pollValid && (
                  <div style={{fontSize:11,color:'#d97706',marginTop:8}}>
                    <i className="bi-exclamation-triangle" style={{marginRight:4}} />Add at least 2 options to publish the poll.
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {/* Target + Priority */}
          <div style={{display:'flex',gap:12,marginBottom:12}}>
            <div style={{flex:1}}>
              <div style={{fontSize:11,fontWeight:700,color:'var(--text-secondary)',letterSpacing:'.05em',marginBottom:5}}>SEND TO</div>
              <select
                value={target === 'group' && targetGroupId ? `group:${targetGroupId}` : target}
                onChange={e=>{
                  const v = e.target.value;
                  if (v.startsWith('group:')) {
                    setTarget('group');
                    setTargetGroupId(v.slice('group:'.length));
                  } else {
                    setTarget(v);
                    setTargetGroupId(null);
                  }
                }}
                style={{width:'100%',border:'1px solid var(--border)',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',fontFamily:'inherit',color:'var(--text)',cursor:'pointer'}}
              >
                <optgroup label="Audiences">
                  {AUDIENCES.map(k => (
                    <option key={k} value={k}>{AUDIENCE_LABELS[k]}</option>
                  ))}
                </optgroup>
                {mentionGroups.length > 0 && (
                  <optgroup label="Tag Groups">
                    {mentionGroups.map(g => (
                      <option key={g.id} value={`group:${g.id}`}>
                        @{g.handle}{g.name ? ` — ${g.name}` : ''} ({g.memberCount ?? (Array.isArray(g.members) ? g.members.length : 0)})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:11,fontWeight:700,color:'var(--text-secondary)',letterSpacing:'.05em',marginBottom:5}}>PRIORITY</div>
              <select value={priority} onChange={e=>setPriority(e.target.value)} style={{width:'100%',border:'1px solid var(--border)',borderRadius:8,padding:'8px 10px',fontSize:13,outline:'none',fontFamily:'inherit',color:'var(--text)',cursor:'pointer'}}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          {/* Popup toggle */}
          <div style={{marginBottom:10,padding:'12px 14px',borderRadius:10,background:'var(--surface-2)',border:'1px solid var(--border)'}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div onClick={()=>setIsPopup(!isPopup)}
                style={{width:40,height:22,borderRadius:12,background:isPopup?'#1b1b1b':'#d1d5db',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
                <div style={{width:18,height:18,borderRadius:'50%',background:'var(--surface)',position:'absolute',top:2,left:isPopup?20:2,transition:'left .2s',boxShadow:'0 1px 3px rgba(0,0,0,0.15)'}}/>
              </div>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>
                  <i className="bi-window-stack" style={{fontSize:12,marginRight:6}}></i>
                  Send as Popup
                </div>
                <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>Recipients must acknowledge before dismissing. Plays a notification sound.</div>
              </div>
            </div>
            {isPopup && (
              <div style={{marginTop:10,paddingTop:10,borderTop:'1px dashed #e0e0e0',display:'flex',alignItems:'center',gap:10}}>
                <i className="bi-music-note-beamed" style={{fontSize:13,color:'var(--text-secondary)'}}></i>
                <div style={{fontSize:12,fontWeight:600,color:'var(--text-secondary)',flexShrink:0}}>Notification Sound</div>
                <select value={soundKey} onChange={e=>setSoundKey(e.target.value)} style={{flex:1,border:'1px solid var(--border)',borderRadius:6,padding:'5px 8px',fontSize:12,outline:'none',fontFamily:'inherit',color:'var(--text)',cursor:'pointer',background:'var(--surface)'}}>
                  {Object.entries(SOUND_PRESETS).map(([k,v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Schedule for later */}
          <div style={{marginBottom:10,padding:'12px 14px',borderRadius:10,background:'var(--surface-2)',border:'1px solid var(--border)'}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div onClick={()=>setScheduleLater(!scheduleLater)}
                style={{width:40,height:22,borderRadius:12,background:scheduleLater?'#1b1b1b':'#d1d5db',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
                <div style={{width:18,height:18,borderRadius:'50%',background:'var(--surface)',position:'absolute',top:2,left:scheduleLater?20:2,transition:'left .2s',boxShadow:'0 1px 3px rgba(0,0,0,0.15)'}}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>
                  <i className="bi-clock" style={{fontSize:12,marginRight:6}}></i>
                  Schedule for later
                </div>
                <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>
                  Pick a date & time. We'll publish automatically at that moment.
                </div>
              </div>
            </div>
            {scheduleLater && (
              <div style={{marginTop:10,paddingTop:10,borderTop:'1px dashed #e0e0e0',display:'flex',alignItems:'center',gap:10}}>
                <i className="bi-calendar-event" style={{fontSize:13,color:'var(--text-secondary)'}}></i>
                <input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={e=>setScheduledFor(e.target.value)}
                  style={{flex:1,border:'1px solid var(--border)',borderRadius:6,padding:'6px 10px',fontSize:13,outline:'none',fontFamily:'inherit',color:'var(--text)'}}
                />
              </div>
            )}
          </div>

          {/* Urgent override block removed 2026-05-14 — the publishing
              rate limits it bypassed are no longer in place. */}

          {/* Error surface */}
          {errorMsg && (
            <div style={{padding:'10px 14px',borderRadius:10,background:'#fdecea',border:'1px solid #f5bcbc',color:'#b02020',fontSize:12,marginBottom:8}}>
              <i className="bi-exclamation-octagon" style={{marginRight:6}}></i>
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{padding:'16px 24px 24px',display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid #f2f2f2',background:'var(--surface-2)'}}>
          <button onClick={handleSaveDraft} disabled={!valid||submitting} style={{background:'var(--surface)',border:'1px solid #dedede',color:valid?'#1b1b1b':'#dedede',borderRadius:128,padding:'10px 20px',fontSize:13,cursor:valid?'pointer':'not-allowed',fontWeight:500}}>
            Save Draft
          </button>
          {canBypassQueue && (
            <button onClick={handleSubmitForApproval} disabled={!valid||submitting} style={{background:'var(--surface)',border:'1px solid #dedede',color:valid?'#1b1b1b':'#dedede',borderRadius:128,padding:'10px 20px',fontSize:13,cursor:valid?'pointer':'not-allowed',fontWeight:500}}>
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
