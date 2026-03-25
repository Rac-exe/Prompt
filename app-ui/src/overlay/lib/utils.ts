/** Generate a unique message ID. */
export function generateId(): string {
  return 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
}

/** Generate a UUID for version grouping. */
export function generateGroupId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Read a File object as base64 (strip `data:…;base64,` prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const MAX_IMAGE_SIZE = 4_500_000;
const MAX_IMAGE_DIMENSION = 1920;

/**
 * If the image is under 4.5 MB, returns its raw base64.
 * Otherwise draws it onto a canvas scaled to 1920px max and re-encodes as JPEG q=0.85.
 */
export function resizeImageIfNeeded(file: File): Promise<{ base64: string; sizeBytes: number }> {
  return new Promise((resolve, reject) => {
    if (file.size <= MAX_IMAGE_SIZE) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve({ base64, sizeBytes: file.size });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        const ratio = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not available')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const base64 = dataUrl.split(',')[1];
      const sizeBytes = Math.round(base64.length * 0.75);
      resolve({ base64, sizeBytes });
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Failed to load image')); };
    img.src = objectUrl;
  });
}
