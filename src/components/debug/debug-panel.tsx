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

const PRESET_SCENARIOS = [
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
        label: "Nevinyrral's Disk",
        cards: [
            { name: "Nevinyrral's Disk", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Mox Emerald", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Mox Ruby", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 3,
    },
    {
        label: "Counterspell",
        cards: [
            {
                name: "Counterspell",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Island",
                owner: "me" as const,
            },
            {
                name: "Island",
                owner: "me" as const,
            },
            {
                name: "Savannah Lions",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Plains",
                owner: "opp" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
    },
    {
        label: "Castle (static +0/+2)",
        cards: [
            // Castle on my battlefield gives my untapped creatures +0/+2.
            { name: "Castle", owner: "me" as const },
            { name: "Savannah Lions", owner: "me" as const }, // 2/1 → 2/3 untapped
            { name: "Serra Angel", owner: "me" as const }, // 4/6
            { name: "Grizzly Bears", owner: "opp" as const }, // opponent: no buff
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 4,
    },
    {
        label: "Bad Moon (black +1/+1, symmetric)",
        cards: [
            // Bad Moon buffs ALL black creatures on either side.
            { name: "Bad Moon", owner: "me" as const },
            { name: "Bog Wraith", owner: "me" as const }, // B → 4/4
            { name: "Bog Wraith", owner: "opp" as const }, // B, opponent → 4/4 (buffed too!)
            { name: "Grizzly Bears", owner: "me" as const }, // G → stays 2/2
            { name: "Savannah Lions", owner: "opp" as const }, // W → stays 2/1
            {
                name: "Disenchant",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Plains", owner: "me" as const }, // W → stays 2/1
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 4,
    },
    {
        label: "Dual lands (Tundra + Underground Sea)",
        cards: [
            // Tundra taps for W or U, Underground Sea for U or B.
            // Pre-tap each with the picker to produce the chosen color,
            // then cast Counterspell ({U}{U}) from hand to verify committal.
            { name: "Tundra", owner: "me" as const },
            { name: "Underground Sea", owner: "me" as const },
            {
                name: "Counterspell",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
    },
    {
        label: "Sol Ring ({T}: Add {C}{C})",
        cards: [
            // Tap Sol Ring to add {C}{C} — pair with a single Mountain to cast
            // Obsianus Golem ({6}) with just 1 land + 1 artifact in play
            // (demonstrates multi-amount fixed mana abilities).
            { name: "Sol Ring", owner: "me" as const },
            { name: "Mountain", owner: "me" as const },
            { name: "Mountain", owner: "me" as const },
            { name: "Mountain", owner: "me" as const },
            {
                name: "Obsianus Golem",
                owner: "me" as const,
                zone: "hand" as const,
            },
        ],
        phase: "PRECOMBAT_MAIN",
    },
    {
        label: "Birds of Paradise & Llanowar Elves",
        cards: [
            // Tap Birds to add any color — pair with a Plains to cast
            // Swords to Plowshares on an opposing creature (golden path).
            // Birds itself is 0/1 with flying for a cheap evasive body (edge case).
            { name: "Birds of Paradise", owner: "me" as const },
            { name: "Llanowar Elves", owner: "me" as const },
            { name: "Plains", owner: "me" as const },
            {
                name: "Swords to Plowshares",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Serra Angel", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
    },
    {
        label: "Library fan stress (53 cards)",
        cards: [],
        phase: "PRECOMBAT_MAIN",
        libraryCount: 53,
    },
    {
        label: "Dark Ritual ({B} → {B}{B}{B})",
        cards: [
            {
                name: "Dark Ritual",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Hypnotic Specter",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const },
        ],
        phase: "PRECOMBAT_MAIN",
    },
    {
        label: "Hypnotic Specter (flying + random discard on damage)",
        cards: [
            { name: "Hypnotic Specter", owner: "me" as const },
            {
                name: "Savannah Lions",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
        ],
        phase: "DECLARE_ATTACKERS",
        landCount: 3,
    },
    {
        label: "Bog Wraith (swampwalk evasion)",
        cards: [
            // Attack with Bog Wraith: opponent controls a Swamp → assigning
            // Grizzly Bears as a blocker must be rejected (CR 702.13b).
            // Remove the Swamp (or swap for Forest) to unlock the block.
            { name: "Bog Wraith", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Swamp", owner: "opp" as const },
            { name: "Forest", owner: "opp" as const },
        ],
        phase: "DECLARE_ATTACKERS",
        landCount: 4,
    },
    {
        label: "Shanodin Dryads (forestwalk evasion)",
        cards: [
            // Attack with Shanodin Dryads: opponent controls a Forest →
            // declare-blockers phase is auto-skipped (CR 702.13b).
            { name: "Shanodin Dryads", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Forest", owner: "opp" as const },
        ],
        phase: "DECLARE_ATTACKERS",
        landCount: 4,
    },
    {
        label: "Fireball ({X}{R}, divided damage + extra-target cost)",
        cards: [
            // Cast Fireball on both opposing creatures. Engine prompts for X,
            // adds +{1} generic for the second target (CR 601.2f), then deals
            // floor(X / 2) to each (CR 120.1). X=4 kills both 1-toughness lions.
            {
                name: "Fireball",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Savannah Lions", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        label: "Time Walk ({1}{U}, extra turn)",
        cards: [
            // Cast Time Walk from hand, pass priority through the end step:
            // at CLEANUP the active player stays p1 (CR 500.7). Next end-of-turn
            // returns control to p2 as normal.
            {
                name: "Time Walk",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const },
            { name: "Island", owner: "me" as const },
        ],
        phase: "PRECOMBAT_MAIN",
    },
    {
        label: "Channel (life → {C} until end of turn)",
        cards: [
            // Cast Channel on 2 Forests: resolves to grant a "Pay 1 life: Add
            // {C}." mana ability on the caster. Fireball in hand lets you
            // convert the life payments into damage, then CLEANUP clears the
            // grant at turn end.
            {
                name: "Channel",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Fireball",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "me" as const },
            { name: "Forest", owner: "me" as const },
            { name: "Mountain", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
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
                                                    "libraryCount" in scenario
                                                        ? scenario.libraryCount
                                                        : undefined,
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
