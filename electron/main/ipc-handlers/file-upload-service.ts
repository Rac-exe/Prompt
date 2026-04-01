import * as https from 'https';
import * as crypto from 'crypto';
import { ipcMain, shell } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { SupabaseClientManager } from '../database/supabase-client';

// ── Constants ─────────────────────────────────────────────────────────────────

const BUCKET = 'message-attachments';
const SIGNED_URL_EXPIRY_SECONDS = 3600; // 1 hour

// ── Cloudinary helpers ────────────────────────────────────────────────────────

function getCloudConfig() {
  return {
    cloudName: process.env.VITE_CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    uploadPreset: process.env.VITE_CLOUDINARY_UPLOAD_PRESET || '',
  };
}

export function isCloudinaryConfigured(): boolean {
  const c = getCloudConfig();
  if (c.cloudName && c.apiKey && c.apiSecret) return true;
  if (c.cloudName && c.uploadPreset && c.cloudName !== 'YOUR_CLOUD_NAME') return true;
  return false;
}

function useSignedUpload(): boolean {
  const c = getCloudConfig();
  return !!(c.cloudName && c.apiKey && c.apiSecret);
}

/**
 * Upload a raw image Buffer to Cloudinary.
 * Accepts any MIME type (jpeg, png, webp, gif).
 * Returns the Cloudinary secure_url on success.
 */
export function uploadImageToCloudinary(
  imageBuffer: Buffer,
  filename: string,
  mimeType: string = 'image/jpeg'
): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = getCloudConfig();
    const boundary = '----FileUploadBoundary' + Date.now();
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const fields: Array<{ name: string; value: string }> = [];

    if (useSignedUpload()) {
      const paramsToSign = `timestamp=${timestamp}`;
      const signature = crypto
        .createHash('sha1')
        .update(paramsToSign + c.apiSecret)
        .digest('hex');

      fields.push({ name: 'timestamp', value: timestamp });
      fields.push({ name: 'api_key', value: c.apiKey });
      fields.push({ name: 'signature', value: signature });
    } else {
      fields.push({ name: 'upload_preset', value: c.uploadPreset });
    }

    // Build multipart body
    let bodyText = '';
    for (const field of fields) {
      bodyText += `--${boundary}\r\n`;
      bodyText += `Content-Disposition: form-data; name="${field.name}"\r\n\r\n`;
      bodyText += `${field.value}\r\n`;
    }

    const fileHeader =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`;
    const fileFooter = `\r\n--${boundary}--\r\n`;

    const bodyStart = Buffer.from(bodyText + fileHeader, 'utf-8');
    const bodyEnd = Buffer.from(fileFooter, 'utf-8');
    const fullBody = Buffer.concat([bodyStart, imageBuffer, bodyEnd]);

    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${c.cloudName}/image/upload`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': fullBody.length,
      },
    };

    console.log(
      `[FileUpload] Uploading image to Cloudinary (${useSignedUpload() ? 'signed' : 'unsigned'}): ${filename}`
    );

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.secure_url) {
            Sentry.addBreadcrumb({ category: 'file-upload', message: 'Cloudinary upload success', level: 'info' });
            console.log('[FileUpload] ✅ Cloudinary upload success:', json.secure_url);
            resolve(json.secure_url);
          } else {
            console.error('[FileUpload] ❌ Cloudinary response:', json);
            const err = new Error(json.error?.message || 'Cloudinary upload failed — no secure_url');
            Sentry.captureException(err);
            reject(err);
          }
        } catch (e) {
          console.error('[FileUpload] ❌ Failed to parse Cloudinary response:', data.substring(0, 200));
          Sentry.captureException(e);
          reject(new Error('Invalid response from Cloudinary'));
        }
      });
    });

    req.on('error', (err) => {
      console.error('[FileUpload] ❌ Cloudinary network error:', err.message);
      Sentry.captureException(err);
      reject(err);
    });

    req.write(fullBody);
    req.end();
  });
}

// ── Supabase Storage helpers ──────────────────────────────────────────────────

/**
 * Sanitise a filename so it is safe to use as an S3/Supabase Storage object key
 * segment.  Only alphanumerics, dashes, underscores and dots are kept; everything
 * else (spaces, brackets, parentheses, percent signs, etc.) is collapsed to a
 * single underscore.  The extension is preserved.  The result is capped at 120
 * characters so the full storage path stays well inside Supabase's 1 024-byte
 * key limit.
 */
function sanitizeStorageFilename(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  const base = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const ext  = lastDot > 0 ? filename.slice(lastDot)    : '';

  const safeBase = base
    .replace(/[^a-zA-Z0-9\-_.]/g, '_')   // replace every unsafe char with _
    .replace(/_+/g, '_')                   // collapse consecutive underscores
    .replace(/^[_\-.]+|[_\-.]+$/g, '')    // strip leading / trailing punctuation
    .slice(0, 110)                         // cap base length
    || 'file';                             // fallback if nothing survives

  // Keep only safe chars in the extension (e.g. ".pdf")
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);

  return safeBase + safeExt;
}

/**
 * Upload a PDF Buffer to Supabase Storage.
 *
 * Path pattern: {userId}/attachments/{sha256_16}/{sanitized_filename}
 *
 * Using a SHA-256 content hash as the folder means:
 *  • Filenames with special characters (brackets, spaces, etc.) never cause
 *    "Invalid key" errors — the hash is always hex-safe.
 *  • Uploading the same file twice (same bytes) resolves to the same path, so
 *    with upsert:true it is a no-op — zero wasted storage at scale.
 *  • RLS still works because userId is still the first path segment.
 *
 * Returns the storagePath (not a URL) on success.
 */
export async function uploadPdfToStorage(
  pdfBuffer: Buffer,
  userId: string,
  chatId: string,
  messageId: string,
  filename: string
): Promise<string> {
  const client = SupabaseClientManager.getClient();

  // Content hash — first 16 hex chars (64 bits) is plenty for deduplication
  const contentHash = crypto
    .createHash('sha256')
    .update(pdfBuffer)
    .digest('hex')
    .slice(0, 16);

  const safeName    = sanitizeStorageFilename(filename);
  const storagePath = `${userId}/attachments/${contentHash}/${safeName}`;

  console.log(`[FileUpload] Uploading PDF to Supabase Storage: ${storagePath}`);

  const { error } = await client.storage
    .from(BUCKET)
    .upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      // upsert:false is intentional.  Content-addressed paths mean that if
      // this exact object already exists it has the *same bytes* (same SHA-256
      // → same path).  We catch the duplicate-key error below and treat it as
      // a silent success instead of using upsert:true, which would require an
      // UPDATE RLS policy that the bucket does not define.
      upsert: false,
    });

  if (error) {
    const statusCode = String((error as any).statusCode ?? '');
    const msg       = (error.message ?? '').toLowerCase();

    // Supabase Storage returns 23505 (PostgreSQL unique violation) or 409
    // when the object already exists.  With content-addressed paths this
    // simply means the file was already uploaded — treat it as success.
    const isDuplicate =
      statusCode === '23505' ||
      statusCode === '409'   ||
      msg.includes('already exists') ||
      msg.includes('duplicate');

    if (isDuplicate) {
      console.log('[FileUpload] ✅ Object already exists at content-addressed path, reusing:', storagePath);
      return storagePath;
    }

    console.error('[FileUpload] ❌ Supabase Storage upload failed:', error.message);
    const uploadErr = new Error(`PDF upload failed: ${error.message}`);
    Sentry.captureException(uploadErr);
    throw uploadErr;
  }

  Sentry.addBreadcrumb({ category: 'file-upload', message: 'Supabase Storage upload success', level: 'info', data: { storagePath } });
  console.log('[FileUpload] ✅ Supabase Storage upload success:', storagePath);
  return storagePath;
}

/**
 * Generate a time-limited signed URL for a Supabase Storage object.
 * Used by the renderer to display/download a stored PDF.
 */
export async function getSignedStorageUrl(storagePath: string): Promise<string> {
  const client = SupabaseClientManager.getClient();

  const { data, error } = await client.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);

  if (error || !data?.signedUrl) {
    console.error('[FileUpload] ❌ Failed to create signed URL:', error?.message);
    throw new Error(`Failed to create signed URL: ${error?.message ?? 'unknown error'}`);
  }

  return data.signedUrl;
}

// ── Unified upload helper ─────────────────────────────────────────────────────

export interface StoredFileRef {
  name: string;
  mimeType: string;
  sizeBytes: number;
  cloudinaryUrl?: string; // images only
  storagePath?: string;   // PDFs only
}

/**
 * Upload a single file attachment to the appropriate storage service.
 * - Images (image/*) → Cloudinary
 * - PDFs             → Supabase Storage
 *
 * Returns a lightweight StoredFileRef (no base64).
 * Falls back to returning base64 as cloudinaryUrl data-URI for images if
 * Cloudinary is not configured (development convenience).
 */
export async function uploadAttachment(
  file: { name: string; mimeType: string; base64: string; sizeBytes: number },
  userId: string,
  chatId: string,
  messageId: string,
  pythonClient?: { uploadImage: (base64: string, filename: string, mimeType: string) => Promise<string> }
): Promise<StoredFileRef> {
  const buf = Buffer.from(file.base64, 'base64');

  if (file.mimeType.startsWith('image/')) {
    if (pythonClient) {
      // Preferred path: proxy through Python service so Cloudinary secrets
      // stay server-side and are never bundled in the Electron package.
      const cloudinaryUrl = await pythonClient.uploadImage(file.base64, file.name, file.mimeType);
      return { name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes, cloudinaryUrl };
    } else if (isCloudinaryConfigured()) {
      const cloudinaryUrl = await uploadImageToCloudinary(buf, file.name, file.mimeType);
      return { name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes, cloudinaryUrl };
    } else {
      console.warn('[FileUpload] Cloudinary not configured — storing image as data URI fallback');
      const dataUrl = `data:${file.mimeType};base64,${file.base64}`;
      return { name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes, cloudinaryUrl: dataUrl };
    }
  } else {
    // PDF
    const storagePath = await uploadPdfToStorage(buf, userId, chatId, messageId, file.name);
    return { name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes, storagePath };
  }
}

// ── IPC handler registration ──────────────────────────────────────────────────

/**
 * Register the storage:get-signed-url IPC handle.
 * Called once at startup from the main process.
 */
export function registerFileUploadHandlers(): void {
  /**
   * storage:get-signed-url
   * Accepts: { storagePath: string }
   * Returns: { signedUrl: string }
   */
  ipcMain.handle('storage:get-signed-url', async (_event, data: { storagePath: string }) => {
    try {
      if (!data?.storagePath) {
        throw new Error('storagePath is required');
      }
      const signedUrl = await getSignedStorageUrl(data.storagePath);
      return { signedUrl };
    } catch (err: any) {
      Sentry.captureException(err);
      console.error('[FileUpload] storage:get-signed-url error:', err.message);
      return { error: err.message };
    }
  });

  /**
   * storage:open-pdf
   * Opens a Supabase-stored PDF in the default system viewer.
   * Accepts: { storagePath: string }
   */
  ipcMain.handle('storage:open-pdf', async (_event, data: { storagePath: string }) => {
    try {
      if (!data?.storagePath) throw new Error('storagePath is required');
      const signedUrl = await getSignedStorageUrl(data.storagePath);
      await shell.openExternal(signedUrl);
      return { success: true };
    } catch (err: any) {
      Sentry.captureException(err);
      console.error('[FileUpload] storage:open-pdf error:', err.message);
      return { success: false, error: err.message };
    }
  });

  console.log('[FileUploadHandlers] IPC handlers registered');
}
