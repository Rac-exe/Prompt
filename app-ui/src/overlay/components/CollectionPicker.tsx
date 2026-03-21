import React, { useCallback, useEffect, useRef, useState } from 'react';

interface CollectionInfo {
  id: string;
  name: string;
  icon?: string;
}

interface CollectionPickerProps {
  open: boolean;
  promptContent: string;
  onClose: () => void;
  onSaved: () => void;
}

const CollectionPicker: React.FC<CollectionPickerProps> = ({ open, promptContent, onClose, onSaved }) => {
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [newCollectionName, setNewCollectionName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Load collections when opened
  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setTitle('');
    setNewCollectionName('');
    setLoading(true);
    setSaving(false);

    const loader = window.electronAPI?.overlay?.getCollections
      ? window.electronAPI.overlay.getCollections()
      : Promise.resolve([]);

    loader
      .then((result: CollectionInfo[]) => {
        setCollections(result || []);
        setLoading(false);
        requestAnimationFrame(() => titleInputRef.current?.focus());
      })
      .catch(() => {
        setCollections([]);
        setLoading(false);
      });
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  // Create new collection
  const handleCreateCollection = useCallback(async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    try {
      const result = await window.electronAPI?.overlay?.createCollection?.(name);
      if (result?.id) {
        setCollections((prev) => [...prev, { id: result.id, name }]);
        setSelectedId(result.id);
        setNewCollectionName('');
      }
    } catch (err) {
      console.error('[Overlay] Failed to create collection:', err);
    }
  }, [newCollectionName]);

  // Save prompt to collection
  const handleSave = useCallback(async () => {
    if (!selectedId || !title.trim()) return;
    setSaving(true);
    try {
      await window.electronAPI?.overlay?.save?.({
        title: title.trim(),
        content: promptContent,
        collectionId: selectedId,
      });
      onSaved();
      onClose();
    } catch (err) {
      console.error('[Overlay] Failed to save to collection:', err);
    } finally {
      setSaving(false);
    }
  }, [selectedId, title, promptContent, onSaved, onClose]);

  const canSave = !!selectedId && !!title.trim() && !saving;

  if (!open) return null;

  return (
    <div className="modal-backdrop open" onClick={handleBackdropClick}>
      <div className="modal-panel">
        {/* Header */}
        <div className="modal-header">
          <span style={{ fontSize: 14, fontWeight: 700, color: 'hsl(var(--foreground))', letterSpacing: '-0.01em' }}>
            Save to Collection
          </span>
          <button className="btn-ghost" onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="divider" style={{ margin: '0 14px' }} />

        {/* Title input */}
        <div style={{ padding: '12px 14px 4px' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'hsl(var(--muted-foreground))', letterSpacing: '0.04em', textTransform: 'uppercase' as const, display: 'block', marginBottom: 6 }}>
            Title
          </label>
          <input
            ref={titleInputRef}
            className="new-collection-input"
            type="text"
            placeholder="Give your prompt a title..."
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ width: '100%', height: 38 }}
          />
        </div>

        {/* Collection list */}
        <div style={{ padding: '4px 14px 0' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'hsl(var(--muted-foreground))', letterSpacing: '0.04em', textTransform: 'uppercase' as const, display: 'block', marginBottom: 6 }}>
            Collection
          </label>
        </div>
        <div className="collection-list">
          {loading && (
            <div style={{ padding: 24, textAlign: 'center', color: 'hsl(var(--muted-foreground))', fontSize: 12 }}>
              Loading collections...
            </div>
          )}
          {!loading && collections.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'hsl(var(--muted-foreground))', fontSize: 12 }}>
              No collections yet. Create one below.
            </div>
          )}
          {!loading && collections.map((col) => (
            <button
              key={col.id}
              className={`collection-item${col.id === selectedId ? ' selected' : ''}`}
              onClick={() => setSelectedId(col.id)}
            >
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'hsl(var(--muted)/0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14 }}>
                {col.icon || '📁'}
              </div>
              <span className="collection-name">{col.name}</span>
              {col.id === selectedId && (
                <svg style={{ width: 14, height: 14, color: 'hsl(var(--emerald))', flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>

        {/* New collection row */}
        <div className="divider" style={{ margin: '2px 14px 0' }} />
        <div className="new-collection-row">
          <input
            className="new-collection-input"
            type="text"
            placeholder="New collection name..."
            maxLength={50}
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCollection(); }}
          />
          <button className="btn-add-collection" disabled={!newCollectionName.trim()} onClick={handleCreateCollection}>
            Create
          </button>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}
            style={{ flex: 1, height: 38, borderRadius: 10, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!canSave} onClick={handleSave}
            style={{ flex: 1, height: 38, borderRadius: 10, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            <span>{saving ? 'Saving...' : 'Save to Collection'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CollectionPicker;
