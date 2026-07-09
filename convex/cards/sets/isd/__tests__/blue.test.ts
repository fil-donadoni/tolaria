// ISD (Innistrad) — blue behavior tests (ADR 0043 colour split).
//
// Snapcaster Mage's ETB grants Flashback (CR 702.34) to a chosen instant/sorcery
// in the controller's graveyard, with cost = its mana cost. The grant is an
// instance-level flashback (`grantedFlashback`) that expires at cleanup. This
// test drives the real trigger + choice + grant path (resolveTopOfStack suspends
// on the choice, applyPendingChoiceSubmit resumes it) and re-checks the outcome
// through projectPublicState — the granted card must arrive on the wire tagged
// with the Flashback cast affordance.
import { describe, it, expect } from "vitest";
import { snapcasterMage } from "../blue";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack, getPlayer } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { getFlashbackCost } from "../../../../gre/flashback";
import { projectPublicState } from "../../../../gameProjections";
import { firebolt } from "../../ody/red";
import { grizzlyBears } from "../../lea";

describe("Snapcaster Mage (ETB grants flashback, CR 702.34)", () => {
    it("is a {1}{U} 2/1 Human Wizard with flash", () => {
        expect(snapcasterMage.manaCost).toEqual({ X: 1, U: 1 });
        expect(snapcasterMage.power).toBe(2);
        expect(snapcasterMage.toughness).toBe(1);
        expect(snapcasterMage.subtypes).toEqual(["Human", "Wizard"]);
        expect(snapcasterMage.staticAbilities).toContain("flash");
    });

    it("grants the chosen instant/sorcery flashback = its mana cost, tagged on the wire", () => {
        const snap = makeInstance(snapcasterMage.id, {
            id: "snap",
            zone: "battlefield",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A sorcery (grantable) and a creature (not an instant/sorcery) in the
        // controller's graveyard.
        const fb = makeInstance(firebolt.id, {
            id: "gy-firebolt",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "gy-bear",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [snap],
                    graveyard: [fb, bear],
                    // Enough to flash Firebolt back at its own mana cost ({R}).
                    manaPool: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0 },
                }),
                makePlayer("p2"),
            ],
        });

        // Fire the self-ETB trigger (mirrors collectTriggers + buildTriggerItem).
        state.stack.push({
            ...snap,
            id: "trig-snap-etb",
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "snapcaster-mage-etb-flashback",
            triggerSourceId: "snap",
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: "snap",
                controllerId: "p1",
                types: snap.types,
            },
            targets: [],
        });

        const first = resolveTopOfStack(state);
        expect(first).toBeNull(); // suspended on the choose-graveyard-card choice
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: head.playerId,
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["gy-firebolt"],
        });

        // CR 702.34 — Firebolt now has flashback = its own mana cost ({R}).
        const grantedFirebolt = getPlayer(state, "p1").graveyard.find(
            (c) => c.id === "gy-firebolt"
        )!;
        expect(grantedFirebolt.grantedFlashback).toEqual({ R: 1 });
        expect(getFlashbackCost(grantedFirebolt)).toEqual({ R: 1 });

        // Frontend wiring — the granted card crosses the wire with the cast
        // affordance ("cast"), since its flashback ({R}) is now affordable.
        const projected = projectPublicState(state, 1, "p1");
        const projFirebolt = projected.players[0].graveyard.find(
            (c) => c.id === "gy-firebolt"
        )!;
        expect(projFirebolt.legalActions).toEqual(["cast"]);
    });

    it("does nothing when the graveyard has no instant or sorcery", () => {
        const snap = makeInstance(snapcasterMage.id, {
            id: "snap2",
            zone: "battlefield",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "gy-bear-2",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [snap], graveyard: [bear] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...snap,
            id: "trig-snap-etb-2",
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "snapcaster-mage-etb-flashback",
            triggerSourceId: "snap2",
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: "snap2",
                controllerId: "p1",
                types: snap.types,
            },
            targets: [],
        });
        // Resolves fully with no choice (no legal card to grant).
        const result = resolveTopOfStack(state);
        expect(result).not.toBeNull();
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(
            getPlayer(state, "p1").graveyard[0].grantedFlashback
        ).toBeUndefined();
    });
});
