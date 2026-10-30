import { describe, it, expect } from "vitest";
import { payCastManaCost } from "../../game";
import {
    normalizeManaCost,
    removeFromZone,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition, EffectOp } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";

/**
 * The Converge value (issue #7211): `{ colorsSpentToCast: true }` — "the number
 * of colors of mana spent to cast this spell" (CR 207.2c ability word; CR 105.1
 * names the five colors, so colorless never counts).
 *
 * The permanent test of a new `EffectValue` member: the value read through the
 * REAL resolution path, the cast-payment seam that records what it reads, the
 * CR 707.10 copy rule, and the outcome through `projectPublicState`.
 */

/** "Exile target nonland permanent if its mana value is less than or equal to
 *  the number of colors of mana spent to cast this spell." — the converge
 *  removal shape, written as the DSL writes it. */
const CONVERGE_EXILE: EffectOp[] = [
    {
        op: "if",
        predicate: {
            left: { manaValue: { of: { target: 0 } } },
            op: "le",
            right: { colorsSpentToCast: true },
        },
        then: [{ op: "exile", target: { target: 0 } }],
    },
];

const CONVERGE_SPELL_ID = "test-converge-exile";
const convergeSpell: CardDefinition = {
    id: CONVERGE_SPELL_ID,
    name: CONVERGE_SPELL_ID,
    rarity: "uncommon",
    manaCost: { X: "X", W: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Permanent", count: 1 },
    noteManaSpent: true,
    effects: CONVERGE_EXILE,
};
registerTokenDefinition(convergeSpell);

/** Mana value 2 ({1}{G}) and mana value 3 ({2}{G}) — either side of a
 *  two-colour converge. */
const MV2_ID = "test-converge-mv2";
registerTokenDefinition({
    id: MV2_ID,
    name: MV2_ID,
    rarity: "common",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
});
const MV3_ID = "test-converge-mv3";
registerTokenDefinition({
    id: MV3_ID,
    name: MV3_ID,
    rarity: "common",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    power: 3,
    toughness: 3,
});

function boardWith(...victims: { defId: string; id: string }[]): GameState {
    return makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", {
                battlefield: victims.map((v) =>
                    makeInstance(v.defId, {
                        id: v.id,
                        controllerId: "p2",
                        ownerId: "p2",
                    })
                ),
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

const onBattlefield = (state: GameState, id: string) =>
    state.players[1].battlefield.some((c) => c.id === id);
const inExile = (state: GameState, id: string) =>
    state.players[1].exile.some((c) => c.id === id);

describe("Effect Script value: colorsSpentToCast (CR 207.2c Converge, CR 105.1)", () => {
    it("counts distinct COLORS: {W}{W}{U} spent is two — an MV-2 target is exiled", () => {
        const state = boardWith({ defId: MV2_ID, id: "mv2" });
        const item = pushSpell(state, CONVERGE_SPELL_ID, "p1", [
            { type: "permanent", id: "mv2" },
        ]);
        // Two {W} are one colour.
        item.notedManaSpent = { W: 2, U: 1 };
        resolveTopOfStack(state);
        expect(onBattlefield(state, "mv2")).toBe(false);
        expect(inExile(state, "mv2")).toBe(true);
    });

    it("colorless {C} is not a colour — {W}{C} is one, an MV-2 target survives", () => {
        const state = boardWith({ defId: MV2_ID, id: "mv2" });
        const item = pushSpell(state, CONVERGE_SPELL_ID, "p1", [
            { type: "permanent", id: "mv2" },
        ]);
        // Counting {C} as a colour would read 2 and exile it.
        item.notedManaSpent = { W: 1, C: 1 };
        resolveTopOfStack(state);
        expect(onBattlefield(state, "mv2")).toBe(true);
    });

    it("an MV-3 target survives two colours (the bound is inclusive, not loose)", () => {
        const state = boardWith({ defId: MV3_ID, id: "mv3" });
        const item = pushSpell(state, CONVERGE_SPELL_ID, "p1", [
            { type: "permanent", id: "mv3" },
        ]);
        item.notedManaSpent = { W: 1, U: 1, C: 5 };
        resolveTopOfStack(state);
        expect(onBattlefield(state, "mv3")).toBe(true);
    });

    it("reads 0 with no record (a spell cast without paying mana spent nothing)", () => {
        const amountId = "test-converge-amount";
        registerTokenDefinition({
            ...convergeSpell,
            id: amountId,
            name: amountId,
            targetRequirement: undefined,
            effects: [
                {
                    op: "gainLife",
                    player: "controller",
                    amount: { colorsSpentToCast: true },
                },
            ],
        });
        const without = boardWith();
        pushSpell(without, amountId, "p1");
        resolveTopOfStack(without);
        expect(without.players[0].life).toBe(20);

        const withFive = boardWith();
        pushSpell(withFive, amountId, "p1").notedManaSpent = {
            W: 1,
            U: 1,
            B: 1,
            R: 1,
            G: 3,
        };
        resolveTopOfStack(withFive);
        expect(withFive.players[0].life).toBe(25);
    });

    it("a COPY reads 0 — CR 707.10 copies decisions, not the mana that paid", () => {
        const amountId = "test-converge-copy-amount";
        registerTokenDefinition({
            ...convergeSpell,
            id: amountId,
            name: amountId,
            targetRequirement: undefined,
            effects: [
                {
                    op: "gainLife",
                    player: "controller",
                    amount: { colorsSpentToCast: true },
                },
            ],
        });
        // A Fork-shaped copier: copies the converge spell still on the stack.
        const copierId = "test-converge-copier";
        registerTokenDefinition({
            id: copierId,
            name: copierId,
            rarity: "common",
            manaCost: { R: 1 },
            types: ["Instant"],
            resolve: (ctx) => {
                ctx.copyStackItem("converge-original");
            },
        });
        const state = boardWith();
        const original = pushSpell(state, amountId, "p1");
        original.id = "converge-original";
        original.notedManaSpent = { W: 1, U: 1 };
        pushSpell(state, copierId, "p1");

        resolveTopOfStack(state); // the copier → the copy lands on top
        const copy = state.stack.find((s) => s.isCopy === true);
        expect(copy).toBeDefined();
        expect(copy!.notedManaSpent).toBeUndefined();
        resolveTopOfStack(state); // the copy: no mana was spent on it
        expect(state.players[0].life).toBe(20);
        resolveTopOfStack(state); // the original: two colours
        expect(state.players[0].life).toBe(22);
    });

    it("full path — {W}{U} floated, paid through the cast seam, resolved: the exile is on the wire", () => {
        const state = boardWith({ defId: MV2_ID, id: "mv2" });
        const caster = state.players[0];
        caster.hand.push(
            makeInstance(CONVERGE_SPELL_ID, {
                id: "converge",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        Object.assign(caster.manaPool, { W: 1, U: 1 });
        // X = 1: the cost is {1}{W}, paid with the floated {W}{U}.
        const manaCost = normalizeManaCost({ X: 1, W: 1 });
        const payment = payCastManaCost(
            state,
            caster,
            manaCost,
            convergeSpell,
            [],
            "converge"
        );
        const card = removeFromZone(state, caster, "converge", "hand", "p1");
        const item: StackItem = {
            ...card,
            castById: "p1",
            targets: [{ type: "permanent", id: "mv2" }],
            ...(payment.notedManaSpent
                ? { notedManaSpent: payment.notedManaSpent }
                : {}),
        };
        state.stack.push(item);
        expect(item.notedManaSpent).toEqual({ W: 1, U: 1 });

        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const p2 = projected.players.find((p) => p.id === "p2")!;
        expect(p2.battlefield.some((c) => c.id === "mv2")).toBe(false);
        expect(p2.exile.some((c) => c.id === "mv2")).toBe(true);
    });
});
