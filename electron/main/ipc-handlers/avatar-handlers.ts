import { ipcMain } from 'electron';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';

// ============================================
// AVATAR UPLOAD IPC HANDLER
// ============================================
// Uploads avatar images to Cloudinary from the main process.
// This avoids CSP/CORS issues that block fetch() in the renderer.
//
// Supports two modes:
//   1. Signed upload (API key + secret) — preferred, more control
//   2. Unsigned upload (upload preset)  — simpler, less secure
//
// Falls back to returning the base64 data URL if Cloudinary isn't configured.

// Read env vars lazily (dotenv.config() runs AFTER module imports are hoisted)
function getCloudConfig() {
  return {
    cloudName: process.env.VITE_CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    uploadPreset: process.env.VITE_CLOUDINARY_UPLOAD_PRESET || '',
  };
}

function isCloudinaryConfigured(): boolean {
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
 * Upload a buffer to Cloudinary using multipart/form-data.
 * Works from Node.js — no browser CSP restrictions.
 */
function uploadToCloudinary(imageBuffer: Buffer, filename: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = getCloudConfig();
    const boundary = '----CloudinaryBoundary' + Date.now();
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // Build multipart form fields
    const fields: Array<{ name: string; value: string }> = [];

    if (useSignedUpload()) {
      // Signed upload: generate signature
      const paramsToSign = `timestamp=${timestamp}`;
      const signature = crypto
        .createHash('sha1')
        .update(paramsToSign + c.apiSecret)
        .digest('hex');

      fields.push({ name: 'timestamp', value: timestamp });
      fields.push({ name: 'api_key', value: c.apiKey });
      fields.push({ name: 'signature', value: signature });
    } else {
      // Unsigned upload: use preset
      fields.push({ name: 'upload_preset', value: c.uploadPreset });
    }

    // Build multipart body
    let body = '';
    for (const field of fields) {
      body += `--${boundary}\r\n`;
      body += `Content-Disposition: form-data; name="${field.name}"\r\n\r\n`;
      body += `${field.value}\r\n`;
    }

    // File field
    const fileHeader =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n`;
    const fileFooter = `\r\n--${boundary}--\r\n`;

    const bodyStart = Buffer.from(body + fileHeader, 'utf-8');
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

    console.log(`[AvatarUpload] Uploading to Cloudinary (${useSignedUpload() ? 'signed' : 'unsigned'}): ${c.cloudName}`);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.secure_url) {
            console.log('[AvatarUpload] ✅ Cloudinary upload success:', json.secure_url);
            resolve(json.secure_url);
          } else {
            console.error('[AvatarUpload] ❌ Cloudinary response:', json);
            reject(new Error(json.error?.message || 'Upload failed — no secure_url in response'));
          }
        } catch (e) {
          console.error('[AvatarUpload] ❌ Failed to parse response:', data.substring(0, 200));
          reject(new Error('Invalid response from Cloudinary'));
        }
      });
    });

    req.on('error', (err) => {
      console.error('[AvatarUpload] ❌ Network error:', err.message);
      reject(err);
    });

    req.write(fullBody);
    req.end();
  });
}

export function registerAvatarHandlers() {
  /**
   * avatar:upload — Upload an avatar image.
   *
   * Accepts: { imageData: string (base64 data URL), filename: string }
   * Returns: { success: boolean, url?: string, error?: string }
   */
  ipcMain.handle('avatar:upload', async (_event, data: { imageData: string; filename: string }) => {
    try {
      if (!data?.imageData) {
        return { success: false, error: 'No image data provided' };
      }

      // Extract raw base64 from data URL (strip "data:image/jpeg;base64," prefix)
      const base64Match = data.imageData.match(/^data:image\/\w+;base64,(.+)$/);
      if (!base64Match) {
        return { success: false, error: 'Invalid image data format' };
      }

      const imageBuffer = Buffer.from(base64Match[1], 'base64');
      console.log(`[AvatarUpload] Received image: ${(imageBuffer.length / 1024).toFixed(0)} KB`);

      if (isCloudinaryConfigured()) {
        try {
          const url = await uploadToCloudinary(imageBuffer, data.filename || 'avatar.jpg');
          return { success: true, url };
        } catch (cloudErr: any) {
          console.error('[AvatarUpload] Cloudinary failed, returning data URL fallback:', cloudErr.message);
          // Fall through to data URL
        }
      } else {
        console.log('[AvatarUpload] Cloudinary not configured, using data URL');
      }

      // Fallback: return the compressed data URL as-is
      return { success: true, url: data.imageData };
    } catch (err: any) {
      console.error('[AvatarUpload] Handler error:', err);
      return { success: false, error: err.message || 'Upload failed' };
    }
  });

  console.log('[AvatarHandlers] IPC handlers registered');
}
