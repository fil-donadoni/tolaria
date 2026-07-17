import { useState } from "react";
import { Input } from "~/components/ui/input";
import type { ScopeCardRating } from "~/hooks/useCardRatings";
import { PICK_RATING_MIN, PICK_RATING_MAX } from "@convex/limited/pickRatings";

interface PickRatingCardRowProps {
    card: ScopeCardRating;
    /** Fires `setCardRating(scope, cardId, rating)` — the caller owns
     *  scope/cardId threading so this row only ever handles the rating
     *  value. Rejected promise surfaces as an inline error. Return value is
     *  ignored (the mutation resolves `null`). */
    onSave: (rating: number) => Promise<unknown>;
    /** Fires `clearCardRating(scope, cardId)`. Return value is ignored. */
    onClear: () => Promise<unknown>;
}

/** One card's inline rating editor (PRD #1296 Slice C, issue #1300): shows
 *  the effective rating (`dbRating ?? seedRating`) and whether it's a
 *  database override or the seed default, a numeric input pre-filled with
 *  the effective value, and Save/Clear controls. Both controls disable while
 *  their own mutation is in flight (project-wide rule: a button firing a
 *  Convex mutation must disable while pending) — tracked locally per-row so
 *  editing one card never disables another row's controls. */
export default function PickRatingCardRow({
    card,
    onSave,
    onClear,
}: PickRatingCardRowProps) {
    const effectiveRating = card.dbRating ?? card.seedRating;
    const [value, setValue] = useState(
        effectiveRating === null ? "" : String(effectiveRating)
    );
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isOverride = card.dbRating !== null;
    const parsed = Number(value);
    const isValidInput =
        value.trim() !== "" &&
        Number.isFinite(parsed) &&
        parsed >= PICK_RATING_MIN &&
        parsed <= PICK_RATING_MAX;

    async function handleSave() {
        if (!isValidInput || pending) return;
        setPending(true);
        setError(null);
        try {
            await onSave(parsed);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Save failed");
        } finally {
            setPending(false);
        }
    }

    async function handleClear() {
        if (pending) return;
        setPending(true);
        setError(null);
        try {
            await onClear();
            setValue(card.seedRating === null ? "" : String(card.seedRating));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Clear failed");
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="flex items-center justify-between gap-3 rounded-sm border border-border-subtle/30 px-2 py-1.5">
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-text">{card.name}</span>
                <span className="text-[11px] text-text-muted">
                    {effectiveRating === null
                        ? "Unrated (Pick Heuristic only)"
                        : isOverride
                          ? `Override: ${effectiveRating}`
                          : `Seed default: ${effectiveRating}`}
                </span>
            </div>
            <Input
                type="number"
                min={PICK_RATING_MIN}
                max={PICK_RATING_MAX}
                step={0.1}
                aria-label={`Rating for ${card.name}`}
                value={value}
                disabled={pending}
                onChange={(e) => setValue(e.currentTarget.value)}
                className="w-20"
            />
            <button
                type="button"
                onClick={() => void handleSave()}
                disabled={pending || !isValidInput}
                className="btn-base btn-tone-primary px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
                {pending ? "Saving…" : "Save"}
            </button>
            <button
                type="button"
                onClick={() => void handleClear()}
                disabled={pending || card.dbRating === null}
                className="btn-base btn-tone-ghost px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
                Clear
            </button>
            {error && (
                <span className="text-[11px] text-danger-strong">{error}</span>
            )}
        </div>
    );
}
