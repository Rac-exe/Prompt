import { useState, useRef, useEffect } from "react";
import { Paperclip, Sparkles, Upload } from "lucide-react";
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
const MAX_FILE_SIZE = 10_000_000; // 10 MB
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
  const [menuPosition, setMenuPosition] = useState<{ bottom: string; left: string }>({ bottom: '0', left: '0' });
  const [fileError, setFileError] = useState<string | null>(null);

  // Calculate position above the anchor button
  useEffect(() => {
    if (isOpen && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setMenuPosition({
        bottom: `calc(100vh - ${rect.top}px + 8px)`,
        left: `${rect.left}px`,
      });
    }
    // Reset sub-state when menu opens/closes
    if (!isOpen) {
      setShowSkillPicker(false);
      setFileError(null);
    }
  }, [isOpen, anchorRef]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isOpen, onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setFileError(null);

    const attached: AttachedFile[] = [];

    for (let i = 0; i < Math.min(files.length, MAX_FILES); i++) {
      const file = files[i];
      if (!ALLOWED_TYPES.includes(file.type)) {
        setFileError(`"${file.name}" is not a supported type (PDF, PNG, JPG, WEBP)`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        setFileError(`"${file.name}" exceeds the 10 MB limit`);
        continue;
      }
      try {
        const base64 = await fileToBase64(file);
        attached.push({ name: file.name, mimeType: file.type, base64, sizeBytes: file.size });
      } catch {
        setFileError(`Failed to read "${file.name}"`);
      }
    }

    if (attached.length > 0) {
      onFilesSelected(attached);
      onClose();
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSkillSelect = (skillName: string) => {
    onSkillSelected(skillName);
    setShowSkillPicker(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Hidden file input */}
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
          "fixed z-50 w-72 rounded-2xl bg-popover border border-border shadow-elevated",
          "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-150"
        )}
        style={menuPosition}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/60">
          <div className="w-7 h-7 rounded-lg bg-emerald/10 border border-emerald/20 flex items-center justify-center">
            <Paperclip className="w-3.5 h-3.5 text-emerald" />
          </div>
          <span className="text-sm font-semibold text-foreground">Add to message</span>
        </div>

        {/* Error strip */}
        {fileError && (
          <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-destructive/8 border border-destructive/20 text-xs text-destructive">
            {fileError}
          </div>
        )}

        {/* Actions */}
        <div className="p-2 space-y-0.5">
          {/* Upload Files */}
          <button
            onClick={() => { setFileError(null); fileInputRef.current?.click(); }}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors duration-150",
              "hover:bg-secondary group text-left"
            )}
          >
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/15 transition-colors flex-shrink-0">
              <Upload className="w-4 h-4 text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground">Upload files</div>
              <div className="text-xs text-muted-foreground">PDF, PNG, JPG, WEBP · max 10 MB</div>
            </div>
          </button>

          {/* Divider */}
          <div className="h-px bg-border/60 my-1 mx-1" />

          {/* Choose Skill */}
          {!showSkillPicker ? (
            <button
              onClick={() => setShowSkillPicker(true)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors duration-150",
                "hover:bg-secondary group text-left"
              )}
            >
              <div className="w-8 h-8 rounded-lg bg-emerald/10 flex items-center justify-center group-hover:bg-emerald/15 transition-colors flex-shrink-0">
                <Sparkles className="w-4 h-4 text-emerald" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">Choose skill</div>
                <div className="text-xs text-muted-foreground">Specialise how your prompt is optimised</div>
              </div>
              <svg className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            /* Inline skill picker */
            <div className="pt-1">
              <SkillPicker
                onSelect={handleSkillSelect}
                onClose={() => setShowSkillPicker(false)}
                className="static w-full shadow-none border-0 rounded-xl bg-secondary/50"
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
};

// Helper: File → base64 string (no data URL prefix)
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
