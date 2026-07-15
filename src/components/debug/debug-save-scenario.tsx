import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    normalizeScenarioSpec,
    type ScenarioSpec,
} from "@convex/debugScenarioSpec";
import DebugButton from "./debug-button";
import DebugScenarioCardFields from "./debug-scenario-card-fields";
import {
    type CardDraft,
    cardToDraft,
    draftToCard,
    emptyCardDraft,
} from "./scenario-draft";

/** An existing row opened for editing. `spec` is the raw stored value (typed
 *  `unknown`); it's tolerantly normalized before inflating the form. */
export type EditingScenario = {
    id: Id<"debugScenarios">;
    label: string;
    spec: unknown;
};

const inputClass =
    "px-2 py-1 rounded bg-black/40 border border-white/20 text-white text-xs placeholder:text-white/30 outline-none focus:border-white/40";

const PHASES = [
    "",
    "BEGINNING",
    "PRECOMBAT_MAIN",
    "COMBAT",
    "POSTCOMBAT_MAIN",
    "ENDING",
] as const;

function num(raw: string): number | undefined {
    const trimmed = raw.trim();
    if (trimmed === "") return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
}

/**
 * Structured "Save scenario" form (replaces the old raw-JSON textarea). A card
 * repeater — each row a `DebugScenarioCardFields` with a card-name autocomplete
 * and an input for every `ScenarioCard` field — plus the spec-level knobs
 * (landCount, libraryCount, turn, phase). On save it assembles a clean
 * `ScenarioSpec` and calls the `assertIsAdmin`-gated `saveDebugScenario`, which
 * re-runs the loadability guard (ADR 0044). A collapsed live JSON preview lets
 * the admin eyeball the assembled spec.
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
    const [landCount, setLandCount] = useState(
        initial?.landCount !== undefined ? String(initial.landCount) : ""
    );
    const [libraryCount, setLibraryCount] = useState(
        initial?.libraryCount !== undefined ? String(initial.libraryCount) : ""
    );
    const [turn, setTurn] = useState(
        initial?.turn !== undefined ? String(initial.turn) : ""
    );
    const [phase, setPhase] = useState(initial?.phase ?? "");
    const [showJson, setShowJson] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

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
        };
        const land = num(landCount);
        if (land !== undefined) s.landCount = land;
        const lib = num(libraryCount);
        if (lib !== undefined) s.libraryCount = lib;
        const t = num(turn);
        if (t !== undefined) s.turn = t;
        if (phase !== "") s.phase = phase;
        return s;
    }, [cards, landCount, libraryCount, turn, phase]);

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
                setLandCount("");
                setLibraryCount("");
                setTurn("");
                setPhase("");
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Save failed");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-white/40 text-[10px] uppercase tracking-wide">
                {editing ? `Edit: ${editing.label}` : "Save scenario"}
            </span>
            <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label…"
                className={`${inputClass} w-full`}
            />

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
                    className="self-start text-white/50 hover:text-white/80 text-[10px] underline"
                >
                    + card
                </button>
            </div>

            {/* Spec-level knobs */}
            <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-white/50">
                    lands
                    <input
                        type="number"
                        min={0}
                        value={landCount}
                        onChange={(e) => setLandCount(e.target.value)}
                        className={`${inputClass} w-14`}
                    />
                </label>
                <label className="flex items-center gap-1 text-white/50">
                    library
                    <input
                        type="number"
                        min={0}
                        value={libraryCount}
                        onChange={(e) => setLibraryCount(e.target.value)}
                        className={`${inputClass} w-14`}
                    />
                </label>
                <label className="flex items-center gap-1 text-white/50">
                    turn
                    <input
                        type="number"
                        min={1}
                        value={turn}
                        onChange={(e) => setTurn(e.target.value)}
                        className={`${inputClass} w-14`}
                    />
                </label>
                <label className="flex items-center gap-1 text-white/50">
                    phase
                    <select
                        value={phase}
                        onChange={(e) => setPhase(e.target.value)}
                        className={inputClass}
                    >
                        {PHASES.map((p) => (
                            <option key={p} value={p}>
                                {p === "" ? "—" : p}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            <button
                type="button"
                onClick={() => setShowJson((v) => !v)}
                className="self-start text-white/40 hover:text-white/70 text-[10px] underline"
            >
                {showJson ? "hide JSON" : "show JSON"}
            </button>
            {showJson && (
                <pre className="max-h-40 overflow-auto rounded bg-black/40 border border-white/10 p-1.5 text-[10px] text-white/60">
                    {JSON.stringify(spec, null, 2)}
                </pre>
            )}

            {error && <span className="text-red-400 text-[10px]">{error}</span>}
            <div className="flex gap-1">
                <DebugButton
                    onClick={() => void handleSave()}
                    disabled={saving}
                >
                    {saving
                        ? editing
                            ? "Updating…"
                            : "Saving…"
                        : editing
                          ? "Update"
                          : "Save to DB"}
                </DebugButton>
                {editing && (
                    <DebugButton
                        variant="danger"
                        onClick={() => onDone?.()}
                        disabled={saving}
                    >
                        Cancel
                    </DebugButton>
                )}
            </div>
        </div>
    );
}
