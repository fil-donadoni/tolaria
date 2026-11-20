// Auto-Tap plans a RESTRICTED mana option when its restriction allows the
// object being paid for (CR 106.6, issue #9861): the REGISTERED
// `autoTapForPayment` handler over the stub `MutationCtx`, against real Eldrazi
// Temple / Mishra's Workshop definitions.
//
//   106.6  Some spells or abilities that produce mana restrict how that mana
//          can be spent, have an additional effect that affects the spell or
//          ability that mana is spent on, or create a delayed triggered
//          ability that triggers when that mana is spent.
//
// The castability gate (`getLegalActions`) already judged restricted options
// per spell; Auto-Tap's source builder dropped every one of them, so a cast the
// gate offered was left with a deficit. Both now read `restrictedManaMayPay`.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { preloadDefinitions, registerTokenDefinition } from "../cards";
import { forest } from "../cards/sets/lea/colorless.cards";
import { eldraziTemple } from "../cards/sets/roe/colorless.cards";
import { mishrasWorkshop } from "../cards/sets/atq/colorless.cards";
import type { CardDefinition } from "../cards/types";
import { autoTapForPayment } from "../game";
import { getLegalActions } from "../gre/rules";
import type { Id } from "../_generated/dataModel";
import type { CardInstanceState, GameState } from "../gre/state";
import type { Zone } from "../gre/types";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";

const GAME_ID = "game-1" as Id<"games">;

function def(card: Omit<CardDefinition, "rarity">): CardDefinition {
    const full = { rarity: "common", ...card } as CardDefinition;
    registerTokenDefinition(full);
    return full;
}

/** Sowing Mycospawn's mana shape: {3}{G}, Devoid — a colorless Eldrazi spell. */
const DEVOID_ELDRAZI = def({
    id: "test-9861-devoid-eldrazi",
    name: "test-9861-devoid-eldrazi",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Eldrazi", "Fungus"],
    staticAbilities: ["devoid"],
    power: 3,
    toughness: 3,
});

/** The same {3}{G} cost on a green, non-Eldrazi creature. */
const GREEN_BEAST = def({
    id: "test-9861-green-beast",
    name: "test-9861-green-beast",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 3,
    toughness: 3,
});

const ARTIFACT_TWO = def({
    id: "test-9861-artifact-two",
    name: "test-9861-artifact-two",
    manaCost: { X: 2 },
    types: ["Artifact"],
});

const NONARTIFACT_TWO = def({
    id: "test-9861-nonartifact-two",
    name: "test-9861-nonartifact-two",
    manaCost: { X: 2 },
    types: ["Enchantment"],
});

const PAID_ABILITY = {
    id: "test-9861-gain",
    oracleText: "{2}: You gain 1 life.",
    cost: { mana: { X: 2 } },
    useStack: true,
    effects: [{ op: "gainLife" as const, player: "controller", amount: 1 }],
};

/** A colorless Eldrazi permanent with a {2} activated ability. */
const ELDRAZI_ENGINE = def({
    id: "test-9861-eldrazi-engine",
    name: "test-9861-eldrazi-engine",
    manaCost: { X: 4 },
    types: ["Creature"],
    subtypes: ["Eldrazi"],
    power: 4,
    toughness: 4,
    activatedAbilities: [PAID_ABILITY],
} as Omit<CardDefinition, "rarity">);

/** The same ability on a green Beast — not a colorless Eldrazi. */
const BEAST_ENGINE = def({
    id: "test-9861-beast-engine",
    name: "test-9861-beast-engine",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 4,
    toughness: 4,
    activatedAbilities: [PAID_ABILITY],
} as Omit<CardDefinition, "rarity">);

preloadDefinitions([forest(), eldraziTemple(), mishrasWorkshop()]);

const mine = (defId: string, id: string, zone: Zone = "battlefield") =>
    makeInstance(defId, { id, controllerId: "p1", ownerId: "p1", zone });

const forestsAndTemple = () => [
    mine(forest().id, "forest1"),
    mine(forest().id, "forest2"),
    mine(eldraziTemple().id, "temple"),
];

function casting(
    spell: CardDefinition,
    battlefield: CardInstanceState[]
): GameState {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                hand: [mine(spell.id, "spell", "hand")],
                battlefield,
            }),
            makePlayer("p2"),
        ],
        pendingCast: {
            playerId: "p1",
            cardInstanceId: "spell",
            manaCost: { ...(spell.manaCost as Record<string, number>) },
            tappedLandIds: [],
        },
    });
}

function activating(
    engine: CardDefinition,
    battlefield: CardInstanceState[]
): GameState {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [mine(engine.id, "engine"), ...battlefield],
            }),
            makePlayer("p2"),
        ],
        pendingActivation: {
            playerId: "p1",
            cardInstanceId: "engine",
            abilityId: PAID_ABILITY.id,
            manaCost: { X: 2 },
            tappedLandIds: [],
            tapSource: false,
            sacrificeSource: false,
        },
    });
}

async function autoTap(state: GameState): Promise<GameState> {
    const h = makeMutationCtx("p1", [gameStateSeed(state, 1)]);
    await runMutation<{ gameId: Id<"games">; playerId: string }, unknown>(
        autoTapForPayment as unknown as Handler<never, never>,
        h.ctx,
        { gameId: GAME_ID, playerId: "p1" }
    );
    return h.state();
}

const tapped = (state: GameState): string[] =>
    state.players[0].battlefield
        .filter((c) => c.isTapped)
        .map((c) => c.id)
        .sort();

const onStack = (state: GameState): string[] =>
    state.stack.map((item) => item.id);

/** The castability gate's answer for the hand card, priority held, no cast
 *  in progress. */
function gateOffersCast(state: GameState): boolean {
    const idle = { ...state, pendingCast: undefined };
    const p1 = idle.players[0];
    return getLegalActions(idle, p1, p1.hand[0]).includes("cast");
}

describe("autoTapForPayment plans restricted mana the spell may spend (CR 106.6, issue #9861)", () => {
    it("pays a colorless Eldrazi {3}{G} with Forest, Forest and Eldrazi Temple's {C}{C}, and the cast commits", async () => {
        const after = await autoTap(
            casting(DEVOID_ELDRAZI, forestsAndTemple())
        );
        expect(tapped(after)).toEqual(["forest1", "forest2", "temple"]);
        expect(after.pendingCast).toBeUndefined();
        expect(onStack(after)).toContain("spell");
        expect(after.players[0].restrictedMana ?? []).toEqual([]);
    });

    it("never plans the Temple's {C}{C} for a non-Eldrazi {3}{G} spell, and the gate does not offer the cast", async () => {
        expect(gateOffersCast(casting(GREEN_BEAST, forestsAndTemple()))).toBe(
            false
        );
        // The gate agrees on the Eldrazi spell over the same board.
        expect(
            gateOffersCast(casting(DEVOID_ELDRAZI, forestsAndTemple()))
        ).toBe(true);

        const after = await autoTap(casting(GREEN_BEAST, forestsAndTemple()));
        expect(after.pendingCast).toBeDefined();
        expect(after.players[0].restrictedMana ?? []).toEqual([]);
        const temple = after.players[0].battlefield.find(
            (c) => c.id === "temple"
        );
        // Tapped (if at all) for its unrestricted {C}, never for {C}{C}.
        expect(temple?.chosenMana?.C ?? 0).toBeLessThanOrEqual(1);
    });

    it("plans Mishra's Workshop for an artifact spell, and leaves its leftover restricted", async () => {
        const after = await autoTap(
            casting(ARTIFACT_TWO, [mine(mishrasWorkshop().id, "workshop")])
        );
        expect(tapped(after)).toEqual(["workshop"]);
        expect(after.pendingCast).toBeUndefined();
        expect(onStack(after)).toContain("spell");
        // CR 106.6 — the unspent {C} keeps its restriction; nothing floats free.
        expect(after.players[0].manaPool.C ?? 0).toBe(0);
        expect(after.players[0].restrictedMana).toEqual([
            expect.objectContaining({
                color: "C",
                amount: 1,
                restriction: "artifact-spell",
            }),
        ]);
    });

    it("never plans Mishra's Workshop for a non-artifact spell", async () => {
        const after = await autoTap(
            casting(NONARTIFACT_TWO, [mine(mishrasWorkshop().id, "workshop")])
        );
        expect(tapped(after)).toEqual([]);
        expect(after.pendingCast).toBeDefined();
    });
});

describe("autoTapForPayment plans restricted mana the activation may spend (CR 106.6, issue #9861)", () => {
    it("pays a colorless Eldrazi's {2} ability with Eldrazi Temple's {C}{C}", async () => {
        const after = await autoTap(
            activating(ELDRAZI_ENGINE, [mine(eldraziTemple().id, "temple")])
        );
        expect(tapped(after)).toEqual(["temple"]);
        expect(after.pendingActivation).toBeUndefined();
        expect(after.stack).toHaveLength(1);
    });

    it("never plans the Temple's {C}{C} for a non-Eldrazi source's ability", async () => {
        const after = await autoTap(
            activating(BEAST_ENGINE, [mine(eldraziTemple().id, "temple")])
        );
        expect(after.pendingActivation).toBeDefined();
        expect(after.players[0].restrictedMana ?? []).toEqual([]);
    });
});
