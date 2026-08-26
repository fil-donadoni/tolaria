import { describe, it, expect } from "vitest";
import { jackedRabbit } from "../white";
import { grizzlyBears } from "../../lea/green";
import { ephemerate } from "../../mh1/white";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    removePermanentTo,
    putReanimatedSetOnBattlefield,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { emitAttackersDeclaredEvents } from "../../../../gre/phases";
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

/** Declares `attackerIds` as attackers through the REAL production entry
 *  point (`emitAttackersDeclaredEvents`, CR 508.1) rather than hand-building
 *  the trigger stack item. A hand-built stack item (the old `pushAttackTrigger`
 *  shape) never runs `collectTriggers`, so the ability's `matches`
 *  (`event.attackerIds.includes(self.id)`) is never executed — a `matches`
 *  that wrongly fired on ANY attacker would pass unchanged. Driving through
 *  the real scan is what actually exercises it. */
function declareAttackers(state: GameState, attackerIds: string[]): void {
    state.phase = "DECLARE_ATTACKERS";
    state.combat = {
        attackerIds,
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: false,
    };
    emitAttackersDeclaredEvents(state);
}

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

describe("Jacked Rabbit — Ravenous, ETB draw (CR 702.156a / 603.4)", () => {
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

        declareAttackers(state, [rabbit.id]);
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
        declareAttackers(state, [rabbit.id]);
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
        declareAttackers(state, [rabbit.id]);
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

    // `matches` coverage (issue review finding #4): the hand-built stack item
    // above never exercised `event.attackerIds.includes(self.id)` — a
    // `matches` that fired on ANY attacker would have passed unchanged. These
    // two drive REAL multi-attacker combat through `declareAttackers` /
    // `emitAttackersDeclaredEvents` so the predicate is actually evaluated.
    it("fires when Jacked Rabbit itself attacks, even alongside another attacker", () => {
        const { state, rabbit } = castForX(3);
        const other = makeInstance(grizzlyBears.id, {
            id: "co-attacker",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(other);

        declareAttackers(state, [rabbit.id, other.id]);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "jacked-rabbit-attack-tokens"
        );
        resolveTopOfStack(state);

        const tokens = state.players[0].battlefield.filter(
            (c) => c.isToken && c.subtypes?.includes("Rabbit")
        );
        expect(tokens).toHaveLength(4);
    });

    it("does NOT fire when a different creature attacks and Jacked Rabbit stays back", () => {
        const { state, rabbit } = castForX(3);
        const other = makeInstance(grizzlyBears.id, {
            id: "solo-attacker",
            controllerId: "p1",
            ownerId: "p1",
        });
        state.players[0].battlefield.push(other);

        // Only `other` attacks — Jacked Rabbit (`rabbit`) is left home.
        declareAttackers(state, [other.id]);

        expect(state.stack).toHaveLength(0);
        const tokens = state.players[0].battlefield.filter(
            (c) => c.isToken && c.subtypes?.includes("Rabbit")
        );
        expect(tokens).toHaveLength(0);
        // `rabbit` itself is unaffected — sanity that the fixture is wired.
        expect(
            state.players[0].battlefield.some((c) => c.id === rabbit.id)
        ).toBe(true);
    });
});

describe("Jacked Rabbit — wire format (projectPublicState)", () => {
    it("counters, effective power and the created tokens survive the projection", () => {
        const { state, rabbit } = castForX(3);
        declareAttackers(state, [rabbit.id]);
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

// Revert-sensitive regressions (issue #1753 sibling): `chosenXOnCast` (and the
// stray runtime `chosenX` a resolved stack item still carries) must NOT
// survive a CR 400.7 zone change. Both drive the real production apply path
// — `removePermanentTo` / `putReanimatedSetOnBattlefield` (which funnel
// through `resetBattlefieldTransientState`) and `resolveTopOfStack` (which
// runs `finalizeSpellResolution`'s ETB snapshot) — not a hand-built view.
// Mirrors `pouncingKavu`'s `wasKicked` pair in
// `convex/cards/sets/inv/__tests__/red.test.ts`.
describe("Jacked Rabbit — CR 400.7 clears the X snapshot on a zone change (issue #1753 precedent)", () => {
    it("(regression) bounced to hand and recast for X=0: does not inherit stale chosenXOnCast/counters or fire the OLD draw trigger", () => {
        const { state, rabbit } = castForX(7);
        expect(rabbit.chosenXOnCast).toBe(7);
        expect(rabbit.counters?.["+1/+1"]).toBe(7);

        // Resolve the pending Ravenous draw trigger so the stack is clean
        // before the zone change (avoids the unrelated LKI question of what a
        // trigger already on the stack does when its source departs).
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(1); // the drawn Grizzly Bears
        expect(state.players[0].library).toHaveLength(1);

        // CR 400.7 — bounce the X=7 rabbit to hand, the shared
        // battlefield-departure chokepoint (`removePermanentTo`).
        const bounced = removePermanentTo(state, rabbit.id, "hand");
        expect(bounced).not.toBeNull();
        const handCard = state.players[0].hand.find((c) => c.id === rabbit.id)!;
        expect(handCard.chosenXOnCast).toBeUndefined();
        expect((handCard as { chosenX?: number }).chosenX).toBeUndefined();
        expect(handCard.counters?.["+1/+1"] ?? 0).toBe(0);

        // Recast for X=0, mirroring the real stack-item build
        // (`announceCast`/`finalizeTargetSelection`, `convex/game.ts`):
        // `{ ...spellCard, castById, chosenX }` — {X} is a MANDATORY
        // announcement on this card, so a real recast always supplies a
        // fresh `chosenX`, unlike kicker's optional `kickerCount`. The real
        // cast mutation also removes the card from hand before it hits the
        // stack — mirror that here rather than leaving a duplicate behind.
        const handIdx = state.players[0].hand.findIndex(
            (c) => c.id === rabbit.id
        );
        state.players[0].hand.splice(handIdx, 1);
        const recast: StackItem = { ...handCard, castById: "p1", chosenX: 0 };
        state.stack.push(recast);
        resolveTopOfStack(state);

        const recastRabbit = state.players[0].battlefield.find(
            (c) => c.card.id === jackedRabbit.id
        )!;
        expect(recastRabbit.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(recastRabbit.chosenXOnCast).toBe(0);
        // No Ravenous ETB draw trigger leaking from the OLD X=7 — hand still
        // holds only the earlier (legitimate) draw, not a second card.
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.players[0].library).toHaveLength(1);
    });

    it("(regression) reanimated after being cast for X=7: X is 0 for a permanent that was never cast (CR 601.2b) — no counters, no draw", () => {
        const { state, rabbit } = castForX(7);
        // Resolve the pending Ravenous draw trigger before the departure.
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(1);
        expect(rabbit.chosenXOnCast).toBe(7);

        // CR 400.7 — send the X=7 rabbit to the graveyard (same
        // battlefield-departure chokepoint). Unlike the hand/library branch,
        // `removePermanentTo` deliberately does NOT clear `chosenXOnCast`
        // here — graveyard/exile preserve historical state — so it is
        // cleared at REANIMATION time instead, via the real production entry
        // path (`putReanimatedSetOnBattlefield`).
        const sent = removePermanentTo(state, rabbit.id, "graveyard");
        expect(sent).not.toBeNull();
        expect(sent!.chosenXOnCast).toBe(7);

        const gy = state.players[0].graveyard;
        const idx = gy.findIndex((c) => c.id === rabbit.id);
        const [reanimated] = gy.splice(idx, 1);
        const entered = putReanimatedSetOnBattlefield(state, [
            { card: reanimated, controllerId: "p1" },
        ]);
        expect(entered).toEqual([rabbit.id]);

        const reanimatedRabbit = state.players[0].battlefield.find(
            (c) => c.card.id === jackedRabbit.id
        )!;
        // CR 601.2b — reanimation never announces an X at all (that only
        // happens when casting), so this permanent's X is 0 (CR 702.156a):
        // no entry counters, and the "X ≥ 5" draw does not fire off the
        // stale X=7 from its previous life.
        expect(reanimatedRabbit.chosenXOnCast).toBeUndefined();
        expect(reanimatedRabbit.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(1); // still just the earlier draw
    });
});

// Departure-time LKI (issue #2042) — the shipped repro for CR 603.4's
// resolution-time re-check against CR 608.2h. This is the case the two
// regressions above deliberately sidestepped ("avoids the unrelated LKI
// question of what a trigger already on the stack does when its source
// departs"): the Ravenous trigger is ALREADY on the stack when Ephemerate
// blinks the rabbit, so CR 400.7 makes the returned permanent a NEW object and
// the re-check must read the departed one's last known information.
describe("Jacked Rabbit — Ravenous survives a blink taken in response (CR 603.4 / 608.2h / 400.7)", () => {
    it("X=6, blinked by Ephemerate while the Ravenous trigger is on the stack: still draws 1", () => {
        const { state, rabbit } = castForX(6);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "jacked-rabbit-ravenous-draw"
        );

        // Ephemerate resolves ON TOP of the waiting trigger: exile the rabbit,
        // then return it under the same instance id.
        pushSpell(state, ephemerate.id, "p1", [
            { type: "permanent", id: rabbit.id },
        ]);
        resolveTopOfStack(state);

        const returned = state.players[0].battlefield.find(
            (c) => c.card.id === jackedRabbit.id
        )!;
        // Preconditions that make this a real repro rather than a tautology:
        // the id really is reused, and the field the intervening-if reads
        // really was wiped by `resetBattlefieldTransientState`.
        expect(returned.id).toBe(rabbit.id);
        expect(returned.chosenXOnCast).toBeUndefined();
        // The returning rabbit's own Ravenous ETB sees X=0, so it adds no
        // second trigger — only the original one is still waiting.
        const ravenous = state.stack.filter(
            (i) => i.triggeredAbilityId === "jacked-rabbit-ravenous-draw"
        );
        expect(ravenous).toHaveLength(1);
        expect(ravenous[0].sourceLki?.chosenXOnCast).toBe(6);

        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.players[0].library).toHaveLength(1);
    });

    it("X=4, blinked the same way: still draws nothing (the snapshot is not a licence to fire)", () => {
        const { state, rabbit } = castForX(4);
        expect(state.stack).toHaveLength(0);
        pushSpell(state, ephemerate.id, "p1", [
            { type: "permanent", id: rabbit.id },
        ]);
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.players[0].library).toHaveLength(2);
    });
});
