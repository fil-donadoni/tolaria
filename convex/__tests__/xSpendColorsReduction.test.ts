// A generic reduction or delve reaching a colour-restricted {X}
// (`ManaCost.xSpendColors`, CR 107.4b / 601.2f / 601.2h / 702.66a). Every cast
// here goes through the registered `announceCast` / `selectTargets` mutations, so
// the cost asserted is the one the server actually parks or charges.

import { describe, it, expect } from "vitest";
import {
    withTemporaryDefinition,
    withTemporaryDefinitionAsync,
} from "../cards";
import type { CardDefinition } from "../cards/types";
import { stoneCalendar } from "../cards/sets/drk/colorless.cards";
import { soulBurn } from "../cards/sets/ice/black.cards";
import { drainLife } from "../cards/sets/lea/black.cards";
import { swamp } from "../cards/sets/lea/colorless.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { announceCast, selectRestrictedXSplit, selectTargets } from "../game";
import { projectPublicState } from "../gameProjections";
import { maxAffordableX } from "../gre/rules";
import { nextOwedPayment } from "../gre/owedPayment";
import {
    getPlayer,
    isPrintedManaCostOnly,
    resolveTopOfStack,
    type GameState,
} from "../gre/state";
import { compactState, expandState } from "../gre/serialize";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";

const POOL0 = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };

type Setup = {
    spellId: string;
    pool?: Partial<typeof POOL0>;
    /** Stone Calendars on the battlefield: each is a {1} generic reduction. */
    reducers?: number;
    swamps?: number;
    graveyard?: number;
};

function board({
    spellId,
    pool = {},
    reducers = 0,
    swamps = 0,
    graveyard = 0,
}: Setup): GameState {
    const permanents = [
        ...Array.from({ length: reducers }, (_, i) =>
            makeInstance(stoneCalendar().id, {
                id: `calendar-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            })
        ),
        ...Array.from({ length: swamps }, (_, i) =>
            makeInstance(swamp().id, {
                id: `swamp-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            })
        ),
    ];
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
                battlefield: permanents,
                graveyard: Array.from({ length: graveyard }, (_, i) =>
                    makeInstance(swamp().id, {
                        id: `dead-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "graveyard",
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

async function cast(setup: Setup, chosenX: number) {
    const harness = makeMutationCtx("p1", [gameStateSeed(board(setup))]);
    await runMutation(
        announceCast as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        { ...BASE, cardInstanceId: "spell", chosenX }
    );
    await runMutation(
        selectTargets as unknown as Handler<Record<string, unknown>, void>,
        harness.ctx,
        { ...BASE, targets: [{ targetType: "player", targetId: "p2" }] }
    );
    return harness;
}

async function answerSplit(
    harness: Awaited<ReturnType<typeof cast>>,
    pointsOnX: number
) {
    await runMutation(
        selectRestrictedXSplit as unknown as Handler<
            Record<string, unknown>,
            void
        >,
        harness.ctx,
        { ...BASE, pointsOnX }
    );
    return harness.state();
}

/** Drain Life's cost and text, but reading the mana spent on it: the shape that
 *  makes the caster's split a real decision. */
function drainLifeNotingMana(): CardDefinition {
    return { ...drainLife(), noteManaSpent: true };
}

/** "Consume Spirit-shaped X" with delve. */
function drainLifeWithDelve(): CardDefinition {
    return { ...drainLife(), staticAbilities: ["delve"] };
}

describe("a generic reduction reaches a restricted X (CR 107.4b / 601.2f)", () => {
    it("Drain Life X=3 under {2}: X first by default, charging {1}{B}{B}", async () => {
        const harness = await cast(
            { spellId: drainLife().id, reducers: 2, pool: { B: 1 } },
            3
        );
        expect(harness.state().pendingCast?.manaCost).toEqual({
            B: 1,
            "X/B": 1,
            X: 1,
        });
    });

    it("with the fixed generic reduced first the same cast charges {B}{B}{B}", async () => {
        const noting = drainLifeNotingMana();
        await withTemporaryDefinitionAsync(noting, async () => {
            const harness = await cast(
                { spellId: noting.id, reducers: 2, pool: { B: 3 } },
                3
            );
            expect(
                harness.state().pendingCast?.restrictedXSplitChoice?.options
            ).toEqual([0, 1]);
            const before = structuredClone(harness.state().pendingCast);
            expect(before?.manaCost).toEqual({ B: 1, "X/B": 1, X: 1 });
            const after = await answerSplit(harness, 1);
            // Paid straight off the pool: three black spent, nothing floating.
            expect(after.stack).toHaveLength(1);
            expect(getPlayer(after, "p1").manaPool.B).toBe(0);
        });
    });

    it("an excess reduction is not lost: {2} covers all of Drain Life X=1", async () => {
        const harness = await cast(
            { spellId: drainLife().id, reducers: 2, pool: { B: 1 } },
            1
        );
        expect(harness.state().stack).toHaveLength(1);
        expect(getPlayer(harness.state(), "p1").manaPool.B).toBe(0);
    });
});

describe("the caster's split on a spell reading mana spent on X (CR 601.2f)", () => {
    const setup = { spellId: soulBurn().id, reducers: 2, pool: { B: 4 } };

    it("both splits affordable: prompted, and nothing is paid before the answer", async () => {
        const harness = await cast(setup, 3);
        const state = harness.state();
        expect(state.stack).toHaveLength(0);
        expect(state.pendingCast?.restrictedXSplitChoice?.options).toEqual([
            0, 1, 2,
        ]);
        expect(nextOwedPayment(state, "p1")?.kind).toBe(
            "cast:restrictedXSplitChoice"
        );
        expect(getPlayer(state, "p1").manaPool.B).toBe(4);
    });

    it("the prompt reaches the client through the projection", async () => {
        const harness = await cast(setup, 3);
        const projected = projectPublicState(harness.state(), 1, "p1");
        expect(projected.pendingCast?.restrictedXSplitChoice?.options).toEqual([
            0, 1, 2,
        ]);
    });

    it("X first: {2}{B} plus one X point, so the life gain caps at 1", async () => {
        const harness = await cast(setup, 3);
        const state = await answerSplit(harness, 0);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].restrictedXManaOwed).toBe(1);
        resolveTopOfStack(state);
        expect(getPlayer(state, "p2").life).toBe(17);
        expect(getPlayer(state, "p1").life).toBe(21);
    });

    it("fixed generic first: {B} plus three X points, so the life gain caps at 3", async () => {
        const harness = await cast(setup, 3);
        const state = await answerSplit(harness, 2);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].restrictedXManaOwed).toBe(3);
        resolveTopOfStack(state);
        expect(getPlayer(state, "p2").life).toBe(17);
        expect(getPlayer(state, "p1").life).toBe(23);
    });

    it("refuses a split that was not offered", async () => {
        const harness = await cast(setup, 3);
        await expect(answerSplit(harness, 3)).rejects.toThrow(/not available/);
    });

    it("the opponent cannot answer the caster's split", async () => {
        const parked = (await cast(setup, 3)).state();
        const opponent = makeMutationCtx("p2", [gameStateSeed(parked)]);
        await expect(
            runMutation(
                selectRestrictedXSplit as unknown as Handler<
                    Record<string, unknown>,
                    void
                >,
                opponent.ctx,
                { ...BASE, pointsOnX: 2 }
            )
        ).rejects.toThrow();
        expect(opponent.state().pendingCast?.manaCost).toEqual(
            parked.pendingCast?.manaCost
        );
    });

    it("one affordable split: no prompt, and the cast commits X first", async () => {
        const harness = await cast(
            { spellId: soulBurn().id, reducers: 2, pool: { B: 2, G: 2 } },
            3
        );
        const state = harness.state();
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(21);
    });

    it("a spell not reading its mana is never prompted, however many splits fit", async () => {
        const harness = await cast(
            { spellId: drainLife().id, reducers: 2, pool: { B: 4 } },
            3
        );
        const state = harness.state();
        expect(state.pendingCast).toBeUndefined();
        expect(state.stack).toHaveLength(1);
    });

    it("with no reduction there is nothing to split", async () => {
        const harness = await cast(
            { spellId: soulBurn().id, pool: { B: 6 } },
            3
        );
        expect(harness.state().stack).toHaveLength(1);
    });
});

describe("the rest of X stays restricted (CR 601.2h)", () => {
    it("one colour: red cannot pay what the reduction left of X", async () => {
        const harness = await cast(
            { spellId: drainLife().id, reducers: 1, pool: { B: 1, R: 3 } },
            2
        );
        expect(harness.state().stack).toHaveLength(0);
        const paid = await cast(
            { spellId: drainLife().id, reducers: 1, pool: { B: 2, R: 2 } },
            2
        );
        expect(paid.state().stack).toHaveLength(1);
    });

    it("two colours: green cannot pay it, red can", async () => {
        const refused = await cast(
            { spellId: soulBurn().id, reducers: 1, pool: { B: 1, G: 3 } },
            2
        );
        expect(refused.state().stack).toHaveLength(0);
        const paid = await cast(
            { spellId: soulBurn().id, reducers: 1, pool: { B: 1, R: 1, G: 2 } },
            2
        );
        expect(paid.state().stack).toHaveLength(1);
    });
});

describe("delve can pay a restricted X (CR 702.66a)", () => {
    it("offers the X points, forcing only what mana cannot cover", async () => {
        const delving = drainLifeWithDelve();
        await withTemporaryDefinitionAsync(delving, async () => {
            const harness = await cast(
                {
                    spellId: delving.id,
                    pool: { B: 3, R: 1 },
                    graveyard: 2,
                },
                3
            );
            expect(
                harness.state().pendingCast?.exileFromGraveyardChoice
                    ?.offsetGeneric
            ).toEqual({ min: 1, max: 2 });
        });
    });

    it("exiled cards cover X, and the rest is still only payable in black", async () => {
        const delving = drainLifeWithDelve();
        await withTemporaryDefinitionAsync(delving, async () => {
            // One card forced and collapsed: {X/B:2}{1}{B} on B B R R is short.
            const harness = await cast(
                {
                    spellId: delving.id,
                    pool: { B: 2, R: 2 },
                    graveyard: 1,
                },
                3
            );
            const state = harness.state();
            expect(state.stack).toHaveLength(0);
            expect(state.pendingCast?.manaCost).toEqual({
                B: 1,
                "X/B": 2,
                X: 1,
            });
        });
    });
});

describe("maxAffordableX agrees with payment under a reduction (CR 107.3)", () => {
    it("two Swamps + {2}: X = 2, where no reduction gives 0", () => {
        const reduced = board({
            spellId: drainLife().id,
            reducers: 2,
            swamps: 2,
        });
        const p1 = getPlayer(reduced, "p1");
        expect(maxAffordableX(p1, p1.hand[0], reduced)).toBe(2);
        const plain = board({ spellId: drainLife().id, swamps: 2 });
        const p1Plain = getPlayer(plain, "p1");
        expect(maxAffordableX(p1Plain, p1Plain.hand[0], plain)).toBe(0);
    });

    it("the ceiling is paid, and one above it is refused", async () => {
        const setup = {
            spellId: drainLife().id,
            reducers: 2,
            pool: { B: 2 },
        };
        const state = board(setup);
        const p1 = getPlayer(state, "p1");
        const ceiling = maxAffordableX(p1, p1.hand[0], state);
        expect((await cast(setup, ceiling)).state().stack).toHaveLength(1);
        expect((await cast(setup, ceiling + 1)).state().stack).toHaveLength(0);
    });

    it("permitted-colour mana still bounds it: red never adds X", () => {
        const state = board({
            spellId: drainLife().id,
            reducers: 2,
            pool: { B: 1, R: 4 },
        });
        const p1 = getPlayer(state, "p1");
        // {B} from black; the fixed {1} from red; {2} covers two X points.
        expect(maxAffordableX(p1, p1.hand[0], state)).toBe(2);
    });

    it("delve fuel raises the ceiling", () => {
        const delving = drainLifeWithDelve();
        withTemporaryDefinition(delving, () => {
            const state = board({
                spellId: delving.id,
                pool: { B: 2 },
                graveyard: 3,
            });
            const p1 = getPlayer(state, "p1");
            // {B} and the fixed {1} from mana, all three X points from fuel.
            expect(maxAffordableX(p1, p1.hand[0], state)).toBe(3);
        });
    });
});

describe("what the split leaves behind", () => {
    it("the record of mana owed on X survives a save and load", async () => {
        const harness = await cast(
            { spellId: soulBurn().id, reducers: 2, pool: { B: 4 } },
            3
        );
        const state = await answerSplit(harness, 2);
        const loaded = expandState(compactState(state));
        expect(loaded.stack[0].restrictedXManaOwed).toBe(3);
    });

    it("a split still pays the printed mana cost; another total does not (CR 601.2f)", () => {
        const state = board({ spellId: soulBurn().id, reducers: 2 });
        const p1 = getPlayer(state, "p1");
        const def = soulBurn();
        const paid = (cost: Record<string, number>) =>
            isPrintedManaCostOnly(state, p1, def, cost, "spell", 3);
        expect(paid({ B: 1, "X/B/R": 1, X: 2 })).toBe(true);
        expect(paid({ B: 1, "X/B/R": 3 })).toBe(true);
        expect(paid({ B: 1, "X/B/R": 3, X: 1 })).toBe(false);
    });
});
