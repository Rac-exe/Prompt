import { ipcMain } from 'electron';
import * as Sentry from '@sentry/electron/main';
import type { PythonClient } from '../api/python-client';

export function registerAvatarHandlers(pythonClient: PythonClient) {
  /**
   * avatar:upload — Upload an avatar image via the Python service.
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

      const url = await pythonClient.uploadImage(rawBase64, data.filename || 'avatar.jpg', mimeType);
      return { success: true, url };
    } catch (err: any) {
      Sentry.captureException(err, { tags: { component: 'avatar-upload' } });
      console.error('[AvatarUpload] Handler error:', err);
      return { success: false, error: err.message || 'Upload failed' };
    }
  });

  console.log('[AvatarHandlers] IPC handlers registered');
}
