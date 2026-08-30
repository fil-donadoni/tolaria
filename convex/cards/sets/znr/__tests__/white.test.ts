// ZNR — white card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { luminarchAspirant, skyclaveApparition } from "../white";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { getCardByName } from "../../..";
import type { GameState } from "../../../../gre/state";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { getEffectivePower } from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";

// Luminarch Aspirant — {1}{W} Creature — Human Cleric, 1/1 (CR 603.6a
// combat-begin trigger; CR 122 counter placement). "At the beginning of
// combat on your turn, put a +1/+1 counter on target creature you control."
describe("Luminarch Aspirant (CR 603.6a beginning-of-combat trigger; CR 122 counter)", () => {
    function setup(extraCreatures: string[] = []) {
        const aspirant = makeInstance(luminarchAspirant.id, {
            id: "aspirant",
            controllerId: "p1",
            ownerId: "p1",
        });
        const others = extraCreatures.map((id) =>
            makeInstance(luminarchAspirant.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [aspirant, ...others] })],
            activePlayerId: "p1",
            phase: "BEGINNING_OF_COMBAT",
        });
        return { state, aspirant };
    }

    /** Pushes the beginning-of-combat trigger onto the stack (CR 603.6a) and
     *  returns the on-stack trigger item. `collectTriggers` sets its
     *  `controllerId` and `triggerSourceId` (`buildTriggerItem`). */
    function pushCombatTrigger(state: ReturnType<typeof setup>["state"]) {
        state.stack.push(
            ...collectTriggers(state, [
                {
                    type: "PHASE_BEGIN",
                    phase: "BEGINNING_OF_COMBAT",
                    activePlayerId: "p1",
                },
            ])
        );
        return state.stack[state.stack.length - 1];
    }

    it("auto-selects the sole legal target (CR 603.3d) and puts a +1/+1 counter on it", () => {
        const { state } = setup();
        const trig = pushCombatTrigger(state);
        // Single mandatory legal target — no real choice, the engine locks it
        // at stack placement (raiseTriggerTargetSelection returns false, no
        // PendingTarget raised) then resolveTopOfStack applies the counter.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([{ type: "permanent", id: "aspirant" }]);
        expect(state.pendingTarget).toBeUndefined();
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "aspirant"
        )!;
        expect(live.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, live)).toBe(2);
    });

    it("raises a trigger PendingTarget when 2+ creatures are legal, then applies the counter to the chosen one (CR 603.3d)", () => {
        const { state } = setup(["ally"]);
        pushCombatTrigger(state);
        // Two legal targets — a real choice is owed: the engine raises a
        // kind:"trigger" PendingTarget pointed at the on-stack trigger.
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        expect(state.pendingTarget?.kind).toBe("trigger");
        state.pendingTarget!.selected = [{ type: "permanent", id: "ally" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        resolveTopOfStack(state);
        const ally = state.players[0].battlefield.find((c) => c.id === "ally")!;
        const aspirant = state.players[0].battlefield.find(
            (c) => c.id === "aspirant"
        )!;
        expect(ally.counters?.["+1/+1"]).toBe(1);
        expect(aspirant.counters?.["+1/+1"]).toBeUndefined();
    });

    it("does NOT fire on the opponent's combat step (CR 603.6a scope: your)", () => {
        const { state } = setup();
        state.players.push(makePlayer("p2"));
        state.activePlayerId = "p2";
        const triggers = collectTriggers(state, [
            {
                type: "PHASE_BEGIN",
                phase: "BEGINNING_OF_COMBAT",
                activePlayerId: "p2",
            },
        ]);
        expect(
            triggers.some(
                (t) => t.triggeredAbilityId === "luminarch-aspirant-counter"
            )
        ).toBe(false);
    });

    it("does nothing when there is no creature you control to target (CR 608.2b)", () => {
        const aspirant = makeInstance(luminarchAspirant.id, {
            id: "aspirant",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [makePlayer("p1", { graveyard: [aspirant] })],
            activePlayerId: "p1",
            phase: "BEGINNING_OF_COMBAT",
        });
        // No battlefield creature — collectTriggers finds nothing to scan
        // (the source itself is not on the battlefield here).
        const triggers = collectTriggers(state, [
            {
                type: "PHASE_BEGIN",
                phase: "BEGINNING_OF_COMBAT",
                activePlayerId: "p1",
            },
        ]);
        expect(triggers).toHaveLength(0);
    });

    it("wire format: the +1/+1 counter survives projectPublicState", () => {
        const { state } = setup();
        const trig = pushCombatTrigger(state);
        // Sole legal target auto-locks (CR 603.3d), then resolve.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([{ type: "permanent", id: "aspirant" }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const live = projected.players[0].battlefield.find(
            (c) => c.id === "aspirant"
        )!;
        expect(getEffectivePower(projected, live)).toBe(2);
    });
});

// Skyclave Apparition — {1}{W}{W} Creature — Kor Spirit, 2/2 (issue #2384).
// "When this creature enters, exile up to one target nonland, nontoken
// permanent you don't control with mana value 4 or less. // When this creature
// leaves the battlefield, the exiled card's owner creates an X/X blue Illusion
// creature token, where X is the mana value of the exiled card."
//
// The point of the card — and of these tests — is that the two abilities are
// arbitrarily far apart: the leave-trigger reads a CR 608.2h snapshot taken at
// the exile, never a live lookup of a card CR 400.7 has already turned into a
// different object.
describe("Skyclave Apparition (CR 603.6a ETB exile; CR 603.10a leave-trigger; CR 608.2h snapshot)", () => {
    /** `opponentCards` are staged on p2's battlefield; `ownCards` on p1's,
     *  alongside the Apparition itself. */
    function setup(opponentNames: string[], ownNames: string[] = []) {
        const apparition = makeInstance(skyclaveApparition.id, {
            id: "apparition",
            controllerId: "p1",
            ownerId: "p1",
        });
        const mk = (name: string, controllerId: string, i: number) =>
            makeInstance(getCardByName(name)!.id, {
                id: `${controllerId}-${i}`,
                controllerId,
                ownerId: controllerId,
            });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        apparition,
                        ...ownNames.map((n, i) => mk(n, "p1", i)),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: opponentNames.map((n, i) => mk(n, "p2", i)),
                }),
            ],
        });
        return { state };
    }

    /** Fires the Apparition's ETB (CR 603.6a) through the REAL announcement
     *  path and resolves it. Returns the on-stack trigger so a caller can
     *  assert what the engine locked. */
    function fireEtb(state: GameState, chosenId?: string) {
        state.stack.push(
            ...collectTriggers(state, [
                {
                    type: "PERMANENT_ENTERED",
                    instanceId: "apparition",
                    controllerId: "p1",
                    types: ["Creature"],
                },
            ])
        );
        const trig = state.stack[state.stack.length - 1];
        if (raiseTriggerTargetSelection(state)) {
            state.pendingTarget!.selected = chosenId
                ? [{ type: "permanent", id: chosenId }]
                : [];
            finalizeTargetSelection(
                state,
                state.pendingTarget!,
                state.pendingTarget!.playerId
            );
        }
        resolveTopOfStack(state);
        return trig;
    }

    /** Sends the Apparition to `zone` and resolves the leave-trigger
     *  (CR 603.10a). */
    function fireLtb(state: GameState, zone: "graveyard" | "hand") {
        removePermanentTo(state, "apparition", zone);
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "skyclave-apparition-token"
        );
        expect(trig).toBeDefined();
        state.stack = state.stack.filter((s) => s.id !== trig!.id);
        state.stack.push(trig!);
        resolveTopOfStack(state);
    }

    const tokensOf = (state: GameState, i: number) =>
        state.players[i].battlefield.filter((c) => c.isToken === true);

    it("exiles the chosen permanent, then MANY TURNS LATER gives its OWNER an X/X Illusion sized by the exiled card's mana value", () => {
        // Hypnotic Specter — {1}{B}{B}, mana value 3 (CR 202.3).
        const { state } = setup(["Hypnotic Specter"]);
        fireEtb(state, "p2-0");
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id)).toEqual(["p2-0"]);

        // The gap the stub called impossible: the leave-trigger fires on a
        // later turn, with nothing on the stack tying the two together.
        state.turn = 7;
        fireLtb(state, "graveyard");

        expect(tokensOf(state, 0)).toHaveLength(0);
        const tokens = tokensOf(state, 1); // CR 108.3 — the exiled CARD's owner
        expect(tokens).toHaveLength(1);
        expect(tokens[0].power).toBe(3);
        expect(tokens[0].toughness).toBe(3);
        expect(tokens[0].subtypes).toContain("Illusion");
        // The exile is permanent — no play-from-exile grant is stamped.
        const exiled = state.players[1].exile[0];
        expect(exiled.castableFromExileBy).toBeUndefined();
    });

    it("offers no legal target when the opponent has only a mana value 5 permanent and you control the rest, and then creates no token", () => {
        // Serra Angel is {3}{W}{W} — mana value 5, above the 4-or-less cap;
        // the Grizzly Bears is YOURS, so "you don't control" excludes it.
        const { state } = setup(["Serra Angel"], ["Grizzly Bears"]);
        const trig = fireEtb(state);
        expect(trig.targets).toEqual([]);
        expect(state.players[1].exile).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(1);

        fireLtb(state, "graveyard");
        expect(tokensOf(state, 0)).toHaveLength(0);
        expect(tokensOf(state, 1)).toHaveLength(0);
    });

    it("fires on a BOUNCE too — the leave-trigger is zone-agnostic (CR 603.10a)", () => {
        const { state } = setup(["Hypnotic Specter"]);
        fireEtb(state, "p2-0");
        fireLtb(state, "hand");
        expect(state.players[0].hand.map((c) => c.id)).toContain("apparition");
        expect(tokensOf(state, 1)).toHaveLength(1);
        expect(tokensOf(state, 1)[0].power).toBe(3);
    });

    it("wire format: the Illusion's computed P/T survives projectPublicState", () => {
        const { state } = setup(["Hypnotic Specter"]);
        fireEtb(state, "p2-0");
        fireLtb(state, "graveyard");
        const projected = projectPublicState(state, 1, "p1");
        const token = projected.players[1].battlefield.find(
            (c) => c.isToken === true
        )!;
        expect(token.power).toBe(3);
        expect(token.toughness).toBe(3);
        expect(token.subtypes).toContain("Illusion");
    });
});
