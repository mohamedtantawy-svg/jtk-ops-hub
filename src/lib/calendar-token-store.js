// ── Calendar token store — DB layer for per-user Google OAuth credentials ──
// Thin wrapper around the `calendar_tokens` table. Keeps the encryption
// details (AES-256-GCM via token-crypto) and the SQL shape in one place so
// callers in routes and services can just say "save these tokens for this
// email" or "give me the decrypted refresh token for this email".
//
// Table shape (see src/lib/migrate.js):
//   user_email              PK — the app user's email (not the Google one)
//   refresh_token_encrypted BYTEA — long-lived, encrypted at rest
//   refresh_token_iv        BYTEA — GCM IV for the refresh token
//   access_token            TEXT — short-lived (usually <1h), stored in clear
//   access_token_expires_at TIMESTAMPTZ — when to refresh
//   scopes                  TEXT — space-separated granted scopes
//   calendar_id             TEXT — default 'primary'
//   google_email            VARCHAR — the Google account actually connected
//                                      (may differ from user_email)
//   connected_at            TIMESTAMPTZ
//   updated_at              TIMESTAMPTZ
//   last_error              TEXT — last refresh failure for debug/UX
//
// Why access_token is NOT encrypted:
//   Access tokens are short-lived (Google issues them for ~1h) and the
//   refresh token is what grants durable access. If an attacker has read
//   access to the DB they'll get the next access token anyway via the
//   refresh token; encrypting both adds no real defence. Keeping the
//   access token in cleartext simplifies reads on the hot path
//   (every Calendar API call).

import { query } from './db.js';
import { encryptString, decryptString } from './token-crypto.js';

/**
 * Insert or update the token row for a user. Called from the OAuth callback
 * (first connect) and from the refresh-token rotation path (Google sometimes
 * rotates refresh tokens during `refresh_token` grants).
 *
 * @param {object} params
 * @param {string} params.userEmail — the ops-hub user email (PK)
 * @param {string} params.refreshToken — plaintext; encrypted before insert
 * @param {string} [params.accessToken] — current access token (may be null)
 * @param {number} [params.accessTokenExpiresAt] — epoch ms; converted to TZ
 * @param {string} params.scopes — space-joined granted scopes
 * @param {string} [params.calendarId='primary']
 * @param {string} [params.googleEmail] — email of the Google account
 */
export async function upsertTokens({
  userEmail,
  refreshToken,
  accessToken = null,
  accessTokenExpiresAt = null,
  scopes,
  calendarId = 'primary',
  googleEmail = null,
}) {
  if (!userEmail) throw new Error('upsertTokens: userEmail required');
  if (!refreshToken) throw new Error('upsertTokens: refreshToken required');
  if (!scopes) throw new Error('upsertTokens: scopes required');

  const { ciphertext, iv } = encryptString(refreshToken);
  const expiresAt = accessTokenExpiresAt ? new Date(accessTokenExpiresAt) : null;

  await query(
    `INSERT INTO calendar_tokens (
       user_email, refresh_token_encrypted, refresh_token_iv,
       access_token, access_token_expires_at, scopes, calendar_id,
       google_email, connected_at, updated_at, last_error
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NULL)
     ON CONFLICT (user_email) DO UPDATE SET
       refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
       refresh_token_iv        = EXCLUDED.refresh_token_iv,
       access_token            = EXCLUDED.access_token,
       access_token_expires_at = EXCLUDED.access_token_expires_at,
       scopes                  = EXCLUDED.scopes,
       calendar_id             = EXCLUDED.calendar_id,
       google_email            = EXCLUDED.google_email,
       updated_at              = NOW(),
       last_error              = NULL`,
    [userEmail, ciphertext, iv, accessToken, expiresAt, scopes, calendarId, googleEmail]
  );
}

/**
 * Update just the access token + expiry (called after a refresh grant).
 * If Google rotated the refresh token as part of the grant, caller should
 * use upsertTokens instead — this only touches the access-token columns.
 */
export async function updateAccessToken({ userEmail, accessToken, accessTokenExpiresAt }) {
  if (!userEmail) throw new Error('updateAccessToken: userEmail required');
  const expiresAt = accessTokenExpiresAt ? new Date(accessTokenExpiresAt) : null;
  await query(
    `UPDATE calendar_tokens
        SET access_token = $2,
            access_token_expires_at = $3,
            updated_at = NOW(),
            last_error = NULL
      WHERE user_email = $1`,
    [userEmail, accessToken, expiresAt]
  );
}

/**
 * Record a token-refresh failure so the UI can surface "needs reconnect".
 * Doesn't clear the stored tokens — we keep them so a manual retry can
 * still succeed if the error was transient (network, rate limit). The
 * route handler decides whether to force a disconnect based on the error
 * code (e.g. invalid_grant → definitely needs reconnect).
 */
export async function recordError({ userEmail, error }) {
  if (!userEmail) return;
  try {
    await query(
      `UPDATE calendar_tokens
          SET last_error = $2, updated_at = NOW()
        WHERE user_email = $1`,
      [userEmail, String(error).slice(0, 500)]
    );
  } catch (dbErr) {
    // Logging failures shouldn't mask the original error.
    console.warn('[calendar-token-store] recordError DB write failed:', dbErr.message);
  }
}

/**
 * Load tokens for the user, decrypting the refresh token. Returns null if
 * there's no row (user hasn't connected). Throws if the row exists but
 * decryption fails — that indicates key rotation or DB corruption and
 * should be surfaced so the user can reconnect.
 *
 * @param {string} userEmail
 * @returns {Promise<null | {
 *   userEmail: string,
 *   refreshToken: string,
 *   accessToken: string | null,
 *   accessTokenExpiresAt: Date | null,
 *   scopes: string,
 *   calendarId: string,
 *   googleEmail: string | null,
 *   connectedAt: Date,
 *   updatedAt: Date,
 *   lastError: string | null,
 * }>}
 */
export async function getTokens(userEmail) {
  if (!userEmail) return null;
  const { rows } = await query(
    `SELECT user_email, refresh_token_encrypted, refresh_token_iv,
            access_token, access_token_expires_at, scopes, calendar_id,
            google_email, connected_at, updated_at, last_error
       FROM calendar_tokens
      WHERE user_email = $1`,
    [userEmail]
  );
  if (rows.length === 0) return null;
  const r = rows[0];

  const refreshToken = decryptString(r.refresh_token_encrypted, r.refresh_token_iv);

  return {
    userEmail: r.user_email,
    refreshToken,
    accessToken: r.access_token,
    accessTokenExpiresAt: r.access_token_expires_at,
    scopes: r.scopes,
    calendarId: r.calendar_id || 'primary',
    googleEmail: r.google_email,
    connectedAt: r.connected_at,
    updatedAt: r.updated_at,
    lastError: r.last_error,
  };
}

/**
 * Lightweight connection-status check that avoids decrypting the refresh
 * token — used by the /connection endpoint the UI polls on mount. We want
 * this to be cheap and to not fail if the encryption key has been rotated
 * (the UI will still show "connected" and the user will see the actual
 * failure when they try to fetch events).
 */
export async function getConnectionStatus(userEmail) {
  if (!userEmail) return { connected: false };
  const { rows } = await query(
    `SELECT google_email, scopes, connected_at, last_error
       FROM calendar_tokens
      WHERE user_email = $1`,
    [userEmail]
  );
  if (rows.length === 0) return { connected: false };
  const r = rows[0];
  return {
    connected: true,
    googleEmail: r.google_email,
    scopes: r.scopes,
    connectedAt: r.connected_at,
    lastError: r.last_error,
  };
}

/**
 * Remove the user's tokens (user clicked "Disconnect"). We don't attempt
 * to revoke the token with Google here — that's a separate best-effort
 * call the route handler makes before invoking this. Even if revocation
 * fails on Google's side, deleting the row is the important bit locally.
 */
export async function deleteTokens(userEmail) {
  if (!userEmail) return;
  await query(`DELETE FROM calendar_tokens WHERE user_email = $1`, [userEmail]);
}
