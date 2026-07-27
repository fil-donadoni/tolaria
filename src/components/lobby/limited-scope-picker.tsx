import type { DraftableSetInfo } from "~/hooks/useLimitedEvent";

/** Human-facing scope label — mirrors
 *  `create-limited-event-dialog.tsx`'s `packSourceLabel`: the Vintage Cube
 *  pool source (ADR 0062) shows a proper name, every real set shows its
 *  uppercased code. */
function scopeLabel(set: DraftableSetInfo): string {
    return set.isCube ? "Vintage Cube" : set.setCode.toUpperCase();
}

interface LimitedScopePickerProps {
    /** Every Draftable Set/the Vintage Cube (PRD #1296: "any Draftable Set or
     *  the Vintage Cube") — a non-Draftable set is filtered out by the
     *  caller before this renders, mirroring the create-event dialog's
     *  selectability gate. */
    scopes: DraftableSetInfo[];
    value: string | undefined;
    onChange: (scope: string) => void;
    /** Accessible name for the radiogroup — each Admin editor names its own
     *  scope axis ("Rating Scope" / "Profile Scope") so two pickers on the
     *  same Lobby page stay distinguishable to a screen reader and to a
     *  `getByRole("radiogroup", { name })` query. */
    ariaLabel: string;
}

/** Radiogroup scope picker shared by the Lobby's per-scope Admin editors —
 *  the Pick Rating editor (PRD #1296 Slice C, issue #1300) and the Card
 *  Profile editor (PRD #1607, issue #1614). Both edit rows keyed by the SAME
 *  `(scope, cardId)` Pack Source scope space over the SAME `listScopeCards`
 *  enumeration, so they pick a scope with ONE component rather than two
 *  copies that could drift apart on which scopes are selectable or how the
 *  Vintage Cube is labelled. Same interaction shape as
 *  `create-limited-event-dialog.tsx`'s Pack Source picker, so an admin
 *  already familiar with that control recognizes this one immediately. */
export default function LimitedScopePicker({
    scopes,
    value,
    onChange,
    ariaLabel,
}: LimitedScopePickerProps) {
    if (scopes.length === 0) {
        return (
            <p className="text-xs text-text-muted">
                No Draftable Sets available yet.
            </p>
        );
    }

    return (
        <div
            role="radiogroup"
            aria-label={ariaLabel}
            className="flex flex-wrap gap-1"
        >
            {scopes.map((set) => (
                <button
                    key={set.setCode}
                    type="button"
                    role="radio"
                    aria-checked={value === set.setCode}
                    onClick={() => onChange(set.setCode)}
                    className={
                        "px-3 py-1 text-xs font-medium rounded-sm border transition " +
                        (value === set.setCode
                            ? "border-accent bg-accent text-surface-base"
                            : "border-border-subtle/40 bg-surface-elevated/30 text-text hover:bg-surface-elevated/50")
                    }
                >
                    {scopeLabel(set)}
                </button>
            ))}
        </div>
    );
}
