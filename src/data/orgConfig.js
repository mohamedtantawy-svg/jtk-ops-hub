// ---------------------------------------------------------------------------
// Organization Configuration — Titles, Regions, Teams, Departments
// ---------------------------------------------------------------------------
//
// @deprecated 2026-05-20 (Phase 6 of the Org tab build).
//
// These flat arrays predate the recursive `org_nodes` table that now backs
// the Org tab. They're still exported for any legacy importer that hasn't
// been migrated yet, but **new code must read from `GET /api/v1/org/nodes`
// via the `useOrgNodes` hook** (or directly from `org_nodes` on the server).
//
// Phase 7 sweeps the remaining import sites; once that lands, this file
// disappears in a follow-up.
// ---------------------------------------------------------------------------

export const TITLES = [
  'HR Experience Administrator',
  'HR Experience Specialist',
  'HR Experience Manager I',
  'HR Operations Manager I',
  'HR Experience Manager II',
  'HR Operations Manager II',
  'Senior HR Experience Manager',
  'Senior HR Operations Manager I',
  'Senior HR Experience Manager II',
  'Senior HR Operations Manager II',
  'Team Lead, HR Experience',
  'Senior Team Lead, HR Experience',
  'Regional Manager, HR Experience',
  'Senior Regional Manager, HR Experience',
  'Associate Director, HR Experience',
  'Director, HR Experience',
];

export const REGIONS = ['APAC', 'EMEA', 'AMER'];

export const TEAMS = ['EOR Services', 'New Services', '24/7'];

export const DEPARTMENTS = ['HR Experience', 'HR Operations'];
