-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: account-deletion lockout — service_role EXECUTE grant on restore_account
--
-- v1 did `REVOKE ALL ... FROM PUBLIC` on restore_account assuming the
-- service_role inherited EXECUTE. Postgres does not — function privileges
-- are per-role and must be granted explicitly. Without this grant the
-- Python /account/confirm-restore endpoint fails with:
--     permission denied for function restore_account  (SQLSTATE 42501)
-- so a real user OTP path could never complete.
-- ─────────────────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.restore_account(TEXT) TO service_role;
