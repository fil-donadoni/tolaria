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

        it("halves an ability whose gate is UNDECIDABLE", () => {
            const gated = defWith(
                diedTrigger({
                    id: "t",
                    oracleText: "t",
                    scope: "self",
                    condition: () => true,
                    effects: SCRIPT,
                })
            );
            expect(gated.triggeredAbilities![0].gate).toEqual({
                undecidable: true,
            });
            expect(dslRealizedAbilityScriptValue(gated)).toBeCloseTo(
                dslRealizedAbilityScriptValue(ungated) / 2
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

    describe("Dash (CR 702.109a) — the second decidable self-flag gate", () => {
        it("declares an { onSelf } gate reading `dashed`", () => {
            const onSelf = onSelfOf(dashTrigger("Test"));
            expect(onSelf(selfView({ dashed: true }))).toBe(true);
            expect(onSelf(selfView())).toBe(false);
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
