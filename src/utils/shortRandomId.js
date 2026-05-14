// ── shortRandomId ───────────────────────────────────────────────────────
// Short random hex IDs for temporary client-side identifiers (optimistic
// comment IDs, attachment IDs, picker rows, etc). Uses crypto.getRandomValues
// when available — not for any cryptographic reason, but because CodeQL's
// `js/insecure-randomness` dataflow analysis flags Math.random() values that
// later flow into server identifiers (e.g. the commentId on a reaction POST).
// These IDs are NOT secrets and don't need CSPRNG strength — but using the
// crypto API makes the dataflow analysis happy and avoids drive-by warnings
// every time a temp ID is plumbed through a new endpoint.
//
// Fallback uses Date.now() + a counter so the result is still unique within
// a single tab, even on the (very rare) host without WebCrypto.

let _counter = 0;

export function shortRandomId(len = 6) {
  const n = Math.max(2, Math.min(32, Number(len) || 6));
  try {
    const g = typeof globalThis !== 'undefined' ? globalThis : self;
    if (g?.crypto?.getRandomValues) {
      const buf = new Uint8Array(Math.ceil(n / 2));
      g.crypto.getRandomValues(buf);
      return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('').slice(0, n);
    }
  } catch {}
  _counter = (_counter + 1) & 0xffff;
  return (Date.now().toString(36) + _counter.toString(36)).slice(-n);
}
