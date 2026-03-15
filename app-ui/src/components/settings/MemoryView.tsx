import { useState, useEffect, useCallback } from 'react';
import { Brain, Trash2, Plus, Edit2, Check, X, User, Activity, BookOpen, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import type { MemoryEntry, MemoryType, UserMemoryMap } from '@/types/electron';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface EditState {
  memoryType: MemoryType;
  key: string;
  value: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_META: Record<MemoryType, { label: string; icon: React.FC<{ className?: string }>; description: string; color: string }> = {
  user: {
    label: 'About You',
    icon: User,
    description: 'Personal facts (role, domain, preferences you\'ve explicitly set)',
    color: 'text-indigo-400',
  },
  behavioral: {
    label: 'Usage Patterns',
    icon: Activity,
    description: 'Automatically inferred from your optimization habits',
    color: 'text-emerald-400',
  },
  context: {
    label: 'Recurring Themes',
    icon: BookOpen,
    description: 'Common topics and subjects detected across your prompts',
    color: 'text-amber-400',
  },
};

function ConfidenceBadge({ confidence, source }: { confidence: number; source: string }) {
  if (source === 'explicit') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo/15 text-indigo-400 font-medium">
        ✏️ You set this
      </span>
    );
  }
  const pct = Math.round(confidence * 100);
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium',
      confidence >= 0.7 ? 'bg-emerald/15 text-emerald-400' : 'bg-amber/15 text-amber-400',
    )}>
      {pct}% confident
    </span>
  );
}

function MemoryRow({
  entry,
  onDelete,
  onEdit,
}: {
  entry: MemoryEntry;
  onDelete: (type: MemoryType, key: string) => void;
  onEdit: (type: MemoryType, key: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.value);

  const handleSave = () => {
    if (draft.trim()) onEdit(entry.memory_type, entry.key, draft.trim());
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(entry.value);
    setEditing(false);
  };

  return (
    <div className="group flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-secondary/40 transition-smooth">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground truncate max-w-[180px]">{entry.key}</span>
          <ConfidenceBadge confidence={entry.confidence} source={entry.source} />
        </div>
        {editing ? (
          <div className="flex items-center gap-2 mt-1">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') handleCancel(); }}
              className="flex-1 text-sm bg-secondary border border-border/50 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <button title="Save" onClick={handleSave} className="text-emerald-400 hover:text-emerald-300 transition-smooth">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button title="Cancel" onClick={handleCancel} className="text-muted-foreground hover:text-foreground transition-smooth">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <p className="text-sm text-foreground/90">{entry.value}</p>
        )}
      </div>
      {!editing && (
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-smooth">
          <button
            title="Edit"
            onClick={() => setEditing(true)}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-smooth"
          >
            <Edit2 className="w-3 h-3" />
          </button>
          <button
            title="Delete"
            onClick={() => onDelete(entry.memory_type, entry.key)}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-smooth"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function MemorySection({
  type,
  entries,
  onDelete,
  onEdit,
  onAdd,
}: {
  type: MemoryType;
  entries: Record<string, MemoryEntry>;
  onDelete: (type: MemoryType, key: string) => void;
  onEdit: (type: MemoryType, key: string, value: string) => void;
  onAdd: (type: MemoryType, key: string, value: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const meta = SECTION_META[type];
  const Icon = meta.icon;
  const list = Object.values(entries);

  const handleAdd = () => {
    if (newKey.trim() && newValue.trim()) {
      onAdd(type, newKey.trim(), newValue.trim());
      setNewKey('');
      setNewValue('');
      setAdding(false);
    }
  };

  return (
    <div className="border border-border/40 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-secondary/20 hover:bg-secondary/40 transition-smooth text-left"
      >
        <Icon className={cn('w-4 h-4', meta.color)} />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold">{meta.label}</span>
          <span className="ml-2 text-xs text-muted-foreground">{list.length} {list.length === 1 ? 'fact' : 'facts'}</span>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-2 py-1">
          {list.length === 0 && !adding && (
            <p className="text-xs text-muted-foreground/60 italic px-3 py-2">{meta.description}</p>
          )}
          {list.map((entry) => (
            <MemoryRow key={`${entry.memory_type}:${entry.key}`} entry={entry} onDelete={onDelete} onEdit={onEdit} />
          ))}

          {/* Add row */}
          {adding ? (
            <div className="flex flex-col gap-2 px-3 py-2">
              <input
                autoFocus
                placeholder="Key (e.g. role)"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="text-sm bg-secondary border border-border/50 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <input
                placeholder="Value (e.g. Senior Software Engineer)"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
                className="text-sm bg-secondary border border-border/50 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <div className="flex gap-2">
                <button onClick={handleAdd} className="flex-1 text-xs py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-smooth">Save</button>
                <button onClick={() => setAdding(false)} className="flex-1 text-xs py-1 rounded bg-secondary hover:bg-secondary/80 transition-smooth">Cancel</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground/70 hover:text-foreground w-full transition-smooth rounded-lg hover:bg-secondary/40"
            >
              <Plus className="w-3 h-3" /> Add fact
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main MemoryView
// ─────────────────────────────────────────────────────────────────────────────

export function MemoryView() {
  const [memory, setMemory] = useState<UserMemoryMap>({ user: {}, behavioral: {}, context: {} });
  const [loading, setLoading] = useState(true);

  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

  const load = useCallback(async () => {
    if (!isElectron) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await window.electronAPI.memory.get();
      setMemory(result);
    } catch {
      toast({ title: 'Failed to load memory', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [isElectron]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = useCallback(async (memoryType: MemoryType, key: string) => {
    if (!isElectron) return;
    const result = await window.electronAPI.memory.delete({ memoryType, key });
    if (result.success) {
      setMemory((prev) => {
        const updated = { ...prev, [memoryType]: { ...prev[memoryType] } };
        delete updated[memoryType][key];
        return updated;
      });
      toast({ title: 'Memory removed' });
    } else {
      toast({ title: 'Failed to remove memory', description: result.error, variant: 'destructive' });
    }
  }, [isElectron]);

  const handleEdit = useCallback(async (memoryType: MemoryType, key: string, value: string) => {
    if (!isElectron) return;
    const result = await window.electronAPI.memory.upsert({ memoryType, key, value, source: 'explicit' });
    if (result.success) {
      setMemory((prev) => ({
        ...prev,
        [memoryType]: {
          ...prev[memoryType],
          [key]: { ...prev[memoryType][key], value, source: 'explicit', confidence: 1.0 },
        },
      }));
    } else {
      toast({ title: 'Failed to update memory', description: result.error, variant: 'destructive' });
    }
  }, [isElectron]);

  const handleAdd = useCallback(async (memoryType: MemoryType, key: string, value: string) => {
    if (!isElectron) return;
    const result = await window.electronAPI.memory.upsert({ memoryType, key, value, source: 'explicit', confidence: 1.0 });
    if (result.success) {
      const now = new Date().toISOString();
      setMemory((prev) => ({
        ...prev,
        [memoryType]: {
          ...prev[memoryType],
          [key]: { key, value, source: 'explicit', confidence: 1.0, memory_type: memoryType, updated_at: now },
        },
      }));
      toast({ title: 'Memory saved' });
    } else {
      toast({ title: 'Failed to save memory', description: result.error, variant: 'destructive' });
    }
  }, [isElectron]);

  const totalFacts = Object.values(memory).reduce((acc, cat) => acc + Object.keys(cat).length, 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Brain className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">App Memory</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            The app learns from your usage to personalize prompt optimization.{' '}
            <span className="text-foreground/70">{totalFacts} {totalFacts === 1 ? 'fact' : 'facts'} stored.</span>
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Loading memory...</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {(['user', 'behavioral', 'context'] as MemoryType[]).map((type) => (
            <MemorySection
              key={type}
              type={type}
              entries={memory[type]}
              onDelete={handleDelete}
              onEdit={handleEdit}
              onAdd={handleAdd}
            />
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
        You have full control. Edit or delete any fact at any time. Inferred facts are learned from your
        optimization history and may update automatically.
      </p>
    </div>
  );
}
