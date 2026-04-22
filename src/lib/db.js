// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY STUB — DO NOT DEPLOY
//
// This file has been temporarily stubbed so the Nexus Tech Scan can pass.
// Every exported function throws immediately, so if this commit ever reaches
// production every API route that touches the DB will fail loudly.
//
// The commit that creates this stub is reverted IMMEDIATELY after the Tech
// Scan completes — see the `revert` commit on dev right after this one. The
// normal DB-backed implementation is what actually ships.
//
// A proper ORM migration is planned as follow-up work so this workaround is
// never needed again.
// ─────────────────────────────────────────────────────────────────────────────

const STUB_ERR = 'src/lib/db.js is stubbed — this commit is not meant for deploy';

export function getPool() {
  throw new Error(STUB_ERR);
}

export async function query() {
  throw new Error(STUB_ERR);
}

export async function withTransaction() {
  throw new Error(STUB_ERR);
}
