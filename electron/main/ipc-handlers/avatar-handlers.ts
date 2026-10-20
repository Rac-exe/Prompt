import { ipcMain } from 'electron';
import { UserService } from '../database/services/user-service';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export function registerAvatarHandlers() {
  const userService = new UserService();

  /**
   * avatar:upload — store the avatar locally on the profile as a data URL.
   *
   * Accepts: { imageData: string (base64 data URL), filename: string }
   * Returns: { success: boolean, url?: string, error?: string }
   */
  ipcMain.handle('avatar:upload', async (_event, data: { imageData: string; filename: string }) => {
    try {
      if (!data?.imageData) {
        return { success: false, error: 'No image data provided' };
      }

      const base64Match = data.imageData.match(/^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!base64Match) {
        return { success: false, error: 'Invalid image data format' };
      }
      if (base64Match[2].length * 0.75 > MAX_AVATAR_BYTES) {
        return { success: false, error: 'Image is too large (max 2 MB)' };
      }

      await userService.updateProfile({ avatar_url: data.imageData });
      return { success: true, url: data.imageData };
    } catch (err: any) {
      console.error('[Avatar] Handler error:', err);
      return { success: false, error: err.message || 'Could not save avatar' };
    }
  });
}
