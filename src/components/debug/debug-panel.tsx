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
        label: "Tap-for-mana triggers — Mana Flare + Manabarbs + Wild Growth",
        cards: [
            // Mana Flare doubles each land's first color. Manabarbs pings the
            // tapper. Wild Growth attached to a Forest gives +{G} on that
            // host's mana tap. Tap any Forest to see all three fire.
            { name: "Mana Flare", owner: "me" as const },
            { name: "Manabarbs", owner: "me" as const },
            {
                name: "Wild Growth",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Warp Artifact — Aura on opponent's artifact (CR 303.4 cross-board attach)",
        cards: [
            // Warp Artifact in hand (cost {B}{B}) targeting an opponent-owned
            // Sol Ring. Cast attaches the aura under my control while the
            // host stays on the opponent's battlefield (CR 303.4). On the
            // opponent's next upkeep the trigger deals 1 damage to them
            // (CR 603.6a). Verifies cross-board aura targeting AND visual
            // attachment when host and aura sit on opposite sides.
            {
                name: "Warp Artifact",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Sol Ring", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "SPELL_CAST trigger — Verduran + Sphere cycle + Soul Net",
        cards: [
            // Verduran on the battlefield. Cast Castle (enchantment) → may-pay
            // prompts to draw a card. Crystal Rod fires on any blue spell
            // → may pay {1} for 1 life. Soul Net fires on creature death.
            { name: "Verduran Enchantress", owner: "me" as const },
            { name: "Ivory Cup", owner: "me" as const },
            { name: "Soul Net", owner: "me" as const },
            { name: "Castle", owner: "me" as const, zone: "hand" as const },
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Mountain", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 6,
    },
    {
        label: "Aura pumps — Firebreathing + Holy Armor",
        cards: [
            // Firebreathing on a Mountain caster's bear: spend {R} to pump
            // +1/+0 EOT. Holy Armor adds passive +0/+2 and a {1}{W} pump for
            // +0/+3 EOT — both modifications stack with the static buff.
            {
                name: "Firebreathing",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Holy Armor",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Grizzly Bears", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Plains", owner: "me" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Reach blocks flier — Giant Spider + Web",
        cards: [
            // Opponent attacks with Shivan Dragon (flying). Giant Spider
            // (innate reach) blocks legally; Web attached to a vanilla
            // Grizzly Bears also lets it block by granting reach + 0/+2.
            { name: "Giant Spider", owner: "me" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Web", owner: "me" as const, zone: "hand" as const },
            { name: "Forest", owner: "me" as const, count: 1 },
            { name: "Shivan Dragon", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const, count: 6 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Psychic Venom — 2 dmg on host land tap (PERMANENT_TAPPED)",
        cards: [
            // Psychic Venom in hand → attach to opponent's Mountain. Every
            // time they tap that land (mana or otherwise) the trigger pings
            // them for 2.
            {
                name: "Psychic Venom",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Upkeep tax — Power Leak + Power Surge + Pestilence",
        cards: [
            // Three upkeep-driven enchantments: Power Leak attached to one of
            // my own enchantments forces a {U}-or-1-life choice each turn;
            // Power Surge pings the active player for each of their untapped
            // lands; Pestilence demands {B} or sacrifice + can be activated
            // for symmetric 1-damage sweeps.
            {
                name: "Power Leak",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Castle", owner: "me" as const },
            { name: "Power Surge", owner: "me" as const },
            { name: "Pestilence", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Sacrifice-counter — Lifeforce / Deathgrip",
        cards: [
            // Lifeforce ({G}, sac: counter Black). Deathgrip ({B}, sac:
            // counter Green). Opponent has Dark Ritual + Llanowar Elves to
            // try one of each color.
            { name: "Lifeforce", owner: "me" as const },
            { name: "Deathgrip", owner: "me" as const },
            { name: "Forest", owner: "me" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            {
                name: "Dark Ritual",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            {
                name: "Llanowar Elves",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Swamp", owner: "opp" as const, count: 2 },
            { name: "Forest", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Northern Paladin — {W}{W}, {T}: destroy target black creature",
        cards: [
            // Tap the Paladin to wipe an opposing Black creature.
            // Hypnotic Specter is the canonical LEA Black target.
            { name: "Northern Paladin", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 2 },
            { name: "Hypnotic Specter", owner: "opp" as const },
            { name: "Swamp", owner: "opp" as const, count: 2 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Arrows showcase — target arrows for stack items",
        cards: [
            // Sandbox per visualizzare le frecce di targeting:
            // - Lightning Bolt (R, any target) → cast su creatura, player o spell
            // - Counterspell (UU) → cast su un'altra spell sulla pila
            // - Disenchant (1W) → cast su artefatto/incantesimo opp
            // - Northern Paladin (T) → triggered ability che bersaglia creatura nera
            // Mana abbondante per concatenare casts e osservare piu frecce.
            {
                name: "Lightning Bolt",
                owner: "me" as const,
                zone: "hand" as const,
                count: 2,
            },
            {
                name: "Counterspell",
                owner: "me" as const,
                zone: "hand" as const,
            },
            {
                name: "Disenchant",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Northern Paladin", owner: "me" as const },
            { name: "Mountain", owner: "me" as const, count: 2 },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Plains", owner: "me" as const, count: 2 },
            {
                name: "Lightning Bolt",
                owner: "opp" as const,
                zone: "hand" as const,
            },
            { name: "Hypnotic Specter", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
            { name: "Sol Ring", owner: "opp" as const },
            { name: "Mountain", owner: "opp" as const, count: 3 },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Block restrictions — Invisibility / Fear / Ironclaw / Dwarven Warriors",
        cards: [
            // Wave 2 block-restriction sweep.
            // - Invisibility on my Grizzly Bears: only Walls can block.
            // - Fear on my Hypnotic Specter: only black/artifact can block.
            // - Ironclaw Orcs: can't block creatures with power ≥ 2.
            // - Dwarven Warriors: tap → target ≤2 power creature is
            //   unblockable EOT.
            {
                name: "Invisibility",
                owner: "me" as const,
                zone: "hand" as const,
            },
            { name: "Fear", owner: "me" as const, zone: "hand" as const },
            { name: "Grizzly Bears", owner: "me" as const },
            { name: "Hypnotic Specter", owner: "me" as const },
            { name: "Dwarven Warriors", owner: "me" as const },
            { name: "Island", owner: "me" as const, count: 2 },
            { name: "Swamp", owner: "me" as const, count: 2 },
            { name: "Mountain", owner: "me" as const, count: 1 },
            { name: "Ironclaw Orcs", owner: "opp" as const },
            { name: "Wall of Water", owner: "opp" as const },
            { name: "Grizzly Bears", owner: "opp" as const },
        ],
        phase: "PRECOMBAT_MAIN",
        landCount: 0,
    },
    {
        label: "Damage prevention shields — Samite Healer / Conservator",
        cards: [
            // Wave 3 prevent-N-to-target.
            // - Samite Healer: tap to drop a 1-damage shield on any target
            //   (creature or player). Opponent's Lightning Bolt is reduced
            //   by 1 (3 → 2 damage).
            // - Conservator: {3}, tap to drop a 2-damage shield on
            //   yourself. Reduces a Bolt to 1.
            // Stack the shields and watch them combine on the same target.
            { name: "Samite Healer", owner: "me" as const },
            { name: "Conservator", owner: "me" as const },
            { name: "Plains", owner: "me" as const, count: 4 },
            { name: "Grizzly Bears", owner: "opp" as const },
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
