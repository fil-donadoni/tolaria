import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    normalizeScenarioSpec,
    type ScenarioSpec,
} from "@convex/debugScenarioSpec";
import { DEBUG_INPUT_CLASS } from "./debug-form-styles";
import DebugButton from "./debug-button";
import DebugScenarioCardFields from "./debug-scenario-card-fields";
import DebugScenarioSpecFields from "./debug-scenario-spec-fields";
import {
    type CardDraft,
    type SpecDraft,
    cardToDraft,
    draftToCard,
    draftToSpec,
    emptyCardDraft,
    emptySpecDraft,
    specToDraft,
} from "./scenario-draft";
import { assembleScenarioSpec } from "./scenario-spec-ownership";

/** An existing row opened for editing. `spec` is the raw stored value (typed
 *  `unknown`); it's tolerantly normalized before inflating the form. */
export type EditingScenario = {
    id: Id<"debugScenarios">;
    label: string;
    spec: unknown;
};

/**
 * Structured "Save scenario" form (replaces the old raw-JSON textarea). A card
 * repeater — each row a `DebugScenarioCardFields` with a card-name autocomplete
 * and an input for every `ScenarioCard` field — plus `DebugScenarioSpecFields`,
 * one input per SPEC-LEVEL field (issue #3463: it was four of eleven, so
 * `life`, `poison`, `experience`, `companion`, `rngSeed` and `markLastDrawn`
 * could be saved by a blade scenario or `specFromState` and never typed by a
 * human). On save it assembles a clean `ScenarioSpec` and calls the
 * `assertIsAdmin`-gated `saveDebugScenario`, which re-runs the loadability
 * guard (ADR 0044). A collapsed live JSON preview lets the admin eyeball the
 * assembled spec.
 *
 * The title + label + Save/Update (+ Cancel) form ONE pinned head group (issue
 * #3494): the CTA used to be the last element on the form, under every card row
 * and all ~28 spec knobs.
 *
 * When EDITING, the assembled spec still carries over every spec field the form
 * renders no input for (`scenario-spec-ownership.ts` — none today, by
 * construction the next widening may add one): the update mutation patches
 * `spec` wholesale, so anything left out is deleted from the row.
 */
export default function DebugSaveScenario({
    editing = null,
    onDone,
}: {
    editing?: EditingScenario | null;
    onDone?: () => void;
} = {}) {
    const saveScenario = useMutation(api.debugScenarios.saveDebugScenario);
    const updateScenario = useMutation(api.debugScenarios.updateDebugScenario);

    // When `editing` is set the parent re-mounts this component via a `key`, so
    // these initializers run once against the row being edited.
    const initial = useMemo(
        () => (editing ? normalizeScenarioSpec(editing.spec) : null),
        [editing]
    );
    const [label, setLabel] = useState(editing?.label ?? "");
    const [cards, setCards] = useState<CardDraft[]>(() =>
        initial && initial.cards.length > 0
            ? initial.cards.map(cardToDraft)
            : [emptyCardDraft()]
    );
    const [specDraft, setSpecDraft] = useState<SpecDraft>(() =>
        specToDraft(initial)
    );
    const [showJson, setShowJson] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const patchSpec = (patch: Partial<SpecDraft>) =>
        setSpecDraft((prev) => ({ ...prev, ...patch }));
    const patchCard = (i: number, patch: Partial<CardDraft>) =>
        setCards((prev) =>
            prev.map((c, j) => (j === i ? { ...c, ...patch } : c))
        );
    const addCard = () => setCards((prev) => [...prev, emptyCardDraft()]);
    const removeCard = (i: number) =>
        setCards((prev) => prev.filter((_, j) => j !== i));

    const spec: ScenarioSpec = useMemo(() => {
        const s: ScenarioSpec = {
            cards: cards.filter((c) => c.name.trim() !== "").map(draftToCard),
            ...draftToSpec(specDraft),
        };
        // `updateDebugScenario` patches `spec` wholesale, so a field this form
        // renders no input for must be carried over from the loaded row or the
        // save DELETES it (issue #3462). The classification is the single
        // authority on which those are.
        return assembleScenarioSpec(s, initial);
    }, [cards, specDraft, initial]);

    const handleSave = async () => {
        if (saving) return;
        setError(null);
        if (spec.cards.length === 0) {
            setError("Add at least one card with a name");
            return;
        }
        setSaving(true);
        try {
            if (editing) {
                await updateScenario({
                    id: editing.id,
                    label: label.trim() || "Untitled",
                    spec,
                });
                onDone?.();
            } else {
                await saveScenario({ label: label.trim() || "Untitled", spec });
                setLabel("");
                setCards([emptyCardDraft()]);
                setSpecDraft(emptySpecDraft());
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    const cta = saving
        ? editing
            ? "Updating…"
            : "Saving…"
        : editing
          ? "Update"
          : "Save to DB";

    return (
        <div className="flex flex-col gap-2">
            {/* The HEAD group — title, label, CTA — pinned (issue #3494).
                `position: sticky` resolves against the sheet body, the nearest
                scrolling ancestor, and stays inside this form's own box, so it
                rides along exactly while the form is on screen. Before this the
                Save button was the LAST element after every card row and every
                spec knob: saving a four-card scenario meant scrolling back past
                all of them to find it.

                OPAQUE, and `bg-surface-elevated` rather than `bg-popover`:
                the two resolve to the same `#1c2027` inside the sheet, and the
                surface token is the one that also reads as a head band on
                `/admin/scenarios`, which mounts this same form on a
                `--color-surface` panel. */}
            <div className="sticky top-0 z-10 flex flex-col gap-1.5 border-b border-border-accent/20 bg-surface-elevated pt-1 pb-2">
                <span className="text-sm font-medium text-text">
                    {editing ? `Edit: ${editing.label}` : "Save scenario"}
                </span>
                <div className="flex items-center gap-1.5">
                    <input
                        type="text"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="Label…"
                        aria-label="scenario label"
                        className={`${DEBUG_INPUT_CLASS} min-w-0 flex-1`}
                    />
                    <DebugButton
                        variant="primary"
                        size="sm"
                        onClick={() => void handleSave()}
                        disabled={saving}
                    >
                        {cta}
                    </DebugButton>
                    {editing && (
                        <DebugButton
                            variant="danger"
                            size="sm"
                            onClick={() => onDone?.()}
                            disabled={saving}
                        >
                            Cancel
                        </DebugButton>
                    )}
                </div>
                {error && (
                    <span className="text-xs text-danger-strong">{error}</span>
                )}
            </div>

            <div className="flex flex-col gap-1">
                {cards.map((card, i) => (
                    <DebugScenarioCardFields
                        key={i}
                        draft={card}
                        index={i}
                        onPatch={(patch) => patchCard(i, patch)}
                        onRemove={() => removeCard(i)}
                    />
                ))}
                <button
                    type="button"
                    onClick={addCard}
                    className="self-start rounded-sm py-1 text-xs text-text-muted underline hover:text-parchment"
                >
                    + card
                </button>
            </div>

            {/* Spec-level knobs — one input per `form-owned` field (#3463),
                split frequent / "Other options" (#3494) */}
            <DebugScenarioSpecFields draft={specDraft} onPatch={patchSpec} />

            <button
                type="button"
                onClick={() => setShowJson((v) => !v)}
                className="self-start rounded-sm py-1 text-xs text-text-disabled underline hover:text-parchment"
            >
                {showJson ? "hide JSON" : "show JSON"}
            </button>
            {showJson && (
                <pre className="max-h-40 overflow-auto rounded-sm border border-border-subtle bg-surface-base/60 p-1.5 font-mono text-[10px] text-text-muted">
                    {JSON.stringify(spec, null, 2)}
                </pre>
            )}
        </div>
    );
}
