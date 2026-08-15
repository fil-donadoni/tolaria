// Sacrifice-only (tap-less) FIXED-output mana abilities — CR 605.1a / 302.6,
// issue #2021.
//
// "Sacrifice this creature: Add {R}{R}." (Tinder Wall) is a mana ability whose
// whole cost is the sacrifice: no {T} anywhere. Before this fix neither
// activation route handled it — `tapUntap`/`tapSourceIntoPayment` resolved the
// produced mana through `getActivatedManaColor`, which matches only a
// `cost.tap` ability, and `activateManaAbility` rejects `cost.sacrifice`
// outright — so the source was sacrificed for ZERO mana (or, on the payment
// path, rejected with "Card does not produce mana"). Nine catalogue abilities
// are this shape, plus the Eldrazi Spawn token.
//
// Driven through the REAL entry point (`tapSourceIntoPayment`, the exported
// primitive the tap mutations share) rather than a hand-rolled state edit —
// there is no convex-test harness in this repo, and the whole bug lived in
// that function's branch selection.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { tapSourceIntoPayment } from "../../game";
import { getCardByName } from "../../cards";
import { createTokenPermanents } from "../state";
import { ELDRAZI_SPAWN_TOKEN } from "../../cards/sharedTokens";
import type { TokenSpec } from "../../cards/types";
import type { GameState, PlayerState } from "../state";

/** One permanent of `cardName` on p1's battlefield, p1 active. */
function boardWith(
    cardName: string,
    overrides: Record<string, unknown> = {},
    manaPool: Record<string, number> = {}
): { state: GameState; player: PlayerState; id: string } {
    const card = makeInstance(getCardByName(cardName).id, {
        id: "source",
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
        ...overrides,
    });
    const player = makePlayer("p1", { battlefield: [card] });
    player.manaPool = { ...player.manaPool, ...manaPool };
    const state = makeState({ players: [player, makePlayer("p2")] });
    state.activePlayerId = "p1";
    return { state, player, id: "source" };
}

describe("fixed-output sacrifice mana abilities (CR 605.1a, issue #2021)", () => {
    it("Tinder Wall adds {R}{R} and goes to the graveyard", () => {
        const { state, player, id } = boardWith("Tinder Wall");
        const wall = player.battlefield.find((c) => c.id === id)!;

        tapSourceIntoPayment(state, player, wall, undefined, []);

        expect(player.manaPool.R).toBe(2);
        expect(player.battlefield.find((c) => c.id === id)).toBeUndefined();
        expect(player.graveyard.find((c) => c.id === id)).toBeDefined();
    });

    it("Gaea's Touch (an enchantment, so never summoning sick) adds {G}{G}", () => {
        const { state, player, id } = boardWith("Gaea's Touch");
        const touch = player.battlefield.find((c) => c.id === id)!;

        tapSourceIntoPayment(state, player, touch, undefined, []);

        expect(player.manaPool.G).toBe(2);
        expect(player.graveyard.find((c) => c.id === id)).toBeDefined();
    });

    it("Crosis's Attendant pays its {1} and adds all THREE colours", () => {
        // The multi-colour half of the bug: `getActivatedManaColor` returns a
        // single `Color` and answers null for {U}{B}{R} even when it matches,
        // so the old fixed branch could not have produced this output at all.
        const { state, player, id } = boardWith(
            "Crosis's Attendant",
            {},
            { W: 1 }
        );
        const golem = player.battlefield.find((c) => c.id === id)!;

        tapSourceIntoPayment(state, player, golem, undefined, []);

        expect(player.manaPool.U).toBe(1);
        expect(player.manaPool.B).toBe(1);
        expect(player.manaPool.R).toBe(1);
        // The {1} generic leg was paid out of the floating {W}.
        expect(player.manaPool.W ?? 0).toBe(0);
        expect(player.battlefield.find((c) => c.id === id)).toBeUndefined();
    });

    it("Morgue Toad adds {U}{R}", () => {
        const { state, player, id } = boardWith("Morgue Toad");
        const toad = player.battlefield.find((c) => c.id === id)!;

        tapSourceIntoPayment(state, player, toad, undefined, []);

        expect(player.manaPool.U).toBe(1);
        expect(player.manaPool.R).toBe(1);
    });

    it("an unaffordable mana leg throws with the source still on the battlefield", () => {
        // CR 601.2f — the cost is paid before any source mutation, so a failed
        // activation must not eat the permanent.
        const { state, player, id } = boardWith("Crosis's Attendant");
        const golem = player.battlefield.find((c) => c.id === id)!;

        expect(() =>
            tapSourceIntoPayment(state, player, golem, undefined, [])
        ).toThrow();
        expect(player.battlefield.find((c) => c.id === id)).toBeDefined();
        expect(player.manaPool.U ?? 0).toBe(0);
    });
});

describe("summoning sickness and a tap-less cost (CR 302.6, issue #2021)", () => {
    it("a summoning-sick Tinder Wall still adds {R}{R}", () => {
        // CR 302.6 gates an ability whose cost contains the tap or untap
        // symbol. This one contains neither.
        const { state, player, id } = boardWith("Tinder Wall", {
            isSummoningSick: true,
        });
        const wall = player.battlefield.find((c) => c.id === id)!;

        tapSourceIntoPayment(state, player, wall, undefined, []);

        expect(player.manaPool.R).toBe(2);
    });

    it("a summoning-sick {T} mana creature is still rejected", () => {
        // The narrowing must not become a hole: Llanowar Elves' cost DOES
        // contain {T}.
        const { state, player, id } = boardWith("Llanowar Elves", {
            isSummoningSick: true,
        });
        const elves = player.battlefield.find((c) => c.id === id)!;

        expect(() =>
            tapSourceIntoPayment(state, player, elves, undefined, [])
        ).toThrow("Creature has summoning sickness");
    });

    it("the Eldrazi Spawn token adds {C} the turn it is created", () => {
        // The reported symptom: a token created by Malevolent Rumble is
        // summoning sick for its whole first turn, which is the turn a player
        // sacrifices it to ramp.
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        const player = state.players[0];
        // `EffectTokenSpec` differs from `TokenSpec` only in the JSON-pure
        // `triggeredAbilities` descriptor shape the interpreter converts
        // (CR 707.2, issue #2364); this spec declares none, so the cast is
        // exactly what the DSL `createToken` Op hands the engine.
        const [id] = createTokenPermanents(
            state,
            ELDRAZI_SPAWN_TOKEN as TokenSpec,
            "p1"
        );
        const token = player.battlefield.find((c) => c.id === id)!;
        expect(token.isSummoningSick).toBe(true);

        tapSourceIntoPayment(state, player, token, undefined, []);

        expect(player.manaPool.C).toBe(1);
        expect(player.battlefield.find((c) => c.id === id)).toBeUndefined();
    });
});

describe("the choice-based sacrifice ability is untouched (CR 605.1a)", () => {
    it("Lion's Eye Diamond still resolves through the choice branch", () => {
        // LED's cost is sacrifice-only too, but it declares `manaChoices`, so
        // it belongs on the unified choice branch — the new fixed-sacrifice
        // path deliberately does not claim it (it would ignore the index).
        const { state, player, id } = boardWith("Lion's Eye Diamond");
        const led = player.battlefield.find((c) => c.id === id)!;

        tapSourceIntoPayment(state, player, led, 2, []); // index 2 = {B}

        expect(player.manaPool.B).toBe(3);
        expect(player.graveyard.find((c) => c.id === id)).toBeDefined();
    });
});
