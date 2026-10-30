-- Session IDs are now hashed at rest (P0 security hardening).
--
-- `SessionService` stores sha256(raw sid) in `sessions.id`; the httpOnly cookie
-- and the JWT `sid` claim carry the raw value. A leaked DB dump therefore no
-- longer contains usable session credentials.
--
-- This migration re-hashes EXISTING raw session ids in place. Post-migration,
-- every previously-issued cookie/JWT becomes invalid (its raw sid no longer
-- matches any stored hash) — users simply log in again, and `revoked_at` /
-- `expires_at` state is preserved through the rewrite.
--
-- idempotence guard: a sha256 hex digest is exactly 64 lowercase hex chars, and
-- no legacy raw sid is (they are prefixed branded ids), so re-running this
-- statement against already-hashed rows is a no-op in practice; the WHERE
-- clause makes that explicit.
UPDATE "sessions"
SET "id" = encode(sha256("id"::bytea), 'hex')
WHERE length("id") <> 64 OR "id" !~ '^[0-9a-f]{64}$';
