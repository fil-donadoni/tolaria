// `/admin/scenarios` — scenario management outside a game (ADR 0044, issue
// #770/#772). The board's debug blade (`DebugDbScenarios`) is the same table
// seen from inside a match, where the point is LOADING a setup; this page is
// the curation view: create, edit, promote to golden, regenerate/vary, delete,
// and prune the ephemeral ones.
//
// It deliberately reuses the blade's parts rather than growing a second
// implementation — `DebugSaveScenario` (the structured create/edit form),
// `DebugScenarioRow`, `DebugScenarioPreview`. The one difference is that no
// `gameId` exists here, so no row offers Load (`onLoad` is optional on the row
// for exactly this caller).
//
// Every query/mutation/action below is `assertIsAdmin`-gated server-side; the
// `/admin` route gate above this component is the UI half of the same boundary.
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, PanelHeader, PanelBody } from "@/components/ui/panel";
import { Banner } from "@/components/ui/banner";
import DebugScenarioRow from "@/components/debug/debug-scenario-row";
import DebugScenarioPreview from "@/components/debug/debug-scenario-preview";
import DebugSaveScenario, {
    type EditingScenario,
} from "@/components/debug/debug-save-scenario";
import { useScenarioTestGame } from "~/hooks/useScenarioTestGame";

/** A regenerated/varied spec awaiting the preview/save step. */
type Preview = {
    spec: unknown;
    unresolved: string[];
    prompt: string;
    initialLabel: string;
};

export default function ScenariosAdminPanel() {
    const scenarios = useQuery(api.debugScenarios.listDebugScenarios, {});
    const deleteScenario = useMutation(api.debugScenarios.deleteDebugScenario);
    const setGolden = useMutation(api.debugScenarios.setDebugScenarioGolden);
    const cleanup = useMutation(api.debugScenarios.cleanupEphemeralScenarios);
    const regenerate = useAction(
        api.debugScenarioGenerator.regenerateDebugScenario
    );

    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<Id<"debugScenarios"> | null>(null);
    const [cleaning, setCleaning] = useState(false);
    const [varyingId, setVaryingId] = useState<Id<"debugScenarios"> | null>(
        null
    );
    const [tweak, setTweak] = useState("");
    const [preview, setPreview] = useState<Preview | null>(null);
    const [filter, setFilter] = useState("");
    const [editing, setEditing] = useState<EditingScenario | null>(null);
    const [creating, setCreating] = useState(false);
    // "Test": create a fresh solo game, apply this scenario to it, go to the
    // board. The only affordance here that leaves the page.
    const testGame = useScenarioTestGame();

    const handleCleanup = async () => {
        if (cleaning) return;
        setError(null);
        setCleaning(true);
        try {
            await cleanup({});
        } catch (e) {
            setError(e instanceof Error ? e.message : "Cleanup failed");
        } finally {
            setCleaning(false);
        }
    };

    // Regenerate (no tweak) / vary (with tweak) both re-run the generator on the
    // row's stored prompt and land the NEW spec in the preview — the source row
    // is never mutated; only a subsequent save inserts a new row.
    const runRegenerate = async (
        row: Doc<"debugScenarios">,
        tweakText?: string
    ) => {
        if (busyId) return;
        setError(null);
        setBusyId(row._id);
        try {
            const result = await regenerate({
                id: row._id,
                ...(tweakText ? { tweak: tweakText } : {}),
            });
            setPreview({
                spec: result.spec,
                unresolved: result.unresolved,
                prompt: result.prompt,
                initialLabel: `${row.label} (copy)`,
            });
            setVaryingId(null);
            setTweak("");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Regenerate failed");
        } finally {
            setBusyId(null);
        }
    };

    const rows = (scenarios ?? []).filter((s) =>
        s.label.toLowerCase().includes(filter.toLowerCase())
    );
    const total = scenarios?.length ?? 0;
    const goldenCount = (scenarios ?? []).filter((s) => s.golden).length;
    const varyingRow = rows.find((r) => r._id === varyingId) ?? null;

    return (
        <>
            {(error || testGame.error) && (
                <Banner tone="danger">{error ?? testGame.error}</Banner>
            )}

            <Panel>
                <PanelHeader
                    title="Saved scenarios"
                    subtitle={
                        scenarios === undefined
                            ? "Loading…"
                            : `${total} total · ${goldenCount} golden (kept) · ${total - goldenCount} ephemeral (prunable)`
                    }
                />
                <PanelBody className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <Input
                            value={filter}
                            onChange={(e) => setFilter(e.currentTarget.value)}
                            placeholder="Search scenarios…"
                            className="h-8 flex-1"
                        />
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setEditing(null);
                                setCreating(true);
                            }}
                        >
                            New scenario
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => void handleCleanup()}
                            disabled={cleaning || total === 0}
                        >
                            {cleaning ? "Cleaning…" : "Clean up ephemeral"}
                        </Button>
                    </div>

                    <div className="flex flex-col gap-1">
                        {rows.length === 0 ? (
                            <span className="text-xs text-text-disabled">
                                {scenarios === undefined
                                    ? "Loading…"
                                    : "No saved scenarios"}
                            </span>
                        ) : (
                            rows.map((s) => (
                                <DebugScenarioRow
                                    key={s._id}
                                    row={s}
                                    disabled={
                                        busyId !== null ||
                                        testGame.launchingId !== null
                                    }
                                    onTest={() => testGame.test(s)}
                                    testing={testGame.launchingId === s._id}
                                    onToggleGolden={() =>
                                        void setGolden({
                                            id: s._id,
                                            golden: s.golden !== true,
                                        })
                                    }
                                    onEdit={() => {
                                        setCreating(false);
                                        setEditing({
                                            id: s._id,
                                            label: s.label,
                                            spec: s.spec,
                                        });
                                    }}
                                    onRegenerate={() => void runRegenerate(s)}
                                    onVary={() => {
                                        setVaryingId(s._id);
                                        setTweak("");
                                    }}
                                    onDelete={() =>
                                        void deleteScenario({ id: s._id })
                                    }
                                />
                            ))
                        )}
                    </div>

                    {varyingRow && (
                        <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
                            <span className="text-label">{`Vary: ${varyingRow.label}`}</span>
                            <Input
                                value={tweak}
                                onChange={(e) =>
                                    setTweak(e.currentTarget.value)
                                }
                                placeholder="Tweak, e.g. add a second Mountain to opp"
                                className="h-8"
                            />
                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="primary"
                                    size="sm"
                                    onClick={() =>
                                        void runRegenerate(
                                            varyingRow,
                                            tweak.trim()
                                        )
                                    }
                                    disabled={busyId !== null}
                                >
                                    {busyId !== null
                                        ? "Generating…"
                                        : "Generate variation"}
                                </Button>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => {
                                        setVaryingId(null);
                                        setTweak("");
                                    }}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    )}
                </PanelBody>
            </Panel>

            {preview !== null && (
                <Panel>
                    <PanelHeader title="Generated scenario" />
                    <PanelBody>
                        <DebugScenarioPreview
                            spec={preview.spec}
                            unresolved={preview.unresolved}
                            prompt={preview.prompt}
                            initialLabel={preview.initialLabel}
                            onSaved={() => setPreview(null)}
                            onDiscard={() => setPreview(null)}
                        />
                    </PanelBody>
                </Panel>
            )}

            {(creating || editing) && (
                <Panel>
                    <PanelHeader
                        title={editing ? "Edit scenario" : "New scenario"}
                    />
                    <PanelBody>
                        {/* Keyed so switching rows re-mounts the form: its
                            field state is initialized from `editing` once. */}
                        <DebugSaveScenario
                            key={editing?.id ?? "new"}
                            editing={editing}
                            onDone={() => {
                                setEditing(null);
                                setCreating(false);
                            }}
                        />
                    </PanelBody>
                </Panel>
            )}
        </>
    );
}
