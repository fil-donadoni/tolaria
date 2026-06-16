/**
 * PROTOTYPE — real component rendering for palette C verification.
 * Throwaway — delete after decision.
 */

import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import GameDialog from "~/components/ui/game-dialog";
import PauseMenuDialog from "~/components/board/pause-menu-dialog";
import GameOverDialog from "~/components/board/game-over-dialog";
import ModePicker from "~/components/cards/mode-picker";
import MulliganPrompt from "~/components/board/mulligan-prompt";
import TargetSelectionBanner from "~/components/board/target-selection-banner";
import PaymentBanner from "~/components/board/payment-banner";
import ActionButton from "~/components/board/action-button";
import type {
    Player,
    GameOver,
    MulliganState,
    PendingTarget,
    PendingCast,
    CardInstance,
} from "~/types/game";

const FAKE_GAME_ID = "kj7fakegameid000000000000000" as Id<"games">;

const FAKE_PLAYER: Player = {
    id: "p1",
    name: "You",
    life: 20,
    hand: [
        {
            id: "i_lightning",
            card: { id: "lightningBolt" },
            ownerId: "p1",
            controllerId: "p1",
            zone: "hand",
            tapped: false,
            counters: {},
            damageMarked: 0,
            legalActions: [],
        } as unknown as CardInstance,
    ],
    library: { count: 53 },
    graveyard: [],
    exile: [],
    battlefield: [],
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    poison: 0,
    energy: 0,
    counters: {},
} as unknown as Player;

const FAKE_OPPONENT: Player = {
    ...FAKE_PLAYER,
    id: "p2",
    name: "Opponent",
};

const FAKE_GAME_OVER: GameOver = {
    winnerId: "p1",
    loserId: "p2",
    reason: "life",
};

const FAKE_MULLIGAN: MulliganState = {
    declaringPlayerId: "p1",
    mulligansTaken: [1, 0],
    bottoming: null,
} as unknown as MulliganState;

const FAKE_TARGET: PendingTarget = {
    playerId: "p1",
    cardInstanceId: "i_lightning",
    targetType: "Creature",
    zone: "battlefield",
    controller: "any",
    count: 1,
    selected: [],
} as unknown as PendingTarget;

const FAKE_CAST: PendingCast = {
    cardInstanceId: "i_lightning",
    playerId: "p1",
} as unknown as PendingCast;

const FAKE_MODES = [
    {
        id: "gain",
        label: "Gain 3 life",
        oracleText: "Target player gains 3 life.",
        resolve: () => {},
    },
    {
        id: "prevent",
        label: "Prevent damage",
        oracleText:
            "Prevent the next 3 damage that would be dealt to any target this turn.",
        resolve: () => {},
    },
] as never;

type Variant =
    | "pause-menu"
    | "pause-menu-confirm"
    | "game-over"
    | "mode-picker-dialog"
    | "mode-picker-portal"
    | "subtitle-demo";

type FloatingPanel = "mulligan" | "target" | "payment-cast";

export default function PrototypeButtonsRoute() {
    const [dialog, setDialog] = useState<Variant | null>(null);
    const [panel, setPanel] = useState<FloatingPanel | null>(null);

    const close = () => setDialog(null);

    return (
        <div
            className="min-h-screen p-6 relative"
            style={{
                backgroundImage:
                    "radial-gradient(ellipse at top, #1a1410 0%, #0a0a0c 50%)",
            }}
        >
            <div className="mb-8">
                <h1 className="font-beleren text-[#f1f1e8] text-2xl tracking-wider mb-1">
                    Palette C · Real Components
                </h1>
                <p className="text-zinc-500 text-sm">
                    Pewter · Tarnished Gold · Crimson. Real instances of
                    production dialogs and banners.
                </p>
            </div>

            {/* Dialog launchers */}
            <section className="mb-8">
                <h2 className="font-beleren text-[#f1f1e8] text-base tracking-wider mb-3">
                    Dialogs
                </h2>
                <div className="flex flex-wrap gap-2">
                    {(
                        [
                            ["pause-menu", "Pause Menu"],
                            ["pause-menu-confirm", "Pause → Confirm Concede"],
                            ["game-over", "Game Over"],
                            ["mode-picker-dialog", "Mode Picker (Dialog)"],
                            ["mode-picker-portal", "Mode Picker (Portal)"],
                            ["subtitle-demo", "Subtitle demo"],
                        ] as [Variant, string][]
                    ).map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setDialog(id)}
                            className="px-3 py-2 rounded-sm text-xs bg-zinc-800/40 border border-zinc-600/45 text-zinc-300 font-beleren tracking-wide hover:bg-zinc-700/40 transition-colors cursor-pointer"
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </section>

            {/* Action bar buttons */}
            <section className="mb-8">
                <h2 className="font-beleren text-[#f1f1e8] text-base tracking-wider mb-3">
                    Action bar buttons
                </h2>
                <div className="flex flex-wrap gap-2 items-center">
                    <ActionButton
                        onClick={() => {}}
                        label="Pass"
                        tone="secondary"
                        shortcut="space"
                    />
                    <ActionButton
                        onClick={() => {}}
                        label="Pass Turn"
                        tone="primary"
                        shortcut="enter"
                    />
                    <ActionButton
                        onClick={() => {}}
                        label="Cancel Cast"
                        tone="destructive"
                        shortcut="U"
                    />
                    <ActionButton
                        onClick={() => {}}
                        label="Confirm Damage"
                        tone="primary"
                    />
                    <ActionButton
                        onClick={() => {}}
                        label="Disabled"
                        tone="primary"
                        disabled
                    />
                </div>
            </section>

            {/* Floating panel toggles */}
            <section className="mb-8">
                <h2 className="font-beleren text-[#f1f1e8] text-base tracking-wider mb-3">
                    Floating panels
                </h2>
                <div className="flex flex-wrap gap-2">
                    {(
                        [
                            ["mulligan", "Mulligan Prompt"],
                            ["target", "Target Banner"],
                            ["payment-cast", "Payment Banner (cast)"],
                        ] as [FloatingPanel, string][]
                    ).map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() =>
                                setPanel((p) => (p === id ? null : id))
                            }
                            className={`px-3 py-2 rounded-sm text-xs font-beleren tracking-wide transition-colors cursor-pointer border ${
                                panel === id
                                    ? "bg-[#7a5a2e]/30 border-[#c8a060]/45 text-[#e0c08a]"
                                    : "bg-zinc-800/40 border-zinc-600/45 text-zinc-300 hover:bg-zinc-700/40"
                            }`}
                        >
                            {label} {panel === id ? "·on" : ""}
                        </button>
                    ))}
                </div>
                <p className="text-zinc-500 text-xs mt-2">
                    Floating panels stay visible until toggled off. They appear
                    centered on screen and are draggable.
                </p>
            </section>

            {/* Real component instances */}
            {dialog === "pause-menu" && (
                <PauseMenuDialog
                    open
                    onOpenChange={(o) => {
                        if (!o) close();
                    }}
                    gameId={FAKE_GAME_ID}
                    playerId="p1"
                />
            )}

            {dialog === "pause-menu-confirm" && (
                <GameDialog
                    open
                    onOpenChange={close}
                    title="Concede"
                    subtitle="Do you really want to concede?"
                    dismissable
                >
                    <div className="flex gap-3 mt-2">
                        <button
                            type="button"
                            onClick={close}
                            className="flex-1 py-2 rounded-sm bg-zinc-800/40 border border-zinc-600/45 text-zinc-300 font-beleren tracking-wide hover:bg-zinc-700/40 transition-colors cursor-pointer"
                        >
                            No
                        </button>
                        <button
                            type="button"
                            onClick={close}
                            className="flex-1 py-2 rounded-sm bg-[#5c1e1e]/45 border border-[#a04040]/45 text-[#d48080] font-beleren tracking-wide hover:bg-[#5c1e1e]/65 transition-colors cursor-pointer"
                        >
                            Yes
                        </button>
                    </div>
                </GameDialog>
            )}

            {dialog === "game-over" && (
                <GameOverDialog
                    gameOver={FAKE_GAME_OVER}
                    allPlayers={[FAKE_PLAYER, FAKE_OPPONENT]}
                />
            )}

            {dialog === "mode-picker-dialog" && (
                <ModePicker
                    modes={FAKE_MODES}
                    cardName="Healing Salve"
                    variant="dialog"
                    onSelect={close}
                    onCancel={close}
                />
            )}

            {dialog === "mode-picker-portal" && (
                <ModePicker
                    modes={FAKE_MODES}
                    cardName="Healing Salve"
                    variant="portal"
                    position={{ x: window.innerWidth / 2 - 130, y: 300 }}
                    onSelect={close}
                    onCancel={close}
                />
            )}

            {dialog === "subtitle-demo" && (
                <GameDialog
                    open
                    onOpenChange={close}
                    title="Lightning Bolt"
                    subtitle="Choose a target creature or player"
                    dismissable
                    showCloseButton
                >
                    <p className="text-zinc-400 text-sm text-center mt-2">
                        (Real target selection happens on the board.)
                    </p>
                </GameDialog>
            )}

            {/* Floating panels — rendered into the page; positioned absolute */}
            {panel === "mulligan" && (
                <MulliganPrompt
                    gameId={FAKE_GAME_ID}
                    viewerId="p1"
                    mulligan={FAKE_MULLIGAN}
                    allPlayers={[FAKE_PLAYER, FAKE_OPPONENT]}
                />
            )}

            {panel === "target" && (
                <TargetSelectionBanner
                    pendingTarget={FAKE_TARGET}
                    me={FAKE_PLAYER}
                    gameId={FAKE_GAME_ID}
                    playerId="p1"
                />
            )}

            {panel === "payment-cast" && (
                <PaymentBanner
                    kind="cast"
                    pendingCast={FAKE_CAST}
                    me={FAKE_PLAYER}
                    gameId={FAKE_GAME_ID}
                    playerId="p1"
                />
            )}
        </div>
    );
}
