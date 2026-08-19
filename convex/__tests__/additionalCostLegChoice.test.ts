// Caster-chosen ADDITIONAL cost (CR 601.2b / 118.8 / 601.2h — issue #2379).
//
// "As an additional cost to cast this spell, discard a card or pay 3 life"
// (Bitter Triumph, LCI) is a DISJUNCTION the caster resolves at announcement.
// This file covers the whole path in one place, per the project's
// crosses-GRE→game.ts→UI rule:
//   - GRE unit: `gre/additionalCost.ts`'s resolution + affordability, and the
//     `getLegalActions` castability gate the Bot enumerates from.
//   - Integration: the exact functions the mutations call —
//     `finalizeTargetSelection` (the targeted cast commit),
//     `recordCastAlternativeHandCostPick` + `tryAutoCommitPendingCast` (the
//     discard leg's picker) — over real GRE state. The project has no
//     convex-test harness for game.ts mutations (ADR 0001), the established
//     substitute used by delveCastCost.test.ts and additional-cost-cast.test.ts.
//   - Wire format: the parked picker and the chosen leg survive
//     `projectPublicState` un-slimmed, which is what the client dialog reads.
//   - Bot: split out to `convex/gre/__tests__/additionalCostLegs.bot.test.ts`
//     (the bot-suite boundary, `scripts/__tests__/bot-suite-boundary.test.ts`,
//     keeps every bot-module importer in the bot suite).
//
// Announcement itself (`announceCast`'s required-iff-declared / unknown-id /
// unpayable-leg triad) is a mutation and is exercised through the pieces it
// composes: `additionalCostLegs`, `canPayAdditionalCostSpec` and
// `assertLegalAction`, called here in the same order the handler calls them.

import { describe, it, expect } from "vitest";
import {
    additionalCostLegs,
    canPayAdditionalCostSpec,
    payableAdditionalCostLegs,
    resolveAdditionalCosts,
    LEG_COST_KEYS,
} from "../gre/additionalCost";
import { assertLegalAction, getLegalActions } from "../gre/rules";
import { nextOwedPayment } from "../gre/owedPayment";
import { pickForOwedPayment } from "../gre/paymentPicks";
import {
    finalizeTargetSelection,
    recordCastAlternativeHandCostPick,
    tryAutoCommitPendingCast,
} from "../game";
import { projectPublicState } from "../gameProjections";
import { compactState, expandState } from "../gre/serialize";
import { getPlayer, type GameState, type PendingTarget } from "../gre/state";
import { getAllCards } from "../cards";
import type { AdditionalCostSpec } from "../cards/types";
import { makeInstance, makePlayer, makeState } from "../cards/__tests__/setup";
import { bitterTriumph } from "../cards/sets/lci";
import { grizzlyBears, lightningBolt } from "../cards/sets/lea";

const SWAMP = "6176936d-72e2-4205-8871-4c5a4f1cb2d8";

/** A board where p1 holds Bitter Triumph plus `spare` other hand cards, has
 *  `life` life and two untapped Swamps, and p2 has a Grizzly Bears to kill. */
function board(opts: { life: number; spare: number }) {
    const triumph = makeInstance(bitterTriumph.id, {
        id: "bt",
        zone: "hand",
        controllerId: "p1",
        ownerId: "p1",
    });
    const spares = Array.from({ length: opts.spare }, (_, i) =>
        makeInstance(lightningBolt.id, {
            id: `spare${i}`,
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const lands = Array.from({ length: 2 }, (_, i) =>
        makeInstance(SWAMP, {
            id: `swamp${i}`,
            zone: "battlefield",
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const bears = makeInstance(grizzlyBears.id, {
        id: "bears",
        zone: "battlefield",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state: GameState = makeState({
        players: [
            makePlayer("p1", {
                hand: [triumph, ...spares],
                battlefield: lands,
                life: opts.life,
                manaPool: { B: 2 },
            }),
            makePlayer("p2", { battlefield: [bears] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    return state;
}

/** The `pendingTarget` `announceCast` writes for a targeted Bitter Triumph
 *  cast with `legId` chosen — the shape whose `additionalCostLegId` field is
 *  the CR 601.2b announcement snapshot this feature turns on. */
function pendingTargetFor(legId: string | undefined): PendingTarget {
    return {
        playerId: "p1",
        cardInstanceId: "bt",
        requirement: bitterTriumph.targetRequirement!,
        selected: [{ type: "permanent", id: "bears" }],
        keepPriority: false,
        ...(legId ? { additionalCostLegId: legId } : {}),
    } as unknown as PendingTarget;
}

describe("additionalCosts.oneOf — leg resolution (CR 601.2b)", () => {
    it("flattens the named leg onto the spec and drops `oneOf`", () => {
        const life = resolveAdditionalCosts(
            bitterTriumph.additionalCosts,
            "pay-3-life"
        );
        expect(life).toEqual({ payLife: 3 });
        const discard = resolveAdditionalCosts(
            bitterTriumph.additionalCosts,
            "discard"
        );
        expect(discard).toEqual({ discard: { count: 1 } });
    });

    it("is the identity for a card with no disjunction", () => {
        const spec = { payLife: 2 };
        expect(resolveAdditionalCosts(spec, undefined)).toBe(spec);
        expect(resolveAdditionalCosts(undefined, "x")).toBeUndefined();
    });

    it("projects EVERY cost-bearing leg key (a new one cannot ship unpaid)", () => {
        // Guard for the fail-open shape `resolveAdditionalCosts`'s explicit
        // field-by-field projection defends against: a leg key the type grows
        // but the projection forgets is a declared cost that silently goes
        // unpaid, with every other test still green.
        for (const key of LEG_COST_KEYS) {
            const flat = resolveAdditionalCosts(
                {
                    oneOf: [{ id: "l", label: "L", [key]: probeValueFor(key) }],
                },
                "l"
            );
            expect(flat).toHaveProperty(key);
        }
    });
});

/** A structurally valid value for each `LEG_COST_KEYS` member — enough for the
 *  projection guard above to see the key survive. */
function probeValueFor(key: (typeof LEG_COST_KEYS)[number]): unknown {
    switch (key) {
        case "payLife":
            return 3;
        case "discard":
            return { count: 1 };
        default:
            return { type: "Creature" };
    }
}

describe("Bitter Triumph — leg affordability (CR 601.2h / 119.4 / 701.9)", () => {
    it("offers BOTH legs with a card in hand and life above 3", () => {
        const state = board({ life: 20, spare: 2 });
        const legs = payableAdditionalCostLegs(
            getPlayer(state, "p1"),
            bitterTriumph.additionalCosts,
            "bt"
        );
        expect(legs.map((l) => l.id)).toEqual(["discard", "pay-3-life"]);
    });

    it("hides the discard leg on an EMPTY hand (the spell itself can't pay, CR 601.2a)", () => {
        const state = board({ life: 20, spare: 0 });
        const legs = payableAdditionalCostLegs(
            getPlayer(state, "p1"),
            bitterTriumph.additionalCosts,
            "bt"
        );
        expect(legs.map((l) => l.id)).toEqual(["pay-3-life"]);
    });

    it("hides the life leg below 3 life (CR 119.4)", () => {
        const state = board({ life: 2, spare: 1 });
        const legs = payableAdditionalCostLegs(
            getPlayer(state, "p1"),
            bitterTriumph.additionalCosts,
            "bt"
        );
        expect(legs.map((l) => l.id)).toEqual(["discard"]);
    });

    it("pays exactly 3 life at 3 life — the boundary is >=, not > (CR 119.4)", () => {
        const state = board({ life: 3, spare: 0 });
        expect(
            canPayAdditionalCostSpec(
                getPlayer(state, "p1"),
                { payLife: 3 },
                "bt"
            )
        ).toBe(true);
    });

    it("empty hand AND life below 3: NO leg is payable and 'cast' is suppressed", () => {
        const state = board({ life: 2, spare: 0 });
        const player = getPlayer(state, "p1");
        const card = player.hand.find((c) => c.id === "bt")!;
        expect(
            payableAdditionalCostLegs(
                player,
                bitterTriumph.additionalCosts,
                "bt"
            )
        ).toEqual([]);
        // The gate the human mutation AND the Bot's enumerator both read.
        expect(getLegalActions(state, player, card)).not.toContain("cast");
        expect(() => assertLegalAction(state, player, card, "cast")).toThrow(
            /Illegal action "cast"/
        );
    });

    it("one payable leg is enough for 'cast' to stay legal", () => {
        const state = board({ life: 2, spare: 1 });
        const player = getPlayer(state, "p1");
        const card = player.hand.find((c) => c.id === "bt")!;
        expect(getLegalActions(state, player, card)).toContain("cast");
    });

    it("the card declares exactly the two printed legs", () => {
        expect(
            additionalCostLegs(bitterTriumph.additionalCosts).map((l) => l.id)
        ).toEqual(["discard", "pay-3-life"]);
    });
});

describe("Bitter Triumph — cast commit pays the CHOSEN leg (CR 601.2f / 601.2h)", () => {
    it("life leg: 3 life is paid as the spell hits the stack, hand untouched", () => {
        const state = board({ life: 20, spare: 2 });
        finalizeTargetSelection(state, pendingTargetFor("pay-3-life"), "p1");
        const player = getPlayer(state, "p1");
        expect(player.life).toBe(17);
        expect(player.hand.map((c) => c.id)).toEqual(["spare0", "spare1"]);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].card.id).toBe(bitterTriumph.id);
        expect(state.stack[0].targets).toEqual([
            { type: "permanent", id: "bears" },
        ]);
        expect(state.pendingCast).toBeUndefined();
    });

    it("discard leg with a REAL choice: parks on the hand picker, no life paid", () => {
        const state = board({ life: 20, spare: 2 });
        finalizeTargetSelection(state, pendingTargetFor("discard"), "p1");
        const player = getPlayer(state, "p1");
        expect(player.life).toBe(20);
        // Two spare cards for a one-card cost — a real pick, so the cast parks.
        expect(state.stack).toHaveLength(0);
        expect(state.pendingCast?.alternativeCostHandChoice).toEqual({
            action: "discard",
            requirements: [{ filter: {}, count: 1 }],
            excludeInstanceId: "bt",
        });
        expect(state.pendingCast?.additionalCostLegId).toBe("discard");

        // ... and the pick then commits the cast, moving exactly that card
        // hand → graveyard (CR 701.9).
        recordCastAlternativeHandCostPick(state, "p1", ["spare1"]);
        tryAutoCommitPendingCast(state, "p1");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].card.id).toBe(bitterTriumph.id);
        expect(player.life).toBe(20);
        expect(player.graveyard.map((c) => c.id)).toEqual(["spare1"]);
        expect(player.hand.map((c) => c.id)).toEqual(["spare0"]);
    });

    it("discard leg with a FORCED choice (one other card): auto-resolves and commits", () => {
        const state = board({ life: 20, spare: 1 });
        finalizeTargetSelection(state, pendingTargetFor("discard"), "p1");
        const player = getPlayer(state, "p1");
        expect(state.stack).toHaveLength(1);
        expect(player.graveyard.map((c) => c.id)).toEqual(["spare0"]);
        expect(player.hand).toHaveLength(0);
        expect(player.life).toBe(20);
    });

    it("the SPELL ITSELF never pays its own discard cost (CR 601.2a)", () => {
        const state = board({ life: 20, spare: 1 });
        finalizeTargetSelection(state, pendingTargetFor("discard"), "p1");
        // Bitter Triumph is on the stack, not in the graveyard.
        expect(state.stack[0].id).toBe("bt");
        expect(getPlayer(state, "p1").graveyard.map((c) => c.id)).not.toContain(
            "bt"
        );
    });

    it("the leg is the ANNOUNCED one, not one re-derived at commit (CR 601.2b)", () => {
        // The caster announced "pay 3 life" while holding two discardable
        // cards. The commit runs in a LATER mutation on a board where the
        // discard leg is perfectly payable — and must still pay life, because
        // CR 601.2b locks the choice at announcement.
        const state = board({ life: 20, spare: 2 });
        finalizeTargetSelection(state, pendingTargetFor("pay-3-life"), "p1");
        const player = getPlayer(state, "p1");
        expect(player.life).toBe(17);
        expect(player.graveyard).toHaveLength(0);
    });

    it("no leg id on the pendingTarget pays NOTHING (fail-closed, not a default leg)", () => {
        // A stale client that omits the choice must not have one silently
        // picked for it — `announceCast` rejects that announcement outright, so
        // this commit is unreachable in production; the assertion pins that no
        // leg is charged by accident if it ever were.
        const state = board({ life: 20, spare: 2 });
        finalizeTargetSelection(state, pendingTargetFor(undefined), "p1");
        const player = getPlayer(state, "p1");
        expect(player.life).toBe(20);
        expect(player.graveyard).toHaveLength(0);
    });
});

// The BOT side of the same park. `moves.ts` enumerates the discard-leg cast,
// so `PendingCast.alternativeCostHandChoice` — a branch that shipped explicitly
// UNREACHABLE in `paymentPicks.ts` — is now a park the bot actually has to
// answer. An unanswered park is a frozen game (ADR 0047), and the freeze is
// silent: `enumerateMoves` returns nothing at a park, so the bot simply stops.
describe("Bitter Triumph — the BOT answers the parked discard leg (ADR 0047 / ADR 0091)", () => {
    it("the park is reported as owed, picked from hand, and commits the cast", () => {
        const state = board({ life: 20, spare: 2 });
        finalizeTargetSelection(state, pendingTargetFor("discard"), "p1");

        // 1. The park is what the bot is owed — from `expectedInput`'s own
        //    census, never a parallel derivation.
        const owed = nextOwedPayment(state, "p1");
        expect(owed?.kind).toBe("cast:alternativeCostHandChoice");

        // 2. `paymentPicks.ts` answers it with a real card from hand — NOT
        //    Bitter Triumph itself (CR 601.2a).
        const submission = pickForOwedPayment(state, "p1", owed!);
        expect(submission?.mutation).toBe("selectCastAlternativeHandCost");
        const picked =
            submission?.mutation === "selectCastAlternativeHandCost"
                ? submission.cardInstanceIds
                : [];
        expect(picked).toHaveLength(1);
        expect(picked[0]).toMatch(/^spare/);

        // 3. Realising that submission pays the leg and unblocks the cast —
        //    nothing is owed afterwards.
        recordCastAlternativeHandCostPick(state, "p1", picked);
        tryAutoCommitPendingCast(state, "p1");
        const player = getPlayer(state, "p1");
        expect(state.stack).toHaveLength(1);
        expect(player.graveyard.map((c) => c.id)).toEqual(picked);
        expect(player.life).toBe(20);
        expect(nextOwedPayment(state, "p1")).toBeNull();
    });
});

describe("Bitter Triumph — wire format (the client sees the choice)", () => {
    it("projectPublicState preserves the parked discard picker and the chosen leg", () => {
        const state = board({ life: 20, spare: 2 });
        finalizeTargetSelection(state, pendingTargetFor("discard"), "p1");
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingCast?.alternativeCostHandChoice).toEqual({
            action: "discard",
            requirements: [{ filter: {}, count: 1 }],
            excludeInstanceId: "bt",
        });
        expect(projected.pendingCast?.additionalCostLegId).toBe("discard");
    });

    it("the chosen leg survives a persistence round trip", () => {
        const state = board({ life: 20, spare: 2 });
        finalizeTargetSelection(state, pendingTargetFor("discard"), "p1");
        const round = expandState(compactState(state));
        expect(round.pendingCast?.additionalCostLegId).toBe("discard");
        expect(round.pendingCast?.alternativeCostHandChoice?.action).toBe(
            "discard"
        );
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Catalogue guard — every declared `oneOf` disjunction is WELL FORMED.
//
// `AdditionalCostLeg.id` is what the caster names in `announceCast`'s
// `additionalCostLegId`, and `resolveAdditionalCosts` resolves it with a plain
// `.find()`. Two legs sharing an id therefore make the SECOND unreachable: the
// picker offers both rows, the caster clicks either, and the FIRST leg's cost
// is what gets charged — a mispaid cost, silent everywhere. A leg declaring no
// cost field at all is worse: it is a FREE leg on a card whose oracle text says
// it costs something, and it is always payable, so it also defeats the CR
// 601.2h castability gate.
//
// Neither shape is expressible as a TypeScript constraint (both are perfectly
// typed), and neither is caught by the affordability sweep in
// `src/lib/__tests__/cast-additional-cost-legs.catalogue.test.ts` — it compares
// SORTED id arrays, so a duplicate id appears identically on both sides and
// passes. This is the guard the type docs promise.
// ═══════════════════════════════════════════════════════════════════════════

/** Every way a declared `oneOf` can be malformed, as `card → complaint`
 *  strings. Pure over a card list so the fixtures below can prove it fires. */
function malformedOneOfLegs(
    defs: readonly { name: string; additionalCosts?: AdditionalCostSpec }[]
): string[] {
    const out: string[] = [];
    for (const def of defs) {
        const legs = def.additionalCosts?.oneOf;
        if (!legs || legs.length === 0) continue;
        // CR 601.2b — a disjunction of one is not a choice; it is a plain
        // additional cost declared in the wrong shape.
        if (legs.length < 2) {
            out.push(`${def.name}: oneOf has ${legs.length} leg`);
        }
        const seen = new Set<string>();
        for (const leg of legs) {
            if (!leg.id.trim()) {
                out.push(`${def.name}: a leg has a blank id`);
            } else if (seen.has(leg.id)) {
                out.push(`${def.name}: duplicate leg id "${leg.id}"`);
            }
            seen.add(leg.id);
            if (!leg.label.trim()) {
                out.push(`${def.name}: leg "${leg.id}" has a blank label`);
            }
            // An empty leg is a FREE leg — always payable, and it flattens
            // nothing onto the spec.
            if (!LEG_COST_KEYS.some((k) => leg[k] !== undefined)) {
                out.push(`${def.name}: leg "${leg.id}" declares no cost`);
            }
        }
    }
    return out;
}

describe("catalogue guard — every additionalCosts.oneOf is well formed (CR 601.2b)", () => {
    it("the whole catalogue is clean", () => {
        const withLegs = getAllCards().filter(
            (c) => (c.additionalCosts?.oneOf?.length ?? 0) > 0
        );
        // Non-vacuity: deleting the last disjunction card must not silence
        // this guard.
        expect(withLegs.length).toBeGreaterThan(0);
        expect(
            malformedOneOfLegs(withLegs),
            "a duplicate leg id makes the later leg unreachable " +
                "(`resolveAdditionalCosts` takes the first match) and an " +
                "empty leg is a free cost — both are silent everywhere else."
        ).toEqual([]);
    });

    it("flags a duplicate leg id", () => {
        expect(
            malformedOneOfLegs([
                {
                    name: "Fixture",
                    additionalCosts: {
                        oneOf: [
                            { id: "a", label: "A", payLife: 3 },
                            { id: "a", label: "B", discard: { count: 1 } },
                        ],
                    },
                },
            ])
        ).toEqual(['Fixture: duplicate leg id "a"']);
    });

    it("flags a leg that declares no cost at all", () => {
        expect(
            malformedOneOfLegs([
                {
                    name: "Fixture",
                    additionalCosts: {
                        oneOf: [
                            { id: "a", label: "A", payLife: 3 },
                            { id: "free", label: "Nothing" },
                        ],
                    },
                },
            ])
        ).toEqual(['Fixture: leg "free" declares no cost']);
    });

    it("flags a blank id, a blank label and a one-leg disjunction", () => {
        expect(
            malformedOneOfLegs([
                {
                    name: "Fixture",
                    additionalCosts: {
                        oneOf: [{ id: " ", label: "", payLife: 1 }],
                    },
                },
            ])
        ).toEqual([
            "Fixture: oneOf has 1 leg",
            "Fixture: a leg has a blank id",
            'Fixture: leg " " has a blank label',
        ]);
    });

    it("passes the real Bitter Triumph", () => {
        expect(malformedOneOfLegs([bitterTriumph])).toEqual([]);
    });
});
