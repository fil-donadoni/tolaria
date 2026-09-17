// Offspring — the two linked abilities of CR 702.175 (issue #2079).
//
// CR 702.175a: "Offspring represents two abilities. 'Offspring [cost]' means
// 'You may pay an additional [cost] as you cast this spell' and 'When this
// permanent enters, if its offspring cost was paid, create a token that's a
// copy of it, except it's 1/1.'"
// CR 702.175b: "If a spell has multiple instances of offspring, each is paid
// separately and triggers based on the payments made for it, not any other
// instances of offspring."
//
// The per-Op regime does NOT cover this mechanic and cannot be relied on: the
// generated canned-scenario sweep explicitly SKIPS `createTokenCopy` ("copies a
// runtime source permanent the canned generator does not model",
// `effects/scenarioGenerator.ts`). So every claim below is hand-written, and
// every one of them drives the REAL commit path (`finalizeTargetSelection`,
// `convex/game.ts`) and the REAL resolution / trigger machinery
// (`resolveTopOfStack`, `processPendingActionTriggers`) rather than
// hand-building a stack item or a trigger.
import { describe, it, expect } from "vitest";
import { finalizeTargetSelection } from "../../../game";
import {
    getPlayer,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type PendingTarget,
} from "../../../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../__tests__/setup";
import { withTemporaryDefinition } from "../../registry";
import { intrepidRabbit } from "../../sets/blb/white";
import {
    additionalCostPaidCount,
    additionalCostPrintedLabel,
    resolveKickerPayments,
} from "../../../gre/kicker";
import { getEffectivePower, getEffectiveToughness } from "../../../gre/layers";
import { projectPublicState } from "../../../gameProjections";
import { offspringTrigger, OFFSPRING_COST_ID } from "../offspring";
import type { CardDefinition } from "../../types";

const SUBJECT_ID = "off1";

// The mechanic's own subject: a vanilla {2}{W} 3/2 with Offspring {1} and
// NOTHING else. Deliberately not the shipped card — Intrepid Rabbit's second
// Oracle line ("target creature you control gets +1/+1 until end of turn") is
// an ETB that retargets onto whichever creature is left, so every P/T claim
// below would be measuring two mechanics at once and would go green on an
// offspring token that was never 1/1. The shipped card's own end-to-end proof
// lives in `cards/sets/blb/__tests__/white.test.ts`; this file proves the
// KEYWORD. The catalogue is frozen, so the probe is served through
// `withTemporaryDefinition`.
const PROBE_ID = "test:offspring-mechanic-probe";
const probe: CardDefinition = {
    id: PROBE_ID,
    name: "Offspring Probe",
    rarity: "common",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Rabbit", "Soldier"],
    power: 3,
    toughness: 2,
    oracleText: "Offspring {1}",
    kickers: [
        {
            id: OFFSPRING_COST_ID,
            keyword: "offspring",
            description: "Offspring {1}",
            mana: { X: 1 },
        },
    ],
    triggeredAbilities: [offspringTrigger({ cardName: "Offspring Probe" })],
};

/** Casts `def` through the real commit path, paying its offspring cost or not,
 *  and resolves the creature spell. Returns the state with the permanent on the
 *  battlefield and its ETB triggers pending. */
function castSubject(payOffspring: boolean, def: CardDefinition): GameState {
    const card = makeInstance(def.id, {
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
        id: SUBJECT_ID,
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [card],
                // CR 601.2f — offspring is an ADDITIONAL cost: {2}{W} printed,
                // plus {1} if the offspring cost is paid. Nothing here is an
                // alternative cost, so the printed cost is still owed in full.
                manaPool: {
                    W: 1,
                    U: 0,
                    B: 0,
                    R: 0,
                    G: 0,
                    C: payOffspring ? 3 : 2,
                },
            }),
            makePlayer("p2"),
        ],
    });
    const pt: PendingTarget = {
        playerId: "p1",
        cardInstanceId: SUBJECT_ID,
        targetType: "any",
        count: 0,
        selected: [],
        ...(payOffspring ? { kickerPayments: { offspring: 1 } } : {}),
    };
    finalizeTargetSelection(state, pt, "p1");
    expect(
        state.stack.find((s) => s.id === SUBJECT_ID),
        "the spell never reached the stack"
    ).toBeDefined();
    resolveTopOfStack(state);
    return state;
}

/** Casts the offspring-only probe, with the catalogue temporarily serving it. */
const castProbe = (payOffspring: boolean, fn: (state: GameState) => void) =>
    withTemporaryDefinition(probe, () => fn(castSubject(payOffspring, probe)));

/** Drains every trigger the board has raised, ordering batches in collection
 *  order. The offspring trigger creates one token whose entry raises nothing
 *  the token itself can answer with another token (CR 707.2 — a payment record
 *  is not a copiable value), so this terminates. */
function drainTriggers(state: GameState): void {
    let guard = 0;
    while (guard++ < 64) {
        processPendingActionTriggers(state);
        resolveTriggerOrder(state);
        if (state.stack.length === 0) break;
        resolveTopOfStack(state);
    }
    expect(guard, "trigger drain did not terminate").toBeLessThan(64);
}

const battlefield = (state: GameState): CardInstanceState[] =>
    getPlayer(state, "p1").battlefield;

const tokensOf = (state: GameState): CardInstanceState[] =>
    battlefield(state).filter((c) => c.isToken === true);

describe("Offspring — the cost half (CR 702.175a / 601.2f)", () => {
    it("is offered on the shipped card with a legible printed label, and is NOT repeatable", () => {
        const entry = intrepidRabbit.kickers![0]!;
        // The cast-cost dialog renders `description` verbatim on the per-entry
        // toggle, and `additionalCostPrintedLabel` is the single authority on
        // the WORD the keyword prints — read off ADDITIONAL_COST_KEYWORDS,
        // never a `multi ? … : …` ternary somewhere else.
        expect(entry.description).toBe("Offspring {1}");
        expect(additionalCostPrintedLabel(entry)).toBe("Offspring");
        // CR 702.175 has no "any number of times" clause: one payment, or none.
        // `resolveKickerPayments` is the single announcement-time validator, so
        // asking it is what proves the engine refuses a second payment rather
        // than merely that the definition omits a flag.
        expect(entry.multi).toBeUndefined();
        expect(resolveKickerPayments(intrepidRabbit, { offspring: 1 })).toEqual(
            {
                offspring: 1,
            }
        );
        // A second payment is REFUSED at announcement, not silently clamped.
        expect(() =>
            resolveKickerPayments(intrepidRabbit, { offspring: 2 })
        ).toThrow(/can only be paid once/);
        expect(resolveKickerPayments(intrepidRabbit, { offspring: 0 })).toBe(
            undefined
        );
    });

    it("is NOT a kick (CR 702.33d) — the payment lands in the unkicked record", () => {
        castProbe(true, (state) => {
            const perm = battlefield(state).find((c) => c.id === SUBJECT_ID)!;
            // CR 702.33d defines "kicked" over KICKER costs alone, so every
            // kicked-ness reader must be blind to an offspring payment while
            // the per-id question still answers yes.
            expect(perm.wasKicked).toBeUndefined();
            expect(perm.kickerPayments).toBeUndefined();
            expect(perm.unkickedCostPayments).toEqual({ offspring: 1 });
            expect(additionalCostPaidCount(perm, OFFSPRING_COST_ID)).toBe(1);
        });
    });
});

describe("Offspring — the trigger half (CR 702.175a / 603.4)", () => {
    const TRIGGER_ID = `offspring-token-copy-${OFFSPRING_COST_ID}`;

    it("with the cost declined the trigger never goes on the stack (CR 603.4)", () => {
        // A matched PAIR, because "the trigger is absent" is only evidence if
        // the same read finds it when it IS there. `triggeredAbilityId` is the
        // field `buildTriggerItem` stamps; reading any other one would make the
        // negative row below pass for the wrong reason, and the positive row is
        // what catches that.
        castProbe(true, (paid) => {
            processPendingActionTriggers(paid);
            resolveTriggerOrder(paid);
            expect(
                paid.stack.map((item) => item.triggeredAbilityId),
                "the paid control never announced its trigger — this row reads the wrong field"
            ).toContain(TRIGGER_ID);
        });

        castProbe(false, (state) => {
            const perm = battlefield(state).find((c) => c.id === SUBJECT_ID)!;
            expect(perm.unkickedCostPayments).toBeUndefined();
            processPendingActionTriggers(state);
            resolveTriggerOrder(state);
            // The intervening if is a CHECK-TIME gate: a declined offspring
            // cost means no ability is ever announced, not an ability that goes
            // on the stack and then does nothing.
            expect(
                state.stack.map((item) => item.triggeredAbilityId),
                "a declined offspring cost still announced its trigger"
            ).not.toContain(TRIGGER_ID);
            drainTriggers(state);
            expect(
                tokensOf(state),
                "a declined cost still made a token"
            ).toHaveLength(0);
        });
    });

    it("the cost paid creates exactly ONE token that is a 1/1 copy (CR 702.175a / 707.2)", () => {
        castProbe(true, (state) => {
            drainTriggers(state);
            const tokens = tokensOf(state);
            expect(tokens).toHaveLength(1);
            const token = tokens[0]!;
            // CR 707.2 — the copy acquires the copiable values: name, card
            // types, subtypes, colour (derived from the mana cost) and rules
            // text. The token presents the SOURCE's definition, which is what
            // carries all of them.
            expect(token.card.id).toBe(PROBE_ID);
            expect(token.controllerId).toBe("p1");
            expect(token.types).toEqual(probe.types);
            expect(token.subtypes).toEqual(probe.subtypes);
            // CR 707.2's "except" clause — "except it's 1/1". Read through the
            // layer system (CR 613), not off the stored base values, because
            // that is what every consumer of a P/T reads.
            expect(getEffectivePower(state, token)).toBe(1);
            expect(getEffectiveToughness(state, token)).toBe(1);
            // The ORIGINAL is untouched by its own copy's exception.
            const original = battlefield(state).find(
                (c) => c.id === SUBJECT_ID
            )!;
            expect(getEffectivePower(state, original)).toBe(3);
            expect(getEffectiveToughness(state, original)).toBe(2);
        });
    });

    it("the token carries no offspring payment of its own (CR 707.2)", () => {
        // Copiable values are printed values; a payment record is not one, so
        // the token's own copy of this trigger is check-time-gated to silence
        // and no token makes further tokens. The count above already proves
        // there is no runaway — this pins the REASON.
        castProbe(true, (state) => {
            drainTriggers(state);
            const token = tokensOf(state)[0]!;
            expect(token.unkickedCostPayments).toBeUndefined();
            expect(additionalCostPaidCount(token, OFFSPRING_COST_ID)).toBe(0);
        });
    });

    it("the creature killed in response still makes the token (CR 608.2h / 111.12)", () => {
        // What issue #2075 bought. The trigger is on the stack; the permanent
        // leaves before it resolves. CR 608.2h: the effect uses the object's
        // last known information when it is no longer in the zone it was
        // expected to be in, and CR 111.12's "no token is created" for a
        // nonexistent object explicitly does NOT apply to that case.
        castProbe(true, (state) => {
            processPendingActionTriggers(state);
            resolveTriggerOrder(state);
            expect(
                state.stack.map((item) => item.triggeredAbilityId)
            ).toContain(TRIGGER_ID);
            // Kill it with the trigger still on the stack, through the real
            // departure funnel — that is what stamps the LKI entry.
            removePermanentTo(state, SUBJECT_ID, "graveyard");
            expect(
                battlefield(state).find((c) => c.id === SUBJECT_ID),
                "the creature was still on the battlefield — this test proves nothing"
            ).toBeUndefined();
            drainTriggers(state);
            const tokens = tokensOf(state);
            expect(
                tokens,
                "the token was lost when its source left the battlefield"
            ).toHaveLength(1);
            expect(tokens[0]!.card.id).toBe(PROBE_ID);
            expect(getEffectivePower(state, tokens[0]!)).toBe(1);
            expect(getEffectiveToughness(state, tokens[0]!)).toBe(1);
        });
    });
});

describe("Offspring — multiple instances (CR 702.175b)", () => {
    // "If a spell has multiple instances of offspring, each is paid separately
    // and triggers based on the payments made for it, not any other instances
    // of offspring." No printed card has two instances, so the claim needs a
    // probe of its own.
    const TWO_INSTANCE_ID = "test:offspring-two-instances-probe";
    const twoInstances: CardDefinition = {
        ...probe,
        id: TWO_INSTANCE_ID,
        name: "Offspring Two-Instance Probe",
        oracleText: "Offspring {1}\nOffspring {1}",
        kickers: [
            {
                id: "offspring-a",
                keyword: "offspring",
                description: "Offspring {1}",
                mana: { X: 1 },
            },
            {
                id: "offspring-b",
                keyword: "offspring",
                description: "Offspring {1}",
                mana: { X: 1 },
            },
        ],
        triggeredAbilities: [
            offspringTrigger({ cardName: "Probe", costId: "offspring-a" }),
            offspringTrigger({ cardName: "Probe", costId: "offspring-b" }),
        ],
    };

    /** Casts the two-instance probe paying whichever named instances the caller
     *  lists, through the real commit path. */
    function castTwoInstance(paid: ReadonlyArray<string>): GameState {
        const card = makeInstance(TWO_INSTANCE_ID, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
            id: SUBJECT_ID,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [card],
                    manaPool: {
                        W: 1,
                        U: 0,
                        B: 0,
                        R: 0,
                        G: 0,
                        C: 2 + paid.length,
                    },
                }),
                makePlayer("p2"),
            ],
        });
        const payments: Record<string, number> = {};
        for (const id of paid) payments[id] = 1;
        finalizeTargetSelection(
            state,
            {
                playerId: "p1",
                cardInstanceId: SUBJECT_ID,
                targetType: "any",
                count: 0,
                selected: [],
                ...(paid.length > 0 ? { kickerPayments: payments } : {}),
            },
            "p1"
        );
        resolveTopOfStack(state);
        return state;
    }

    it("each instance is paid separately and triggers only on its own payments", () => {
        withTemporaryDefinition(twoInstances, () => {
            // Pay ONE of the two. The other instance's trigger reads its own
            // id, finds nothing, and never reaches the stack — which is the
            // whole content of CR 702.175b.
            const one = castTwoInstance(["offspring-a"]);
            const perm = battlefield(one).find((c) => c.id === SUBJECT_ID)!;
            expect(perm.unkickedCostPayments).toEqual({ "offspring-a": 1 });
            expect(additionalCostPaidCount(perm, "offspring-a")).toBe(1);
            expect(additionalCostPaidCount(perm, "offspring-b")).toBe(0);
            processPendingActionTriggers(one);
            resolveTriggerOrder(one);
            const announced = one.stack.map((item) => item.triggeredAbilityId);
            expect(announced).toContain("offspring-token-copy-offspring-a");
            expect(
                announced,
                "the UNPAID instance announced its trigger off the OTHER instance's payment"
            ).not.toContain("offspring-token-copy-offspring-b");
            drainTriggers(one);
            expect(tokensOf(one)).toHaveLength(1);

            // Both paid: two independent payments, two independent triggers,
            // two tokens.
            const both = castTwoInstance(["offspring-a", "offspring-b"]);
            expect(
                battlefield(both).find((c) => c.id === SUBJECT_ID)!
                    .unkickedCostPayments
            ).toEqual({ "offspring-a": 1, "offspring-b": 1 });
            drainTriggers(both);
            expect(tokensOf(both)).toHaveLength(2);

            // Neither paid: nothing at all.
            const none = castTwoInstance([]);
            drainTriggers(none);
            expect(tokensOf(none)).toHaveLength(0);
        });
    });
});

describe("Offspring — wire format (projectPublicState)", () => {
    it("the 1/1 token survives the projection as a copy (CR 707.2)", () => {
        // The projection strips `card.card` down to `{ id }` and reshapes every
        // zone; a GRE-only assertion would pass while the client rendered a
        // token with the wrong body. Re-read the SAME claims through the
        // reducer.
        castProbe(true, (state) => {
            drainTriggers(state);
            const token = tokensOf(state)[0]!;

            const projected = projectPublicState(state, 1, "p1");
            const viewer = projected.players.find((p) => p.id === "p1")!;
            const slimToken = viewer.battlefield.find((c) => c.id === token.id);
            expect(
                slimToken,
                "the offspring token did not survive the projection"
            ).toBeDefined();
            expect(slimToken!.card.id).toBe(PROBE_ID);
            expect(slimToken!.isToken).toBe(true);
            expect(slimToken!.types).toEqual(probe.types);
            expect(slimToken!.subtypes).toEqual(probe.subtypes);
            // CR 707.2's "except it's 1/1", re-derived from the PROJECTED
            // state — the exception rides `copyExcept`, one more fat field the
            // projection could have stripped.
            const projectedState = projected as unknown as GameState;
            const projectedToken = slimToken as unknown as CardInstanceState;
            expect(getEffectivePower(projectedState, projectedToken)).toBe(1);
            expect(getEffectiveToughness(projectedState, projectedToken)).toBe(
                1
            );

            // And the original is still 3/2 on the wire — the exception belongs
            // to the copy alone.
            const slimOriginal = viewer.battlefield.find(
                (c) => c.id === SUBJECT_ID
            )! as unknown as CardInstanceState;
            expect(getEffectivePower(projectedState, slimOriginal)).toBe(3);
            expect(getEffectiveToughness(projectedState, slimOriginal)).toBe(2);
        });
    });
});
