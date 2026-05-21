// ── WhatsNewTour ─────────────────────────────────────────────────────────────
// One-time training overlay that walks every Ops Hub user through the May 2026
// release (HR Hub, Workspace rebrand, Hide Task, Escalate from Q, Urgent
// Assist, fresh Quick Create menu).
//
// Show-once contract:
//   • localStorage key `ops_hub_whats_new_v1` is the seen-flag.
//   • The tour mounts when the key is absent, runs through to the final step,
//     and writes the flag on either "Got it" OR "Skip" (so closing it never
//     re-prompts).
//   • Future releases bump the version suffix (`_v2`, …) to re-prompt
//     everyone without disturbing this run's seen-flags.
//
// Audience scope:
//   This is a GENERAL training. It deliberately avoids any manager-only
//   surface (e.g. approve/deny on hide-task, scope toggles other than the
//   default "My"). Every Ops Hub user sees the same eight steps regardless
//   of role.

import { useState, useEffect, useCallback } from 'react';

export const WHATS_NEW_KEY = 'ops_hub_whats_new_v1';

// One step per feature. Keep the body terse — users skim, they don't read.
// `tip` is a small footnote underneath the body for the "where to find it"
// line; optional, so feature-only steps can omit it.
const STEPS = [
  {
    icon: 'bi-stars',
    color: '#1565c0',
    title: "What's new in May",
    body: "We've reorganised the nav and shipped HR Hub, Urgent Assist, plus quick actions on every queue row. Here's a 60-second tour — you can skip any time.",
    tip: 'You only see this once.',
  },
  {
    icon: 'bi-grid-1x2',
    color: '#1565c0',
    title: 'Queue is now Workspace',
    body: 'Same FIFO task list, sharper name. Look for "Workspace" in the top nav — it groups Workbench, Offboarding, Redlines, Incentive Plans and more under one roof.',
    tip: 'Top nav · Workspace',
  },
  {
    icon: 'bi-eye-slash',
    color: 'var(--text-secondary)',
    title: 'Hide tasks that aren\'t yours',
    body: 'Every Workspace row has a "Hide" action. Use it for internal Deel-employee tasks, test entries, or anything you genuinely shouldn\'t be working. A manager will approve before it disappears for everyone.',
    tip: 'Workspace row → Hide',
  },
  {
    icon: 'bi-arrow-up-right-circle-fill',
    color: '#d42d35',
    title: 'Escalate any task in one click',
    body: 'Need someone to chase a request beyond your scope? Click "Escalate" on any Workspace row to open an HR Hub request with the task link and your manager pre-filled.',
    tip: 'Workspace row → Escalate',
  },
  {
    icon: 'bi-life-preserver',
    color: '#0a7d3e',
    title: 'HR Hub — your one-stop request inbox',
    body: 'Submit a request to the HR team across four flows: HR request, HR reporting, escalation zero, or feedback. Comment, follow, and watch status updates in real time.',
    tip: 'Top nav · HR Hub',
  },
  {
    icon: 'bi-lightning-charge-fill',
    color: '#d97706',
    title: 'Urgent Assist',
    body: 'A new top-level tab for HRX urgent assist requests with a 6-hour business-hour SLA. Manual entries from the Quick Create menu live here too — the SLA clock starts the moment you submit.',
    tip: 'Top nav · Urgent Assist',
  },
  {
    icon: 'bi-plus-circle-fill',
    color: 'var(--text)',
    title: 'Quick Create — fresh menu',
    body: 'The "+" button in the top-right now spawns the right form for whatever you\'re creating: an HR Hub request, an Urgent Assist entry, or a task. No more digging through tabs.',
    tip: 'Top nav · "+" button',
  },
  {
    icon: 'bi-check-circle-fill',
    color: '#0a7d3e',
    title: "You're all set",
    body: 'That\'s the lot. If you ever need a refresher, the in-app docs and the #ops-hub Slack channel are your friends. Thanks for using Ops Hub.',
    tip: 'Press ⌘K to search anywhere',
  },
];

const WhatsNewTour = ({ onDismiss }) => {
  const [step, setStep] = useState(0);
  const total = STEPS.length;
  const isLast = step === total - 1;
  const cur = STEPS[step];

  // Always persist the seen-flag — whether the user finished or skipped — so
  // the tour never re-prompts. Wrapped in try/catch in case localStorage is
  // disabled (incognito, locked-down browsers, …).
  const finish = useCallback(() => {
    try { localStorage.setItem(WHATS_NEW_KEY, '1'); } catch (e) {}
    onDismiss?.();
  }, [onDismiss]);

  // Keyboard shortcuts: Esc skips, arrow keys + Enter advance / go back.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { finish(); return; }
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (isLast) finish(); else setStep(s => Math.min(s + 1, total - 1));
        return;
      }
      if (e.key === 'ArrowLeft') setStep(s => Math.max(s - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isLast, finish, total]);

  return (
    <div
      style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:850,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}
      role="dialog" aria-modal="true" aria-labelledby="whats-new-title"
      onClick={finish}
    >
      <div
        style={{background:'var(--surface,#fff)',borderRadius:18,width:'100%',maxWidth:540,overflow:'hidden',boxShadow:'0 8px 32px rgba(0,0,0,0.22)',position:'relative',animation:'modalIn .2s cubic-bezier(.34,1.56,.64,1) forwards'}}
        onClick={(e)=>e.stopPropagation()}
      >
        {/* Skip (top-right) */}
        <button
          onClick={finish}
          aria-label="Skip tour"
          style={{position:'absolute',top:14,right:14,background:'rgba(255,255,255,0.18)',border:'none',color:'rgba(255,255,255,0.85)',fontSize:12,fontWeight:500,padding:'6px 12px',borderRadius:128,cursor:'pointer',zIndex:10,letterSpacing:0.2,transition:'all .15s'}}
          onMouseEnter={(e)=>e.currentTarget.style.background='rgba(255,255,255,0.32)'}
          onMouseLeave={(e)=>e.currentTarget.style.background='rgba(255,255,255,0.18)'}
        >
          Skip tour
        </button>

        {/* Hero */}
        <div style={{background:'linear-gradient(135deg,#1b1b1b 0%,#2d2d2d 100%)',padding:'28px 28px 24px'}}>
          <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:14}}>
            <div style={{width:44,height:44,background:`${cur.color}20`,border:`1px solid ${cur.color}40`,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center'}}>
              <i className={cur.icon} style={{color:cur.color,fontSize:20}}></i>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{color:'var(--text-muted)',fontSize:11,fontWeight:600,letterSpacing:0.6,textTransform:'uppercase',marginBottom:3}}>
                Step {step + 1} of {total}
              </div>
              <h2 id="whats-new-title" style={{color:'white',fontWeight:700,fontSize:18,lineHeight:1.25,margin:0}}>
                {cur.title}
              </h2>
            </div>
          </div>
          <p style={{color:'#cfcfcf',fontSize:13.5,lineHeight:1.65,margin:0}}>
            {cur.body}
          </p>
          {cur.tip && (
            <div style={{marginTop:14,display:'inline-flex',alignItems:'center',gap:6,background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:128,padding:'5px 12px',color:'#cfcfcf',fontSize:12}}>
              <i className="bi-geo-alt-fill" style={{fontSize:11,color:'var(--text-muted)'}}></i>
              {cur.tip}
            </div>
          )}
        </div>

        {/* Progress dots */}
        <div style={{display:'flex',justifyContent:'center',gap:6,padding:'18px 28px 6px'}}>
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              aria-label={`Go to step ${i + 1}`}
              aria-current={i === step ? 'step' : undefined}
              style={{
                width: i === step ? 22 : 8,
                height: 8,
                borderRadius: 8,
                border: 'none',
                background: i === step ? '#1b1b1b' : (i < step ? '#9e9e9e' : '#e0e0e0'),
                cursor: 'pointer',
                padding: 0,
                transition: 'all .18s',
              }}
            />
          ))}
        </div>

        {/* Footer controls */}
        <div style={{padding:'14px 28px 24px',display:'flex',alignItems:'center',gap:12}}>
          <button
            onClick={() => setStep(s => Math.max(s - 1, 0))}
            disabled={step === 0}
            style={{background:'transparent',color: step===0 ? '#bdbdbd' : '#1b1b1b',border:'1px solid '+(step===0?'#e8e8e8':'#d0d0d0'),borderRadius:128,padding:'9px 18px',fontSize:13,fontWeight:500,cursor: step===0?'not-allowed':'pointer',display:'flex',alignItems:'center',gap:6,transition:'all .15s'}}
          >
            <i className="bi-arrow-left" style={{fontSize:13}}></i>Back
          </button>
          <div style={{flex:1}} />
          <button
            onClick={() => isLast ? finish() : setStep(s => Math.min(s + 1, total - 1))}
            style={{background:'#1b1b1b',color:'white',border:'none',borderRadius:128,padding:'10px 22px',fontSize:13.5,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:7,transition:'all .15s'}}
            onMouseEnter={(e)=>e.currentTarget.style.background='#000'}
            onMouseLeave={(e)=>e.currentTarget.style.background='#1b1b1b'}
          >
            {isLast ? <>Got it<i className="bi-check2" style={{fontSize:15}}></i></> : <>Next<i className="bi-arrow-right" style={{fontSize:13}}></i></>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WhatsNewTour;
