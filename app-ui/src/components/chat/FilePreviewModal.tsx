import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  X, Download, FileText, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  ExternalLink, AlertCircle, Image as ImageIcon, File as FileIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PreviewFile {
  name: string;
  mimeType: string;
  /** base64-encoded content — NO data-URL prefix. Present for in-session files. */
  base64?: string;
  /** Cloudinary secure_url for images persisted to external storage. */
  cloudinaryUrl?: string;
  sizeBytes?: number;
}

interface FilePreviewModalProps {
  file: PreviewFile | null;
  onClose: () => void;
  allFiles?: PreviewFile[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatSize(bytes?: number) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function fileTypeLabel(mimeType: string): string {
  if (mimeType === "application/pdf") return "PDF";
  const sub = mimeType.split("/")[1]?.toUpperCase();
  return sub || "FILE";
}

function base64ToUint8(base64: string): Uint8Array {
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/** Convert base64 to Blob ObjectURL (cheaper than data-URI for rendering) */
function base64ToBlobUrl(base64: string, mimeType: string): string {
  const bin = atob(base64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  const blob = new Blob([buf], { type: mimeType });
  return URL.createObjectURL(blob);
}

/** Trigger a download for any file */
function downloadFile(base64: string, mimeType: string, name: string) {
  try {
    const url = base64ToBlobUrl(base64, mimeType);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  } catch { /* ignore */ }
}

/** Open the file in a new browser tab via blob URL */
function openInNewTab(base64: string, mimeType: string) {
  try {
    const url = base64ToBlobUrl(base64, mimeType);
    window.open(url, "_blank");
    // Don't revoke — the new tab needs it
  } catch { /* ignore */ }
}

/** Debounce a number-setting callback */
function useDebouncedSetter(delay: number) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  return useCallback(
    (fn: () => void) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(fn, delay);
    },
    [delay],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF viewer — uses Chromium's native PDF plugin via <embed> + blob URL.
// Requires `plugins: true` in Electron's BrowserWindow webPreferences.
// ─────────────────────────────────────────────────────────────────────────────

interface PdfViewerProps {
  base64: string;
  fileName: string;
}

const PdfViewer = ({ base64, fileName }: PdfViewerProps) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    try {
      const url = base64ToBlobUrl(base64, "application/pdf");
      setBlobUrl(url);
      setError(false);
      return () => URL.revokeObjectURL(url);
    } catch {
      setError(true);
    }
  }, [base64]);

  if (error || !blobUrl) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
          <AlertCircle className="w-7 h-7 text-red-400" />
        </div>
        <div>
          <p className="text-white font-medium mb-1">{fileName}</p>
          <p className="text-white/40 text-sm">Could not preview this PDF.</p>
        </div>
        <button
          onClick={() => downloadFile(base64, "application/pdf", fileName)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/8 border border-white/12 text-white text-sm hover:bg-white/12 transition-colors"
        >
          <Download className="w-4 h-4" /> Download to view
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 w-full bg-[#525659]">
      <embed
        src={blobUrl}
        type="application/pdf"
        className="w-full h-full"
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Image viewer with loading state, blob URL, double-click zoom
// ─────────────────────────────────────────────────────────────────────────────

interface ImageViewerProps {
  base64?: string;
  cloudinaryUrl?: string;
  mimeType: string;
  name: string;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  offset: { x: number; y: number };
  setOffset: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
}

const ImageViewer = ({ base64, cloudinaryUrl, mimeType, name, zoom, setZoom, offset, setOffset }: ImageViewerProps) => {
  const [loaded, setLoaded] = useState(false);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const debounce = useDebouncedSetter(30);

  // If Cloudinary URL is available, use it directly — no blob URL needed
  const blobUrl = useMemo(
    () => (base64 && !cloudinaryUrl ? base64ToBlobUrl(base64, mimeType) : null),
    [base64, cloudinaryUrl, mimeType]
  );
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  const imgSrc = cloudinaryUrl ?? blobUrl ?? '';

  // Reset loaded state when src changes
  useEffect(() => { setLoaded(false); }, [imgSrc]);

  // Double-click toggles between 1x and 2x
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (zoom >= 1.5) {
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    } else {
      setZoom(2);
    }
  };

  return (
    <div
      className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[#111]"
      onWheel={e => {
        e.preventDefault();
        debounce(() => setZoom(z => Math.max(0.25, Math.min(4, z - e.deltaY * 0.002))));
      }}
      onMouseMove={e => {
        if (!isDragging.current) return;
        setOffset({
          x: dragStart.current.ox + (e.clientX - dragStart.current.x),
          y: dragStart.current.oy + (e.clientY - dragStart.current.y),
        });
      }}
      onMouseUp={() => { isDragging.current = false; }}
      onMouseLeave={() => { isDragging.current = false; }}
    >
      {/* Loading spinner — shown until image fires onLoad */}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      )}

      <img
        src={imgSrc}
        alt={name}
        draggable={false}
        onLoad={() => setLoaded(true)}
        onDoubleClick={handleDoubleClick}
        onMouseDown={e => {
          if (zoom <= 1) return;
          e.preventDefault();
          isDragging.current = true;
          dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
        }}
        className={cn("transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")}
        style={{
          transform: `scale(${zoom}) translate(${offset.x / zoom}px, ${offset.y / zoom}px)`,
          transition: isDragging.current ? "opacity 0.2s" : "transform 0.15s ease, opacity 0.2s",
          cursor: zoom > 1 ? (isDragging.current ? "grabbing" : "grab") : "default",
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          userSelect: "none",
        }}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Unsupported file fallback
// ─────────────────────────────────────────────────────────────────────────────

const UnsupportedViewer = ({ file }: { file: PreviewFile }) => (
  <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center">
    <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
      <FileIcon className="w-7 h-7 text-white/40" />
    </div>
    <div>
      <p className="text-white font-medium mb-1">{file.name}</p>
      <p className="text-white/40 text-sm">Preview not available for this file type.</p>
      <p className="text-white/25 text-xs mt-1">{file.mimeType}</p>
    </div>
    <button
      onClick={() => file.base64 && downloadFile(file.base64, file.mimeType, file.name)}
      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/8 border border-white/12 text-white text-sm hover:bg-white/12 transition-colors"
    >
      <Download className="w-4 h-4" /> Download
    </button>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main Modal
// ─────────────────────────────────────────────────────────────────────────────

export const FilePreviewModal = ({ file, onClose, allFiles }: FilePreviewModalProps) => {
  const [active, setActive] = useState<PreviewFile | null>(file);
  const [transitioning, setTransitioning] = useState(false);
  useEffect(() => { setActive(file); }, [file]);

  // Image zoom / pan (owned here so header can show %)
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  // Reset on file switch
  useEffect(() => { setZoom(1); setOffset({ x: 0, y: 0 }); }, [active]);

  // Navigation
  const siblings = allFiles ?? (file ? [file] : []);
  const currentIdx = active
    ? siblings.findIndex(f => f.name === active.name && f.mimeType === active.mimeType)
    : -1;
  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx >= 0 && currentIdx < siblings.length - 1;

  const switchFile = useCallback((next: PreviewFile) => {
    setTransitioning(true);
    setTimeout(() => {
      setActive(next);
      setTransitioning(false);
    }, 100);
  }, []);
  const goPrev = useCallback(() => { if (hasPrev) switchFile(siblings[currentIdx - 1]); }, [hasPrev, siblings, currentIdx, switchFile]);
  const goNext = useCallback(() => { if (hasNext) switchFile(siblings[currentIdx + 1]); }, [hasNext, siblings, currentIdx, switchFile]);

  // Keyboard
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowLeft" && siblings.length > 1) goPrev();
      if (e.key === "ArrowRight" && siblings.length > 1) goNext();
      // Image zoom via keyboard
      if (isImage && (e.key === "+" || e.key === "=")) { e.preventDefault(); setZoom(z => Math.min(4, z + 0.25)); }
      if (isImage && e.key === "-") { e.preventDefault(); setZoom(z => Math.max(0.25, z - 0.25)); }
      if (isImage && e.key === "0") { setZoom(1); setOffset({ x: 0, y: 0 }); }
    };
    const isImage = active.mimeType.startsWith("image/");
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active, goPrev, goNext, onClose, siblings.length, setZoom, setOffset]);

  if (!active) return null;

  const isImage = active.mimeType.startsWith("image/");
  const isPdf = active.mimeType === "application/pdf";
  const isSupported = isImage || isPdf;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-[#0a0a0a] animate-in fade-in-0 duration-150">

      {/* ════════════════════════════════════════════
          TOP BAR
      ════════════════════════════════════════════ */}
      <div className="flex items-center justify-between px-4 h-14 border-b border-white/8 flex-shrink-0 select-none">

        {/* ── Left: file icon + name + type badge + size ── */}
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            "w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center",
            isPdf ? "bg-red-500/15 border border-red-500/20"
              : isImage ? "border border-white/10 overflow-hidden"
              : "bg-white/5 border border-white/10"
          )}>
            {isPdf && <FileText className="w-4 h-4 text-red-400" />}
            {isImage && <ImageIcon className="w-4 h-4 text-white/50" />}
            {!isPdf && !isImage && <FileIcon className="w-4 h-4 text-white/40" />}
          </div>
          <div className="min-w-0 flex items-center gap-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate max-w-[260px]">{active.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/8 text-white/45">{fileTypeLabel(active.mimeType)}</span>
                {active.sizeBytes != null && (
                  <span className="text-[11px] text-white/30">{formatSize(active.sizeBytes)}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Center: navigation ── */}
        {siblings.length > 1 && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={goPrev} disabled={!hasPrev}
              className="w-7 h-7 rounded-md flex items-center justify-center text-white/50 hover:text-white hover:bg-white/8 disabled:opacity-20 disabled:pointer-events-none transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-white/40 tabular-nums">{currentIdx + 1} / {siblings.length}</span>
            <button onClick={goNext} disabled={!hasNext}
              className="w-7 h-7 rounded-md flex items-center justify-center text-white/50 hover:text-white hover:bg-white/8 disabled:opacity-20 disabled:pointer-events-none transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Right: controls ── */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Image zoom bar */}
          {isImage && (
            <div className="flex items-center gap-0.5 mr-1.5 border border-white/10 rounded-lg overflow-hidden">
              <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} title="Zoom out (-)"
                className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/8 transition-colors">
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }} title="Fit to screen (0)"
                className="px-2 h-7 text-[11px] font-medium text-white/50 hover:text-white hover:bg-white/8 min-w-[44px] text-center tabular-nums transition-colors">
                {Math.round(zoom * 100)}%
              </button>
              <button onClick={() => setZoom(z => Math.min(4, z + 0.25))} title="Zoom in (+)"
                className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/8 transition-colors">
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Open in new tab */}
          <button
            onClick={() => {
              if (active.cloudinaryUrl) { window.open(active.cloudinaryUrl, '_blank'); }
              else if (active.base64) { openInNewTab(active.base64, active.mimeType); }
            }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/8 transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>

          {/* Download */}
          <button onClick={() => active.base64 && downloadFile(active.base64, active.mimeType, active.name)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/8 transition-colors" title="Download">
            <Download className="w-4 h-4" />
          </button>

          {/* Close */}
          <button onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/8 transition-colors" title="Close (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ════════════════════════════════════════════
          CONTENT AREA — with fade transition wrapper
      ════════════════════════════════════════════ */}
      <div className={cn(
        "flex-1 flex min-h-0 relative transition-opacity duration-100",
        transitioning ? "opacity-0" : "opacity-100",
      )}>
        {isImage && (
          <ImageViewer
            key={active.name}
            base64={active.base64}
            cloudinaryUrl={active.cloudinaryUrl}
            mimeType={active.mimeType}
            name={active.name}
            zoom={zoom}
            setZoom={setZoom}
            offset={offset}
            setOffset={setOffset}
          />
        )}

        {isPdf && active.base64 && (
          <PdfViewer
            key={active.name + active.base64.slice(0, 16)}
            base64={active.base64}
            fileName={active.name}
          />
        )}

        {!isSupported && <UnsupportedViewer file={active} />}

        {/* Side arrows */}
        {siblings.length > 1 && hasPrev && (
          <button onClick={goPrev}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/60 border border-white/10 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-white hover:bg-black/80 transition-all">
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        {siblings.length > 1 && hasNext && (
          <button onClick={goNext}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/60 border border-white/10 backdrop-blur-sm flex items-center justify-center text-white/70 hover:text-white hover:bg-black/80 transition-all">
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* ════════════════════════════════════════════
          THUMBNAIL STRIP (multi-file)
      ════════════════════════════════════════════ */}
      {siblings.length > 1 && (
        <div className="flex items-center justify-center gap-2 h-16 border-t border-white/8 px-4 flex-shrink-0 select-none">
          {siblings.map((f, i) => {
            const isAct = i === currentIdx;
            const isImg = f.mimeType.startsWith("image/");
            const isPdfThumb = f.mimeType === "application/pdf";
            return (
              <button
                key={i}
                onClick={() => switchFile(f)}
                title={f.name}
                className={cn(
                  "w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 border-2 transition-all flex items-center justify-center",
                  isAct ? "border-white/70 scale-110" : "border-white/15 opacity-50 hover:opacity-80 hover:border-white/35",
                )}
              >
                {isImg && (f.cloudinaryUrl || f.base64) && (
                  <img
                    src={f.cloudinaryUrl ?? `data:${f.mimeType};base64,${f.base64}`}
                    alt={f.name}
                    className="w-full h-full object-cover"
                  />
                )}
                {isPdfThumb && (
                  <div className="w-full h-full bg-red-500/10 flex items-center justify-center">
                    <FileText className="w-4 h-4 text-red-400/80" />
                  </div>
                )}
                {!isImg && !isPdfThumb && (
                  <div className="w-full h-full bg-white/5 flex items-center justify-center">
                    <FileIcon className="w-4 h-4 text-white/30" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
