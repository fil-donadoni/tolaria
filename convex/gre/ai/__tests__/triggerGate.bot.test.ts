// Ability-gate valuation (CR 603.4, issue #1936) — the value model must not
// score a CONDITIONAL triggered ability as if it always fires.
//
// The bug it pins: `evokeTrigger`'s AI shadow script (`{ op: "sacrifice",
// target: { ref: "$source" } }`, PR #1934) values as `SAC_SELF_COST` (−40),
// which is right for an EVOKED Incarnation and flatly wrong for a hard-cast
// one — the sacrifice trigger's "if its evoke cost was paid" gate means it can
// never fire there. The value model dropped that gate for EVERY gated ability,
// so this file pins the general rule (`TriggerGate` → `gateWeight`) and both
// directions of the reference case.
//
// Scope note (PR #1962 review). The fix is the DECIDABLE `{ onSelf }` branch
// only. An `{ undecidable: true }` gate is valued at FACE VALUE (weight 1, a
// strict no-op) — matching `case "if"` in `opValuers.ts`, the codebase's
// precedent for an unresolvable state predicate. Discounting it penalised
// authoring form rather than semantics: 75 of the 85 catalogue gates are
// undecidable, and they are dominated by event DISCRIMINATORS (saga chapter
// dispatch, Skullclamp's `wasAttachedToLeaver`, nth-spell counters) that sit in
// `condition:` only because `scope`/`filter` can't express them, while a
// semantically identical `diedTrigger({ scope: "self" })` carries no gate at
// all. The 0.5 weight survives only where the uncertainty is real: an
// `{ onSelf }` gate read with no instance (a card still in hand).
//
// The companion source-level guard — every `condition`-accepting trigger
// factory routes its return through `withTriggerGate` — lives in
// `scripts/__tests__/trigger-gate-marking.test.ts` (it reads files, which the
// Convex runtime forbids in `convex/`).

import { describe, it, expect } from "vitest";
import { getAllCards, getDefinition } from "../../../cards";
import { evokeTrigger } from "../../../cards/abilities/evoke";
import { dashTrigger } from "../../../cards/abilities/dash";
import { enteredTrigger } from "../../../cards/abilities/triggers/enteredTrigger";
import { diedTrigger } from "../../../cards/abilities/triggers/diedTrigger";
import type {
    CardDefinition,
    EffectOp,
    PermanentView,
    TriggeredAbility,
} from "../../../cards/types";
import { dslRealizedAbilityScriptValue } from "../cardScriptValue";
import { dslRealizedAbilityValueById } from "../../cardValue";
import { evaluateCreature } from "../../evaluate";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";

/** Solitude (mh2/white) — the reference Evoke Incarnation. */
const SOLITUDE_ID = "47a6234f-309f-4e03-9263-66da48b57153";

/** Ragavan, Nimble Pilferer (mh2/red) — the reference Dash card. */
const RAGAVAN_ID = "a9738cda-adb1-47fb-9f4c-ecd930228c4d";

/** The MH2 Incarnations and the ECL evoke trio all share `evokeTrigger`, so
 *  the fix is template-wide, not card-wide. */
function evokeCards(): CardDefinition[] {
    return getAllCards().filter((def) =>
        (def.triggeredAbilities ?? []).some((t) => t.id === "evoke-sacrifice")
    );
}

/** A minimal `PermanentView` standing in for a source permanent — enough for
 *  an `{ onSelf }` gate, which reads only the instance's own flags. */
function selfView(overrides: Partial<PermanentView> = {}): PermanentView {
    return {
        id: "self-1",
        card: { id: "self-card" },
        controllerId: "p1",
        ownerId: "p1",
        types: ["Creature"],
        subtypes: [],
        isTapped: false,
        ...overrides,
    };
}

const SCRIPT: EffectOp[] = [{ op: "draw", count: 2, player: "controller" }];

function onSelfOf(ability: TriggeredAbility): (self: PermanentView) => boolean {
    const gate = ability.gate;
    if (!gate || !("onSelf" in gate)) {
        throw new Error(`${ability.id}: expected a decidable { onSelf } gate`);
    }
    return gate.onSelf;
}

describe("triggered-ability gates in the value model (CR 603.4, issue #1936)", () => {
    describe("gate shapes", () => {
        function defWith(ability: TriggeredAbility): CardDefinition {
            return {
                id: "test-gate-card",
                name: "Test Gate Card",
                manaCost: { generic: 2 },
                types: ["Creature"],
                triggeredAbilities: [ability],
            } as CardDefinition;
        }

        const ungated = defWith(
            diedTrigger({
                id: "t",
                oracleText: "t",
                scope: "self",
                effects: SCRIPT,
            })
        );

        it("values an UNGATED ability at its full script value", () => {
            expect(ungated.triggeredAbilities![0].gate).toBeUndefined();
            expect(dslRealizedAbilityScriptValue(ungated)).toBeGreaterThan(0);
        });

        it("values an UNDECIDABLE gate at FACE VALUE — marked, but not discounted", () => {
            const gated = defWith(
                diedTrigger({
                    id: "t",
                    oracleText: "t",
                    scope: "self",
                    condition: () => true,
                    effects: SCRIPT,
                })
            );
            // The gate is still RECORDED (that is what makes a later, better
            // reader possible) — it just doesn't move the number. Weighting it
            // would make two authoring forms of the same predicate disagree:
            // this ability and `ungated` below are semantically identical.
            expect(gated.triggeredAbilities![0].gate).toEqual({
                undecidable: true,
            });
            expect(dslRealizedAbilityScriptValue(gated)).toBeCloseTo(
                dslRealizedAbilityScriptValue(ungated)
            );
        });

        it("DECIDES an { onSelf } gate when the instance is supplied — full value when true, zero when false", () => {
            const gated = defWith(
                enteredTrigger({
                    id: "t",
                    oracleText: "t",
                    scope: "self",
                    conditionOnSelf: (self) => self.evoked === true,
                    effects: SCRIPT,
                })
            );
            const full = dslRealizedAbilityScriptValue(ungated);
            expect(
                dslRealizedAbilityScriptValue(
                    gated,
                    undefined,
                    selfView({ evoked: true })
                )
            ).toBeCloseTo(full);
            expect(
                dslRealizedAbilityScriptValue(gated, undefined, selfView())
            ).toBe(0);
        });

        it("falls back to the undecided weight for an { onSelf } gate with NO instance (a card in hand)", () => {
            const gated = defWith(
                enteredTrigger({
                    id: "t",
                    oracleText: "t",
                    scope: "self",
                    conditionOnSelf: (self) => self.evoked === true,
                    effects: SCRIPT,
                })
            );
            expect(dslRealizedAbilityScriptValue(gated)).toBeCloseTo(
                dslRealizedAbilityScriptValue(ungated) / 2
            );
        });
    });

    describe("Evoke — the reference case (CR 702.74a)", () => {
        it("declares a DECIDABLE { onSelf } gate on the sacrifice trigger", () => {
            const onSelf = onSelfOf(evokeTrigger("Solitude"));
            expect(onSelf(selfView({ evoked: true }))).toBe(true);
            expect(onSelf(selfView())).toBe(false);
        });

        it("charges the self-sacrifice to an EVOKED permanent and NOT to a hard-cast one", () => {
            const def = getDefinition(SOLITUDE_ID);
            const evoked = dslRealizedAbilityScriptValue(
                def,
                undefined,
                selfView({ evoked: true })
            );
            const hardCast = dslRealizedAbilityScriptValue(
                def,
                undefined,
                selfView()
            );
            // The sacrifice is a COST (negative), so dropping it must raise the
            // hard-cast reading strictly above the evoked one.
            expect(hardCast).toBeGreaterThan(evoked);
            expect(evoked).toBeLessThan(0);
        });

        it("holds for every card built on the shared evoke template", () => {
            const cards = evokeCards();
            expect(cards.length).toBeGreaterThanOrEqual(5);
            for (const def of cards) {
                const evoked = dslRealizedAbilityScriptValue(
                    def,
                    undefined,
                    selfView({ evoked: true })
                );
                const hardCast = dslRealizedAbilityScriptValue(
                    def,
                    undefined,
                    selfView()
                );
                expect(
                    hardCast,
                    `${def.name}: hard-cast must not be charged the evoke sacrifice`
                ).toBeGreaterThan(evoked);
            }
        });
    });

    describe("Dash (CR 702.109a) — self-bounce priced as a cost (issue #1964)", () => {
        // Dash's `self.dashed` predicate is decidable in exactly the same way
        // Evoke's `self.evoked` is. Before #1964 the trigger's BODY was
        // wrong-signed in the value model: `delayedTrigger{ moveZone $source →
        // hand }` scored as a generic bounce (+55 "tempo") when returning your
        // OWN creature is a cost, so deciding the gate would have paid the bot
        // +95 to dash (`grantAbility(haste)` +40, the bounce +55) — measured
        // as `dslRealizedAbilityValueById(Ragavan, Nimble Pilferer)` = 165
        // dashed vs 70 hard-cast. Left the gate UNDECIDABLE (a plain
        // `condition`) until the self-bounce was modelled as a cost.
        //
        // #1964 fixed the sign (`HAND_RETURN_SELF_COST` in `opValuers.ts`,
        // threaded through the `delayedTrigger`'s own `capture` so the nested
        // `{ ref: "$self" }` is recognized as aliasing `$source`) and flipped
        // `dashTrigger` back to the decidable `conditionOnSelf` — this block
        // now asserts the CORRECTED behaviour (rewritten, not deleted, per
        // the #1964 PR: the old assertion of the +95 bonus encoded the bug).
        it("declares a DECIDABLE { onSelf } gate on the dash trigger", () => {
            const onSelf = onSelfOf(dashTrigger("Test"));
            expect(onSelf(selfView({ dashed: true }))).toBe(true);
            expect(onSelf(selfView())).toBe(false);
        });

        it("no longer pays a board-eval bonus to dash — dashed scores at or below hard-cast", () => {
            const dashed = dslRealizedAbilityValueById(
                RAGAVAN_ID,
                selfView({ dashed: true })
            );
            const hardCast = dslRealizedAbilityValueById(
                RAGAVAN_ID,
                selfView()
            );
            // Haste (+40) minus the now-correctly-signed self-bounce cost
            // (-55, `HAND_RETURN_SELF_COST`) nets NEGATIVE — dashing is
            // strictly below hard-cast on this static axis, not merely tied.
            // The real trade (an extra hasty attack step now vs. keeping the
            // body/tempo) is what `selectRootMove`/`evaluate.ts` weighs at
            // search time against the actual board (the blade entry below).
            expect(dashed).toBeLessThan(hardCast);
        });

        it("holds for every card built on the shared dash template", () => {
            const cards = getAllCards().filter((def) =>
                (def.triggeredAbilities ?? []).some(
                    (t) => t.id === "dash-haste-and-return"
                )
            );
            expect(cards.length).toBeGreaterThanOrEqual(2);
            for (const def of cards) {
                const dashed = dslRealizedAbilityScriptValue(
                    def,
                    undefined,
                    selfView({ dashed: true })
                );
                const hardCast = dslRealizedAbilityScriptValue(
                    def,
                    undefined,
                    selfView()
                );
                expect(
                    dashed,
                    `${def.name}: dashing must not score above hard-casting`
                ).toBeLessThanOrEqual(hardCast);
            }
        });
    });

    describe("through the board evaluator (the surface that actually decides)", () => {
        function scoreSolitude(evoked: boolean): number {
            const inst = makeInstance(SOLITUDE_ID, {
                controllerId: "p1",
                ...(evoked ? { evoked: true } : {}),
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [inst] }),
                    makePlayer("p2"),
                ],
            });
            return evaluateCreature(state, inst);
        }

        it("scores a hard-cast Solitude in play strictly above an evoked one", () => {
            expect(scoreSolitude(false)).toBeGreaterThan(scoreSolitude(true));
        });

        it("keeps the id-keyed entry point in step with the instance-aware one", () => {
            expect(
                dslRealizedAbilityValueById(SOLITUDE_ID, selfView())
            ).toBeGreaterThan(
                dslRealizedAbilityValueById(
                    SOLITUDE_ID,
                    selfView({ evoked: true })
                )
            );
        });
    });

    describe("catalogue reach", () => {
        it("marks the catalogue's gated triggers rather than a handful of cards", () => {
            let gated = 0;
            for (const def of getAllCards()) {
                for (const t of def.triggeredAbilities ?? []) {
                    if (t.gate) gated++;
                }
            }
            // A floor, not a snapshot: it fails loudly if the marking ever
            // stops reaching the catalogue (e.g. a factory rewrite drops the
            // `withTriggerGate` call), without churning on every new card.
            expect(gated).toBeGreaterThan(50);
        });
    });
});
