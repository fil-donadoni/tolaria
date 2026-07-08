// Activated-ability dispatch parity (PRD #249, issue #278). The spatial board's
// battlefield card (`BoardBattlefieldCard`, wired by `BoardBattlefield`)
// gains the same activated-ability affordance the classic board
// (`PlayerBattlefield` → `BattlefieldCard`) already has: a right-click context
// menu / touch action-sheet listing the permanent's activatable abilities, both
// driven by the shared `useBattlefieldInteraction` hook (`getActivatable` +
// `handleActivateAbility`) and the shared `ActivatableAbilityMenu`.
//
// These tests render each board's battlefield against identical mocked mutations
// + game context and compare the dispatched `activateAbility` / `tapUntap` args
// for:
//  (a) a plain stack ability                    → activateAbility(abilityId)
//  (b) an X ability (601.2b prompt)             → activateAbility(chosenX)
//  (c) a dual mana+stack card's mana entry      → tapUntap (mana ability)
//  (d) keep-priority via Ctrl/Cmd               → activateAbility(keepPriority)
// plus the CR 113.3c gating: an "any player may activate" ability is offered on
// an OPPONENT's permanent only while the viewer holds priority.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, within } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

// --- Mutation capture ---
type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const tapUntap = vi.fn<MutFn>(() => Promise.resolve());
const activateAbility = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());

const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    tapUntap,
    activateAbility,
};

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) => MUTATIONS[ref._name] ?? noop,
    useQuery: () => undefined,
}));

vi.mock("@convex/_generated/api", () => {
    const names = [
        "tapUntap",
        "tapForPayment",
        "untapForPayment",
        "tapForActivationPayment",
        "untapForActivationPayment",
        "toggleAttacker",
        "selectBlocker",
        "assignBlockerTarget",
        "selectTarget",
        "selectAdditionalCost",
        "selectActivationCost",
        "selectSacrifice",
        "activateAbility",
        "activateManaAbility",
    ];
    const game: Record<string, { _name: string }> = {};
    for (const n of names) game[n] = { _name: n };
    return { api: { game } };
});

// Card registry. STACK_DEF: a plain {T}: stack ability. X_DEF: an X-cost stack
// ability. DUAL_DEF: a mana ability ({T}: add C) AND a {3}: untap stack ability
// (Basalt Monolith shape). ANY_DEF: an "any player may activate" stack ability.
const STACK_DEF = {
    id: "stack-def",
    name: "Prodigal Sorcerer",
    activatedAbilities: [
        {
            id: "tim-ping",
            useStack: true,
            oracleText: "{T}: Prodigal Sorcerer deals 1 damage to any target.",
            cost: { tap: true },
        },
    ],
};
const X_DEF = {
    id: "x-def",
    name: "Rocket Launcher",
    activatedAbilities: [
        {
            id: "rl-x",
            useStack: true,
            oracleText: "{X}: deal X damage.",
            cost: { mana: { X: "X" } },
        },
    ],
};
const DUAL_DEF = {
    id: "dual-def",
    name: "Basalt Monolith",
    activatedAbilities: [
        {
            id: "bm-mana",
            useStack: false,
            manaProduced: { C: 3 },
            oracleText: "{T}: Add {C}{C}{C}.",
            cost: { tap: true },
        },
        {
            id: "bm-untap",
            useStack: true,
            oracleText: "{3}: Untap Basalt Monolith.",
            cost: { mana: { generic: 3 } },
        },
    ],
};
const ANY_DEF = {
    id: "any-def",
    name: "Ifh-Bíff Efreet",
    activatedAbilities: [
        {
            id: "ifh-fog",
            useStack: true,
            activatableByAnyPlayer: true,
            oracleText: "{G}: prevent combat damage.",
            cost: { mana: { G: 1 } },
        },
    ],
};
// MANA_COST_DEF: a mana ability whose cost includes MANA (Chromatic Star
// "{1}, {T}, Sacrifice: Add one mana of any color"). It must surface as an
// explicit menu entry — never a silent left-click tap — so the player pays the
// {1} (issue: the ability used to bypass the menu and open the picker directly).
const MANA_COST_DEF = {
    id: "mana-cost-def",
    name: "Chromatic Star",
    activatedAbilities: [
        {
            id: "cs-mana",
            useStack: false,
            oracleText:
                "{1}, {T}, Sacrifice this artifact: Add one mana of any color.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};
const DEFS: Record<string, unknown> = {
    "stack-def": STACK_DEF,
    "x-def": X_DEF,
    "dual-def": DUAL_DEF,
    "any-def": ANY_DEF,
    "mana-cost-def": MANA_COST_DEF,
};
vi.mock("@convex/cards", () => ({
    getDefinition: (id: string) => DEFS[id] ?? { id, name: id },
    tryGetDefinition: (id: string) => DEFS[id] ?? { id, name: id },
}));

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
    }),
}));

// Inert visuals.
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../card-tilt-3d", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../spatial-zone", () => ({
    default: ({
        items,
    }: {
        items: { key: string; node: React.ReactNode }[];
    }) => (
        <div data-testid="spatial-zone">
            {items.map((it) => (
                <div key={it.key}>{it.node}</div>
            ))}
        </div>
    ),
}));

import BoardBattlefield from "../board-battlefield";

function permanent(
    id: string,
    defId: string,
    overrides: Partial<CardInstance> = {}
): CardInstance {
    return {
        id,
        card: { id: defId },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        types: ["Artifact"],
        ...overrides,
    } as CardInstance;
}

function makePlayer(id: string, battlefield: CardInstance[]): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

function makeContext(
    players: Player[],
    overrides: Partial<React.ContextType<typeof GameContext>> = {}
): React.ContextType<typeof GameContext> {
    return {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: players,
        showAllCards: false,
        debugAllActions: false,
        ...overrides,
    } as React.ContextType<typeof GameContext>;
}

function renderSpatial(
    player: Player,
    players: Player[],
    ctx?: Partial<React.ContextType<typeof GameContext>>
) {
    return render(
        <GameContext value={makeContext(players, ctx)}>
            <BoardBattlefield player={player} />
        </GameContext>
    );
}

function clearAll() {
    for (const m of Object.values(MUTATIONS)) m.mockClear();
}

// The context menu opens on a LEFT click: the trigger synthesizes a
// `contextmenu` from the click (see ui/context-menu.tsx). A genuine right-click
// is reserved for the card preview and no longer opens the menu. Click the
// card, then click the menu item by its visible label.
function openMenuAndClick(
    root: HTMLElement,
    cardId: string,
    labelMatch: string,
    keepPriority = false
) {
    const trigger = root.querySelector<HTMLElement>(
        `[data-arrow-anchor-permanent="${cardId}"]`
    )!;
    fireEvent.click(trigger);
    // Mana symbols render as <img alt="{C}">, so an item's label is split
    // across text + image nodes. Match on the item container's textContent
    // (which includes the <img alt>) rather than a single text node.
    const menuItem = within(root.ownerDocument.body)
        .getAllByRole("menuitem")
        .find((el) => (el.textContent ?? "").includes(labelMatch))!;
    fireEvent.click(menuItem, {
        ctrlKey: keepPriority,
        metaKey: false,
    });
}

beforeEach(() => {
    clearAll();
    cleanup();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("board battlefield activated-ability parity with the classic board (#278)", () => {
    it("(a) a plain stack ability dispatches identical activateAbility args on both boards", () => {
        const me = makePlayer("me", [permanent("tim1", "stack-def")]);

        const { container } = renderSpatial(me, [me]);
        openMenuAndClick(container, "tim1", "deals 1 damage");
        const spatialArgs = activateAbility.mock.calls[0][0];

        expect(spatialArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "tim1",
            abilityId: "tim-ping",
        });
        expect(spatialArgs!.chosenX).toBeUndefined();
        expect(spatialArgs!.keepPriority).toBeUndefined();
    });

    it("(b) an X ability prompts and dispatches identical chosenX args on both boards", () => {
        vi.spyOn(window, "prompt").mockReturnValue("3");
        const me = makePlayer("me", [permanent("rl1", "x-def")]);

        const { container } = renderSpatial(me, [me]);
        openMenuAndClick(container, "rl1", "deal X damage");
        const spatialArgs = activateAbility.mock.calls[0][0];

        expect(spatialArgs).toMatchObject({
            cardInstanceId: "rl1",
            abilityId: "rl-x",
            chosenX: 3,
        });
    });

    it("(c) a dual mana+stack card's mana entry routes to tapUntap on both boards", () => {
        const me = makePlayer("me", [permanent("bm1", "dual-def")]);

        const { container } = renderSpatial(me, [me]);
        openMenuAndClick(container, "bm1", "Add");
        const spatialArgs = tapUntap.mock.calls[0][0];

        expect(spatialArgs).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "bm1",
        });
        // The mana entry must NOT go through the stack-ability mutation.
        expect(activateAbility).not.toHaveBeenCalled();
    });

    it("(d) the keep-priority modifier (Ctrl/Cmd) dispatches identically on both boards", () => {
        const me = makePlayer("me", [permanent("tim1", "stack-def")]);

        const { container } = renderSpatial(me, [me]);
        openMenuAndClick(container, "tim1", "deals 1 damage", true);
        const spatialArgs = activateAbility.mock.calls[0][0];

        expect(spatialArgs).toMatchObject({
            cardInstanceId: "tim1",
            abilityId: "tim-ping",
            keepPriority: true,
        });
    });

    it("(e) an 'any player may activate' ability is offered on an opponent permanent only while the viewer has priority", () => {
        // Opponent controls the Efreet; the viewer ("me") looks at the opponent
        // battlefield. Surface the ability only while the viewer holds priority.
        const opp = makePlayer("opp", [
            permanent("efreet1", "any-def", {
                controllerId: "opp",
                ownerId: "opp",
            }),
        ]);
        const me = makePlayer("me", []);

        // With priority on the viewer: ability offered → dispatch works.
        const withPriority = renderSpatial(opp, [me, opp], {
            priorityPlayerId: "me",
        });
        openMenuAndClick(withPriority.container, "efreet1", "prevent combat");
        expect(activateAbility).toHaveBeenCalledTimes(1);
        expect(activateAbility.mock.calls[0][0]).toMatchObject({
            cardInstanceId: "efreet1",
            abilityId: "ifh-fog",
        });

        clearAll();
        cleanup();

        // Without priority on the viewer: no ability surfaced → no context-menu
        // item to click, nothing dispatched.
        const noPriority = renderSpatial(opp, [me, opp], {
            priorityPlayerId: "opp",
        });
        const trigger = noPriority.container.querySelector<HTMLElement>(
            '[data-arrow-anchor-permanent="efreet1"]'
        )!;
        fireEvent.click(trigger);
        const items = within(document.body).queryAllByText((t) =>
            t.includes("prevent combat")
        );
        expect(items).toHaveLength(0);
        expect(activateAbility).not.toHaveBeenCalled();
    });

    it("(f) a touch tap on a single-ability permanent fires it immediately on both boards", () => {
        const me = makePlayer("me", [permanent("tim1", "stack-def")]);

        const tapCard = (root: HTMLElement) => {
            const el = root.querySelector<HTMLElement>(
                '[data-arrow-anchor-permanent="tim1"]'
            )!;
            // touchStart flags the next click as a touch tap; the click then
            // diverts to the single ability instead of the card's tap/pay.
            fireEvent.touchStart(el);
            fireEvent.click(el);
        };

        const { container } = renderSpatial(me, [me]);
        tapCard(container);
        const spatialArgs = activateAbility.mock.calls[0][0];

        expect(spatialArgs).toMatchObject({
            cardInstanceId: "tim1",
            abilityId: "tim-ping",
        });
        // keep-priority is unavailable on a touch tap (no modifier key).
        expect(spatialArgs!.keepPriority).toBeUndefined();
        expect(tapUntap).not.toHaveBeenCalled();
    });

    it("(g) a genuine right-click does NOT open the ability menu — it belongs to the preview; a left click does", () => {
        const me = makePlayer("me", [permanent("tim1", "stack-def")]);
        const { container } = renderSpatial(me, [me]);
        const trigger = container.querySelector<HTMLElement>(
            '[data-arrow-anchor-permanent="tim1"]'
        )!;

        // A raw `contextmenu` (right-click) is NOT the trigger's own synthesized
        // event, so it must be left to the preview — the menu stays closed.
        fireEvent.contextMenu(trigger);
        expect(within(document.body).queryAllByRole("menuitem")).toHaveLength(
            0
        );

        // A left click synthesizes the one contextmenu that opens the menu.
        fireEvent.click(trigger);
        expect(
            within(document.body).queryAllByRole("menuitem").length
        ).toBeGreaterThan(0);
    });

    it("(h) a mana ability with a {1} cost is surfaced as a menu entry (not a silent tap) and is not treated as a stack ability", () => {
        // Regression: Chromatic Star's "{1}, {T}, Sacrifice: Add any" used to
        // bypass the ability menu entirely — `getActivatable` returned [], so a
        // bare left click opened the colour picker and resolved the ability
        // without the player deciding to activate it or paying the {1}. It must
        // now appear as an explicit menu entry (CR 605.1a / 601.2f) so the
        // player chooses to activate it; the mana-ability flow then charges the
        // {1} server-side. It is never the stack-ability mutation.
        const me = makePlayer("me", [permanent("cs1", "mana-cost-def")]);
        const { container } = renderSpatial(me, [me]);

        // The menu opens on a left click and lists the cost-bearing ability.
        // Pre-fix the menu was empty (no entry), so this item was absent.
        const trigger = container.querySelector<HTMLElement>(
            '[data-arrow-anchor-permanent="cs1"]'
        )!;
        fireEvent.click(trigger);
        const item = within(document.body)
            .getAllByRole("menuitem")
            .find((el) =>
                (el.textContent ?? "").includes("Add one mana of any color")
            );
        expect(item).toBeDefined();

        // Selecting it must NOT dispatch the stack-ability mutation — it is a
        // mana ability, routed to the mana flow (colour picker → tapUntap).
        fireEvent.click(item!, { ctrlKey: false, metaKey: false });
        expect(activateAbility).not.toHaveBeenCalled();
    });
});
