// Per-card behaviour tests for blue cards in `convex/cards/sets/dsk/blue.cards.ts`
// (Duskmourn: House of Horror, split by colour per ADR 0043). Fixtures from
// convex/cards/__tests__/setup.helper.ts.
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
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
} from "../../../__tests__/setup.helper";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";
import {
    dealDamageFromPermanentToPlayer,
    flushPendingEvents,
} from "../../../../gre/state";
import type { DamageDealtEvent, PermanentView } from "../../../types";
import type { GameState } from "../../../../gre/state";
import { getDefinition } from "../../../index";

const enduringCuriosity = getDefinition("8616629e-08f9-41ad-bfec-f86c8096f1cb");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const blackLotus = getDefinition("b0faa7f2-b547-42c4-a810-839da50dadfe");

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

    it("does not fire for an opponent's creature (CR 109.5 — 'you control')", () => {
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

    it("agrees with the PRODUCTION emitter: a real DAMAGE_DEALT carries the source types the filter reads, and noncombat does not fire", () => {
        const { state, self } = board();
        const bears = state.players[0].battlefield.find(
            (c) => c.id === "mine"
        )!;

        // A real emission, not a fixture: `dealDamageFromPermanentToPlayer` is
        // the noncombat permanent-source sink, and it is what decides whether
        // `sourceTypes` is on the wire at all. Without this, every assertion
        // above could agree with a hand-built event the engine never emits.
        dealDamageFromPermanentToPlayer(state, bears, "p1", "p2", 2);
        const emitted = flushPendingEvents(state).find(
            (e) => e.type === "DAMAGE_DEALT"
        ) as DamageDealtEvent;

        expect(emitted).toBeDefined();
        expect(emitted.sourceTypes).toContain("Creature");
        // …and CR 510.1 still closes: this is noncombat damage.
        expect(emitted.isCombat).toBe(false);
        expect(fires(state, self, emitted)).toBe(false);
        // Flip only the combat flag on the SAME emitted event and it fires —
        // isolating the gate from the source-description fields.
        expect(fires(state, self, { ...emitted, isCombat: true })).toBe(true);
    });
});

// Floodpits Drowner (issue #10504) — the entry trigger is the compiled
// tap-and-stun clause on exercised Ops (covered by its golden). What only this
// card exercises is the activated ability: the `hasCounter` target filter
// (CR 122.1) and the move of TWO objects into their OWNERS' libraries
// (CR 108.3, CR 701.24a), gated on the Drowner still being the same object
// (CR 400.7).
describe("Floodpits Drowner — shuffle itself and a stunned creature away", () => {
    const drowner = getDefinition("a6a62aa3-8edb-4000-8ebd-15ec4b00eed7");
    const SHUFFLE = drowner.activatedAbilities!.find(
        (a) => a.id === "floodpits-drowner-shuffle"
    )!;

    function drownerBoard(stun: number) {
        const self = makeInstance(drowner.id, {
            id: "drowner",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [self] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(grizzlyBears.id, {
                            id: "stunned",
                            controllerId: "p2",
                            ownerId: "p2",
                            ...(stun > 0 ? { counters: { stun } } : {}),
                        }),
                        makeInstance(grizzlyBears.id, {
                            id: "plain",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        return { state, self };
    }

    it("offers only a creature with a stun counter as the target (CR 122.1)", () => {
        const { state } = drownerBoard(1);
        const ids = getLegalTargets(
            state,
            SHUFFLE.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(ids).toEqual(["stunned"]);
    });

    it("puts both objects into their owners' libraries", () => {
        const { state, self } = drownerBoard(1);
        resolveActivated(state, self, SHUFFLE.id, [
            { type: "permanent", id: "stunned" },
        ]);
        const [p1, p2] = state.players;
        expect(p1!.battlefield.map((c) => c.id)).toEqual([]);
        expect(p2!.battlefield.map((c) => c.id)).toEqual(["plain"]);
        expect(p1!.library.map((c) => c.card.id)).toEqual([drowner.id]);
        expect(p2!.library.map((c) => c.card.id)).toEqual([grizzlyBears.id]);
        // CR 701.24a — each owner shuffled: the public insert's placement
        // knowledge (ADR 0026) is ended by the shuffle, in BOTH libraries.
        for (const card of [p1!.library[0]!, p2!.library[0]!])
            expect(card.libraryPositionKnownTo).toBeUndefined();
    });

    it("leaves a Drowner that already left the battlefield where it is (CR 400.7)", () => {
        const { state, self } = drownerBoard(1);
        state.players[0]!.battlefield = [];
        state.players[0]!.graveyard = [{ ...self, zone: "graveyard" }];
        resolveActivated(state, self, SHUFFLE.id, [
            { type: "permanent", id: "stunned" },
        ]);
        const [p1, p2] = state.players;
        expect(p1!.graveyard.map((c) => c.id)).toEqual(["drowner"]);
        expect(p1!.library).toEqual([]);
        expect(p2!.library.map((c) => c.card.id)).toEqual([grizzlyBears.id]);
        expect(p2!.library[0]!.libraryPositionKnownTo).toBeUndefined();
    });
});
