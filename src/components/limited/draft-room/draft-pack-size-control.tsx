import { cn } from "~/lib/utils";
import {
    DRAFT_PACK_SIZE_MODES,
    type DraftPackSizeMode,
} from "./draftPackSizing";

/**
 * The desktop Booster's size control (issue #9166): three named intents —
 * Fit all / Large / Read — replacing the unlabelled zoom slider new players
 * never noticed. A radiogroup, so the choice is announced as one.
 */
export default function DraftPackSizeControl({
    mode,
    onChange,
}: {
    mode: DraftPackSizeMode;
    onChange: (mode: DraftPackSizeMode) => void;
}) {
    return (
        <div
            data-slot="draft-pack-size-control"
            role="radiogroup"
            aria-label="Booster card size"
            className="flex shrink-0 overflow-hidden rounded-sm border border-border-accent/50"
        >
            {DRAFT_PACK_SIZE_MODES.map((m) => (
                <button
                    key={m.mode}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.mode}
                    title={m.hint}
                    onClick={() => onChange(m.mode)}
                    className={cn(
                        "min-h-[var(--control-h)] px-3 text-sm font-semibold transition-colors",
                        mode === m.mode
                            ? "bg-accent-strong/25 text-parchment"
                            : "text-text-muted hover:text-parchment"
                    )}
                >
                    {m.label}
                </button>
            ))}
        </div>
    );
}
