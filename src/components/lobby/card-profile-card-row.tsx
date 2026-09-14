import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import CardImage from "~/components/cards/card-image";
import type {
    EditableCardProfile,
    ScopeCardProfile,
} from "~/hooks/useCardProfiles";
import CardProfileArchetypePicker from "./card-profile-archetype-picker";
import CardProfileCapabilityPicker from "./card-profile-capability-picker";
import CardProfileOracleText from "./card-profile-oracle-text";

interface CardProfileCardRowProps {
    card: ScopeCardProfile;
    /** Whether this row's editing panel is expanded. OWNED BY THE EDITOR
     *  (issue #3597), not by the row: "save this one and open the next" is a
     *  statement about the review QUEUE, and a row that owns its own open flag
     *  cannot make it. */
    open: boolean;
    onToggle: () => void;
    /** Fires `setCardProfile(scope, cardId, …)` — the caller owns
     *  scope/cardId threading so this row only ever handles the profile
     *  body. Rejected promise surfaces as an inline error. */
    onSave: (profile: EditableCardProfile) => Promise<unknown>;
    /** Fires `clearCardProfile(scope, cardId)` — reverts to the checked-in
     *  census seed (or to no profile at all). */
    onClear: () => Promise<unknown>;
    /** Hand the queue to the next row. Called ONLY after a save resolves, so
     *  a rejected write leaves the reviewer on the card they were judging with
     *  the error visible, never silently advanced past it. */
    onAdvance: () => void;
}

function summarize(list: string[]): string {
    return list.length === 0 ? "—" : list.join(", ");
}

/** One card's inline Card Profile editor (PRD #1607, ADR 0072, issues #1614
 *  and #3597). Collapsed it shows the card's ART, its name, the EFFECTIVE
 *  profile (`dbProfile ?? seedProfile`), where that profile came from, and —
 *  the load-bearing bit — whether it has been reviewed: an LLM-seeded row is
 *  `reviewed: false` and contributes at HALF the contextual cap until a human
 *  confirms it, so "Unreviewed" is the editor's primary call to action, not a
 *  footnote. Expanding reveals the card's rules text, the two closed-vocabulary
 *  pickers (Archetypes, Capabilities), the review toggle and the save controls.
 *
 *  Art in the COLLAPSED row is not decoration: judging whether a creature is
 *  `reanimatable` or belongs to `aggro` is a judgement about a body and a cost,
 *  and a name-only row made the reviewer recall or re-look-up every card of a
 *  several-hundred-card pass (issue #3597). The rules text stays behind the
 *  expansion, where the judgement is actually made, so the collapsed list
 *  remains scannable.
 *
 *  Collapsed-by-default matters: a scope is hundreds of cards, and rendering
 *  every card's full control set at once would be thousands of live inputs.
 *
 *  Both controls disable while their own mutation is in flight (project-wide
 *  rule: a button firing a Convex mutation disables while pending), tracked
 *  per-row so editing one card never disables another row's controls —
 *  mirrors `PickRatingCardRow`. */
export default function CardProfileCardRow({
    card,
    open,
    onToggle,
    onSave,
    onClear,
    onAdvance,
}: CardProfileCardRowProps) {
    const effective = card.dbProfile ?? card.seedProfile;
    const [archetypes, setArchetypes] = useState<string[]>(
        effective?.archetypes ?? []
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
    const panelRef = useRef<HTMLDivElement | null>(null);

    // Opening a row moves keyboard focus INTO it — which is what makes the
    // whole pass keyboard-reachable: "Mark reviewed & next" advances the
    // queue, the next panel takes focus, and ⌘/Ctrl+Enter there confirms it
    // without a pointer ever touching the page. Without this the focus stays
    // on the Edit button of a row that has since scrolled away.
    useEffect(() => {
        if (open) panelRef.current?.focus();
    }, [open]);

    const isOverride = card.dbProfile !== null;
    const source =
        effective === null
            ? "Unprofiled"
            : isOverride
              ? "Override"
              : "Census seed";

    /** The one write path. `markReviewed` is what the pass's primary control
     *  sends: confirming a row IS flipping that flag, so the common case must
     *  not cost a second click on the checkbox first. Returns whether the
     *  write resolved, so only a successful save advances the queue. */
    async function save(markReviewed: boolean): Promise<boolean> {
        if (pending) return false;
        setPending(true);
        setError(null);
        try {
            await onSave({
                archetypes,
                provides,
                requires,
                comboEdges: effective?.comboEdges,
                reviewed: markReviewed,
            });
            setReviewed(markReviewed);
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : "Save failed");
            return false;
        } finally {
            setPending(false);
        }
    }

    async function handleReviewedAndNext() {
        if (await save(true)) onAdvance();
    }

    async function handleClear() {
        if (pending) return;
        setPending(true);
        setError(null);
        try {
            await onClear();
            setArchetypes(card.seedProfile?.archetypes ?? []);
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
            <div className="flex items-center gap-3">
                <div
                    className="relative aspect-5/7 w-11 shrink-0"
                    data-card-profile-art={card.cardId}
                >
                    <CardImage
                        card={{ id: card.cardId }}
                        lazy
                        promoteLayer={false}
                        sizes="44px"
                    />
                </div>
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
                    onClick={onToggle}
                >
                    {open ? "Close" : "Edit"}
                </Button>
            </div>

            {open && (
                <div
                    ref={panelRef}
                    tabIndex={-1}
                    role="group"
                    aria-label={`Profile for ${card.name}`}
                    className="flex flex-col gap-2 border-t border-border-subtle/30 pt-2 outline-none"
                    onKeyDown={(e) => {
                        // ⌘/Ctrl+Enter — the pass's whole keyboard loop. Not a
                        // bare Enter: this panel is full of checkboxes and text
                        // controls where Enter already means something.
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            void handleReviewedAndNext();
                        }
                    }}
                >
                    <CardProfileOracleText cardId={card.cardId} />
                    <CardProfileArchetypePicker
                        legend="Archetypes"
                        value={archetypes}
                        onChange={setArchetypes}
                        disabled={pending}
                        cardName={card.name}
                    />
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
                    <div className="flex flex-wrap items-center gap-3">
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
                            onClick={() => void handleReviewedAndNext()}
                            disabled={pending}
                        >
                            {pending ? "Saving…" : "Mark reviewed & next"}
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            size="xs"
                            onClick={() => void save(reviewed)}
                            disabled={pending}
                        >
                            Save
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
                        <span className="text-[10px] text-text-muted">
                            ⌘/Ctrl+Enter marks reviewed and opens the next card
                        </span>
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
