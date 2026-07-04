import { useState, useRef, useCallback, useEffect } from "react";
import { UploadSimple, X, Camera, CircleNotch, User, Image as ImageIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const isElectron = typeof window !== 'undefined' && window.electronAPI;

type Mode = "pick" | "camera";

interface AvatarUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentAvatarUrl: string | null;
  onAvatarUploaded: (url: string) => void;
}

export function AvatarUploadModal({
  open, onOpenChange, currentAvatarUrl, onAvatarUploaded,
}: AvatarUploadModalProps) {
  const [mode, setMode] = useState<Mode>("pick");
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const validateFile = (file: File): string | null => {
    if (!ACCEPTED_TYPES.includes(file.type)) return "Unsupported format. Use JPG, PNG, or GIF.";
    if (file.size > MAX_FILE_SIZE) return "File too large. Maximum size is 2 MB.";
    return null;
  };

  const handleFile = useCallback((file: File) => {
    const err = validateFile(file);
    if (err) { setError(err); return; }
    setError(null);
    setSelectedFile(file);
    const blobUrl = URL.createObjectURL(file);
    setPreview(blobUrl);
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  // ── Camera ───────────────────────────────────────────────────────────
  const startCamera = async () => {
    setError(null); setMode("camera"); setCameraReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => { videoRef.current?.play(); setCameraReady(true); };
      }
    } catch {
      setError("Could not access camera. Please allow camera permissions.");
      setMode("pick");
    }
  };

  const stopCamera = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setCameraReady(false);
  }, []);

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    canvas.toBlob((blob) => {
      if (!blob) return;
      stopCamera(); setMode("pick");
      handleFile(new File([blob], "camera-capture.jpg", { type: "image/jpeg" }));
    }, "image/jpeg", 0.9);
  };

  useEffect(() => { if (!open) { stopCamera(); setMode("pick"); } }, [open, stopCamera]);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true); setError(null);
    try {
      const imageDataUrl = await fileToDataUrl(selectedFile);
      if (isElectron && (window.electronAPI as any)?.uploadAvatar) {
        const result = await (window.electronAPI as any).uploadAvatar(imageDataUrl, selectedFile.name || "avatar.jpg");
        if (result?.success && result.url) { onAvatarUploaded(result.url); handleClose(); return; }
      }
      onAvatarUploaded(imageDataUrl);
      handleClose();
    } catch { setError("Something went wrong. Please try again."); }
    finally { setIsUploading(false); }
  };

  const removeFile = () => {
    if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
    setPreview(null); setSelectedFile(null);
  };

  const handleClose = () => {
    stopCamera();
    if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
    setPreview(null); setSelectedFile(null); setError(null);
    setIsDragging(false); setIsUploading(false); setMode("pick");
    onOpenChange(false);
  };

  const displayImage = preview || currentAvatarUrl;
  const fileSizeKB = selectedFile ? (selectedFile.size / 1024).toFixed(0) : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[540px] bg-background border-border rounded-2xl p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="px-7 pt-7 pb-1">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold tracking-tight">Change Profile Picture</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Upload a photo or take one with your camera.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="border-t border-border mt-4" />

        {/* ── CAMERA MODE ── */}
        {mode === "camera" ? (
          <div className="flex flex-col items-center gap-4 px-7 py-8">
            <div className="relative w-48 h-48 rounded-full overflow-hidden bg-black border-2 border-border">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: "scaleX(-1)" }} />
              {!cameraReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <CircleNotch size={24} weight="light" className="animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => { stopCamera(); setMode("pick"); }}>Cancel</Button>
              <Button onClick={capturePhoto} disabled={!cameraReady} className="border border-input text-foreground hover:bg-muted gap-2">
                <Camera size={16} weight="light" /> Capture
              </Button>
            </div>
          </div>
        ) : (
          /* ── PICK MODE — two-column layout ── */
          <div className="flex gap-8 px-7 py-8">
            {/* Left column: avatar preview circle */}
            <div className="flex flex-col items-center gap-3 flex-shrink-0">
              <div
                className={cn(
                  "relative w-44 h-44 rounded-full border-2 border-dashed flex items-center justify-center cursor-pointer transition-all overflow-hidden",
                  isDragging ? "border-primary bg-primary/5 scale-105" : "border-border/60 hover:border-primary/40",
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                {displayImage ? (
                  <>
                    <img src={displayImage} alt="Preview" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                      <Camera size={28} weight="light" className="text-white" />
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground/50">
                    <User size={48} weight="light" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Avatar Preview</span>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground/50 text-center leading-tight">
                Supported formats: JPG, PNG, GIF.<br />Max size: 2MB
              </p>
            </div>

            {/* Right column: action cards */}
            <div className="flex flex-col gap-3 flex-1 min-w-0 justify-center">
              {/* Choose File card */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-4 p-4 rounded-xl border border-border/60 hover:border-primary/40 hover:bg-secondary/40 transition-all text-left w-full group"
              >
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10 transition-colors">
                  <UploadSimple size={20} weight="light" className="text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Choose File</p>
                  <p className="text-xs text-muted-foreground">From your computer</p>
                </div>
              </button>

              {/* Take Photo card */}
              <button
                onClick={startCamera}
                className="flex items-center gap-4 p-4 rounded-xl border border-border/60 hover:border-primary/40 hover:bg-secondary/40 transition-all text-left w-full group"
              >
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10 transition-colors">
                  <Camera size={20} weight="light" className="text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Take Photo</p>
                  <p className="text-xs text-muted-foreground">Using your webcam</p>
                </div>
              </button>

              {/* Selected file info card */}
              {selectedFile && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/15">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <ImageIcon size={16} weight="light" className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{selectedFile.name}</p>
                    <p className="text-[11px] text-muted-foreground">{fileSizeKB} KB</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(); }}
                    className="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                  >
                    <X size={16} weight="light" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Hidden file input */}
        <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.gif,.webp" className="hidden" onChange={handleFileInputChange} />

        {/* Error */}
        {error && (
          <div className="px-7 pb-2">
            <p className="text-xs text-destructive text-center">{error}</p>
          </div>
        )}

        {/* Footer */}
        {mode === "pick" && (
          <div className="flex items-center justify-end gap-3 px-7 py-5 bg-muted/30 border-t border-border">
            <Button variant="ghost" onClick={handleClose} disabled={isUploading} className="font-semibold">
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!selectedFile || isUploading}
              className="border border-input text-foreground hover:bg-muted gap-2 font-semibold px-6"
            >
              {isUploading ? (
                <><CircleNotch size={16} weight="light" className="animate-spin" /> Saving...</>
              ) : (
                <><UploadSimple size={16} weight="light" /> Save Changes</>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
