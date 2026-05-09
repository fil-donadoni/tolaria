import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { JSONTree } from "react-json-tree";
import { usePageVisible } from "~/hooks/usePageVisible";
import {
    PLAYER_COLORS,
    getOrCreateClientId,
    getStoredPlayerName,
    storeSession,
} from "~/lib/session";
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
        zone?: "hand" | "battlefield" | "graveyard";
        tapped?: boolean;
        /** Number of copies to place in the zone. Default 1. */
        count?: number;
        /** Marked damage (CR 120.3) on a battlefield creature. */
        damageMarked?: number;
    }[];
    phase: string;
    landCount: number;
    libraryCount?: number;
};

const PRESET_SCENARIOS: PresetScenario[] = [
    {
        label: "Regeneration ({G}: regenerate enchanted creature, CR 701.15a)",
        cards: [
            // Regeneration in hand, attach to my Grizzly Bears, then have
            // the opponent throw a Lightning Bolt at it. Activating {G}
            // before the Bolt resolves stacks a regen shield: the Bolt's
            // lethal damage is replaced by heal+tap, the bear stays in play.
            {
                name: "Regeneration",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 2 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Twiddle (toggle tap state on artifact/creature/land, CR 701.20)",
        cards: [
            // Twiddle the opponent's tapped land to untap it (the only useful
            // mode is forced; pre-modal-cast infra). Verify the bear in play
            // also becomes a legal target.
            {
                name: "Twiddle",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const },
            { name: "Mountain", owner: "opp" as const, tapped: true },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Unsummon (return target creature to its owner's hand, CR 701.10)",
        cards: [
            // Bounce the opponent's bear back to their hand. After resolution
            // the bear should leave the battlefield and reappear in opp.hand
            // as a fresh card (no marked damage, untapped, no summoning sick).
            {
                name: "Unsummon",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Damage marked overlay (red badge above P/T, CR 120.3)",
        cards: [
            // Each creature has different marked-damage state to exercise the
            // overlay UI: no badge (0 / undefined), small (1), and near-lethal
            // (toughness-1). Cleared at CLEANUP per CR 514.2.
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                damageMarked: 1,
            },
            {
                name: "Hill Giant",
                owner: "me" as const,
                damageMarked: 2,
            },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
            },
            {
                name: "Serra Angel",
                owner: "opp" as const,
                damageMarked: 3,
            },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Regrowth (target card from your graveyard, CR 400.7 / 608.2b)",
        cards: [
            // Cast Regrowth on your own graveyard to recur a Lightning Bolt;
            // the opponent's bear in their graveyard is NOT a legal target
            // (controller: 'you' filter).
            {
                name: "Regrowth",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                zone: "graveyard" as const,
            },
            {
                name: "Grizzly Bears",
                owner: "opp" as const,
                zone: "graveyard" as const,
            },
            { name: "Forest", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Sinkhole (destroy target land, CR 701.7)",
        cards: [
            // Sinkhole costs {B}{B}{1}: three Swamps cover the cost. Two
            // legal targets in play — opponent's Mountain and Forest — to
            // exercise the Land target picker. The opponent's Grizzly Bears
            // is NOT a legal target (Sinkhole reads "target land"), so
            // clicking it during target selection should be rejected.
            {
                name: "Sinkhole",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 3 },
            { name: "Mountain", owner: "opp" as const },
            { name: "Forest", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Volcanic Eruption (X target Mountains; X dmg to each creature/player, CR 107.3 / 205.3 / 614.5)",
        cards: [
            // Volcanic Eruption costs {X}{U}{U}{U}. With six Islands the
            // caster can pay X=3 and still cast — pick three of the four
            // opponent Mountains, then watch the eruption: three Mountains
            // hit graveyards and 3 damage goes to every creature and player.
            // Plateau is "Land — Mountain Plains" so it's a legal target too,
            // exercising the subtype filter (CR 205.3). Savannah Lions
            // (2 toughness) dies; Serra Angel (4 toughness, flying) survives
            // — flying does NOT save anything here (CR 120.3).
            {
                name: "Volcanic Eruption",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 6 },
            { name: "Mountain", owner: "opp" as const, count: 3 },
            { name: "Plateau", owner: "opp" as const },
            { name: "Savannah Lions", owner: "opp" as const },
            { name: "Serra Angel", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "me" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Sea Serpent vs Sinkhole (CR 508.1c attack + CR 603.8 state trigger)",
        cards: [
            // Two-step exercise covering both Sea Serpent abilities:
            //  1. Attack: defender controls an Island, so Sea Serpent CAN
            //     legally attack (CR 508.1c). Declare it as attacker to
            //     verify the restriction's positive case.
            //  2. State trigger: pass priority back to the opponent, who
            //     casts Sinkhole on the only Island we control. After
            //     Sinkhole resolves we control 0 Islands — the next stable
            //     checkpoint scans state triggers (CR 117.5 + 603.8) and
            //     queues the sacrifice on the stack. Resolving it sends
            //     Sea Serpent to the graveyard.
            { name: "Sea Serpent", owner: "me" as const },
            { name: "Island", owner: "me" as const },
            { name: "Island", owner: "opp" as const },
            { name: "Swamp", owner: "opp" as const, count: 2 },
            {
                name: "Sinkhole",
                owner: "opp" as const,
                zone: "hand" as const,
            },
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
    onSwitchGame: (gameId: Id<"games">, playerId: string) => void;
};

export default function DebugPanel({
    gameId,
    showAllCards,
    onToggleShowAllCards,
    debugAllActions,
    onToggleDebugAllActions,
    onSwitchGame,
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
    const game = useQuery(
        api.game.getGame,
        isOpen && pageVisible ? { gameId } : "skip"
    );
    const undo = useMutation(api.game.debugUndo);
    const resetGame = useMutation(api.game.debugResetGame);
    const setupScenario = useMutation(api.game.debugSetupScenario);
    const createSoloGame = useMutation(api.game.createSoloGame);

    const handleNewSolo = async () => {
        // Reuse the deck of the first player in the current game so the user
        // doesn't have to round-trip through the lobby just to restart.
        const sourceDeck = game?.players[0]?.deck;
        if (!sourceDeck) return;
        const name = getStoredPlayerName().trim() || "Player";
        const baseId = getOrCreateClientId();
        const p1Id = `${baseId}-p1`;
        const p2Id = `${baseId}-p2`;
        const newId = await createSoloGame({
            name: `${name}'s solo game`,
            player1: {
                id: p1Id,
                name: `${name} (P1)`,
                bgColor: PLAYER_COLORS[0],
                deck: sourceDeck,
            },
            player2: {
                id: p2Id,
                name: `${name} (P2)`,
                bgColor: PLAYER_COLORS[1],
                deck: sourceDeck,
            },
        });
        storeSession(newId, p1Id);
        onSwitchGame(newId, p1Id);
    };

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
                            <DebugButton onClick={handleNewSolo}>
                                {game?.solo ? "Restart Solo" : "New Solo Game"}
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
