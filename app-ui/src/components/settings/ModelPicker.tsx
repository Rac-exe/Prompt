import { useMemo, useState } from "react";
import { CaretUpDown, Check } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { OpenRouterModel } from "@/types/electron";

interface ModelPickerProps {
  value: string;
  models: OpenRouterModel[];
  onChange: (modelId: string) => void;
  /** Only list models that support tool calling (needed by agentic RAG). */
  requireTools?: boolean;
  disabled?: boolean;
  id?: string;
}

function formatPrice(model: OpenRouterModel): string {
  if (model.promptPricePerMillion == null || model.completionPricePerMillion == null) return "";
  if (model.promptPricePerMillion === 0 && model.completionPricePerMillion === 0) return "free";
  return `$${model.promptPricePerMillion} / $${model.completionPricePerMillion} per M tokens`;
}

/** Searchable picker over OpenRouter's model list. Free text is allowed for ids not in the list. */
export function ModelPicker({ value, models, onChange, requireTools, disabled, id }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const options = useMemo(
    () => (requireTools ? models.filter((m) => m.supportsTools) : models),
    [models, requireTools],
  );
  const selected = models.find((m) => m.id === value);
  const searchIsCustomId = search.includes("/") && !options.some((m) => m.id === search.trim());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full min-w-0 h-9 px-3 flex items-center justify-between gap-2 rounded-md text-sm bg-secondary border border-border hover:border-emerald/40 focus-visible:outline-none focus-visible:border-emerald/50 disabled:opacity-50"
        >
          <span className="truncate text-left">
            {selected ? selected.name : value || "Choose a model"}
            {selected && <span className="ml-2 text-xs text-muted-foreground">{selected.id}</span>}
          </span>
          <CaretUpDown className="w-4 h-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] bg-popover border-border shadow-elevated rounded-xl" align="start">
        <Command>
          <CommandInput placeholder="Search models or type an id like vendor/model…" value={search} onValueChange={setSearch} />
          <CommandList className="max-h-72">
            <CommandEmpty>No matching models.</CommandEmpty>
            {searchIsCustomId && (
              <CommandGroup heading="Custom">
                <CommandItem
                  value={`custom:${search}`}
                  onSelect={() => {
                    onChange(search.trim());
                    setOpen(false);
                  }}
                >
                  Use “{search.trim()}”
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading={requireTools ? "Models with tool calling" : "Models"}>
              {options.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`${m.name} ${m.id}`}
                  onSelect={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                  className="flex items-start gap-2"
                >
                  <Check className={cn("w-4 h-4 mt-0.5 shrink-0", m.id === value ? "opacity-100 text-emerald" : "opacity-0")} />
                  <span className="min-w-0">
                    <span className="block truncate">{m.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {m.id}
                      {formatPrice(m) && ` · ${formatPrice(m)}`}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
