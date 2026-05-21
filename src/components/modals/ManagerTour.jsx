// ── ManagerTour ──────────────────────────────────────────────────────────────
// Manager-only training overlay. Walks Team Leads, Regional Managers, and
// admins through the manager-specific surfaces shipped in the May 2026
// release: scope toggles, hide-task approvals, HR Hub status authority,
// Leaders Hub sub-toggle, and the Quick Create extras gated to their role.
//
// Show-once contract:
//   • localStorage key `ops_hub_whats_new_mgr_v1`. Written on either "Got it"
//     or "Skip" (or Esc) so the tour never re-prompts.
//   • Future manager-specific releases bump the version suffix (`_v2`, …)
//     to re-prompt without disturbing this run's flags.
//
// Audience gating happens in the parent (App.jsx) — this component renders
// whatever is given. App gates on `perms.dataScope !== 'own_tasks_only'`
// AND on the seen-flag being absent. We deliberately render this AFTER the
// general WhatsNewTour finishes, so a brand-new manager sees the general
// steps first, then the manager extras.

import { useState, useEffect, useCallback } from 'react';

export const MANAGER_TOUR_KEY = 'ops_hub_whats_new_mgr_v1';

// Manager-specific steps. Keep them short — same UX vocabulary as the
// general tour so the second pass feels like a continuation, not a reset.
const STEPS = [
  {
    icon: 'bi-shield-lock-fill',
    color: '#6f42c1',
    title: 'A few extras for managers',
    body: "You've already seen the general release notes. Here's the manager-only stuff: scope toggles, hide-task approvals, HR Hub status authority, and the Leaders Hub.",
    tip: 'Visible only to you.',
  },
  {
    icon: 'bi-people-fill',
    color: '#1565c0',
    title: 'My / Team / All scope toggle',
    body: 'In HR Hub, Leaders Hub, and Urgent Assist, you can flip between your own work, your direct/regional team, and everything in the org. The badge next to each toggle counts non-resolved items only — resolved tickets stay out of the noise.',
    tip: 'HR Hub · Leaders Hub · Urgent Assist',
  },
  {
    icon: 'bi-eye-slash-fill',
    color: 'var(--text-secondary)',
    title: 'Approve or deny hide-task requests',
    body: "When someone on your team requests to hide a task, the request lands in HR Hub as a 'hide_task_request' row with inline Approve / Deny. Approve and the task disappears from every queue; deny and the requester gets a notification.",
    tip: 'HR Hub · hide_task_request rows',
  },
  {
    icon: 'bi-shield-check',
    color: '#0a7d3e',
    title: '4-eyes principle on approvals',
    body: "Team Leads and Regional Managers can't decide their own hide-task requests — someone else has to approve or deny. Admins can self-approve when needed (audit override). HR Hub status changes are open to any manager, regardless of assignment.",
    tip: 'Audit-safe by default',
  },
  {
    icon: 'bi-clipboard-check-fill',
    color: '#d97706',
    title: 'Move any HR Hub request through its lifecycle',
    body: "You don't have to be the assignee to change a request's status. Any manager (TL / RM / Admin) can move a ticket from new → in_progress → on_hold → resolved. Useful when an assignee is OOO and you need to unblock the team.",
    tip: 'HR Hub · status pill',
  },
  {
    icon: 'bi-megaphone-fill',
    color: '#d42d35',
    title: 'Leaders Hub',
    body: "Your command center for team-wide signals. Default view is Alerts (the old Leaders Alerts feed); the 'Team' sub-toggle flips to the live people directory with assignment, capacity, and country filters all in one place.",
    tip: 'Top nav · Leaders Hub',
  },
  {
    icon: 'bi-plus-circle-fill',
    color: 'var(--text)',
    title: 'Quick Create — your menu has more',
    body: 'The "+" button in the top-right shows you an extra option: "New Leaders Alert". Use it to broadcast a team-wide signal (incident, policy nudge, recognition) directly into the Leaders Hub without leaving wherever you are.',
    tip: 'Top nav · "+" button',
  },
  {
    icon: 'bi-lightning-fill',
    color: '#0a7d3e',
    title: "You're all set",
    body: "That's the manager toolkit. Anything that breaks or feels wrong, ping #ops-hub on Slack — the team is monitoring closely while these surfaces bed in.",
    tip: 'Press ⌘K to search anywhere',
  },
];

const ManagerTour = ({ onDismiss }) => {
  const [step, setStep] = useState(0);
  const total = STEPS.length;
  const isLast = step === total - 1;
  const cur = STEPS[step];

  // Always persist the seen-flag — whether the user finished or skipped — so
  // the tour never re-prompts. Same try/catch dance as WhatsNewTour for the
  // localStorage-disabled cases (incognito, hardened browsers).
  const finish = useCallback(() => {
    try { localStorage.setItem(MANAGER_TOUR_KEY, '1'); } catch (e) {}
    onDismiss?.();
  }, [onDismiss]);

  // Esc skips, ←/→ navigate, Enter advances or finishes.
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
      role="dialog" aria-modal="true" aria-labelledby="mgr-tour-title"
      onClick={finish}
    >
      <div
        style={{background:'var(--surface,#fff)',borderRadius:18,width:'100%',maxWidth:540,overflow:'hidden',boxShadow:'0 8px 32px rgba(0,0,0,0.22)',position:'relative',animation:'modalIn .2s cubic-bezier(.34,1.56,.64,1) forwards'}}
        onClick={(e)=>e.stopPropagation()}
      >
        {/* Manager badge (top-left corner) */}
        <div style={{position:'absolute',top:14,left:14,background:'rgba(111,66,193,0.18)',border:'1px solid rgba(111,66,193,0.32)',borderRadius:128,padding:'4px 10px',fontSize:11,fontWeight:600,color:'#cfb8ec',letterSpacing:0.5,zIndex:10,textTransform:'uppercase',display:'flex',alignItems:'center',gap:5}}>
          <i className="bi-shield-fill-check" style={{fontSize:11}}></i>Manager
        </div>

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
        <div style={{background:'linear-gradient(135deg,#1b1b1b 0%,#2d2d2d 100%)',padding:'48px 28px 24px'}}>
          <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:14}}>
            <div style={{width:44,height:44,background:`${cur.color}20`,border:`1px solid ${cur.color}40`,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center'}}>
              <i className={cur.icon} style={{color:cur.color,fontSize:20}}></i>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{color:'var(--text-muted)',fontSize:11,fontWeight:600,letterSpacing:0.6,textTransform:'uppercase',marginBottom:3}}>
                Step {step + 1} of {total}
              </div>
              <h2 id="mgr-tour-title" style={{color:'white',fontWeight:700,fontSize:18,lineHeight:1.25,margin:0}}>
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

export default ManagerTour;
