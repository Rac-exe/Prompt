import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { Paperclip, Sparkle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { SkillPicker } from "./SkillPicker";
import type { AttachedFile } from "@/types/electron";

interface PlusMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onFilesSelected: (files: AttachedFile[]) => void;
  onSkillSelected: (skillName: string) => void;
  anchorRef: React.RefObject<HTMLButtonElement>;
}

const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_FILE_SIZE = 32_000_000;  // 32 MB hard cap (PDF limit per Claude)
const MAX_IMAGE_SIZE = 4_500_000;  // images above this are auto-resized
const MAX_IMAGE_DIMENSION = 1920;  // max px on longest side after resize
const MAX_FILES = 5;

export const PlusMenu = ({
  isOpen,
  onClose,
  onFilesSelected,
  onSkillSelected,
  anchorRef,
}: PlusMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);

  // Reset state on close
  useEffect(() => {
    if (!isOpen) { setShowSkillPicker(false); setFileError(null); }
  }, [isOpen]);

  // Compute position above the anchor button using fixed coords
  useLayoutEffect(() => {
    if (!isOpen || !anchorRef.current) { setPos(null); return; }
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 6,
    });
  }, [isOpen, anchorRef]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setFileError(null);

    const attached: AttachedFile[] = [];
    for (let i = 0; i < Math.min(files.length, MAX_FILES); i++) {
      const file = files[i];
      if (!ALLOWED_TYPES.includes(file.type)) {
        setFileError(`"${file.name}" is not a supported type`);
        continue;
      }
      // PDFs: hard size cap, no resize possible
      if (file.type === 'application/pdf') {
        if (file.size > MAX_FILE_SIZE) {
          setFileError(`"${file.name}" is too large (max 32 MB for PDFs)`);
          continue;
        }
        try {
          const base64 = await fileToBase64(file);
          attached.push({ name: file.name, mimeType: file.type, base64, sizeBytes: file.size });
        } catch { setFileError(`Failed to read "${file.name}"`); }
        continue;
      }
      // Images: auto-resize if above limit
      if (IMAGE_TYPES.includes(file.type)) {
        try {
          const { base64, sizeBytes, mimeType } = await resizeImageIfNeeded(file);
          attached.push({ name: file.name, mimeType, base64, sizeBytes });
        } catch { setFileError(`Failed to process "${file.name}"`); }
      }
    }

    if (attached.length > 0) { onFilesSelected(attached); onClose(); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (!isOpen || !pos) return null;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />

      <div
        ref={menuRef}
        className={cn(
          "fixed z-[100] min-w-[200px] rounded-xl",
          "bg-popover border border-border/80 shadow-xl",
          "animate-in fade-in-0 slide-in-from-bottom-1 duration-100",
        )}
        style={{ left: pos.left, bottom: pos.bottom }}
      >
        {fileError && (
          <div className="px-2.5 pt-2 pb-0">
            <div className="px-2.5 py-1.5 rounded-lg bg-destructive/8 border border-destructive/20 text-[11px] text-destructive">
              {fileError}
            </div>
          </div>
        )}

        {!showSkillPicker ? (
          <div className="py-1 px-1">
            <button
              onClick={() => { setFileError(null); fileInputRef.current?.click(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-secondary transition-colors text-left"
            >
              <Paperclip size={16} weight="light" className="text-muted-foreground flex-shrink-0" />
              <span className="text-[13px] text-foreground">Add photos & files</span>
            </button>
            <button
              onClick={() => setShowSkillPicker(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-secondary transition-colors text-left"
            >
              <Sparkle size={16} weight="light" className="text-muted-foreground flex-shrink-0" />
              <span className="text-[13px] text-foreground">Choose skill</span>
            </button>
          </div>
        ) : (
          <div className="py-1">
            <SkillPicker
              onSelect={(name) => { onSkillSelected(name); setShowSkillPicker(false); onClose(); }}
              onClose={() => setShowSkillPicker(false)}
              className="static w-full shadow-none border-0 rounded-xl bg-transparent max-w-[320px]"
            />
          </div>
        )}
      </div>
    </>
  );
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function resizeImageIfNeeded(file: File): Promise<{ base64: string; sizeBytes: number; mimeType: string }> {
  return new Promise((resolve, reject) => {
    // If small enough, just base64-encode as-is
    if (file.size <= MAX_IMAGE_SIZE) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve({ base64, sizeBytes: file.size, mimeType: file.type || 'image/png' });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    // Oversized: draw onto a canvas and re-encode as JPEG
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
      const sizeBytes = Math.round(base64.length * 0.75); // approximate decoded size
      resolve({ base64, sizeBytes, mimeType: 'image/jpeg' });
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Failed to load image')); };
    img.src = objectUrl;
  });
}
