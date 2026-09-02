// Per-card behaviour tests for blue cards in `convex/cards/sets/dsk/blue.ts`
// (Duskmourn: House of Horror, split by colour per ADR 0043). Fixtures from
// convex/cards/__tests__/setup.ts.
//
// Enduring Curiosity (issue #2085) is a pure DSL card on already-exercised Ops,
// so the catalogue sweep plus the generated smoke test cover its BODY. What
// they cannot see is the trigger's GATE — the four axes this card combines on
// `damageDealtTrigger` (a `yours`-scoped creature source, combat damage only, a
// player recipient with no controller relation). Each axis is a separate way to
// ship a trigger that fires on the wrong event and passes every other check, so
// each gets its own assertion against the real `matches` predicate. The cycle's
// shared dies-trigger is covered once on Enduring Innocence (`white.test.ts`).

import { describe, it, expect } from "vitest";
import { enduringCuriosity } from "..";
import { grizzlyBears } from "../../lea/green";
import { blackLotus } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { DamageDealtEvent, PermanentView } from "../../../types";
import type { GameState } from "../../../../gre/state";

const DRAW_TRIGGER = enduringCuriosity.triggeredAbilities!.find(
    (t) => t.id === "enduring-curiosity-draw"
)!;

/** p1 controls Enduring Curiosity, a Grizzly Bears and a Black Lotus;
 *  p2 controls a Bears of their own. */
function board(): { state: GameState; self: PermanentView } {
    const curiosity = makeInstance(enduringCuriosity.id, {
        id: "curiosity",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    curiosity,
                    makeInstance(grizzlyBears.id, {
                        id: "mine",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(blackLotus.id, {
                        id: "lotus",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(grizzlyBears.id, {
                        id: "theirs",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
    });
    return { state, self: curiosity as unknown as PermanentView };
}

/** A DAMAGE_DEALT event (CR 120.3) carrying the emitter's own source
 *  description fields, which is what every `sourceFilter` reads. */
function damage(over: Partial<DamageDealtEvent>): DamageDealtEvent {
    return {
        type: "DAMAGE_DEALT",
        sourceInstanceId: "mine",
        sourceControllerId: "p1",
        target: { type: "player", id: "p2" },
        amount: 2,
        isCombat: true,
        sourceTypes: ["Creature"],
        ...over,
    };
}

describe("Enduring Curiosity — whenever a creature you control deals combat damage to a player (CR 120.3 / 510.1, issue #2085)", () => {
    // The engine hands `matches` the GameState itself as its `TriggerStateView`
    // (`gre/triggers.ts`), so this is the production call shape, not a
    // hand-built view.
    const fires = (
        state: GameState,
        self: PermanentView,
        e: DamageDealtEvent
    ) => DRAW_TRIGGER.matches(e, self, state);

    it("fires for another creature its controller controls", () => {
        const { state, self } = board();
        expect(fires(state, self, damage({}))).toBe(true);
    });

    it("fires for ITSELF — the Oracle says 'a creature', not 'another creature'", () => {
        const { state, self } = board();
        expect(
            fires(state, self, damage({ sourceInstanceId: "curiosity" }))
        ).toBe(true);
    });

    it("does not fire for an opponent's creature (CR 109.4 — 'you control')", () => {
        const { state, self } = board();
        expect(
            fires(
                state,
                self,
                damage({ sourceInstanceId: "theirs", sourceControllerId: "p2" })
            )
        ).toBe(false);
    });

    it("does not fire for a noncreature source you control", () => {
        const { state, self } = board();
        expect(
            fires(
                state,
                self,
                damage({ sourceInstanceId: "lotus", sourceTypes: ["Artifact"] })
            )
        ).toBe(false);
    });

    it("does not fire on noncombat damage (CR 510.1 — combat damage only)", () => {
        const { state, self } = board();
        expect(fires(state, self, damage({ isCombat: false }))).toBe(false);
    });

    it("does not fire on damage dealt to a permanent instead of a player", () => {
        const { state, self } = board();
        expect(
            fires(
                state,
                self,
                damage({ target: { type: "permanent", id: "theirs" } })
            )
        ).toBe(false);
    });

    it("fires when the damaged player is its OWN controller — the clause names no relation", () => {
        const { state, self } = board();
        expect(
            fires(state, self, damage({ target: { type: "player", id: "p1" } }))
        ).toBe(true);
    });
});
