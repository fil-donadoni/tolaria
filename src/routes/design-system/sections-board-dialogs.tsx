// Board dialog specimens — the census's live mounts for `src/components/board/**`
// (issue #4419, slice of the `check:ui` coverage census debt issue #4402).
//
// WHY THIS SECTION EXISTS. Seventeen of the board's own overlays paint a layer
// over a live game and were measured at no viewport: the census
// (`scripts/lib/ui-census.ts`) could prove it, and `DEBT` recorded it. A board
// dialog cannot be photographed from the board — the lane would have to reach
// the exact position that opens it, and several of them (the convoke tapper,
// the escape/delve exile pickers, the alternative-hand-cost picker) sit behind
// a cast whose cost the lane cannot set up. What every one of them CAN do is
// render from pure props, which is what this section hands them.
//
// ONE AT A TIME, BY DESIGN. Every specimen here is a real portal overlay:
// `GameDialog` and `AnchoredPicker` portal to `document.body` and paint
// `position: fixed`, `ActionSheet` likewise. Mounting the seventeen together
// would stack seventeen scrims on one screen and measure whichever landed on
// top. So the page mounts exactly the one its opener selected, and
// `scripts/ui-gate/surfaces.ts` carries one `dlg-*` surface per opener — the
// shape `design-system-dialog` already had for the canonical GameDialog, and
// the reason each row reports `walked` (a probe photographed it) rather than
// the weaker import-derived `specimen`.
//
// THE PROPS ARE FIXTURES, NOT A GAME. Every `gameId` / `playerId` here is a
// specimen handle: the dialogs take them as opaque strings and only spend them
// in a mutation a walk never fires. The two board dialogs that cannot be
// fixtured this way — `pregame-dialog` and `manual-peek-dialog`, which both
// open an unconditional `useQuery` on a real row — are NOT here: the pregame
// gate is measured on the lane's own game (`game-pregame`), and the manual
// peek needs a live Manual Game (issue #4427).
import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { PublicMatch } from "@convex/matches";
import type { CardInstance, PendingTarget, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    SkipPhasePrefsContext,
    useSkipPhasePrefsState,
} from "~/hooks/useSkipPhasePreferences";
import ActivatableAbilityMenu from "~/components/board/activatable-ability-menu";
import AttackAllConfirmDialog from "~/components/board/attack-all-confirm-dialog";
import CastAlternativeHandCostDialog from "~/components/board/cast-alternative-hand-cost-dialog";
import CastExileCostDialog from "~/components/board/cast-exile-cost-dialog";
import ControllerPhaseList from "~/components/board/controller-phase-list";
import ConvokeCreatureDialog from "~/components/board/convoke-creature-dialog";
import DiscardCostDialog from "~/components/board/discard-cost-dialog";
import ExileCostDialog from "~/components/board/exile-cost-dialog";
import GameOverDialog from "~/components/board/game-over-dialog";
import GraveyardTargetDialog from "~/components/board/graveyard-target-dialog";
import HandCardActionMenu from "~/components/board/hand-card-action-menu";
import ManaChoicePicker from "~/components/board/mana-choice-picker";
import ManaSpendChoiceDialog from "~/components/board/mana-spend-choice-dialog";
import ManualGameOverDialog from "~/components/board/manual-game-over-dialog";
import ManualVerbPopover from "~/components/board/manual-verb-popover";
import PauseMenuDialog from "~/components/board/pause-menu-dialog";
import SideboardingDialog from "~/components/board/sideboarding-dialog";
import { Section, Specimen, Where } from "./lib";

/* ── Fixtures ─────────────────────────────────────────────────────────── */

/** A specimen game handle. Opaque to every dialog below: they forward it to a
 *  mutation, and no walk presses a control that fires one. */
const GAME_ID = "specimen-game" as unknown as Id<"games">;
const ME = "me";
const OPP = "opp";

/** Real print ids, taken from the `mono-red-burn` preset (`convex/deckPresets.ts`)
 *  — a catalogue entry with art on every deployment the lane walks, so the
 *  card tiles inside these dialogs are the real `CardImage`, not a grey box
 *  that would read as a passing measurement of nothing. */
const PRINT = {
    bolt: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    goblin: "b4eb3db3-6a7c-488a-9433-d5d1d3133816",
    hillGiant: "0ddb98e8-13fe-4786-83f7-b72c56db135a",
    minotaur: "78a9088f-8755-47cb-aa93-51d992ccab90",
    mountain: "eace2c85-976c-425e-9800-5a6ccbd91b56",
} as const;

function card(
    id: string,
    printId: string,
    zone: CardInstance["zone"],
    overrides: Partial<CardInstance> = {}
): CardInstance {
    return {
        id,
        card: { id: printId },
        controllerId: ME,
        ownerId: ME,
        zone,
        isTapped: false,
        ...overrides,
    };
}

const HAND: CardInstance[] = [
    card("h1", PRINT.bolt, "hand"),
    card("h2", PRINT.goblin, "hand"),
    card("h3", PRINT.mountain, "hand"),
];

const GRAVEYARD: CardInstance[] = [
    card("g1", PRINT.hillGiant, "graveyard"),
    card("g2", PRINT.minotaur, "graveyard"),
    card("g3", PRINT.bolt, "graveyard"),
];

const BATTLEFIELD: CardInstance[] = [
    card("b1", PRINT.goblin, "battlefield", {
        types: ["Creature"],
        power: 1,
        toughness: 1,
    }),
    card("b2", PRINT.hillGiant, "battlefield", {
        types: ["Creature"],
        power: 3,
        toughness: 3,
    }),
];

function player(id: string, name: string, bgColor: string): Player {
    return {
        id,
        name,
        bgColor,
        life: 20,
        hand: [...HAND],
        library: [],
        graveyard: [...GRAVEYARD],
        exile: [],
        battlefield: id === ME ? [...BATTLEFIELD] : [],
        manaPool: {},
    };
}

const PLAYERS: Player[] = [
    player(ME, "You", "#7f1d1d"),
    player(OPP, "Rival", "#1e3a8a"),
];

/** The `GameContext` the three context-reading dialogs need
 *  (`ControllerPhaseList`, `ManualGameOverDialog`, `SideboardingDialog`). Same
 *  shape `makeManualGameContext` builds for the Manual Board: a complete,
 *  well-formed, inert value — `useGameContext` throws without one. */
const GAME_CONTEXT = {
    gameId: GAME_ID,
    playerId: ME,
    activePlayerId: ME,
    priorityPlayerId: ME,
    phase: "PRECOMBAT_MAIN" as const,
    turn: 4,
    engineTurn: 7,
    stackCount: 0,
    stackItems: [],
    allPlayers: PLAYERS,
    showAllCards: false,
    debugAllActions: false,
    onSwitchGame: () => {},
};

/** `n` copies of a print, the shape a Match deck copy is stored in. The
 *  swap editor lists one row per COPY, so a three-card fixture would have
 *  measured a dialog three rows tall — the one modal whose failure shape is
 *  a list that outgrows a phone. */
function deckCards(
    rows: ReadonlyArray<[number, string, string]>
): { cardId: string; cardName: string }[] {
    return rows.flatMap(([n, cardId, cardName]) =>
        Array.from({ length: n }, () => ({ cardId, cardName }))
    );
}

function match(status: PublicMatch["status"], bestOf: 1 | 3): PublicMatch {
    return {
        matchId: "specimen-match" as unknown as Id<"matches">,
        bestOf,
        status,
        currentGameNumber: 2,
        playDrawChooserId: ME,
        solo: false,
        vsAi: false,
        players: [
            {
                id: ME,
                name: "You",
                bgColor: "#7f1d1d",
                score: 1,
                ready: false,
                deck: {
                    id: "specimen-deck",
                    name: "Mono Red Burn",
                    format: "freeform",
                    maindeck: deckCards([
                        [4, PRINT.bolt, "Lightning Bolt"],
                        [4, PRINT.goblin, "Mons's Goblin Raiders"],
                        [4, PRINT.hillGiant, "Hill Giant"],
                        [4, PRINT.mountain, "Mountain"],
                    ]),
                    sideboard: deckCards([
                        [3, PRINT.minotaur, "Hurloon Minotaur"],
                    ]),
                },
            },
            {
                id: OPP,
                name: "Rival",
                bgColor: "#1e3a8a",
                score: 1,
                ready: true,
            },
        ],
    };
}

const PENDING_TARGET: PendingTarget = {
    playerId: ME,
    cardInstanceId: "h1",
    targetType: "card",
    count: 1,
    selected: [],
    zone: "graveyard",
};

/* ── The specimen table ───────────────────────────────────────────────── */

type BoardDialogSpecimen = {
    /** Opener seam and `dlg-<slug>` surface id. */
    slug: string;
    label: string;
    /** Repo-relative module the census row is keyed on. */
    file: string;
    render: (close: () => void) => React.ReactNode;
};

const SPECIMENS: BoardDialogSpecimen[] = [
    {
        slug: "activatable-ability",
        label: "Activatable abilities (ActionSheet)",
        file: "board/activatable-ability-menu.tsx",
        render: (close) => (
            <ActivatableAbilityMenu
                abilities={[
                    { id: "a1", oracleText: "{T}: Add {R}." },
                    {
                        id: "a2",
                        oracleText:
                            "{2}{R}, {T}: This creature deals 1 damage to any target.",
                    },
                ]}
                onActivate={close}
                sheetOpen
                onSheetClose={close}
            >
                <span className="sr-only">specimen permanent</span>
            </ActivatableAbilityMenu>
        ),
    },
    {
        slug: "attack-all",
        label: "Attack with all",
        file: "board/attack-all-confirm-dialog.tsx",
        render: (close) => (
            <AttackAllConfirmDialog
                confirm={{
                    open: true,
                    eligibleCount: 5,
                    confirm: close,
                    cancel: close,
                }}
            />
        ),
    },
    {
        slug: "cast-alt-hand-cost",
        label: "Alternative cost",
        file: "board/cast-alternative-hand-cost-dialog.tsx",
        render: () => (
            <CastAlternativeHandCostDialog
                choice={{
                    action: "discard",
                    requirements: [{ filter: {}, count: 1 }],
                    excludeInstanceId: "h1",
                }}
                me={PLAYERS[0]}
                gameId={GAME_ID}
                playerId={ME}
            />
        ),
    },
    {
        slug: "cast-exile-cost",
        label: "Flashback cost",
        file: "board/cast-exile-cost-dialog.tsx",
        render: () => (
            <CastExileCostDialog
                choice={{
                    count: 2,
                    excludeInstanceId: "h1",
                    zone: "graveyard",
                }}
                me={PLAYERS[0]}
                gameId={GAME_ID}
                playerId={ME}
            />
        ),
    },
    {
        slug: "controller-phases",
        label: "Turn phases",
        file: "board/controller-phase-list.tsx",
        render: (close) => <ControllerPhaseList onClose={close} />,
    },
    {
        slug: "convoke",
        label: "Convoke",
        file: "board/convoke-creature-dialog.tsx",
        render: () => (
            <ConvokeCreatureDialog
                choice={{
                    min: 1,
                    max: 2,
                    hybridPips: [],
                    coloredPips: { R: 1 },
                }}
                me={PLAYERS[0]}
                gameId={GAME_ID}
                playerId={ME}
            />
        ),
    },
    {
        slug: "discard-cost",
        label: "Discard a card",
        file: "board/discard-cost-dialog.tsx",
        render: () => (
            <DiscardCostDialog
                choice={{ filter: {}, count: 1 }}
                me={PLAYERS[0]}
                gameId={GAME_ID}
                playerId={ME}
            />
        ),
    },
    {
        slug: "exile-cost",
        label: "Exile from a graveyard",
        file: "board/exile-cost-dialog.tsx",
        render: () => (
            <ExileCostDialog
                choice={{ count: 1 }}
                allPlayers={PLAYERS}
                gameId={GAME_ID}
                playerId={ME}
            />
        ),
    },
    {
        slug: "game-over",
        label: "Game Over",
        file: "board/game-over-dialog.tsx",
        render: () => (
            <GameOverDialog
                gameOver={{
                    winnerId: ME,
                    loserId: OPP,
                    reason: "life",
                }}
                allPlayers={PLAYERS}
                match={match("sideboarding", 3)}
                viewerId={ME}
            />
        ),
    },
    {
        slug: "graveyard-target",
        label: "Graveyard target picker",
        file: "board/graveyard-target-dialog.tsx",
        render: () => (
            <GraveyardTargetDialog
                pendingTarget={PENDING_TARGET}
                me={PLAYERS[0]}
                allPlayers={PLAYERS}
                gameId={GAME_ID}
                playerId={ME}
                activePlayerId={ME}
            />
        ),
    },
    {
        slug: "hand-card-actions",
        label: "Hand card actions (ActionSheet)",
        file: "board/hand-card-action-menu.tsx",
        render: (close) => (
            <HandCardActionMenu
                abilities={[
                    {
                        id: "cycling",
                        oracleText: "{2}, Discard this card: Draw a card.",
                    },
                ]}
                onActivate={close}
                primaryActions={[
                    { label: "Cast Lightning Bolt", onSelect: close },
                ]}
                sheetOpen
                onSheetClose={close}
            >
                <span className="sr-only">specimen hand card</span>
            </HandCardActionMenu>
        ),
    },
    {
        slug: "mana-choice",
        label: "Mana choice picker",
        file: "board/mana-choice-picker.tsx",
        render: (close) => (
            <ManaChoicePicker
                choices={[{ R: 1 }, { G: 1 }, { W: 1, U: 1 }]}
                sacrificeFlags={[false, false, true]}
                onSelect={close}
                onCancel={close}
            />
        ),
    },
    {
        slug: "mana-spend",
        label: "Choose mana to spend",
        file: "board/mana-spend-choice-dialog.tsx",
        render: () => (
            <ManaSpendChoiceDialog
                choice={{ generic: 1, candidateColors: ["R", "G"] }}
                container="cast"
                gameId={GAME_ID}
                playerId={ME}
            />
        ),
    },
    {
        slug: "manual-game-over",
        label: "Manual Game Over",
        file: "board/manual-game-over-dialog.tsx",
        render: () => (
            <ManualGameOverDialog
                players={[
                    { id: ME, name: "You" },
                    { id: OPP, name: "Rival" },
                ]}
                winnerId={ME}
                viewerId={ME}
                onSwitchGame={() => {}}
            />
        ),
    },
    {
        slug: "manual-verb",
        label: "Manual verb prompt",
        file: "board/manual-verb-popover.tsx",
        render: (close) => (
            <ManualVerbPopover
                pending={{
                    anchor: null,
                    nonce: 1,
                    request: {
                        kind: "number",
                        title: "Draw how many?",
                        defaultValue: 1,
                        min: 1,
                        onConfirm: () => {},
                    },
                }}
                onClose={close}
            />
        ),
    },
    {
        slug: "pause-menu",
        label: "Game Menu",
        file: "board/pause-menu-dialog.tsx",
        render: (close) => (
            <PauseMenuDialog
                open
                onOpenChange={(next) => {
                    if (!next) close();
                }}
                gameId={GAME_ID}
                playerId={ME}
                match={match("playing", 3)}
            />
        ),
    },
    {
        slug: "sideboarding",
        label: "Sideboarding",
        file: "board/sideboarding-dialog.tsx",
        render: () => (
            <SideboardingDialog
                match={match("sideboarding", 3)}
                viewerId={ME}
            />
        ),
    },
];

export function BoardDialogsSection() {
    const [open, setOpen] = useState<string | null>(null);
    // The REAL phase-stop state, not a stub: `ControllerPhaseList` renders one
    // toggle per phase out of it, so a stubbed value would measure a column of
    // dead rows. The hook is `localStorage`-backed and game-independent.
    const skipPrefs = useSkipPhasePrefsState();
    const close = () => setOpen(null);
    const mounted = SPECIMENS.find((s) => s.slug === open);

    return (
        <Section
            id="board-dialogs"
            index="16"
            title="Board dialogs"
            blurb={
                <>
                    Every overlay <code>src/components/board/**</code> paints
                    over a live game, mounted from fixture props so it can be
                    measured at all five viewports with no game running (issue
                    #4419). One at a time: each of these is a real portal
                    overlay at <code>position: fixed</code>, so mounting them
                    together would stack seventeen scrims and measure whichever
                    landed on top. <code>check:ui</code> walks one{" "}
                    <code>dlg-*</code> surface per opener.
                </>
            }
        >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {SPECIMENS.map((s) => (
                    <Specimen key={s.slug} label={s.label} tone="plain">
                        <button
                            type="button"
                            data-board-dialog-specimen={s.slug}
                            className="btn-base btn-tone-secondary w-full px-3 py-1.5 text-xs"
                            onClick={() => setOpen(s.slug)}
                        >
                            Open {s.label}
                        </button>
                        <Where>{s.file}</Where>
                    </Specimen>
                ))}
            </div>

            {/* The mounted specimen. Inside the provider unconditionally:
                three of these dialogs call `useGameContext()`, which throws
                without one, and a provider that only wrapped those three
                would be a per-dialog exception list to keep in step. */}
            <GameContext.Provider value={GAME_CONTEXT}>
                <SkipPhasePrefsContext.Provider value={skipPrefs}>
                    {mounted?.render(close)}
                </SkipPhasePrefsContext.Provider>
            </GameContext.Provider>
        </Section>
    );
}
