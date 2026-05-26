import { cn } from "~/lib/utils";

const TYPES = [
    "Creature",
    "Instant",
    "Sorcery",
    "Artifact",
    "Enchantment",
    "Land",
    "Planeswalker",
] as const;

interface TypeFilterProps {
    selected: string[];
    onToggle: (type: string) => void;
}

export default function TypeFilter({ selected, onToggle }: TypeFilterProps) {
    return (
        <div className="flex flex-wrap items-center gap-1">
            {TYPES.map((t) => {
                const active = selected.includes(t);
                return (
                    <button
                        key={t}
                        onClick={() => onToggle(t)}
                        className={cn(
                            "rounded-full px-2.5 py-1 text-[11px] uppercase tracking-wide transition",
                            active
                                ? "filter-chip-active text-parchment"
                                : "filter-chip-inactive text-text-muted hover:text-parchment"
                        )}
                    >
                        {t}
                    </button>
                );
            })}
        </div>
    );
}
