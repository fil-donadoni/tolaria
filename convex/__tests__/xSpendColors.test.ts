// "Spend only [colour(s)] mana on X." — `ManaCost.xSpendColors` (CR 107.3a /
// CR 601.2h, issue #3811, which closes the #1330 class).
//
// X is announced before payment (CR 107.3a), so by the time the cost is paid
// (CR 601.2h) the restriction is a fixed per-pip constraint on the announced n
// mana. `normalizeManaCost` therefore owes the X as coloured pips (one colour)
// or guild-hybrid pips (two colours) instead of generic, and every payment
// consumer — pool coverage, auto-tap, the castability ceiling — inherits it.
//
//  1. **Unit** — the normalized shape, the X ceiling (`maxAffordableX`, shared
//     by the target-legality gate and the Bot's X enumeration), card colour.
//  2. **Auto-tap** — the planner picks permitted-colour sources for X.
//  3. **Full path** — Drain Life driven through the registered `announceCast` /
//     `selectTargets` mutations: an X the pool can pay only with red parks on
//     mana, an X paid with black reaches the stack and resolves for X.

import { describe, it, expect } from "vitest";
import { normalizeManaCost, isManaCostCovered } from "../gre/state";
import { resolveTopOfStack, getPlayer, type GameState } from "../gre/state";
import { maxAffordableX } from "../gre/rules";
import { buildAutoTapSources, solveAutoTap } from "../gre/autoTap";
import { getColorsFromCost } from "../cards/colors";
import { drainLife } from "../cards/sets/lea/black";
import { soulBurn } from "../cards/sets/ice/black";
import { swamp, mountain } from "../cards/sets/lea/colorless";
import { announceCast, selectTargets } from "../game";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import type { Id } from "../_generated/dataModel";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "./gameMutationHarness";

const POOL0 = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

function withSpell(
    spellId: string,
    pool: Partial<typeof POOL0>,
    lands: { id: string; def: string }[] = []
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(spellId, {
                        id: "spell",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: lands.map((l) =>
                    makeInstance(l.def, {
                        id: l.id,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    })
                ),
                manaPool: { ...POOL0, ...pool },
            }),
            makePlayer("p2"),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

describe("normalizeManaCost owes a restricted X as coloured pips (CR 107.3a / 601.2h)", () => {
    it("one permitted colour → n pips of that colour, the fixed generic untouched", () => {
        expect(normalizeManaCost(drainLife.manaCost!, { chosenX: 3 })).toEqual({
            B: 4,
            X: 1,
        });
    });

    it("two permitted colours → n guild-hybrid pips under the composite key", () => {
        expect(normalizeManaCost(soulBurn.manaCost!, { chosenX: 2 })).toEqual({
            B: 1,
            "B/R": 2,
            X: 2,
        });
    });

    it("X = 0 owes nothing extra", () => {
        expect(normalizeManaCost(drainLife.manaCost!)).toEqual({ B: 1, X: 1 });
    });

    it("refuses three colours rather than folding X back to generic", () => {
        expect(() =>
            normalizeManaCost(
                { X: "X", xSpendColors: ["B", "R", "G"] },
                { chosenX: 1 }
            )
        ).toThrow(/one or two colours/);
    });

    it("a non-permitted colour cannot pay X; a permitted one can (Soul Burn: any B/R mix)", () => {
        const cost = normalizeManaCost(soulBurn.manaCost!, { chosenX: 2 });
        // {2}{B} fixed + X=2: 5 mana. Green pays the generic, never the X.
        expect(isManaCostCovered({ B: 1, G: 4 }, cost)).toBe(false);
        expect(isManaCostCovered({ B: 1, G: 2, R: 2 }, cost)).toBe(true);
        expect(isManaCostCovered({ B: 2, G: 2, R: 1 }, cost)).toBe(true);
    });

    it("a CR 609.4b substitution still reaches the restricted pips", () => {
        const cost = normalizeManaCost(drainLife.manaCost!, { chosenX: 1 });
        const whiteAsBlack = [{ from: "W", to: "B" }];
        expect(isManaCostCovered({ B: 1, W: 2 }, cost)).toBe(false);
        expect(isManaCostCovered({ B: 1, W: 2 }, cost, whiteAsBlack)).toBe(
            true
        );
    });
});

describe("maxAffordableX counts only permitted colours toward X (CR 107.3a)", () => {
    it("Drain Life with {B}{B}{B}{R}{R} available → 2, not 4", () => {
        const state = withSpell(drainLife.id, { B: 3, R: 2 });
        const p1 = getPlayer(state, "p1");
        expect(maxAffordableX(p1, p1.hand[0], state)).toBe(2);
    });

    it("Soul Burn counts red as well as black toward X", () => {
        const state = withSpell(soulBurn.id, { B: 2, R: 2, G: 2 });
        const p1 = getPlayer(state, "p1");
        // {2}{B} fixed: B pays {B}, G G the {2}; X from the B + R R left → 3.
        expect(maxAffordableX(p1, p1.hand[0], state)).toBe(3);
    });
});

describe("card colour ignores the restriction (CR 105.2 — rules text, not a mana symbol)", () => {
    it("Drain Life and Soul Burn stay mono-black", () => {
        expect(getColorsFromCost(drainLife.manaCost)).toEqual(["B"]);
        expect(getColorsFromCost(soulBurn.manaCost)).toEqual(["B"]);
    });
});

describe("auto-tap pays a restricted X from permitted-colour sources", () => {
    it("taps the three Swamps and one Mountain for Drain Life X = 2", () => {
        const lands = [
            { id: "m1", def: mountain.id },
            { id: "m2", def: mountain.id },
            { id: "s1", def: swamp.id },
            { id: "s2", def: swamp.id },
            { id: "s3", def: swamp.id },
        ];
        const state = withSpell(drainLife.id, {}, lands);
        const p1 = getPlayer(state, "p1");
        const cost = normalizeManaCost(drainLife.manaCost!, { chosenX: 2 });
        const plan = solveAutoTap(
            p1.manaPool,
            cost,
            [],
            buildAutoTapSources(p1.battlefield)
        );
        expect(plan).not.toBeNull();
        const tapped = plan!.map((s) => s.cardId).sort();
        expect(tapped.filter((id) => id.startsWith("s"))).toHaveLength(3);
        expect(tapped.filter((id) => id.startsWith("m"))).toHaveLength(1);
    });
});

describe("Drain Life full path — X paid with the wrong colour is refused server-side", () => {
    const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };
    async function cast(pool: Partial<typeof POOL0>) {
        const harness = makeMutationCtx("p1", [
            gameStateSeed(withSpell(drainLife.id, pool)),
        ]);
        await runMutation(
            announceCast as unknown as Handler<Record<string, unknown>, void>,
            harness.ctx,
            { ...BASE, cardInstanceId: "spell", chosenX: 2 }
        );
        await runMutation(
            selectTargets as unknown as Handler<Record<string, unknown>, void>,
            harness.ctx,
            { ...BASE, targets: [{ targetType: "player", targetId: "p2" }] }
        );
        return harness.state();
    }

    it("{B}{R}{R}{R} cannot pay {X=2}{1}{B}: the cast parks owing {B}{B}{B}", async () => {
        const state = await cast({ B: 1, R: 3 });
        expect(state.stack).toHaveLength(0);
        expect(state.pendingCast?.manaCost).toMatchObject({ B: 3, X: 1 });
    });

    it("{B}{B}{B}{R} pays it: the spell resolves for X = 2", async () => {
        const state = await cast({ B: 3, R: 1 });
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].chosenX).toBe(2);
        resolveTopOfStack(state);
        expect(getPlayer(state, "p2").life).toBe(18);
        expect(getPlayer(state, "p1").life).toBe(22);
    });
});
