// MH3 black — per-colour card behavior tests (ADR 0043 parallel test file).
import { describe, it, expect } from "vitest";
import { nethergoyf, emperorOfBones } from "../black";
import { grizzlyBears } from "../../lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import {
    resolveTopOfStack,
    buildSpellContext,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { fireDelayedTriggers } from "../../../../gre/phases";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import type { CardType } from "../../../types";

// A dead card of a chosen card type sitting in a graveyard (the CDA reads the
// instance `.types`).
function deadCard(
    id: string,
    owner: string,
    types: CardType[]
): CardInstanceState {
    return {
        id,
        card: { id: `fake-${id}` },
        types,
        subtypes: [],
        staticAbilities: [],
        power: 0,
        toughness: 0,
        controllerId: owner,
        ownerId: owner,
        zone: "graveyard",
        isTapped: false,
    };
}

describe("Nethergoyf (CR 604.3 card-type-counting CDA P/T, CR 702.138 escape)", () => {
    it("power = distinct card types in YOUR graveyard, toughness = that + 1", () => {
        const goyf = makeInstance(nethergoyf.id, {
            id: "goyf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [goyf],
                    graveyard: [
                        deadCard("c1", "p1", ["Creature"]),
                        deadCard("c2", "p1", ["Creature"]), // dup type
                        deadCard("l1", "p1", ["Land"]),
                        deadCard("i1", "p1", ["Instant"]),
                    ],
                }),
                // Opponent's graveyard must NOT count ("YOUR graveyard").
                makePlayer("p2", {
                    graveyard: [deadCard("x1", "p2", ["Sorcery"])],
                }),
            ],
        });
        const after = state.players[0].battlefield[0];
        // Creature, Land, Instant = 3 distinct types in p1's graveyard → 3/4.
        expect(getEffectivePower(state, after)).toBe(3);
        expect(getEffectiveToughness(state, after)).toBe(4);
    });

    it("MANDATORY wire format: the card-type count survives projectPublicState", () => {
        const goyf = makeInstance(nethergoyf.id, {
            id: "goyf",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [goyf],
                    graveyard: [
                        deadCard("c1", "p1", ["Creature"]),
                        deadCard("i1", "p1", ["Instant"]),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const before = state.players[0].battlefield[0];
        expect(getEffectivePower(state, before)).toBe(2);
        expect(getEffectiveToughness(state, before)).toBe(3);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "goyf"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

// Emperor of Bones (issue #1323, parent #917) — composes Adapt (#1316),
// linked-exile tracking (#1319 foundation), and the counter-placement
// meta-trigger (#1319 foundation), plus a NEW small primitive this ticket
// adds: the finality counter's intrinsic graveyard-bound-from-battlefield
// redirect (`removePermanentTo`, `gre/state.ts`; see
// `gre/__tests__/finalityCounter.test.ts` for that primitive's own tests in
// isolation). The reanimation clause's `moveZone` shapes (`linkToSource` on
// the announced-target shape, the new `exiledWithSource` sixth shape) are
// permanent-tested in `gre/effects/__tests__/interpreter.test.ts`; this file
// is the CARD-level wiring proof — the smoke sweep SKIPS any script
// containing `moveZone`, so per `.claude/rules/gre-development.md` § DSL-first
// authoring this earns a hand-written test.
describe("Emperor of Bones (CR 603.6a combat trigger, CR 701.46 adapt, CR 607 linked-exile reanimation)", () => {
    /** Puts a triggered ability on the stack WITHOUT resolving it — mirrors
     *  `collectTriggers`/`buildTriggerItem`'s own shape (`triggerSourceId` +
     *  `triggerEvent`), the same idiom Soul-Guide Lantern's own test uses for
     *  a `targetRequirement`-bearing trigger (`thb/__tests__/colorless.test.ts`). */
    function pushTrigger(
        state: GameState,
        source: CardInstanceState,
        triggeredAbilityId: string,
        triggerEvent: StackItem["triggerEvent"]
    ): void {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: source.controllerId,
            triggeredAbilityId,
            triggerSourceId: source.id,
            triggerEvent,
        } as StackItem);
    }

    function emperor(id: string, controllerId: string): CardInstanceState {
        return makeInstance(emperorOfBones.id, {
            id,
            controllerId,
            ownerId: controllerId,
        });
    }

    function gyCreature(id: string, owner: string): CardInstanceState {
        return makeInstance(grizzlyBears.id, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone: "graveyard",
        });
    }

    it("exiles the announced target card from EITHER player's graveyard and links it to itself", () => {
        const boss = emperor("emp1", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [boss] }),
                makePlayer("p2", { graveyard: [gyCreature("gy1", "p2")] }),
            ],
        });
        pushTrigger(state, boss, "emperor-of-bones-exile", {
            type: "PHASE_BEGIN",
            phase: "BEGINNING_OF_COMBAT",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);

        expect(raiseTriggerTargetSelection(state)).toBe(true);
        state.pendingTarget!.selected = [
            { type: "graveyard-card", id: "gy1", playerId: "p2" },
        ];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);

        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id)).toContain("gy1");

        // Linked to EMPEROR's own instance id, not the resolving stack item.
        const spell = pushSpell(state, emperorOfBones.id, "p1");
        const ctx = buildSpellContext(state, spell);
        expect(ctx.getCardsExiledWith("emp1").map((c) => c.id)).toEqual([
            "gy1",
        ]);
    });

    it('"up to one" — declining the target is legal and exiles nothing', () => {
        const boss = emperor("emp2", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [boss] }),
                makePlayer("p2", { graveyard: [gyCreature("gy2", "p2")] }),
            ],
        });
        pushTrigger(state, boss, "emperor-of-bones-exile", {
            type: "PHASE_BEGIN",
            phase: "BEGINNING_OF_COMBAT",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);

        expect(raiseTriggerTargetSelection(state)).toBe(true);
        state.pendingTarget!.selected = [];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["gy2"]);
        expect(state.players[1].exile).toHaveLength(0);
    });

    // The marquee integration test: exile → adapt → reanimate (finality
    // counter + haste) → delayed sacrifice, which — because of the finality
    // counter — lands the sacrificed creature in EXILE, not the graveyard
    // (proving the new engine-level finality-counter redirect end to end
    // through a real card, not just the synthetic fixture in
    // `gre/__tests__/finalityCounter.test.ts`).
    it("adapt's counter placement reanimates the linked creature (haste, finality counter), sacrificed to EXILE at the next end step", () => {
        const boss = emperor("emp3", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [boss],
                    manaPool: { W: 0, U: 0, B: 1, R: 0, G: 0, C: 0 },
                }),
                // The exiled card is OPPONENT-owned — "under your control"
                // must still bring it under p1 (CR 800.4a).
                makePlayer("p2", { graveyard: [gyCreature("gy3", "p2")] }),
            ],
        });

        // Ability 1: exile gy3, linked to emp3.
        pushTrigger(state, boss, "emperor-of-bones-exile", {
            type: "PHASE_BEGIN",
            phase: "BEGINNING_OF_COMBAT",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        raiseTriggerTargetSelection(state);
        state.pendingTarget!.selected = [
            { type: "graveyard-card", id: "gy3", playerId: "p2" },
        ];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);
        expect(state.players[1].exile.map((c) => c.id)).toContain("gy3");

        // Ability 2: activate Adapt 2 — emp3 has no +1/+1 counters, so this
        // puts two on it, firing the COUNTER_ADDED meta-trigger (ability 3).
        state.stack.push({
            ...boss,
            zone: "stack",
            castById: "p1",
            abilityId: "emperor-of-bones-adapt",
        } as StackItem);
        resolveTopOfStack(state);
        const adapted = state.players[0].battlefield.find(
            (c) => c.id === "emp3"
        )!;
        expect(adapted.counters).toEqual({ "+1/+1": 2 });

        // The meta-trigger is now on the stack — resolve it.
        const onStack = state.stack[state.stack.length - 1];
        expect(onStack?.triggeredAbilityId).toBe("emperor-of-bones-reanimate");
        resolveTopOfStack(state);

        const reanimated = state.players[0].battlefield.find(
            (c) => c.id === "gy3"
        );
        expect(reanimated).toBeDefined();
        // "under your control" — p1 controls it even though p2 owns it.
        expect(reanimated!.controllerId).toBe("p1");
        expect(reanimated!.ownerId).toBe("p2");
        expect(reanimated!.counters).toEqual({ finality: 1 });
        expect(reanimated!.staticAbilities).toContain("haste");
        expect(state.players[1].exile.some((c) => c.id === "gy3")).toBe(false);

        // Wire format — the reanimated permanent's finality counter and
        // haste are visible to BOTH viewers (battlefield is public, CR 400.2).
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "gy3"
            )!;
            expect(slim.counters).toEqual({ finality: 1 });
            expect(slim.staticAbilities).toContain("haste");
        }

        // CR 603.7 — sacrificed at the beginning of the next end step. The
        // finality counter redirects the sacrifice from graveyard to EXILE
        // (MH3 reminder text: "If this permanent would be put into a
        // graveyard from the battlefield, exile it instead").
        expect(state.delayedTriggers).toHaveLength(1);
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.some((c) => c.id === "gy3")).toBe(
            false
        );
        expect(state.players[1].graveyard.some((c) => c.id === "gy3")).toBe(
            false
        );
        expect(state.players[1].exile.some((c) => c.id === "gy3")).toBe(true);
    });

    it("the reanimation trigger is a clean CR 608.2b no-op when nothing is exiled with Emperor", () => {
        const boss = emperor("emp4", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [boss] }),
                makePlayer("p2"),
            ],
        });
        // Adapt fires the meta-trigger with an EMPTY linked-exile pile.
        state.stack.push({
            ...boss,
            zone: "stack",
            castById: "p1",
            abilityId: "emperor-of-bones-adapt",
        } as StackItem);
        resolveTopOfStack(state);
        const onStack = state.stack[state.stack.length - 1];
        expect(onStack?.triggeredAbilityId).toBe("emperor-of-bones-reanimate");
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual(["emp4"]);
        // `$reanimated` never bound (nothing was exiled with Emperor), so the
        // `delayedTrigger` Op does not schedule a "sacrifice it" instance
        // with nothing to act on (CR 608.2b, issue #2490) — before the fix
        // it scheduled anyway, leaving inert `delayedTriggers[]` residue that
        // would fire and sacrifice nothing at the next end step (the exact
        // Shallow Grave bug, `mir/black.ts`, shares this script shape).
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });
});
