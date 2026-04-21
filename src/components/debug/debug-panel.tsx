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
        label: "Wheel of Fortune (each player discards hand, draws 7)",
        cards: [
            // Wheel of Fortune castable turn 1 with 3 Mountains ({2}{R}).
            // Both players have non-empty hands so the discard step is
            // visible, and library filler ensures the draw-7 resolves.
            {
                name: "Wheel of Fortune",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const, count: 3 },
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
                count: 3,
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
    {
        label: "Howling Mine (each player's draw step: +1 card if untapped, CR 603.6a)",
        cards: [
            // Howling Mine in play untapped. Pass to DRAW step → trigger fires
            // for the active player (+1 extra draw). Icy Manipulator in play
            // lets you tap the Mine in response (intervening-if at resolve
            // cancels the extra draw, CR 603.4).
            { name: "Howling Mine", owner: "me" as const },
            { name: "Icy Manipulator", owner: "opp" as const },
            { name: "Island", owner: "opp" as const, count: 2 },
            { name: "Plains", owner: "me" as const, count: 2 },
        ],
        phase: "UPKEEP",
        landCount: 0,
        libraryCount: 10,
    },
    {
        label: "Control Magic on Serra Angel (steal opponent's creature, CR 613.1b + 702.10c)",
        cards: [
            // P1 casts Control Magic ({2}{U}{U}) targeting the opponent's
            // Serra Angel. On resolve, the Angel flips to P1's battlefield
            // with summoning sickness reset (CR 702.10c) — P1 can't attack
            // with it the same turn. Killing the Angel (via Lightning Bolt
            // in hand) detaches the aura via SBA 704.5m; destroying the
            // aura instead (via Disenchant in opp's hand) reverts control.
            {
                name: "Control Magic",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 4 },
            { name: "Serra Angel", owner: "opp" as const },
            {
                name: "Disenchant",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Plains", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Red Ward on Grizzly Bears (aura grants protection from red, CR 702.16)",
        cards: [
            // Exercise the aura system end-to-end: cast Red Ward targeting
            // the bear → bear gains protection from red → Lightning Bolt
            // (red) no longer targets the bear, but Disenchant still does.
            // Killing the bear (e.g. with Swords to Plowshares) detaches
            // the aura via SBA 704.5m.
            { name: "Grizzly Bears", owner: "me" as const },
            {
                name: "Red Ward",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Disenchant",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "opp" as const },
            { name: "Plains", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Steal Artifact on Sol Ring (aura flips artifact control, CR 613.1b)",
        cards: [
            // P1 casts Steal Artifact ({2}{U}{U}) targeting the opponent's
            // Sol Ring. On resolve, the Sol Ring enters P1's battlefield —
            // no summoning sickness (artifacts don't get 702.10c). Tap it
            // for {C}{C} immediately. Destroying the aura (Disenchant in
            // opp's hand) reverts control back to the opponent.
            {
                name: "Steal Artifact",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 4 },
            { name: "Sol Ring", owner: "opp" as const },
            {
                name: "Disenchant",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Plains", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Winter Orb (active player untaps at most one A/C/L per turn, CR 502.1)",
        cards: [
            // Winter Orb on P1's side. P1 has tapped lands and a tapped
            // creature — on the next UNTAP step only one of them untaps
            // (deterministic: first tapped A/C/L in battlefield order).
            // Pass turn repeatedly to observe P2's UNTAP also capped.
            { name: "Winter Orb", owner: "me" as const },
            {
                name: "Plains",
                owner: "me" as const,
                count: 3,
                tapped: true,
            },
            {
                name: "Grizzly Bears",
                owner: "me" as const,
                tapped: true,
            },
            {
                name: "Plains",
                owner: "opp" as const,
                count: 3,
                tapped: true,
            },
        ],
        phase: "END_STEP",
        landCount: 0,
    },
    {
        label: "Braingeyser ({X}{U}{U} → target player draws X, CR 107.3 / 121.1)",
        cards: [
            // Braingeyser in hand, 4 Islands in play ({X}{U}{U}): cast with
            // X=2 for a balanced draw, or target the opponent to mill via
            // deck size on an empty library. Golden path: choose X=3 → p1
            // draws 3. Edge case: target opponent with X ≥ library size to
            // exercise hasDrawnFromEmpty (CR 704.5b).
            {
                name: "Braingeyser",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        libraryCount: 10,
    },
    {
        label: "Sengir Vampire (combat kill → +1/+1, CR 603.2 / CREATURE_DIED)",
        cards: [
            // Sengir Vampire attacks, opponent blocks with a Grizzly Bear (2/2).
            // Combat damage: Vampire (4/4 flying) deals 4 to the bear (lethal),
            // the bear can't reach the vampire through flying. CREATURE_DIED
            // fires, Sengir's trigger resolves → modifyPower/Toughness +1 →
            // Vampire is 5/5.
            { name: "Sengir Vampire", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Swamp", owner: "me" as const, count: 4 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Nightmare (P/T = Swamps you control, CR 604.3 CDA)",
        cards: [
            // Nightmare requires {5}{B} to cast; with 6 Swamps in play, cast
            // it and it enters as a 6/6 flyer. Destroy one Swamp to watch the
            // CDA recompute to 5/5 live.
            {
                name: "Nightmare",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Royal Assassin ({T}: destroy target tapped creature, CR 701.20)",
        cards: [
            // Royal Assassin already untapped with summoning sickness off.
            // Opponent has a tapped Savannah Lions (e.g. just attacked last
            // turn or was tapped by Icy Manipulator). Activate the assassin's
            // ability → target lions → resolve, lions in graveyard.
            {
                name: "Royal Assassin",
                owner: "me" as const,
            },
            {
                name: "Savannah Lions",
                owner: "opp" as const,
                tapped: true,
            },
            { name: "Swamp", owner: "me" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Demonic Tutor (search library for a card, CR 701.19)",
        cards: [
            // 2 Swamps for {1}{B}. Resolve → prompt: select a card from
            // library → card goes to hand, library shuffles.
            {
                name: "Demonic Tutor",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
        libraryCount: 10,
    },
    {
        label: "Drain Life ({X}{B} → X damage, gain X life)",
        cards: [
            // 5 Swamps. Cast Drain Life with X=4 targeting opponent: opp loses
            // 4 life, me gains 4.
            {
                name: "Drain Life",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 5 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Sinkhole ({B}{B} → destroy target land)",
        cards: [
            // 2 Swamps. Target opponent's Mountain → destroyed.
            {
                name: "Sinkhole",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "opp" as const, count: 2 },
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
