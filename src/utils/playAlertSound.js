// ── playAlertSound ──────────────────────────────────────────────────────
// Short three-tone "you're now on call" alarm. Used by both
// MocAlertModal and TlocAlertModal so the audio cue is identical when
// either rotating role lands on the current user (Mohamed's spec:
// "popup with a sound exactly the same to when the manager on call
// changes" — applied symmetrically to MOC and TLOC).
//
// Web Audio synth — no audio asset shipped (no MIME/CSP surprises).
// Caller invokes inside a useEffect on modal mount. The Web Audio
// autoplay policy requires a prior user gesture; the rotation that
// triggers this modal happens after the user has interacted with the
// app at least once (login click), so it plays. On the very first
// session-load case where the user hasn't clicked yet, the
// AudioContext will be suspended — we resume it best-effort. If it
// stays silent, the visual popup still fires.

export function playAlertSound() {
  if (typeof window === 'undefined') return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  let ctx;
  try { ctx = new AC(); } catch { return; }
  // Resume in case the page hasn't received a user gesture yet — best
  // effort; if it stays suspended the visual popup still fires.
  try { if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume(); } catch {}
  const now = ctx.currentTime;
  const tone = (freq, start, dur, peak = 0.22) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(peak, now + start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.02);
  };
  // Three-tone alarm — distinct + a bit more urgent than the notif
  // chime in useNotificationSound (which is a softer 2-tone).
  tone(880,  0,    0.18);
  tone(660,  0.16, 0.18);
  tone(880,  0.32, 0.24, 0.26);
  setTimeout(() => { try { ctx.close(); } catch {} }, 800);
}
