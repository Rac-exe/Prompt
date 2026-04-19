import { ipcMain } from 'electron';
import * as Sentry from '@sentry/electron/main';
import type { PythonClient } from '../api/python-client';
import { UserService } from '../database/services/user-service';

export function registerAvatarHandlers(pythonClient: PythonClient) {
  const userService = new UserService();

  /**
   * avatar:upload — Upload an avatar image via the Python service.
   *
   * Persists BOTH avatar_url (CDN URL) and avatar_public_id (Cloudinary handle)
   * to the user's profile so account deletion can wipe the asset directly.
   *
   * Accepts: { imageData: string (base64 data URL), filename: string }
   * Returns: { success: boolean, url?: string, error?: string }
   */
  ipcMain.handle('avatar:upload', async (_event, data: { imageData: string; filename: string }) => {
    try {
      if (!data?.imageData) {
        return { success: false, error: 'No image data provided' };
      }

      const base64Match = data.imageData.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!base64Match) {
        return { success: false, error: 'Invalid image data format' };
      }

      const mimeType = `image/${base64Match[1]}`;
      const rawBase64 = base64Match[2];
      console.log(`[AvatarUpload] Received image: ${(rawBase64.length * 0.75 / 1024).toFixed(0)} KB`);

      const upload = await pythonClient.uploadImage(rawBase64, data.filename || 'avatar.jpg', mimeType);

      // Persist both fields. updateProfile is best-effort — we still return the
      // URL on partial failure so the renderer can preview the image immediately.
      try {
        await userService.updateProfile({
          avatar_url: upload.url,
          avatar_public_id: upload.publicId || null,
        } as any);
      } catch (err) {
        console.warn('[AvatarUpload] Failed to persist avatar_public_id (non-fatal):', err);
        Sentry.captureException(err, { tags: { component: 'avatar-upload', op: 'persist-public-id' } });
      }

      return { success: true, url: upload.url };
    } catch (err: any) {
      Sentry.captureException(err, { tags: { component: 'avatar-upload' } });
      console.error('[AvatarUpload] Handler error:', err);
      return { success: false, error: err.message || 'Upload failed' };
    }
  });

  console.log('[AvatarHandlers] IPC handlers registered');
}
