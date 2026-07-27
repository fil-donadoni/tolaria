import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type {
    EditableCardProfile,
    ScopeCardProfile,
} from "~/hooks/useCardProfiles";
import CardProfileCapabilityPicker from "./card-profile-capability-picker";

interface CardProfileCardRowProps {
    card: ScopeCardProfile;
    /** Fires `setCardProfile(scope, cardId, …)` — the caller owns
     *  scope/cardId threading so this row only ever handles the profile
     *  body. Rejected promise surfaces as an inline error. */
    onSave: (profile: EditableCardProfile) => Promise<unknown>;
    /** Fires `clearCardProfile(scope, cardId)` — reverts to the checked-in
     *  census seed (or to no profile at all). */
    onClear: () => Promise<unknown>;
}

/** Comma-separated Archetype text -> the array the mutation takes. The
 *  server normalizes (trim/lowercase/dedupe, `normalizeArchetypes`) — this
 *  only splits, so the ONE normalization authority stays server-side. */
function parseArchetypes(text: string): string[] {
    return text
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
}

function summarize(list: string[]): string {
    return list.length === 0 ? "—" : list.join(", ");
}

/** One card's inline Card Profile editor (PRD #1607, ADR 0072, issue #1614).
 *  Collapsed by default it shows the EFFECTIVE profile (`dbProfile ??
 *  seedProfile`), where that profile came from, and — the load-bearing bit —
 *  whether it has been reviewed: an LLM-seeded row is `reviewed: false` and
 *  contributes at HALF the contextual cap until a human confirms it, so
 *  "Unreviewed" is the editor's primary call to action, not a footnote.
 *  Expanding reveals the Archetype text field, the two closed-vocabulary
 *  Capability pickers, the review toggle and Save/Clear. Collapsed-by-default
 *  matters: a scope is hundreds of cards, and rendering every card's full
 *  control set at once would be thousands of live inputs.
 *
 *  Both controls disable while their own mutation is in flight (project-wide
 *  rule: a button firing a Convex mutation disables while pending), tracked
 *  per-row so editing one card never disables another row's controls —
 *  mirrors `PickRatingCardRow`. */
export default function CardProfileCardRow({
    card,
    onSave,
    onClear,
}: CardProfileCardRowProps) {
    const effective = card.dbProfile ?? card.seedProfile;
    const [open, setOpen] = useState(false);
    const [archetypes, setArchetypes] = useState(
        (effective?.archetypes ?? []).join(", ")
    );
    const [provides, setProvides] = useState<string[]>(
        effective?.provides ?? []
    );
    const [requires, setRequires] = useState<string[]>(
        effective?.requires ?? []
    );
    const [reviewed, setReviewed] = useState(effective?.reviewed ?? false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isOverride = card.dbProfile !== null;
    const source =
        effective === null
            ? "Unprofiled"
            : isOverride
              ? "Override"
              : "Census seed";

    async function handleSave() {
        if (pending) return;
        setPending(true);
        setError(null);
        try {
            await onSave({
                archetypes: parseArchetypes(archetypes),
                provides,
                requires,
                comboEdges: effective?.comboEdges,
                reviewed,
            });
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
            setArchetypes((card.seedProfile?.archetypes ?? []).join(", "));
            setProvides(card.seedProfile?.provides ?? []);
            setRequires(card.seedProfile?.requires ?? []);
            setReviewed(card.seedProfile?.reviewed ?? false);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Clear failed");
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="flex flex-col gap-2 rounded-sm border border-border-subtle/30 px-2 py-1.5">
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-text">
                        {card.name}
                    </span>
                    <span className="text-[11px] text-text-muted">
                        {source} · archetypes:{" "}
                        {summarize(effective?.archetypes ?? [])} · provides:{" "}
                        {summarize(effective?.provides ?? [])} · requires:{" "}
                        {summarize(effective?.requires ?? [])}
                    </span>
                </div>
                {effective !== null && (
                    <span
                        className={
                            "shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium " +
                            (effective.reviewed
                                ? "bg-surface-elevated/50 text-text-muted"
                                : "bg-danger-strong/20 text-danger-strong")
                        }
                    >
                        {effective.reviewed ? "Reviewed" : "Unreviewed"}
                    </span>
                )}
                <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-expanded={open}
                    onClick={() => setOpen((prev) => !prev)}
                >
                    {open ? "Close" : "Edit"}
                </Button>
            </div>

            {open && (
                <div className="flex flex-col gap-2 border-t border-border-subtle/30 pt-2">
                    <label className="flex flex-col gap-1 text-[11px] font-medium text-text-muted">
                        Archetypes (comma separated)
                        <Input
                            type="text"
                            aria-label={`Archetypes for ${card.name}`}
                            value={archetypes}
                            disabled={pending}
                            onChange={(e) =>
                                setArchetypes(e.currentTarget.value)
                            }
                        />
                    </label>
                    <CardProfileCapabilityPicker
                        legend="Provides"
                        value={provides}
                        onChange={setProvides}
                        disabled={pending}
                    />
                    <CardProfileCapabilityPicker
                        legend="Requires"
                        value={requires}
                        onChange={setRequires}
                        disabled={pending}
                    />
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1 text-[11px] text-text">
                            <input
                                type="checkbox"
                                checked={reviewed}
                                disabled={pending}
                                aria-label={`Reviewed for ${card.name}`}
                                onChange={(e) =>
                                    setReviewed(e.currentTarget.checked)
                                }
                            />
                            Reviewed (full weight)
                        </label>
                        <Button
                            type="button"
                            variant="primary"
                            size="xs"
                            onClick={() => void handleSave()}
                            disabled={pending}
                        >
                            {pending ? "Saving…" : "Save"}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => void handleClear()}
                            disabled={pending || card.dbProfile === null}
                        >
                            Clear
                        </Button>
                        {error && (
                            <span className="text-[11px] text-danger-strong">
                                {error}
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
