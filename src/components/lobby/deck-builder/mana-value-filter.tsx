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
            <span className="text-[10px] uppercase tracking-wide text-white/40">
                MV
            </span>
            {VALUES.map((v) => {
                const active = selected.includes(v);
                const label = v === 7 ? "7+" : String(v);
                return (
                    <button
                        key={v}
                        onClick={() => onToggle(v)}
                        className={cn(
                            "h-7 w-7 rounded-full text-xs transition",
                            active
                                ? "bg-white/20 text-white ring-1 ring-white/40"
                                : "bg-white/5 text-white/50 hover:text-white"
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
