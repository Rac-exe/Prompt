import { useEffect, useState } from "react";
import { ArrowSquareOut, Eye, EyeSlash } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { ModelPicker } from "./ModelPicker";
import type { AISettingsView, OpenRouterModel } from "@/types/electron";

const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";
const DEEPGRAM_URL = "https://console.deepgram.com/";

interface AIProviderFormProps {
  /** "onboarding" hides optional extras and names the button "Continue". */
  variant: "onboarding" | "settings";
  onSaved?: (settings: AISettingsView) => void;
}

function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        className="h-9 pr-9 text-sm font-mono bg-secondary border-border focus-visible:border-emerald/50 focus-visible:ring-emerald/15"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
        aria-label={visible ? "Hide key" : "Show key"}
      >
        {visible ? <EyeSlash className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => window.electronAPI?.openExternal(href)}
      className="inline-flex items-center gap-1 text-emerald hover:underline"
    >
      {children}
      <ArrowSquareOut className="w-3 h-3" />
    </button>
  );
}

/**
 * OpenRouter API key + model choices for prompt optimization and the
 * code-intelligence (RAG) pipeline. Keys are validated and stored by the
 * main process; this form only ever sees the last 4 characters.
 */
export function AIProviderForm({ variant, onSaved }: AIProviderFormProps) {
  const api = window.electronAPI?.aiSettings;
  const [current, setCurrent] = useState<AISettingsView | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [deepgramKey, setDeepgramKey] = useState("");
  const [optimizerModel, setOptimizerModel] = useState("");
  const [ragModel, setRagModel] = useState("");
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    api.get().then((view) => {
      setCurrent(view);
      setOptimizerModel(view.optimizerModel);
      setRagModel(view.ragModel);
    });
    api.listModels().then((res) => {
      setModels(res.models);
      setModelsError(res.error ?? null);
    });
  }, [api]);

  const needsKey = !current?.hasApiKey;
  const canSave = !saving && (needsKey ? apiKey.trim().length > 0 : true) && !!optimizerModel && !!ragModel;

  const handleSave = async () => {
    if (!api) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.save({
        ...(apiKey.trim() ? { openrouterApiKey: apiKey.trim() } : {}),
        ...(deepgramKey.trim() ? { deepgramApiKey: deepgramKey.trim() } : {}),
        optimizerModel,
        ragModel,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not save settings");
        return;
      }
      setCurrent(res.settings);
      setApiKey("");
      setDeepgramKey("");
      if (variant === "settings") toast({ title: "AI provider saved" });
      onSaved?.(res.settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveDeepgram = async () => {
    if (!api) return;
    const res = await api.save({ deepgramApiKey: null });
    if (res.ok) {
      setCurrent(res.settings);
      toast({ title: "Deepgram key removed" });
    }
  };

  if (!api) {
    return <p className="text-sm text-destructive">This window is not running inside the Prmpt desktop app.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="openrouter-key" className="text-sm font-medium">OpenRouter API key</Label>
        <SecretInput
          id="openrouter-key"
          value={apiKey}
          onChange={(v) => {
            setApiKey(v);
            setError(null);
          }}
          placeholder={current?.hasApiKey ? `Saved key ${current.apiKeyPreview} — paste a new one to replace it` : "sk-or-v1-…"}
          disabled={saving}
        />
        <p className="text-xs text-muted-foreground">
          Prmpt sends requests straight from your computer to OpenRouter with this key. Get one at{" "}
          <ExternalLink href={OPENROUTER_KEYS_URL}>openrouter.ai/keys</ExternalLink>.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="optimizer-model" className="text-sm font-medium">Prompt optimization model</Label>
        <ModelPicker id="optimizer-model" value={optimizerModel} models={models} onChange={setOptimizerModel} disabled={saving} />
        <p className="text-xs text-muted-foreground">Rewrites your prompts in chat and in the @prompt overlay.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="rag-model" className="text-sm font-medium">Code intelligence (RAG) model</Label>
        <ModelPicker id="rag-model" value={ragModel} models={models} onChange={setRagModel} requireTools disabled={saving} />
        <p className="text-xs text-muted-foreground">
          Answers questions about your Spaces and drives agentic code search, so it needs tool calling.
          Indexing summaries use a small, cheap model.
        </p>
      </div>

      {modelsError && <p className="text-xs text-amber-500">{modelsError}. You can still type a model id.</p>}

      {variant === "settings" && (
        <div className="space-y-2">
          <Label htmlFor="deepgram-key" className="text-sm font-medium">
            Deepgram API key <span className="font-normal text-muted-foreground">(optional, for voice input)</span>
          </Label>
          <SecretInput
            id="deepgram-key"
            value={deepgramKey}
            onChange={setDeepgramKey}
            placeholder={current?.hasDeepgramKey ? `Saved key ${current.deepgramKeyPreview} — paste a new one to replace it` : "Leave empty to keep voice input off"}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            Voice input streams audio to Deepgram for transcription. Get a key at{" "}
            <ExternalLink href={DEEPGRAM_URL}>console.deepgram.com</ExternalLink>
            {current?.hasDeepgramKey && (
              <>
                {" · "}
                <button type="button" onClick={handleRemoveDeepgram} className="text-muted-foreground hover:text-foreground underline">
                  remove saved key
                </button>
              </>
            )}
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={!canSave}
        className="h-9 px-4 rounded-xl text-sm font-medium bg-emerald text-white hover:bg-emerald/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? "Checking key…" : variant === "onboarding" ? "Save and continue" : "Save"}
      </button>
    </div>
  );
}
