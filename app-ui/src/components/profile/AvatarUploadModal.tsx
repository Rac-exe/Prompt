import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, X, Camera, Loader2, ImageIcon, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
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

  // ── File validation ──────────────────────────────────────────────────
  const validateFile = (file: File): string | null => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return "Unsupported format. Use JPG, PNG, or WebP.";
    }
    if (file.size > MAX_FILE_SIZE) {
      return "File too large. Maximum size is 5 MB.";
    }
    return null;
  };

  // ── Handle file selection ────────────────────────────────────────────
  const handleFile = useCallback((file: File) => {
    const err = validateFile(file);
    if (err) { setError(err); return; }
    setError(null);
    setSelectedFile(file);
    // Use blob URL for preview (avoids CSP issues with data: URIs in Electron)
    const blobUrl = URL.createObjectURL(file);
    setPreview(blobUrl);
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  // ── Drag & drop ──────────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  // ── Camera ───────────────────────────────────────────────────────────
  const startCamera = async () => {
    setError(null);
    setMode("camera");
    setCameraReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setCameraReady(true);
        };
      }
    } catch (err: any) {
      console.error("[AvatarUpload] Camera error:", err);
      setError("Could not access camera. Please allow camera permissions.");
      setMode("pick");
    }
  };

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    // Center-crop to square
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);

    canvas.toBlob((blob) => {
      if (!blob) return;
      stopCamera();
      setMode("pick");
      // Use handleFile so the preview goes through the same blob URL path
      const file = new File([blob], "camera-capture.jpg", { type: "image/jpeg" });
      handleFile(file);
    }, "image/jpeg", 0.9);
  };

  // Stop camera when modal closes
  useEffect(() => {
    if (!open) {
      stopCamera();
      setMode("pick");
    }
  }, [open, stopCamera]);

  // ── Read file as base64 data URL for upload ───────────────────────────
  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // ── Upload / save ────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    setError(null);

    try {
      // Convert file to base64 data URL for sending via IPC
      const imageDataUrl = await fileToDataUrl(selectedFile);

      if (isElectron && (window.electronAPI as any)?.uploadAvatar) {
        // Upload via main process IPC (avoids CSP/CORS issues in renderer)
        const result = await (window.electronAPI as any).uploadAvatar(
          imageDataUrl,
          selectedFile.name || "avatar.jpg"
        );

        if (result && result.success && result.url) {
          onAvatarUploaded(result.url);
          handleClose();
          return;
        }

        if (result && !result.success) {
          console.warn("[AvatarUpload] IPC upload returned error:", result.error);
        }
      }

      // Fallback: use the data URL directly
      onAvatarUploaded(imageDataUrl);
      handleClose();
    } catch (err: any) {
      console.error("[AvatarUpload] Error:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  // ── Reset & close ────────────────────────────────────────────────────
  const handleClose = () => {
    stopCamera();
    // Revoke blob URL to free memory
    if (preview && preview.startsWith('blob:')) {
      URL.revokeObjectURL(preview);
    }
    setPreview(null);
    setSelectedFile(null);
    setError(null);
    setIsDragging(false);
    setIsUploading(false);
    setMode("pick");
    onOpenChange(false);
  };

  // ── Render ───────────────────────────────────────────────────────────
  const displayImage = preview || currentAvatarUrl;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-background border-border rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Change Profile Picture</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Upload a photo or take one with your camera.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">

          {/* ── CAMERA MODE ── */}
          {mode === "camera" ? (
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-48 h-48 rounded-full overflow-hidden bg-black border-2 border-border">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  style={{ transform: "scaleX(-1)" }}
                />
                {!cameraReady && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline" size="sm"
                  onClick={() => { stopCamera(); setMode("pick"); }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={capturePhoto}
                  disabled={!cameraReady}
                  className="bg-emerald hover:bg-emerald/90 text-white gap-1.5"
                >
                  <Camera className="w-3.5 h-3.5" />
                  Capture
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* ── PICK MODE ── */}
              <div
                className={cn(
                  "relative w-32 h-32 rounded-full border-2 border-dashed flex items-center justify-center cursor-pointer transition-all overflow-hidden",
                  isDragging
                    ? "border-emerald bg-emerald/10 scale-105"
                    : "border-border hover:border-emerald/50 hover:bg-secondary/50",
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                {displayImage ? (
                  <>
                    <img src={displayImage} alt="Avatar preview" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity rounded-full">
                      <Camera className="w-6 h-6 text-white" />
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                    <ImageIcon className="w-8 h-8 opacity-40" />
                    <span className="text-[10px] font-medium">Drop or click</span>
                  </div>
                )}
              </div>

              {/* Source buttons */}
              <div className="flex gap-2">
                <Button
                  variant="outline" size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-1.5 text-xs"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Choose File
                </Button>
                <Button
                  variant="outline" size="sm"
                  onClick={startCamera}
                  className="gap-1.5 text-xs"
                >
                  <Video className="w-3.5 h-3.5" />
                  Take Photo
                </Button>
              </div>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={handleFileInputChange}
              />

              {/* File info */}
              {selectedFile && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Upload className="w-3 h-3" />
                  <span className="truncate max-w-[200px]">{selectedFile.name}</span>
                  <span>({(selectedFile.size / 1024).toFixed(0)} KB)</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                      setPreview(null);
                    }}
                    className="ml-1 p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </>
          )}

          {/* Error */}
          {error && (
            <p className="text-xs text-destructive text-center max-w-[280px]">{error}</p>
          )}
        </div>

        {/* Actions */}
        {mode === "pick" && (
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={handleClose} disabled={isUploading}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleUpload}
              disabled={!selectedFile || isUploading}
              className="bg-emerald hover:bg-emerald/90 text-white gap-1.5"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  Save
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
