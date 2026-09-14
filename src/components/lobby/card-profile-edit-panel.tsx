import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import type {
    EditableCardProfile,
    ScopeCardProfile,
} from "~/hooks/useCardProfiles";
import CardProfileArchetypePicker from "./card-profile-archetype-picker";
import CardProfileCapabilityPicker from "./card-profile-capability-picker";
import CardProfileOracleText from "./card-profile-oracle-text";

interface CardProfileEditPanelProps {
    card: ScopeCardProfile;
    /** DOM id, so the collapsed row's toggle can carry `aria-controls`. */
    panelId: string;
    onSave: (profile: EditableCardProfile) => Promise<unknown>;
    onClear: () => Promise<unknown>;
    /** Hand the queue to the next row. Called ONLY after a save resolves, so
     *  a rejected write leaves the reviewer on the card they were judging
     *  with the error visible, never silently advanced past it. */
    onAdvance: () => void;
}

/** The expanded half of one Card Profile row: the card's rules text, the two
 *  closed-vocabulary picker families, the review toggle and the save controls
 *  (PRD #1607, ADR 0072, issues #1614 and #3597).
 *
 *  ITS OWN COMPONENT because MOUNTING is what seeds it. The editor owns which
 *  row is open, so a collapsed row stays mounted — and when this state lived
 *  on the row, edits abandoned by opening a different row survived invisibly:
 *  reopening showed pickers contradicting the summary line right above them,
 *  and "Mark reviewed & next" then WROTE those abandoned values and flagged
 *  the row reviewed. Re-seeding from an effect would be the same bug fixed
 *  twice over (and `react-hooks/set-state-in-effect` is right to refuse it).
 *  Here the panel does not exist while the row is closed, so opening one
 *  always reads the CURRENT effective profile — including whatever a reactive
 *  update (another tab, a Clear, a concurrent admin) has changed since.
 *
 *  While it IS open the reviewer's in-progress state is the truth: a later
 *  reactive update does not yank the pickers out from under them. */
export default function CardProfileEditPanel({
    card,
    panelId,
    onSave,
    onClear,
    onAdvance,
}: CardProfileEditPanelProps) {
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

    // Focus lands INSIDE the panel on mount — what makes the pass keyboard-
    // reachable: advancing the queue mounts the next panel, which takes focus,
    // and ⌘/Ctrl+Enter there confirms it without a pointer ever touching the
    // page. The row hands focus BACK to its toggle on unmount.
    useEffect(() => {
        panelRef.current?.focus();
    }, []);

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
        <div
            ref={panelRef}
            id={panelId}
            tabIndex={-1}
            role="group"
            aria-label={`Profile for ${card.name}`}
            className="flex flex-col gap-2 border-t border-border-subtle/30 pt-2 outline-none"
            onKeyDown={(e) => {
                // ⌘/Ctrl+Enter — the pass's whole keyboard loop. Not a bare
                // Enter: this panel is full of checkboxes and text controls
                // where Enter already means something.
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
                        onChange={(e) => setReviewed(e.currentTarget.checked)}
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
    );
}
