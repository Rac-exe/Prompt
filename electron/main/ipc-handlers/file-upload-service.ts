import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app, ipcMain, shell } from 'electron';

/**
 * Local attachment storage.
 *
 * Files attached to chat messages are saved under {userData}/attachments so
 * they can be reopened later. Paths are content-addressed:
 *   {sha256_16}/{sanitized_filename}
 * so the same file attached twice is stored once.
 */

export function getAttachmentsRoot(): string {
  return path.join(app.getPath('userData'), 'attachments');
}

/**
 * Sanitise a filename for use as a path segment. Only alphanumerics, dashes,
 * underscores and dots are kept; the extension is preserved and the result is
 * capped at 120 characters.
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

  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);

  return safeBase + safeExt;
}

/** Absolute path for a stored attachment, refusing anything outside the attachments folder. */
function resolveStoragePath(storagePath: string): string {
  const root = path.resolve(getAttachmentsRoot());
  const full = path.resolve(root, storagePath);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('Invalid attachment path');
  }
  if (!fs.existsSync(full)) {
    throw new Error('Attachment not found');
  }
  return full;
}

export interface StoredFileRef {
  name: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}

/**
 * Save a single attachment to disk. Returns a lightweight reference (no base64)
 * that is stored on the message.
 */
export async function saveAttachment(
  file: { name: string; mimeType: string; base64: string; sizeBytes: number },
  _chatId: string,
  _messageId: string,
): Promise<StoredFileRef> {
  const buf = Buffer.from(file.base64, 'base64');
  const contentHash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
  const storagePath = `${contentHash}/${sanitizeStorageFilename(file.name)}`;
  const full = path.join(getAttachmentsRoot(), contentHash, sanitizeStorageFilename(file.name));
  if (!fs.existsSync(full)) {
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, buf);
  }
  return { name: file.name, mimeType: file.mimeType, sizeBytes: buf.length, storagePath };
}

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

// ── IPC handler registration ──────────────────────────────────────────────────

/**
 * Register the storage:* IPC handles. Called once at startup.
 */
export function registerFileUploadHandlers(): void {
  /**
   * storage:get-signed-url
   * Returns the stored file as a data URL the renderer can display.
   * Accepts: { storagePath: string }
   * Returns: { signedUrl: string } | { error: string }
   */
  ipcMain.handle('storage:get-signed-url', async (_event, data: { storagePath: string }) => {
    try {
      if (!data?.storagePath) throw new Error('storagePath is required');
      const full = resolveStoragePath(data.storagePath);
      const mime = MIME_BY_EXT[path.extname(full).toLowerCase()] ?? 'application/octet-stream';
      const bytes = await fs.promises.readFile(full);
      return { signedUrl: `data:${mime};base64,${bytes.toString('base64')}` };
    } catch (err: any) {
      console.error('[Attachments] storage:get-signed-url error:', err.message);
      return { error: err.message };
    }
  });

  /**
   * storage:open-pdf
   * Opens a stored attachment in the default system viewer.
   * Accepts: { storagePath: string }
   */
  ipcMain.handle('storage:open-pdf', async (_event, data: { storagePath: string }) => {
    try {
      if (!data?.storagePath) throw new Error('storagePath is required');
      const error = await shell.openPath(resolveStoragePath(data.storagePath));
      if (error) throw new Error(error);
      return { success: true };
    } catch (err: any) {
      console.error('[Attachments] storage:open-pdf error:', err.message);
      return { success: false, error: err.message };
    }
  });
}
