import { useState, useEffect, useCallback } from 'react';
import { Brain, Trash, Plus, PencilSimple, Check, X, User, Pulse, BookOpen, CaretDown, CaretRight, CircleNotch, Eye } from '@phosphor-icons/react';
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

const SECTION_META: Record<MemoryType, { label: string; icon: React.ComponentType<{ className?: string; size?: number; weight?: string }>; description: string; color: string }> = {
  user: {
    label: 'About You',
    icon: User,
    description: 'Personal facts (role, domain, preferences you\'ve explicitly set)',
    color: 'text-indigo-400',
  },
  behavioral: {
    label: 'Usage Patterns',
    icon: Pulse,
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

function ConfidenceBadge({ confidence, source, observationCount }: { confidence: number; source: string; observationCount?: number }) {
  if (source === 'explicit') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo/15 text-indigo-400 font-medium">
        You set this
      </span>
    );
  }
  const pct = Math.round(confidence * 100);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn(
        'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium',
        confidence >= 0.7 ? 'bg-emerald/15 text-emerald-400' : 'bg-amber/15 text-amber-400',
      )}>
        {pct}% confident
      </span>
      {observationCount && observationCount > 1 && (
        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-medium" title={`Observed ${observationCount} times`}>
          <Eye size={10} weight="light" />
          {observationCount}
        </span>
      )}
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
          <ConfidenceBadge confidence={entry.confidence} source={entry.source} observationCount={entry.observation_count} />
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
              <Check size={14} weight="light" />
            </button>
            <button title="Cancel" onClick={handleCancel} className="text-muted-foreground hover:text-foreground transition-smooth">
              <X size={14} weight="light" />
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
            <PencilSimple size={12} weight="light" />
          </button>
          <button
            title="Delete"
            onClick={() => onDelete(entry.memory_type, entry.key)}
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-smooth"
          >
            <Trash size={12} weight="light" />
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
        <Icon size={16} weight="light" className={meta.color} />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold">{meta.label}</span>
          <span className="ml-2 text-xs text-muted-foreground">{list.length} {list.length === 1 ? 'fact' : 'facts'}</span>
        </div>
        {expanded ? <CaretDown size={16} weight="light" className="text-muted-foreground" /> : <CaretRight size={16} weight="light" className="text-muted-foreground" />}
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
              <Plus size={12} weight="light" /> Add fact
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Toggle Switch Component
// ─────────────────────────────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (val: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        checked ? 'bg-primary' : 'bg-secondary',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200 shadow-sm',
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main MemoryView
// ─────────────────────────────────────────────────────────────────────────────

export function MemoryView() {
  const [memory, setMemory] = useState<UserMemoryMap>({ user: {}, behavioral: {}, context: {} });
  const [loading, setLoading] = useState(true);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [togglingMemory, setTogglingMemory] = useState(false);

  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

  const load = useCallback(async () => {
    if (!isElectron) { setLoading(false); return; }
    setLoading(true);
    try {
      const [result, enabled] = await Promise.all([
        window.electronAPI.memory.get(),
        window.electronAPI.memory.getEnabled(),
      ]);
      setMemory(result);
      setMemoryEnabled(enabled);
    } catch {
      toast({ title: 'Failed to load memory', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [isElectron]);

  useEffect(() => { load(); }, [load]);

  // Listen for live memory updates from the analyzer
  useEffect(() => {
    if (!isElectron || !window.electronAPI.memory.onUpdated) return;
    const cleanup = window.electronAPI.memory.onUpdated((updatedMemory: UserMemoryMap) => {
      setMemory(updatedMemory);
    });
    return cleanup;
  }, [isElectron]);

  const handleToggleMemory = useCallback(async (enabled: boolean) => {
    if (!isElectron) return;
    setTogglingMemory(true);
    try {
      const result = await window.electronAPI.memory.setEnabled(enabled);
      if (result.success) {
        setMemoryEnabled(enabled);
        toast({
          title: enabled ? 'Memory learning enabled' : 'Memory learning paused',
          description: enabled
            ? 'The app will learn from your usage to personalize optimization.'
            : 'Automatic learning paused. You can still add facts manually.',
        });
      } else {
        toast({ title: 'Failed to update setting', description: result.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Failed to update setting', variant: 'destructive' });
    } finally {
      setTogglingMemory(false);
    }
  }, [isElectron]);

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
          [key]: { key, value, source: 'explicit', confidence: 1.0, memory_type: memoryType, updated_at: now, observation_count: 1 },
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
          <Brain size={20} weight="light" className="text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">App Memory</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            The app learns from your usage to personalize prompt optimization.{' '}
            <span className="text-foreground/70">{totalFacts} {totalFacts === 1 ? 'fact' : 'facts'} stored.</span>
          </p>
        </div>
      </div>

      {/* Memory Toggle */}
      <div className="flex items-center justify-between px-4 py-3 border border-border/40 rounded-xl bg-secondary/10">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Learn from my usage</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {memoryEnabled
              ? 'The app automatically learns facts from your prompts to improve optimization.'
              : 'Automatic learning is paused. You can still add facts manually.'}
          </p>
        </div>
        <ToggleSwitch
          checked={memoryEnabled}
          onChange={handleToggleMemory}
          disabled={togglingMemory}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <CircleNotch size={20} weight="light" className="animate-spin mr-2" />
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
        You have full control. Edit or delete any fact at any time. Facts you set manually always take priority
        over inferred ones. Inferred facts update automatically when learning is enabled.
      </p>
    </div>
  );
}
