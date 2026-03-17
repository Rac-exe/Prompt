import { useState, useRef, useEffect } from "react";
import { FileText, Image, Sparkles, Paperclip, Camera, BookOpen, Lightbulb, Globe, MoreHorizontal } from "lucide-react";
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

  // Calculate menu position when opened
  useEffect(() => {
    if (isOpen && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setMenuPosition({
        bottom: `calc(100vh - ${rect.top}px + 8px)`,
        left: `${rect.left}px`,
      });
    }
  }, [isOpen, anchorRef]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const attachedFiles: AttachedFile[] = [];

    for (let i = 0; i < Math.min(files.length, 5); i++) {
      const file = files[i];

      // Validate file size
      if (file.size > 10_000_000) {
        alert(`File "${file.name}" exceeds 10 MB limit`);
        continue;
      }

      // Validate file type
      const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        alert(`File type not allowed: ${file.type}`);
        continue;
      }

      // Convert to base64
      try {
        const base64 = await fileToBase64(file);
        attachedFiles.push({
          name: file.name,
          mimeType: file.type,
          base64,
          sizeBytes: file.size,
        });
      } catch (error) {
        console.error(`[PlusMenu] Failed to process file ${file.name}:`, error);
        alert(`Failed to process file "${file.name}"`);
      }
    }

    if (attachedFiles.length > 0) {
      onFilesSelected(attachedFiles);
      onClose();
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
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
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Plus menu popover - ChatGPT Style */}
      {!showSkillPicker ? (
        <div
          ref={menuRef}
          className={cn(
            "fixed z-50 w-80 rounded-2xl bg-white dark:bg-gray-800 shadow-2xl border border-gray-200 dark:border-gray-700",
            "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200"
          )}
          style={menuPosition}
        >
          {/* Header */}
          <div className="p-4 border-b border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <Paperclip className="w-4 h-4 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">Add photos & files</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Upload files or choose a skill</p>
              </div>
            </div>
          </div>

          {/* Menu Items */}
          <div className="p-2">
            {/* Add Files */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200",
                "hover:bg-gray-50 dark:hover:bg-gray-700/50 group"
              )}
            >
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40 transition-colors">
                <Camera className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1 text-left">
                <div className="font-medium text-gray-900 dark:text-gray-100">Upload files</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">PDF, PNG, JPG, WEBP</div>
              </div>
            </button>

            {/* Divider */}
            <div className="h-px bg-gray-100 dark:bg-gray-700 my-2" />

            {/* Skills Section */}
            <div className="space-y-1">
              {/* Create image */}
              <button
                onClick={() => onSkillSelected('creative')}
                className={cn(
                  "w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200",
                  "hover:bg-gray-50 dark:hover:bg-gray-700/50 group"
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center group-hover:bg-purple-100 dark:group-hover:bg-purple-900/40 transition-colors">
                  <Image className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="flex-1 text-left">
                  <div className="font-medium text-gray-900 dark:text-gray-100">Create image</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">Generate images with AI</div>
                </div>
              </button>

              {/* Thinking */}
              <button
                onClick={() => onSkillSelected('analytical')}
                className={cn(
                  "w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200",
                  "hover:bg-gray-50 dark:hover:bg-gray-700/50 group"
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center group-hover:bg-amber-100 dark:group-hover:bg-amber-900/40 transition-colors">
                  <Lightbulb className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 text-left">
                  <div className="font-medium text-gray-900 dark:text-gray-100">Thinking</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">Deep analysis and reasoning</div>
                </div>
              </button>

              {/* Study and learn */}
              <button
                onClick={() => onSkillSelected('educational')}
                className={cn(
                  "w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200",
                  "hover:bg-gray-50 dark:hover:bg-gray-700/50 group"
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center group-hover:bg-green-100 dark:group-hover:bg-green-900/40 transition-colors">
                  <BookOpen className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div className="flex-1 text-left">
                  <div className="font-medium text-gray-900 dark:text-gray-100">Study and learn</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">Educational assistance</div>
                </div>
              </button>

              {/* Web search */}
              <button
                onClick={() => onSkillSelected('research')}
                className={cn(
                  "w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200",
                  "hover:bg-gray-50 dark:hover:bg-gray-700/50 group"
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-cyan-50 dark:bg-cyan-900/20 flex items-center justify-center group-hover:bg-cyan-100 dark:group-hover:bg-cyan-900/40 transition-colors">
                  <Globe className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                </div>
                <div className="flex-1 text-left">
                  <div className="font-medium text-gray-900 dark:text-gray-100">Web search</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">Search the internet</div>
                </div>
              </button>

              {/* More skills */}
              <button
                onClick={() => setShowSkillPicker(true)}
                className={cn(
                  "w-full flex items-center gap-4 p-3 rounded-xl transition-all duration-200",
                  "hover:bg-gray-50 dark:hover:bg-gray-700/50 group"
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-gray-50 dark:bg-gray-700 flex items-center justify-center group-hover:bg-gray-100 dark:group-hover:bg-gray-600 transition-colors">
                  <MoreHorizontal className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </div>
                <div className="flex-1 text-left">
                  <div className="font-medium text-gray-900 dark:text-gray-100">More</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">Browse all skills</div>
                </div>
                <div className="text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          ref={menuRef}
          className="fixed z-50"
          style={menuPosition}
        >
          <SkillPicker
            onSelect={handleSkillSelect}
            onClose={() => {
              setShowSkillPicker(false);
              onClose();
            }}
          />
        </div>
      )}
    </>
  );
};

// Helper function to convert File to base64
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix (e.g., "data:application/pdf;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
