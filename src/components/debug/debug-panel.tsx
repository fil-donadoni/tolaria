import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { JSONTree } from "react-json-tree";
import { usePageVisible } from "~/hooks/usePageVisible";
import DebugButton from "./debug-button";

const theme = {
    scheme: "tolaria",
    base00: "transparent",
    base01: "#383830",
    base02: "#49483e",
    base03: "#75715e",
    base04: "#a59f85",
    base05: "#f8f8f2",
    base06: "#f5f4f1",
    base07: "#f9f8f5",
    base08: "#f92672",
    base09: "#fd971f",
    base0A: "#f4bf75",
    base0B: "#a6e22e",
    base0C: "#a1efe4",
    base0D: "#66d9ef",
    base0E: "#ae81ff",
    base0F: "#cc6633",
};

const PRESET_SCENARIOS = [
    {
        label: "Serra Angel vs Bears",
        cards: [
            { name: "Serra Angel", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 7,
    },
    {
        label: "Combat: Serra vs Wall",
        cards: [
            { name: "Serra Angel", owner: "me" as const },
            { name: "Wall of Swords", owner: "opp" as const },
        ],
        phase: "DECLARE_ATTACKERS",
        landCount: 7,
    },
    {
        label: "Multi-block test",
        cards: [
            { name: "Serra Angel", owner: "me" as const },
            { name: "Hill Giant", owner: "me" as const },
            { name: "Savannah Lions", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Pearled Unicorn", owner: "opp" as const },
        ],
        phase: "DECLARE_ATTACKERS",
        landCount: 7,
    },
    {
        label: "Trample: Mammoth vs Merfolk x2",
        cards: [
            { name: "War Mammoth", owner: "me" as const },
            { name: "Merfolk of the Pearl Trident", owner: "opp" as const },
            { name: "Merfolk of the Pearl Trident", owner: "opp" as const },
        ],
        phase: "DECLARE_ATTACKERS",
        landCount: 7,
    },
    {
        label: "Defender: Wall vs Bears",
        cards: [
            { name: "Wall of Swords", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "DECLARE_ATTACKERS",
        landCount: 7,
    },
    {
        label: "Mox: all 5 + Black Lotus",
        cards: [
            { name: "Black Lotus", owner: "me" as const },
            { name: "Mox Pearl", owner: "me" as const },
            { name: "Mox Sapphire", owner: "me" as const },
            { name: "Mox Jet", owner: "me" as const },
            { name: "Mox Ruby", owner: "me" as const },
            { name: "Mox Emerald", owner: "me" as const },
        ],
        phase: "PRECOMBAT_MAIN",
    },
];

type DebugPanelProps = {
    gameId: Id<"games">;
    showAllCards: boolean;
    onToggleShowAllCards: () => void;
    debugAllActions: boolean;
    onToggleDebugAllActions: () => void;
};

export default function DebugPanel({
    gameId,
    showAllCards,
    onToggleShowAllCards,
    debugAllActions,
    onToggleDebugAllActions,
}: DebugPanelProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [showScenarios, setShowScenarios] = useState(false);
    const pageVisible = usePageVisible();
    const state = useQuery(
        api.game.getFullState,
        isOpen && pageVisible ? { gameId } : "skip"
    );
    const undo = useMutation(api.game.debugUndo);
    const resetGame = useMutation(api.game.debugResetGame);
    const setupScenario = useMutation(api.game.debugSetupScenario);

    return (
        <div className="fixed top-1/2 right-4 -translate-y-1/2 z-50 font-mono text-xs">
            <div className="rounded-lg border border-white/10 bg-black/90 shadow-2xl backdrop-blur">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex w-full items-center justify-between px-3 py-2 text-white/70 hover:text-white"
                >
                    <span className="font-semibold">Debug</span>
                    <span>{isOpen ? "\u25B2" : "\u25BC"}</span>
                </button>

                {isOpen && (
                    <div className="border-t border-white/10">
                        <div className="flex flex-wrap gap-2 px-3 py-2 border-b border-white/10">
                            {state && state.seq > 0 && (
                                <DebugButton onClick={() => undo({ gameId })}>
                                    Undo
                                </DebugButton>
                            )}
                            <DebugButton onClick={onToggleShowAllCards}>
                                {showAllCards ? "Hide cards" : "Show all cards"}
                            </DebugButton>
                            <DebugButton onClick={onToggleDebugAllActions}>
                                {debugAllActions ? "Rules on" : "All actions"}
                            </DebugButton>
                            <DebugButton
                                onClick={() => setShowScenarios(!showScenarios)}
                            >
                                Scenarios
                            </DebugButton>
                            <DebugButton
                                onClick={() => resetGame({ gameId })}
                                variant="danger"
                            >
                                Reset Game
                            </DebugButton>
                        </div>

                        {showScenarios && (
                            <div className="px-3 py-2 border-b border-white/10 flex flex-col gap-1">
                                <span className="text-white/40 text-[10px] uppercase tracking-wide">
                                    Load scenario
                                </span>
                                {PRESET_SCENARIOS.map((scenario) => (
                                    <DebugButton
                                        key={scenario.label}
                                        onClick={() =>
                                            setupScenario({
                                                gameId,
                                                cards: scenario.cards,
                                                phase: scenario.phase,
                                                landCount: scenario.landCount,
                                            })
                                        }
                                    >
                                        {scenario.label}
                                    </DebugButton>
                                ))}
                            </div>
                        )}

                        <div className="max-h-[70vh] w-100 overflow-auto px-2 py-1">
                            {state ? (
                                <JSONTree
                                    data={state}
                                    theme={theme}
                                    invertTheme={false}
                                    shouldExpandNodeInitially={(
                                        _keyPath,
                                        _data,
                                        level
                                    ) => level < 2}
                                />
                            ) : (
                                <span className="text-white/40">
                                    Loading...
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
