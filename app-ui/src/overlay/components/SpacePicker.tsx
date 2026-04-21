import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Shape mirrors the projection published by ProjectsView via the spaces
// bridge. Kept as a local copy (instead of importing from the components/
// projects path) so the overlay bundle does not pull in the whole Spaces
// UI tree just to render this picker.
interface SpaceInfo {
  id: string;
  name: string;
  projects: Array<{ projectId: string; name: string; localPath: string; branch?: string }>;
  lastUsedAt: number;
}

interface SpacePickerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (spaceId: string, spaceName: string) => void;
  initialSpaceId: string | null;
}

const SpacePicker: React.FC<SpacePickerProps> = ({ open, onClose, onConfirm, initialSpaceId }) => {
  const [spaces, setSpaces] = useState<SpaceInfo[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedId(initialSpaceId);
    setSelectedName('');
    setSearch('');
    setLoading(true);
    setError(false);

    const loader = window.electronAPI?.spaces?.list
      ? window.electronAPI.spaces.list()
      : Promise.resolve([] as SpaceInfo[]);

    loader
      .then((result) => {
        // Sort by lastUsedAt desc so the most recently active space is at
        // the top — matches the SpacesList card ordering in the main app.
        const sorted = (result || []).slice().sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
        setSpaces(sorted);
        setLoading(false);
        requestAnimationFrame(() => searchRef.current?.focus());
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [open, initialSpaceId]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return spaces;
    return spaces.filter((s) => {
      if (s.name.toLowerCase().includes(q)) return true;
      return s.projects.some((p) => p.name.toLowerCase().includes(q) || p.localPath.toLowerCase().includes(q));
    });
  }, [spaces, search]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const handleSelect = useCallback((space: SpaceInfo) => {
    setSelectedId(space.id);
    setSelectedName(space.name);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!selectedId) return;
    const target = spaces.find((s) => s.id === selectedId);
    onConfirm(selectedId, target?.name || selectedName);
  }, [selectedId, selectedName, onConfirm, spaces]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop open" onClick={handleBackdropClick}>
      <div className="chat-picker-panel">
        <div className="modal-header">
          <span style={{ fontSize: 14, fontWeight: 700, color: 'hsl(var(--foreground))', letterSpacing: '-0.01em' }}>
            Attach Space
          </span>
          <button className="btn-ghost" onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="divider" style={{ margin: '0 14px' }} />

        <div style={{ padding: '10px 14px 4px' }}>
          <input
            ref={searchRef}
            className="chat-picker-search"
            type="text"
            placeholder="Search spaces…"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="chat-list">
          {loading && (
            <div style={{ padding: 24, textAlign: 'center', color: 'hsl(var(--muted-foreground))', fontSize: 12 }}>Loading...</div>
          )}
          {error && (
            <div style={{ padding: 24, textAlign: 'center', color: 'hsl(0 72% 51%)', fontSize: 12 }}>Failed to load spaces</div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'hsl(var(--muted-foreground))', fontSize: 12 }}>
              {spaces.length === 0
                ? 'No spaces yet. Create one in the main app to attach it here.'
                : 'No spaces match your search.'}
            </div>
          )}
          {!loading && !error && filtered.map((space) => {
            const project = space.projects[0];
            return (
              <button
                key={space.id}
                className={`chat-list-item${space.id === selectedId ? ' selected' : ''}`}
                onClick={() => handleSelect(space)}
                style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 2 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <svg style={{ width: 13, height: 13, flexShrink: 0, color: 'hsl(var(--muted-foreground))' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                  </svg>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{space.name}</span>
                </div>
                {project ? (
                  <span style={{ fontSize: 11, color: 'hsl(var(--muted-foreground) / 0.7)', paddingLeft: 21, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                    {project.name}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: 'hsl(var(--muted-foreground) / 0.5)', paddingLeft: 21, fontStyle: 'italic' }}>
                    No folder attached
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="divider" style={{ margin: '0 14px' }} />
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}
            style={{ flex: 1, height: 36, borderRadius: 10, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!selectedId} onClick={handleConfirm}
            style={{ flex: 1, height: 36, borderRadius: 10, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
            Attach
          </button>
        </div>
      </div>
    </div>
  );
};

export default SpacePicker;
