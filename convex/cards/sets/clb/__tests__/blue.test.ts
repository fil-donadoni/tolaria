// CLB blue — per-colour card behavior tests (ADR 0043 parallel test file).
//
// Displacer Kitten (issue #1375, closing the #1308 residue stub) is the first
// card to combine three previously-separate shipped pieces in ONE ability:
// a CR 603.2 SPELL_CAST "whenever you cast a noncreature spell" trigger, a
// CR 603.3d "up to one target" announced at stack placement (issue #1193),
// and the CR 400.7 SAME-RESOLUTION blink (`exile` bind + `moveZone` ref,
// issue #1401). Each piece has its own coverage; the combination — in
// particular an `{ target: 0 }` Effect Script reading a 0..1 slot that may be
// EMPTY — does not, so it earns a hand-written test.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import { emitSpellCastEvent, resolveTopOfStack } from "../../../../gre/state";
import {
    collectTriggers,
    placeTriggersOnStack,
} from "../../../../gre/triggers";
import {
    getLegalTargets,
    raiseTriggerTargetSelection,
} from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import { PERMANENT_TYPES } from "../../../types";
import { displacerKitten } from "../blue";
import { lightningBolt } from "../../lea/red";
import { balduvianBears } from "../../ice/green";
import { forest } from "../../lea/colorless";

const ABILITY_ID = "displacer-kitten-blink";

/** Casts `cardId` for `casterId` and runs the real cast-trigger pass: emit
 *  SPELL_CAST (CR 601.2i), collect the triggers it fires, put them on the
 *  stack. Returns the collected trigger count. */
function castAndCollect(
    state: GameState,
    cardId: string,
    casterId: string
): number {
    const spell = pushSpell(state, cardId, casterId, []);
    emitSpellCastEvent(state, spell);
    const triggers = collectTriggers(state, state.pendingEvents ?? []);
    state.pendingEvents = [];
    // Drop the cast spell itself — this test exercises the trigger, not the
    // spell's own resolution.
    state.stack = state.stack.filter((s) => s.id !== spell.id);
    placeTriggersOnStack(state, triggers);
    return triggers.length;
}

/** Drives the CR 603.3d choice through the real machinery: raise the
 *  `kind: "trigger"` PendingTarget (count 0..1), then write the chosen target
 *  (or the empty "decline" set) onto the on-stack trigger. */
function chooseTarget(state: GameState, targetId: string | null) {
    expect(raiseTriggerTargetSelection(state)).toBe(true);
    state.pendingTarget!.selected = targetId
        ? [{ type: "permanent", id: targetId }]
        : [];
    finalizeTargetSelection(
        state,
        state.pendingTarget!,
        state.pendingTarget!.playerId
    );
}

function kittenOn(controllerId: string): CardInstanceState {
    return makeInstance(displacerKitten.id, {
        id: "kitten1",
        controllerId,
        ownerId: controllerId,
    });
}

describe("Displacer Kitten — definition (CLB, issue #1375)", () => {
    it("pins mana cost, stats, subtypes, and declares NO keyword (Avoidance is an ability word)", () => {
        expect(displacerKitten.manaCost).toEqual({ X: 3, U: 1 });
        expect(displacerKitten.types).toEqual(["Creature"]);
        expect(displacerKitten.subtypes).toEqual(["Cat", "Beast"]);
        expect(displacerKitten.power).toBe(2);
        expect(displacerKitten.toughness).toBe(2);
        expect(displacerKitten.staticAbilities).toBeUndefined();
    });

    it("declares the CR 603.3d target requirement: up to one nonland permanent YOU control", () => {
        expect(
            displacerKitten.triggeredAbilities?.[0]?.targetRequirement
        ).toEqual({
            type: [...PERMANENT_TYPES],
            count: { min: 0, max: 1 },
            excludeTypes: "Land",
            controller: "you",
        });
    });

    it("is DSL-first (ADR 0045): the blink is an exile-bind + moveZone-ref pair, no resolve()", () => {
        const ability = displacerKitten.triggeredAbilities?.[0];
        expect(ability?.id).toBe(ABILITY_ID);
        expect(ability?.resolve).toBeUndefined();
        expect(ability?.effects).toEqual([
            { op: "exile", target: { target: 0 }, bind: "$c" },
            { op: "moveZone", target: { ref: "$c" }, to: "battlefield" },
        ]);
    });
});

describe("Displacer Kitten — trigger condition (CR 603.2 / 601.2i)", () => {
    it("fires when its controller casts a NONCREATURE spell", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kittenOn("p1")] }),
                makePlayer("p2"),
            ],
        });
        expect(castAndCollect(state, lightningBolt.id, "p1")).toBe(1);
        expect(state.stack[0]?.triggeredAbilityId).toBe(ABILITY_ID);
    });

    it("does NOT fire on a CREATURE spell", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kittenOn("p1")] }),
                makePlayer("p2"),
            ],
        });
        expect(castAndCollect(state, balduvianBears.id, "p1")).toBe(0);
    });

    it('does NOT fire on the OPPONENT\'s noncreature spell ("whenever YOU cast")', () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kittenOn("p1")] }),
                makePlayer("p2"),
            ],
        });
        expect(castAndCollect(state, lightningBolt.id, "p2")).toBe(0);
    });
});

describe("Displacer Kitten — same-resolution blink (CR 400.7, issue #1401)", () => {
    it("exiles the chosen nonland permanent and returns it to the battlefield in ONE resolution", () => {
        const bears = makeInstance(balduvianBears.id, {
            id: "bears1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kittenOn("p1"), bears] }),
                makePlayer("p2"),
            ],
        });
        expect(castAndCollect(state, lightningBolt.id, "p1")).toBe(1);
        chooseTarget(state, "bears1");
        expect(resolveTopOfStack(state)).not.toBeNull();

        // Back on the battlefield, and NOT left sitting in exile.
        expect(state.players[0].exile.map((c) => c.id)).not.toContain("bears1");
        const returned = state.players[0].battlefield.find(
            (c) => c.card.id === balduvianBears.id
        );
        expect(returned).toBeDefined();
        // CR 400.7 — a new object; controller is the OWNER (the Oracle text's
        // "under its owner's control", the `moveZone` default).
        expect(returned!.controllerId).toBe("p1");
        expect(returned!.ownerId).toBe("p1");
    });

    it("returns the card under its OWNER's control, not the Kitten controller's", () => {
        // A permanent P1 controls but P2 owns (stolen with a control-change
        // effect) is still "a nonland permanent you control" and a legal
        // target; the return hands it back to its OWNER (CR 400.7 / 110.2).
        const stolen = makeInstance(balduvianBears.id, {
            id: "stolen1",
            controllerId: "p1",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kittenOn("p1"), stolen] }),
                makePlayer("p2"),
            ],
        });
        expect(castAndCollect(state, lightningBolt.id, "p1")).toBe(1);
        chooseTarget(state, "stolen1");
        expect(resolveTopOfStack(state)).not.toBeNull();

        const returned = state.players[1].battlefield.find(
            (c) => c.card.id === balduvianBears.id
        );
        expect(returned).toBeDefined();
        expect(returned!.controllerId).toBe("p2");
        expect(
            state.players[0].battlefield.some(
                (c) => c.card.id === balduvianBears.id
            )
        ).toBe(false);
    });

    it('"up to one" with NO target chosen is a clean no-op (unbound $c, nothing exiled)', () => {
        const bears = makeInstance(balduvianBears.id, {
            id: "bears1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kittenOn("p1"), bears] }),
                makePlayer("p2"),
            ],
        });
        expect(castAndCollect(state, lightningBolt.id, "p1")).toBe(1);
        chooseTarget(state, null);
        expect(resolveTopOfStack(state)).not.toBeNull();

        expect(state.players[0].exile).toHaveLength(0);
        expect(
            state.players[0].battlefield.find((c) => c.id === "bears1")
        ).toBeDefined();
    });

    it("offers only NONLAND permanents YOU control (no land, nothing of the opponent's)", () => {
        const land = makeInstance(forest.id, {
            id: "forest1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const theirs = makeInstance(balduvianBears.id, {
            id: "theirs1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kittenOn("p1"), land] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            displacerKitten.triggeredAbilities![0]!.targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(legal).not.toContain("forest1");
        expect(legal).not.toContain("theirs1");
        // The Kitten itself IS eligible — the Oracle text has no "other".
        expect(legal).toContain("kitten1");
    });

    it("wire format: the blinked permanent is on the battlefield after projectPublicState", () => {
        const bears = makeInstance(balduvianBears.id, {
            id: "bears1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [kittenOn("p1"), bears] }),
                makePlayer("p2"),
            ],
        });
        expect(castAndCollect(state, lightningBolt.id, "p1")).toBe(1);
        chooseTarget(state, "bears1");
        expect(resolveTopOfStack(state)).not.toBeNull();

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.card.id === balduvianBears.id
        );
        expect(slim).toBeDefined();
        expect(slim!.controllerId).toBe("p1");
        expect(projected.players[0].exile).toHaveLength(0);
    });
});
