// Monocolour hybrid mana `{2/W}` (CR 107.4e / 202.3f / 105.2, issue #1743): the
// pip is paid with one mana of its colour OR its generic amount. Covers the
// representation (mana value, colour, pip count, devotion), the leg solver, the
// castability gate and the real cast path (`finalizeTargetSelection`).
import { describe, it, expect } from "vitest";
import { manaValue } from "../constants";
import { getColorsFromCost, getPipCountsFromCost } from "../../cards/colors";
import { countDevotion } from "../layers";
import { readManaCost } from "../../oracle/manaCost";
import { getLegalActions, solveHybridGenericLegs } from "../rules";
import { normalizeManaCost } from "../state";
import { foldHybridGenericLegs } from "../hybridGeneric";
import { lightningBolt } from "../../cards/sets/lea/red.cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition, ManaCost } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { finalizeTargetSelection } from "../../game";
import type { PendingTarget } from "../state";

const PIP = { generic: 2, color: "W" } as const;
const EMPTY_POOL = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

function variant(manaCost: ManaCost): CardDefinition {
    return { ...lightningBolt(), manaCost };
}

function handState(manaCost: ManaCost, pool: Partial<typeof EMPTY_POOL>) {
    const def = variant(manaCost);
    const card = makeInstance(def.id, {
        id: "spell",
        zone: "hand",
        controllerId: "p1",
    });
    const player = makePlayer("p1", {
        hand: [card],
        manaPool: { ...EMPTY_POOL, ...pool },
    });
    const state = makeState({ players: [player, makePlayer("p2")] });
    return { def, card, player, state };
}

describe("monocolour hybrid — representation (CR 202.3f / 105.2)", () => {
    const cost: ManaCost = { hybridGeneric: [PIP, PIP, PIP] };

    it("values each {2/W} pip at 2, the higher half (CR 202.3f)", () => {
        expect(manaValue({ hybridGeneric: [PIP] })).toBe(2);
        expect(manaValue({ X: 1, hybridGeneric: [PIP, PIP] })).toBe(5);
        // guild hybrid stays 1 per pip
        expect(manaValue({ hybrid: [["W", "U"]] })).toBe(1);
    });

    it("takes its colour from the colour half, once per pip (CR 105.2)", () => {
        expect(getColorsFromCost(cost)).toEqual(["W"]);
        expect(getPipCountsFromCost(cost)).toEqual({ W: 3 });
    });

    it("counts toward devotion to its colour (CR 700.5)", () => {
        const def = variant(cost);
        const permanent = makeInstance(def.id, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [permanent] }),
                makePlayer("p2"),
            ],
        });
        withTemporaryDefinition(def, () => {
            expect(countDevotion(state, "p1", "W")).toBe(3);
            expect(countDevotion(state, "p1", "U")).toBe(0);
        });
    });

    it("reads {2/W} from printed mana cost text", () => {
        expect(readManaCost("{2/W}{2/W}{2/W}")).toEqual({
            ok: true,
            cost: { hybridGeneric: [PIP, PIP, PIP] },
        });
    });

    it("normalizeManaCost leaves the pip for the cast path to resolve", () => {
        expect(normalizeManaCost({ R: 1, hybridGeneric: [PIP] })).toEqual({
            R: 1,
        });
    });

    it("folds a colour leg into a pip and a generic leg into generic", () => {
        const folded = foldHybridGenericLegs({ hybridGeneric: [PIP, PIP] }, [
            true,
            false,
        ]);
        expect(folded).toEqual({ W: 1, generic: 2 });
        expect(normalizeManaCost(folded)).toEqual({ W: 1, X: 2 });
    });
});

describe("monocolour hybrid — leg solver and cast gate (CR 107.4e)", () => {
    const one: ManaCost = { hybridGeneric: [PIP] };

    it("pays {2/W} with one {W}", () => {
        const { card, player, state } = handState(one, { W: 1 });
        withTemporaryDefinition(variant(one), () => {
            const folded = solveHybridGenericLegs(
                player,
                card,
                one,
                undefined,
                state
            );
            expect(folded && normalizeManaCost(folded)).toEqual({ W: 1 });
            expect(getLegalActions(state, player, card)).toContain("cast");
        });
    });

    it("pays {2/W} with any two mana", () => {
        const { card, player, state } = handState(one, { R: 1, G: 1 });
        withTemporaryDefinition(variant(one), () => {
            const folded = solveHybridGenericLegs(
                player,
                card,
                one,
                undefined,
                state
            );
            expect(folded && normalizeManaCost(folded)).toEqual({ X: 2 });
            expect(getLegalActions(state, player, card)).toContain("cast");
        });
    });

    it("is not castable with a single mana of another colour", () => {
        const { card, player, state } = handState(one, { R: 1 });
        withTemporaryDefinition(variant(one), () => {
            expect(
                solveHybridGenericLegs(player, card, one, undefined, state)
            ).toBeNull();
            expect(getLegalActions(state, player, card)).not.toContain("cast");
        });
    });

    it("picks the cheaper leg per pip: {W} for one, two generic for the other", () => {
        const two: ManaCost = { hybridGeneric: [PIP, PIP] };
        const { card, player, state } = handState(two, { W: 1, R: 2 });
        withTemporaryDefinition(variant(two), () => {
            const folded = solveHybridGenericLegs(
                player,
                card,
                two,
                undefined,
                state
            );
            expect(folded && normalizeManaCost(folded)).toEqual({
                W: 1,
                X: 2,
            });
        });
    });

    it("decides the legs together with the generic tail", () => {
        // {1}{2/W} with exactly {W}{R}: the colour leg + the tail is payable,
        // the generic leg (3 mana in total) is not.
        const cost: ManaCost = { X: 1, hybridGeneric: [PIP] };
        const { card, player, state } = handState(cost, { W: 1, R: 1 });
        withTemporaryDefinition(variant(cost), () => {
            expect(getLegalActions(state, player, card)).toContain("cast");
        });
    });
});

describe("monocolour hybrid — real cast path (finalizeTargetSelection)", () => {
    function cast(pool: Partial<typeof EMPTY_POOL>) {
        const cost: ManaCost = { R: 1, hybridGeneric: [PIP] };
        const { def, player, state } = handState(cost, pool);
        const pt: PendingTarget = {
            playerId: "p1",
            cardInstanceId: "spell",
            targetType: "player",
            count: 1,
            selected: [{ type: "player", id: "p2" }],
        };
        state.pendingTarget = pt;
        withTemporaryDefinition(def, () =>
            finalizeTargetSelection(state, pt, "p1")
        );
        return { player, state };
    }

    it("owes {R}{W} when a white mana is available", () => {
        const { state } = cast({ R: 1, W: 1 });
        // paid in full from the pool: the spell is on the stack, pool empty
        expect(state.stack.length).toBe(1);
        expect(state.players[0].manaPool.W).toBe(0);
        expect(state.players[0].manaPool.R).toBe(0);
    });

    it("owes {R} + two generic when no white mana is available", () => {
        const { state } = cast({ R: 1, G: 2 });
        expect(state.stack.length).toBe(1);
        expect(state.players[0].manaPool.G).toBe(0);
        expect(state.players[0].manaPool.R).toBe(0);
    });
});
