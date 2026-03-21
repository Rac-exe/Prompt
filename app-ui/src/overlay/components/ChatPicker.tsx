import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface ChatInfo {
  id: string;
  title: string;
}

interface ChatPickerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (chatId: string, chatName: string) => void;
  initialChatId: string | null;
}

const ChatPicker: React.FC<ChatPickerProps> = ({ open, onClose, onConfirm, initialChatId }) => {
  const [chats, setChats] = useState<ChatInfo[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load chats when opened
  useEffect(() => {
    if (!open) return;
    setSelectedId(initialChatId);
    setSelectedName('');
    setSearch('');
    setLoading(true);
    setError(false);

    const loader = window.electronAPI?.overlay?.getChats
      ? window.electronAPI.overlay.getChats()
      : Promise.resolve([]);

    loader
      .then((result: ChatInfo[]) => {
        setChats(result || []);
        setLoading(false);
        requestAnimationFrame(() => searchRef.current?.focus());
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [open, initialChatId]);

  // Filtered list
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return chats;
    return chats.filter((c) => c.title.toLowerCase().includes(q));
  }, [chats, search]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const handleSelect = useCallback((chat: ChatInfo) => {
    setSelectedId(chat.id);
    setSelectedName(chat.title);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!selectedId) return;
    onConfirm(selectedId, selectedName);
  }, [selectedId, selectedName, onConfirm]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop open" onClick={handleBackdropClick}>
      <div className="chat-picker-panel">
        {/* Header */}
        <div className="modal-header">
          <span style={{ fontSize: 14, fontWeight: 700, color: 'hsl(var(--foreground))', letterSpacing: '-0.01em' }}>
            Attach Chat Context
          </span>
          <button className="btn-ghost" onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="divider" style={{ margin: '0 14px' }} />

        {/* Search */}
        <div style={{ padding: '10px 14px 4px' }}>
          <input
            ref={searchRef}
            className="chat-picker-search"
            type="text"
            placeholder="Search chats…"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Chat list */}
        <div className="chat-list">
          {loading && (
            <div style={{ padding: 24, textAlign: 'center', color: 'hsl(var(--muted-foreground))', fontSize: 12 }}>Loading...</div>
          )}
          {error && (
            <div style={{ padding: 24, textAlign: 'center', color: 'hsl(0 72% 51%)', fontSize: 12 }}>Failed to load chats</div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'hsl(var(--muted-foreground))', fontSize: 12 }}>No chats found.</div>
          )}
          {!loading && !error && filtered.map((chat) => (
            <button
              key={chat.id}
              className={`chat-list-item${chat.id === selectedId ? ' selected' : ''}`}
              onClick={() => handleSelect(chat)}
            >
              <svg style={{ width: 13, height: 13, flexShrink: 0, color: 'hsl(var(--muted-foreground))' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chat.title}</span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="divider" style={{ margin: '0 14px' }} />
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}
            style={{ flex: 1, height: 36, borderRadius: 10, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!selectedId} onClick={handleConfirm}
            style={{ flex: 1, height: 36, borderRadius: 10, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Attach
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPicker;
