import { cn } from "~/lib/utils";

const VALUES = [0, 1, 2, 3, 4, 5, 6, 7] as const;

interface ManaValueFilterProps {
    selected: number[];
    onToggle: (value: number) => void;
}

export default function ManaValueFilter({
    selected,
    onToggle,
}: ManaValueFilterProps) {
    return (
        <div className="flex items-center gap-1">
            <span className="text-label">MV</span>
            {VALUES.map((v) => {
                const active = selected.includes(v);
                const label = v === 7 ? "7+" : String(v);
                return (
                    <button
                        key={v}
                        onClick={() => onToggle(v)}
                        // No `text-text-muted` on the inactive chip: under
                        // `.filter-chip-inactive`'s own `opacity-60` the two
                        // dims compound below AA (axe `color-contrast`,
                        // measured on `deck-builder-filters`, issue #4421).
                        // The other inactive chips inherit the text colour
                        // and let the opacity alone say "off".
                        className={cn(
                            "h-7 w-7 rounded-full text-xs transition",
                            active
                                ? "filter-chip-active text-parchment"
                                : "filter-chip-inactive"
                        )}
                        aria-pressed={active}
                    >
                        {label}
                    </button>
                );
            })}
        </div>
    );
}
