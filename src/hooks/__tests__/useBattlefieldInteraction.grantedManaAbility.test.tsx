// Issue #1880 — the board's CLICK HANDLER must resolve a GRANTED mana ability
// (CR 113.1 / 611.2a), not just OFFER it.
//
// `src/lib/__tests__/granted-mana-ability.wire.test.ts` covers what the menu
// offers (`getActivatedManaMenuEntry` & friends). That is only half the seam:
// `getActivatable` surfacing a granted ability id is useless if
// `handleActivateAbility` then resolves that id against the PRINTED
// `getDefinition(card.card.id).activatedAbilities` — the granted id never
// matches, the `!ability.useStack` mana routing is skipped, and the click
// dispatches `activateAbility`, which throws "Use tapUntap for mana abilities"
// server-side (`activateAbilityOnState`, convex/game.ts).
//
// So every assertion here is on the DISPATCHED ACTION, driven through the REAL
// `useBattlefieldInteraction` reducer, on a board built by
// `projectPublicState` (a hand-built instance would mask a wire-dropped field:
// `grantedActivatedAbilities` rides across only because `slimCard` spreads the
// instance).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const tapUntap = vi.fn<MutFn>(() => Promise.resolve());
const activateAbility = vi.fn<MutFn>(() => Promise.resolve());
const activateManaAbility = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());
const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    tapUntap,
    activateAbility,
    activateManaAbility,
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
        "tapArtifactForImprovise",
        "untapArtifactForImprovise",
        "tapForAttackTax",
        "untapForAttackTax",
        "toggleAttacker",
        "selectBlocker",
        "assignBlockerTarget",
        "selectTarget",
        "selectAdditionalCost",
        "selectActivationCost",
        "selectSacrifice",
        "activateAbility",
        "activateManaAbility",
        "getFullState",
    ];
    const game: Record<string, { _name: string }> = {};
    for (const n of names) game[n] = { _name: n };
    return { api: { game } };
});

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
        reportError: vi.fn(),
        dismissError: vi.fn(),
    }),
}));

// NOTE: `@convex/cards` is deliberately NOT mocked — this test needs the REAL
// registry so `getEffectiveActivatedAbilities` resolves the grant templates.
import { registerTokenDefinition } from "@convex/cards";
import type { ActivatedAbility } from "@convex/cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { useBattlefieldInteraction } from "../useBattlefieldInteraction";

// Ids distinct from the sibling suites: vitest may reuse a worker and the card
// registry is process-wide.
const FIXED_ID = "hook-1880-add-c";
/** A free tap-for-mana grant (Urza's Saga chapter-I shape). */
const FIXED_TEMPLATE: ActivatedAbility = {
    id: FIXED_ID,
    oracleText: "{T}: Add {C}.",
    cost: { tap: true },
    useStack: false,
    manaProduced: { C: 1 },
};

const COSTED_ID = "hook-1880-pay-1-add-w";
/** CR 601.2f / 605.3c (issue #1179) — a mana ability whose cost includes MANA
 *  must never be a silent left-click tap-for-mana. */
const COSTED_TEMPLATE: ActivatedAbility = {
    id: COSTED_ID,
    oracleText: "{1}, {T}: Add {W}.",
    cost: { tap: true, mana: { X: 1 } },
    useStack: false,
    manaProduced: { W: 1 },
};

const GRANTER_ID = "hook-1880-granter";
registerTokenDefinition({
    id: GRANTER_ID,
    name: "Test Hook Mana Granter",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Sorcery"],
    grantTemplates: [FIXED_TEMPLATE, COSTED_TEMPLATE],
});

const PUMP_ID = "hook-1880-pump";
/** A recipient that ALSO carries a printed STACK ability — the only shape in
 *  which `getActivatable` returns the plain mana toggle as a menu entry
 *  (`stack.length > 0`), which is exactly the reachable path for finding 1. */
const HOST_WITH_STACK_ID = "hook-1880-host-with-stack";
registerTokenDefinition({
    id: HOST_WITH_STACK_ID,
    name: "Test Hook Host With Stack Ability",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: PUMP_ID,
            oracleText: "{1}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
        },
    ],
});

/** A vanilla recipient: no printed ability at all, so a granted cost-bearing
 *  mana ability is its ONLY ability — the fall-through-to-left-click shape. */
const VANILLA_ID = "hook-1880-vanilla";
registerTokenDefinition({
    id: VANILLA_ID,
    name: "Test Hook Vanilla Recipient",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});

const fixedGrant = [{ sourceCardId: GRANTER_ID, abilityId: FIXED_ID }];
const costedGrant = [{ sourceCardId: GRANTER_ID, abilityId: COSTED_ID }];

/** Builds a one-permanent board and returns it AS THE CLIENT SEES IT — through
 *  `projectPublicState`. */
function projectedBoard(
    cardId: string,
    grants: { sourceCardId: string; abilityId: string }[]
): { card: CardInstance; me: Player } {
    const instance = makeInstance(cardId, {
        id: "granted-source",
        controllerId: "me",
        ownerId: "me",
        isSummoningSick: false,
        grantedActivatedAbilities: grants,
    });
    const state = makeState({
        players: [
            makePlayer("me", { battlefield: [instance] }),
            makePlayer("them"),
        ],
        activePlayerId: "me",
        priorityPlayerId: "me",
    });
    const wire = projectPublicState(state, 1, "me");
    const me = wire.players[0] as unknown as Player;
    const card = me.battlefield.find(
        (c) => c.id === "granted-source"
    ) as CardInstance;
    return { card, me };
}

type Interaction = ReturnType<typeof useBattlefieldInteraction>;

function renderInteraction(me: Player) {
    const ctx = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [me],
        showAllCards: false,
        debugAllActions: false,
    } as unknown as NonNullable<React.ContextType<typeof GameContext>>;

    const handle: { current: Interaction | null } = { current: null };
    function Harness() {
        handle.current = useBattlefieldInteraction(me);
        return <>{handle.current.overlays}</>;
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    const utils = render(<Harness />, { wrapper });
    return { ...utils, handle };
}

describe("useBattlefieldInteraction — granted mana abilities reach the CLICK handler (issue #1880)", () => {
    beforeEach(() => {
        tapUntap.mockClear();
        activateAbility.mockClear();
        activateManaAbility.mockClear();
        cleanup();
    });

    it("clicking the granted {T}: Add {C} entry on a permanent that also has a stack ability routes to tapUntap, never activateAbility", () => {
        const { card, me } = projectedBoard(HOST_WITH_STACK_ID, fixedGrant);
        const { handle } = renderInteraction(me);

        // Precondition (the reachable shape): both the granted mana toggle and
        // the printed stack ability are offered.
        const offered = handle.current!.getActivatable(card).map((a) => a.id);
        expect(offered).toContain(FIXED_ID);
        expect(offered).toContain(PUMP_ID);

        act(() => {
            handle.current!.handleActivateAbility(card.id, FIXED_ID, false);
        });

        // CR 605.3a — a mana ability never uses the stack: the click must go to
        // the tap flow. `activateAbility` would throw "Use tapUntap for mana
        // abilities" server-side.
        expect(tapUntap).toHaveBeenCalledTimes(1);
        expect(tapUntap).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "granted-source",
        });
        expect(activateAbility).not.toHaveBeenCalled();
    });

    it("a granted COST-BEARING mana ability gets an explicit menu entry, so the permanent is never reachable by the silent left-click tap", () => {
        const { card, me } = projectedBoard(VANILLA_ID, costedGrant);
        const { handle } = renderInteraction(me);

        const entries = handle.current!.getActivatable(card);
        // CR 601.2f / 605.3c (issue #1179): the {1} must be a deliberate
        // choice, so the ability is surfaced explicitly.
        expect(entries).toEqual([
            { id: COSTED_ID, oracleText: "{1}, {T}: Add {W}." },
        ]);
        // ...and THAT is what keeps the plain tap path away from it:
        // `BoardBattlefieldCard` / `BattlefieldCard` bind their own tap/pay
        // `onClick` only when the permanent has NO activatable abilities
        // (`useAbilityCardClick` — "the card's own tap/pay is intentionally
        // NOT bound here"). With an empty list the click would fall through to
        // `handleClick` → `tapUntap`, silently charging the {1}.
        expect(entries.length > 0).toBe(true);
    });

    it("clicking that granted cost-bearing entry routes to the mana flow, never activateAbility", () => {
        const { card, me } = projectedBoard(VANILLA_ID, costedGrant);
        const { handle } = renderInteraction(me);

        act(() => {
            handle.current!.handleActivateAbility(card.id, COSTED_ID, false);
        });

        expect(tapUntap).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "granted-source",
        });
        expect(activateAbility).not.toHaveBeenCalled();
    });

    it("the ungranted control offers nothing and dispatches nothing", () => {
        const { card, me } = projectedBoard(VANILLA_ID, []);
        const { handle } = renderInteraction(me);

        expect(handle.current!.getActivatable(card)).toEqual([]);
        expect(tapUntap).not.toHaveBeenCalled();
        expect(activateAbility).not.toHaveBeenCalled();
    });
});
