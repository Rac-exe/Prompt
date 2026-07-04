// ── File attachment constraints ──────────────────────────────────────────────
export const MAX_ATTACHED_FILES = 5;
export const MAX_FILE_SIZE = 10_000_000;   // 10 MB — matches main process and Python parser validation
export const MAX_IMAGE_SIZE = 4_500_000;   // 4.5 MB — images above this are auto-resized
export const MAX_IMAGE_DIMENSION = 1920;   // max px on longest side after resize
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
];

// ── SVG icon paths keyed by skill name — exact Lucide v0.462.0 paths ─────────
export const SKILL_ICON_SVGS: Record<string, string> = {
  automation:
    '<path d="M20 7h-9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M14 17H5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="17" cy="17" r="3" stroke-width="2"/>' +
    '<circle cx="7" cy="7" r="3" stroke-width="2"/>',
  business:
    '<rect x="2" y="7" width="20" height="14" rx="2" ry="2" stroke-width="2"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/>',
  communication:
    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
  creative:
    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/><circle cx="6.5" cy="11.5" r="1" stroke-width="2"/><circle cx="9.5" cy="7.5" r="1" stroke-width="2"/><circle cx="14.5" cy="7.5" r="1" stroke-width="2"/><circle cx="17.5" cy="11.5" r="1" stroke-width="2"/>',
  educational:
    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"/>',
  research:
    '<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M8.5 2h7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M7 16h10" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  technical:
    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>',
  visual:
    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>',
};

export const DEFAULT_SKILL_ICON =
  '<path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2-6-4.8-6 4.8 2.4-7.2-6-4.8h7.6z"/>';
