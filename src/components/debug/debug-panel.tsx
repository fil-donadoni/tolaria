import { useEffect, useRef, useState } from "react";
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

type PresetScenario = {
    label: string;
    cards: {
        name: string;
        owner: "me" | "opp";
        zone?: "hand" | "battlefield";
        tapped?: boolean;
        /** Number of copies to place in the zone. Default 1. */
        count?: number;
    }[];
    phase: string;
    landCount: number;
    libraryCount?: number;
};

const PRESET_SCENARIOS: PresetScenario[] = [
    {
        label: "Circle of Protection: Red (prevent next damage from red source)",
        cards: [
            // CoP: Red already in play. Opponent holds a Lightning Bolt and
            // has a Mountain to cast it. Activate the CoP's "{1}: next red
            // source of your choice..." ability, target the Bolt on the
            // stack, resolve CoP first, then Bolt fizzles on prevention.
            { name: "Circle of Protection: Red", owner: "me" as const },
            { name: "Plains", owner: "me" as const },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mons's Goblin Raiders", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Balance (asymmetric lands / hand / creatures → 3-step resolve)",
        cards: [
            // Classic asymmetric Balance setup. P1 has a lead across all
            // three zones — on resolve, they'll be prompted to keep 1 land,
            // keep 1 card, keep 1 creature (step by step). Castable turn 1
            // with 2 Plains ({1}{W}).
            {
                name: "Balance",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Plains", owner: "me" as const, count: 4 },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            {
                name: "Savannah Lions",
                owner: "me" as const,
                count: 3,
            },
            { name: "Plains", owner: "opp" as const, count: 1 },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "hand" as const,
                count: 5,
            },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Timetwister (each player shuffles hand+gy into library, draws 7)",
        cards: [
            // Timetwister castable turn 1 with 3 Islands ({2}{U}). Both
            // players have hand + library filler so the draw-7 is visible
            // end-to-end; graveyards are initially empty (the filler preset
            // doesn't populate gy, but the effect still exercises the
            // hand→library shuffle + the draw-7 path).
            {
                name: "Timetwister",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 3 },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
                count: 2,
            },
            { name: "Mountain", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        libraryCount: 12,
    },
    {
        label: "Knights (protection from color: target/block/damage prevented, CR 702.16)",
        cards: [
            // Both knights in play. Golden path: WK can't be targeted by
            // Swords to Plowshares (white), BK can't be targeted by Dark
            // Ritual-colored... actually use the symmetry: each knight can't
            // be targeted by a source of the opposite color, can't be blocked
            // by a creature of that color, and takes no damage from such a
            // source. Lightning Bolt (red) still hits either knight.
            { name: "White Knight", owner: "me" as const },
            { name: "Black Knight", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Serra Angel", owner: "opp" as const },
            { name: "Hurloon Minotaur", owner: "me" as const },
            {
                name: "Swords to Plowshares",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const },
            { name: "Swamp", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
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
    const panelRef = useRef<HTMLDivElement>(null);
    const pageVisible = usePageVisible();

    useEffect(() => {
        if (!isOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (
                panelRef.current &&
                !panelRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        };
        document.addEventListener("pointerdown", handlePointerDown);
        return () =>
            document.removeEventListener("pointerdown", handlePointerDown);
    }, [isOpen]);
    const state = useQuery(
        api.game.getFullState,
        isOpen && pageVisible ? { gameId } : "skip"
    );
    const undo = useMutation(api.game.debugUndo);
    const resetGame = useMutation(api.game.debugResetGame);
    const setupScenario = useMutation(api.game.debugSetupScenario);

    return (
        <div
            ref={panelRef}
            className="fixed top-1/2 right-4 -translate-y-1/2 z-50 font-mono text-xs"
        >
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
                            <DebugButton
                                onClick={() => {
                                    localStorage.clear();
                                    sessionStorage.clear();
                                    window.location.reload();
                                }}
                                variant="danger"
                            >
                                Clear Storage
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
                                                libraryCount:
                                                    scenario.libraryCount,
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
