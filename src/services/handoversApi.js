// ── Handovers API client ──────────────────────────────────────────────
// Phase 1 ships read-only endpoints only; the rest of the write path
// (create / accept / decline / approve / reject / cancel / handback)
// arrives in Phase 2. This file already exports the function signatures
// so the FE can wire stubs before the server side lands.

import { apiFetch } from './api';

/** Per-lens counts for the OOO header chip row. */
export async function fetchHandoverLensCounts() {
  return apiFetch('/handovers/lens-counts');
}

// Phase 2 stubs — call sites can import these now even though the routes
// return 404 today. Each will be replaced with the real endpoint as part
// of the Phase 2 PR; until then they throw an informative error so the
// FE never silently no-ops.

const PHASE_2_ERROR = 'Handover write paths arrive in Phase 2 of HANDOVERS_PLAN.md';

export async function createHandover(_payload) { throw new Error(PHASE_2_ERROR); }
export async function submitHandover(_id) { throw new Error(PHASE_2_ERROR); }
export async function acceptHandover(_id) { throw new Error(PHASE_2_ERROR); }
export async function declineHandover(_id, _reason) { throw new Error(PHASE_2_ERROR); }
export async function approveHandover(_id) { throw new Error(PHASE_2_ERROR); }
export async function rejectHandover(_id, _reason) { throw new Error(PHASE_2_ERROR); }
export async function cancelHandover(_id, _reason) { throw new Error(PHASE_2_ERROR); }
export async function logHandback(_id, _payload) { throw new Error(PHASE_2_ERROR); }
