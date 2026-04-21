-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Account Deletion — hard lockout (Option C)
--
-- Adds:
--   • profiles.avatar_public_id          — Cloudinary public_id for direct cleanup
--   • RPC request_account_deletion(reason) — atomic: insert request + ban user
--   • RPC restore_account(user_id)         — service-role only: cancel request + unban
--
-- Tightens RLS on deletion_requests:
--   • Drops the prior "users can cancel" UPDATE policy
--     (cancel/restore now flows through the OTP'd Python endpoint → service-role RPC)
--   • Keeps SELECT (status check) and INSERT (legacy clients fall back to RPC anyway)
--
-- Lockout mechanism:
--   We set auth.users.banned_until = NOW() + 30 days when a deletion is requested.
--   Supabase GoTrue blocks sign-in for banned users with "User is banned"
--   until the timestamp passes. The nightly process-deletions Edge Function
--   physically wipes the user before that point.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. profiles.avatar_public_id ─────────────────────────────────────────────
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS avatar_public_id TEXT;

COMMENT ON COLUMN public.profiles.avatar_public_id IS
    'Cloudinary public_id of the avatar — used for direct cleanup on account deletion.';


-- ── 2. RLS tightening on deletion_requests ───────────────────────────────────
-- Cancel is now a server-only operation (OTP'd Python flow → service-role RPC).
DROP POLICY IF EXISTS "Users can cancel own pending deletion requests"
    ON public.deletion_requests;


-- ── 3. request_account_deletion RPC ──────────────────────────────────────────
-- Atomic: inserts a pending request AND bans the auth user for 30 days.
-- Runs with SECURITY DEFINER so it can write to auth.users.
CREATE OR REPLACE FUNCTION public.request_account_deletion(p_reason TEXT DEFAULT NULL)
RETURNS public.deletion_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id     UUID := auth.uid();
    v_scheduled   TIMESTAMPTZ := NOW() + INTERVAL '30 days';
    v_existing    public.deletion_requests%ROWTYPE;
    v_request     public.deletion_requests%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_existing
    FROM public.deletion_requests
    WHERE user_id = v_user_id AND status = 'pending'
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'A deletion request is already pending (scheduled for %)',
            to_char(v_existing.scheduled_deletion_at, 'YYYY-MM-DD')
        USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.deletion_requests
        (user_id, requested_at, scheduled_deletion_at, status, reason)
    VALUES
        (v_user_id, NOW(), v_scheduled, 'pending', NULLIF(p_reason, ''))
    RETURNING * INTO v_request;

    -- Hard lockout: GoTrue refuses sign-in while banned_until > NOW()
    UPDATE auth.users
       SET banned_until = v_scheduled
     WHERE id = v_user_id;

    RETURN v_request;
END;
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(TEXT) TO authenticated;

COMMENT ON FUNCTION public.request_account_deletion(TEXT) IS
    'Atomically request account deletion: inserts pending request + bans user for 30 days.';


-- ── 4. restore_account RPC (service-role only) ───────────────────────────────
-- Called by the Python /account/confirm-restore endpoint after OTP verification.
-- Looks up the user by email, cancels their pending deletion request,
-- and clears the banned_until lockout.
CREATE OR REPLACE FUNCTION public.restore_account(p_email TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id UUID;
    v_cancelled INT;
BEGIN
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE LOWER(email) = LOWER(p_email)
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No account found for %', p_email USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.deletion_requests
       SET status = 'cancelled',
           processed_at = NOW()
     WHERE user_id = v_user_id
       AND status = 'pending';

    GET DIAGNOSTICS v_cancelled = ROW_COUNT;

    UPDATE auth.users
       SET banned_until = NULL
     WHERE id = v_user_id;

    RETURN json_build_object(
        'user_id',   v_user_id,
        'cancelled', v_cancelled,
        'restored_at', NOW()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.restore_account(TEXT) FROM PUBLIC;
-- Only service_role may call this (no GRANT to authenticated/anon).

COMMENT ON FUNCTION public.restore_account(TEXT) IS
    'Service-role only: cancel pending deletion + clear ban after OTP-verified restore.';


-- ── 5. user_has_pending_deletion convenience view ────────────────────────────
-- Lets the renderer ask "is there a pending deletion?" without exposing details.
CREATE OR REPLACE VIEW public.my_pending_deletion AS
SELECT id, requested_at, scheduled_deletion_at, status, reason
FROM public.deletion_requests
WHERE user_id = auth.uid() AND status = 'pending';

GRANT SELECT ON public.my_pending_deletion TO authenticated;


-- ── 6. service_role grants (for process-deletions Edge Function) ─────────────
-- The original deletion_requests migration only granted to authenticated; the
-- nightly cron worker runs as service_role and needs to read pending rows and
-- mark them completed.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deletion_requests TO service_role;
GRANT SELECT ON public.my_pending_deletion TO service_role;
