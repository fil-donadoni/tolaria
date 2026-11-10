// Step 3's Match Clock field (issue #2308): the per-player chess clock's
// on/off switch and its minutes, editable only while it is on. Defaults and
// bounds come from `~/lib/matchSetup` (`effectiveClock`, `clampClockMinutes`);
// the server re-checks the value at Start (`clockBudgetMs`).
import {
    MATCH_CLOCK_MAX_MINUTES,
    MATCH_CLOCK_MIN_MINUTES,
} from "@convex/matchClock";
import { clampClockMinutes, type MatchSetup } from "~/lib/matchSetup";
import { cn } from "~/lib/utils";

export default function MatchClockField({
    on,
    minutes,
    onChange,
}: {
    on: boolean;
    minutes: number;
    onChange: (patch: Partial<MatchSetup>) => void;
}) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Match Clock
            </span>
            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label="Match Clock"
                    onClick={() => onChange({ clockOn: !on })}
                    className={cn(
                        "rounded-sm border px-3 py-1 text-xs font-medium transition",
                        on
                            ? "border-accent bg-accent text-surface-base"
                            : "border-border-subtle/40 bg-surface-elevated/30 text-text hover:bg-surface-elevated/50"
                    )}
                >
                    {on ? "On" : "Off"}
                </button>
                <label
                    className={cn(
                        "flex items-center gap-2 text-xs text-text",
                        !on && "opacity-40"
                    )}
                >
                    <input
                        type="number"
                        inputMode="numeric"
                        min={MATCH_CLOCK_MIN_MINUTES}
                        max={MATCH_CLOCK_MAX_MINUTES}
                        step={1}
                        disabled={!on}
                        value={minutes}
                        aria-label="Minutes per player"
                        onChange={(e) => {
                            // A field cleared mid-edit keeps the last value
                            // rather than snapping to the minimum.
                            if (e.target.value === "") return;
                            onChange({
                                clockMinutes: clampClockMinutes(
                                    Number(e.target.value)
                                ),
                            });
                        }}
                        className="w-16 rounded-sm border border-border-subtle/40 bg-surface-elevated/30 px-2 py-1 tabular-nums disabled:cursor-not-allowed"
                    />
                    minutes per player, for the whole Match
                </label>
            </div>
        </div>
    );
}
