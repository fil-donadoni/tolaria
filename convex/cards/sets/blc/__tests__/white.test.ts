import { describe, it, expect } from "vitest";
import { jackedRabbit } from "../white";
import { grizzlyBears } from "../../lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { compactState, expandState } from "../../../../gre/serialize";
import { getEffectivePower } from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { tokenPrintIdFor } from "../../../tokenPrintLookup";
import { getDefinition } from "../../../index";

/** Casts Jacked Rabbit for `x` and resolves it onto p1's battlefield.
 *  Mirrors the shared `entersWithCounters` pattern: the chosen X lives on the
 *  resolving stack item (CR 601.2b), which is what `entersWith`'s `"X"` count
 *  reads. The library is stocked so the Ravenous draw has something to draw. */
function castForX(x: number): { state: GameState; rabbit: CardInstanceState } {
    const state = makeState({
        players: [
            makePlayer("p1", {
                library: [
                    makeInstance(grizzlyBears.id, {
                        id: "lib-1",
                        ownerId: "p1",
                        zone: "library",
                    }),
                    makeInstance(grizzlyBears.id, {
                        id: "lib-2",
                        ownerId: "p1",
                        zone: "library",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    const item = pushSpell(state, jackedRabbit.id, "p1");
    item.chosenX = x;
    resolveTopOfStack(state);
    const rabbit = state.players[0].battlefield.find((c) => c.id === item.id)!;
    return { state, rabbit };
}

/** Pushes Jacked Rabbit's "whenever this creature attacks" trigger, the shape
 *  `collectTriggers` builds for an `ATTACKERS_DECLARED` event (CR 508.1). */
function pushAttackTrigger(state: GameState, rabbit: CardInstanceState): void {
    state.stack.push({
        ...rabbit,
        zone: "stack",
        castById: rabbit.controllerId,
        triggeredAbilityId: "jacked-rabbit-attack-tokens",
        triggerSourceId: rabbit.id,
        triggerEvent: {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: rabbit.controllerId,
            attackerIds: [rabbit.id],
        } as StackItem["triggerEvent"],
        targets: [],
    });
}

describe("Jacked Rabbit — card definition (CR 202.1 / 205)", () => {
    it("has the printed {X}{1}{W} cost — the generic pip is NOT dropped", () => {
        // The committed stub had `{ X: "X", W: 1 }`, an instance of the
        // importer defect tracked as #1774 (`parseManaCost` drops generic pips
        // when {X} is present). `ManaCost.generic` coexists with the "X"
        // marker; both must be present.
        expect(jackedRabbit.manaCost).toEqual({ X: "X", generic: 1, W: 1 });
    });

    it("is a 1/2 Rabbit Warrior", () => {
        expect(jackedRabbit.types).toEqual(["Creature"]);
        expect(jackedRabbit.subtypes).toEqual(["Rabbit", "Warrior"]);
        expect(jackedRabbit.power).toBe(1);
        expect(jackedRabbit.toughness).toBe(2);
    });
});

describe("Jacked Rabbit — Ravenous, entry counters (CR 702.156a / 614.1c)", () => {
    it("X=0 — enters with no +1/+1 counters", () => {
        const { rabbit } = castForX(0);
        expect(rabbit.counters?.["+1/+1"] ?? 0).toBe(0);
    });

    it("X=4 — enters with 4 +1/+1 counters", () => {
        const { state, rabbit } = castForX(4);
        expect(rabbit.counters?.["+1/+1"]).toBe(4);
        // CR 613 — the counters are live in the layer system immediately.
        expect(getEffectivePower(state, rabbit)).toBe(5);
    });

    it("X=5 — enters with 5 +1/+1 counters", () => {
        const { rabbit } = castForX(5);
        expect(rabbit.counters?.["+1/+1"]).toBe(5);
    });

    it("snapshots the chosen X onto the permanent, not just as counters", () => {
        // The typed `chosenXOnCast` snapshot (the `wasKicked` precedent, issue
        // #1753) is what the ETB trigger's intervening-if reads. It must NOT
        // be inferred from the counter count, which any later effect can move.
        const { rabbit } = castForX(7);
        expect(rabbit.chosenXOnCast).toBe(7);
    });
});

describe("Jacked Rabbit — Ravenous, ETB draw (CR 702.156a / 603.4d)", () => {
    it("X=0 — the intervening-if is false, so nothing goes on the stack", () => {
        const { state } = castForX(0);
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("X=4 — the boundary: 4 is NOT 5 or more, so no draw", () => {
        const { state } = castForX(4);
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].library).toHaveLength(2);
    });

    it("X=5 — the trigger fires and draws a card", () => {
        const { state } = castForX(5);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "jacked-rabbit-ravenous-draw"
        );
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.players[0].library).toHaveLength(1);
    });

    it("X=5 — the draw still fires after a save/load round trip", () => {
        // The decisive regression: in a real game the trigger goes on the
        // stack, the state is persisted at the stable point, and only THEN
        // does the trigger resolve. `chosenXOnCast` must survive that; the raw
        // `chosenX` a resolved stack item leaves on the permanent does not.
        const { state } = castForX(5);
        const reloaded = expandState(compactState(state));
        expect(reloaded.players[0].battlefield[0].chosenXOnCast).toBe(5);
        resolveTopOfStack(reloaded);
        expect(reloaded.players[0].hand).toHaveLength(1);
    });
});

describe("Jacked Rabbit — attack trigger (CR 508.1 / 613)", () => {
    it("creates Rabbit tokens equal to CURRENT power, not printed power", () => {
        // X=3 → 3 counters → effective power 4, while the printed power is 1.
        // A count that read the printed value would make exactly one token.
        const { state, rabbit } = castForX(3);
        expect(getEffectivePower(state, rabbit)).toBe(4);

        pushAttackTrigger(state, rabbit);
        resolveTopOfStack(state);

        const tokens = state.players[0].battlefield.filter(
            (c) => c.isToken && c.subtypes?.includes("Rabbit")
        );
        expect(tokens).toHaveLength(4);
        for (const t of tokens) {
            expect(t.power).toBe(1);
            expect(t.toughness).toBe(1);
            expect(t.types).toContain("Creature");
        }
    });

    it("a vanilla X=0 Rabbit still makes one token (power 1)", () => {
        const { state, rabbit } = castForX(0);
        pushAttackTrigger(state, rabbit);
        resolveTopOfStack(state);
        const tokens = state.players[0].battlefield.filter(
            (c) => c.isToken && c.subtypes?.includes("Rabbit")
        );
        expect(tokens).toHaveLength(1);
    });

    it("wires the token's art from the reverse-linked Scryfall lockfile (CR 111)", () => {
        // The shared RABBIT_TOKEN spec pins no `imagePrintId` on purpose —
        // `SpellContext.createToken` resolves it per PRODUCING card, so the
        // art matches this card's own printing.
        const expected = tokenPrintIdFor(jackedRabbit.id, "Rabbit");
        expect(expected).toBeDefined();
        const { state, rabbit } = castForX(0);
        pushAttackTrigger(state, rabbit);
        resolveTopOfStack(state);
        const token = state.players[0].battlefield.find(
            (c) => c.isToken && c.subtypes?.includes("Rabbit")
        )!;
        // The art lands on the token's synthesized CardDefinition (the
        // instance keeps only `card: { id }`), which is what the client reads.
        expect(getDefinition(token.card.id as string).imagePrintId).toBe(
            expected
        );
    });
});

describe("Jacked Rabbit — wire format (projectPublicState)", () => {
    it("counters, effective power and the created tokens survive the projection", () => {
        const { state, rabbit } = castForX(3);
        pushAttackTrigger(state, rabbit);
        resolveTopOfStack(state);

        const tokenIds = state.players[0].battlefield
            .filter((c) => c.isToken && c.subtypes?.includes("Rabbit"))
            .map((c) => c.id);
        expect(tokenIds).toHaveLength(4);

        const projected = projectPublicState(state, 1, "p1");
        const slimRabbit = projected.players[0].battlefield.find(
            (c) => c.id === rabbit.id
        )!;
        // The Ravenous counters and the X snapshot both cross the wire...
        expect(slimRabbit.counters?.["+1/+1"]).toBe(3);
        expect(slimRabbit.chosenXOnCast).toBe(3);
        // ...and the same layer read holds on the projected state.
        expect(getEffectivePower(projected, slimRabbit)).toBe(4);
        const slimTokens = projected.players[0].battlefield.filter((c) =>
            tokenIds.includes(c.id)
        );
        expect(slimTokens).toHaveLength(4);
        for (const t of slimTokens) {
            expect(getEffectivePower(projected, t)).toBe(1);
        }
    });
});
