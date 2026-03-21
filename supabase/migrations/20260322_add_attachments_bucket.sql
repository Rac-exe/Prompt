-- ============================================================
-- Migration: message-attachments storage bucket
-- Stores image and PDF attachments for chat messages.
-- Images are uploaded to Cloudinary; PDFs go here.
-- ============================================================

-- Create a private bucket for PDF message attachments.
-- Images use Cloudinary (handled in application code).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-attachments',
  'message-attachments',
  false,                         -- private: never publicly accessible
  10485760,                      -- 10 MB per file (matches app-level limit)
  ARRAY['application/pdf']       -- only PDFs; images go to Cloudinary
)
ON CONFLICT (id) DO NOTHING;

-- ── Row-Level Security ──────────────────────────────────────────────────────

-- SELECT: users can download their own files
CREATE POLICY "Users can read own attachments"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'message-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- INSERT: users can upload into their own folder
CREATE POLICY "Users can upload own attachments"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'message-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- DELETE: users can delete their own files
CREATE POLICY "Users can delete own attachments"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'message-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
