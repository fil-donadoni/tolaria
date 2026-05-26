import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { ChevronDownIcon, X } from "lucide-react";
import { api } from "@convex/_generated/api";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "~/lib/utils";

interface SubtypeComboboxProps {
    selected: string[];
    onToggle: (tag: string) => void;
}

export default function SubtypeCombobox({
    selected,
    onToggle,
}: SubtypeComboboxProps) {
    const all = useQuery(api.cardIndex.list, {});
    const [open, setOpen] = useState(false);

    const options = useMemo(() => {
        if (!all) return [] as string[];
        const set = new Set<string>();
        for (const row of all) {
            for (const s of row.subtypes) set.add(s);
            for (const s of row.supertypes) set.add(s);
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [all]);

    return (
        <div className="flex items-center gap-1">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger
                    aria-expanded={open}
                    className={cn(
                        "flex h-8 min-w-50 items-center justify-between gap-2 rounded-sm border border-border-subtle/40 bg-surface-elevated/20 px-2.5 text-[11px] capitalize tracking-wide text-text-muted transition hover:bg-surface-elevated/30 hover:text-parchment"
                    )}
                >
                    <span>
                        {selected.length === 0
                            ? "Subtype / supertype"
                            : `${selected.length} selected`}
                    </span>
                    <ChevronDownIcon className="size-3.5 opacity-60" />
                </PopoverTrigger>
                <PopoverContent
                    className="w-[240px] border-border-subtle/40 bg-surface p-0"
                    align="start"
                    side="bottom"
                    sideOffset={4}
                >
                    <Command>
                        <CommandInput placeholder="Search type…" />
                        <CommandList>
                            <CommandEmpty>No matching type.</CommandEmpty>
                            <CommandGroup>
                                {options.map((opt) => {
                                    const active = selected.includes(opt);
                                    return (
                                        <CommandItem
                                            key={opt}
                                            value={opt}
                                            onSelect={() => onToggle(opt)}
                                            data-checked={active}
                                            className="capitalize tracking-wide"
                                        >
                                            {opt}
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>

            {selected.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                    {selected.map((tag) => (
                        <span
                            key={tag}
                            className="flex items-center gap-1 rounded-full bg-accent-soft/30 px-2 py-0.5 text-[10px] capitalize tracking-wide text-parchment"
                        >
                            {tag}
                            <button
                                onClick={() => onToggle(tag)}
                                className="text-text-muted hover:text-parchment"
                                aria-label={`Remove ${tag}`}
                            >
                                <X className="size-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
