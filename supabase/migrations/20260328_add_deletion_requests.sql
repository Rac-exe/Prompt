-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: GDPR Account Deletion Requests
--
-- Creates the `deletion_requests` table that records user-initiated deletion
-- requests. Data is NOT deleted immediately — a scheduled Edge Function
-- (process-deletions) runs nightly to wipe records where:
--   status = 'pending' AND scheduled_deletion_at <= NOW()
--
-- The 30-day delay gives users a cancellation window and satisfies GDPR
-- Article 17 requirements (erasure "without undue delay").
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.deletion_requests (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    requested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scheduled_deletion_at TIMESTAMPTZ NOT NULL,           -- requested_at + 30 days
    status                TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'completed', 'cancelled')),
    reason                TEXT,                           -- optional user-provided reason
    processed_at          TIMESTAMPTZ,                   -- set by the Edge Function on completion
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce: one active pending request per user
CREATE UNIQUE INDEX IF NOT EXISTS deletion_requests_user_pending_unique
    ON public.deletion_requests (user_id)
    WHERE status = 'pending';

-- Index for the nightly cron job query
CREATE INDEX IF NOT EXISTS deletion_requests_scheduled_idx
    ON public.deletion_requests (scheduled_deletion_at)
    WHERE status = 'pending';

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.deletion_requests ENABLE ROW LEVEL SECURITY;

-- Users can only see and manage their own requests
CREATE POLICY "Users can view own deletion requests"
    ON public.deletion_requests FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own deletion requests"
    ON public.deletion_requests FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can only cancel (set status='cancelled') their own pending requests.
-- They cannot set status='completed' — only the server-side Edge Function does that.
CREATE POLICY "Users can cancel own pending deletion requests"
    ON public.deletion_requests FOR UPDATE
    USING (auth.uid() = user_id AND status = 'pending')
    WITH CHECK (status = 'cancelled');

-- No direct DELETE — records are retained for audit purposes
-- (the Edge Function sets status='completed' rather than deleting the row)


-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: Pair this migration with a Supabase Edge Function named
-- `process-deletions` (deploy to supabase/functions/process-deletions/).
--
-- The function should:
--   1. Query: SELECT * FROM deletion_requests
--              WHERE status='pending' AND scheduled_deletion_at <= NOW()
--   2. For each row:
--      a. Delete all rows in: messages, chats, user_memory, user_feedback,
--         user_settings, profiles, optimizations WHERE user_id = row.user_id
--      b. List and delete Supabase Storage objects for the user
--      c. Call the Cloudinary Destroy API for image public_ids stored in the DB
--      d. Call auth.admin.deleteUser(row.user_id) using the service role key
--      e. UPDATE deletion_requests SET status='completed', processed_at=NOW()
--              WHERE id = row.id
--   3. Schedule via Supabase Cron: `0 2 * * *` (2:00 AM UTC daily)
-- ─────────────────────────────────────────────────────────────────────────────
