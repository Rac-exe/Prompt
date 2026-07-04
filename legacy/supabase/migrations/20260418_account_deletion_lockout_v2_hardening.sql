-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Account Deletion lockout — hardening pass (v2)
--
-- Pre-prod audit of 20260418_account_deletion_lockout.sql surfaced three holes.
-- Each fix is idempotent so re-applying is a no-op.
--
--   C1 (security): restore_account() unconditionally cleared banned_until,
--                  letting an OTP-verified user lift ANY ban — including
--                  manual ToS bans set by an admin. We now only clear the
--                  ban when there is a matching pending deletion request.
--
--   C2 (security): a direct INSERT policy on deletion_requests let users
--                  bypass the RPC entirely. They could insert a row with
--                  scheduled_deletion_at = NOW() and have themselves wiped
--                  on the next cron without a 30-day grace period and
--                  without being banned (auth still works → confused state).
--                  Drop the policy. The RPC is the only insertion path.
--
--   C3 (bug):      user_full_profile view didn't expose avatar_public_id,
--                  so the renderer always saw `null` even after the column
--                  was added. Recreating the view to include it.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── C1. Harden restore_account ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restore_account(p_email TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id   UUID;
    v_cancelled INT;
BEGIN
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE LOWER(email) = LOWER(p_email)
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No account found for %', p_email USING ERRCODE = 'P0002';
    END IF;

    -- Only honour restore when there's a matching pending deletion request.
    -- Without this check an OTP-verified email could lift any admin-imposed ban.
    UPDATE public.deletion_requests
       SET status       = 'cancelled',
           processed_at = NOW()
     WHERE user_id = v_user_id
       AND status  = 'pending';

    GET DIAGNOSTICS v_cancelled = ROW_COUNT;

    IF v_cancelled = 0 THEN
        RAISE EXCEPTION 'No pending deletion to restore for %', p_email
            USING ERRCODE = 'P0002';
    END IF;

    -- Safe to lift the ban: we just confirmed the user is in the
    -- deletion-pending state (i.e. WE put the ban there in the first place).
    UPDATE auth.users
       SET banned_until = NULL
     WHERE id = v_user_id;

    RETURN json_build_object(
        'user_id',     v_user_id,
        'cancelled',   v_cancelled,
        'restored_at', NOW()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_account(TEXT) FROM PUBLIC;
COMMENT ON FUNCTION public.restore_account(TEXT) IS
    'Service-role only: cancel pending deletion + clear ban. Refuses if no pending deletion exists (so admin bans are not affected).';


-- ── C2. Remove the bypass-able INSERT policy ────────────────────────────────
-- All inserts MUST go through public.request_account_deletion(), which
-- atomically records the request AND bans the auth user.
DROP POLICY IF EXISTS "Users can insert own deletion requests"
    ON public.deletion_requests;


-- ── C3. Make avatar_public_id visible via the canonical profile view ────────
-- Postgres refuses to insert a column into the middle of a view via CREATE OR
-- REPLACE (no column reorder allowed). DROP + CREATE is the safe path.
DROP VIEW IF EXISTS public.user_full_profile;

CREATE VIEW public.user_full_profile AS
SELECT
    p.id,
    p.name,
    p.dob,
    p.email,
    p.avatar_url,
    p.avatar_public_id,
    p.created_at,
    p.updated_at,
    up.personalization_prompt,
    up.ui_settings
FROM public.profiles p
LEFT JOIN public.user_preferences up ON p.id = up.user_id;

GRANT SELECT ON public.user_full_profile TO authenticated;
