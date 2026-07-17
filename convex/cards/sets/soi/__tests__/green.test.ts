// soi/__tests__/green.test.ts — Tireless Tracker (CR 603.6a Landfall,
// CR 701.16 Investigate, CR 205.3-scoped "whenever you sacrifice a Clue").
// Both triggered abilities are DSL (Effect Script) reusing already-exercised
// Ops (createToken, counters, draw) PLUS the new engine capability this card
// exists to prove (issue #1191): a token-scoped activated ability on a
// `createToken` spec, and a subtype-filtered sacrifice `leftTrigger`. Per
// `.claude/rules/gre-development.md` § DSL-first authoring, a card that
// depends on a genuinely new capability (not just reused Ops) earns a
// hand-written test — this is that test. The Op-level regression coverage for
// the two new capabilities themselves lives in
// `convex/gre/effects/__tests__/interpreter.test.ts` (token.activatedAbilities)
// and `convex/cards/abilities/triggers/__tests__/leftTrigger.test.ts`
// (subtype filter / wasSacrificed).

import { describe, it, expect } from "vitest";
import { tirelessTracker } from "../green";
import { getCardByName, getDefinition } from "../../../index";
import {
    resolveTopOfStack,
    removePermanentTo,
    processPendingActionTriggers,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

const SWAMP_ID = getCardByName("Swamp").id;

/** A hand-crafted Clue-shaped token id — `getDefinition` synthesizes it on
 *  demand via `maybeSynthesizeToken` (same client-rehydration path exercised
 *  by `tokenRegistry.test.ts`), so a test can drop a Clue onto the
 *  battlefield without running the full landfall→investigate resolution
 *  first. Matches the shape `CLUE_TOKEN_SPEC` produces: Artifact, subtype
 *  Clue, no P/T. */
const CLUE_TOKEN_ID = "token:Clue|Artifact|Clue||||||||";
/** A same-shaped non-Clue artifact token, for the negative "not a Clue"
 *  sacrifice-trigger test. */
const OTHER_TOKEN_ID = "token:Servo|Artifact,Creature|Servo|||1|1|||";

function landEntered(instanceId: string, controllerId: string) {
    return {
        type: "PERMANENT_ENTERED" as const,
        instanceId,
        controllerId,
        cardId: SWAMP_ID,
        types: ["Land"] as const,
    };
}

describe("Tireless Tracker — Landfall investigate (CR 603.6a / 701.16, issue #1191)", () => {
    it("a land you control entering creates a Clue token (an artifact with the sac-draw ability)", () => {
        const tracker = makeInstance(tirelessTracker.id, {
            id: "tracker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(SWAMP_ID, {
            id: "land1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tracker, land] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [landEntered("land1", "p1")]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        resolveTopOfStack(state);

        const clue = state.players[0].battlefield.find((c) => c.isToken);
        expect(clue).toBeDefined();
        expect(clue!.types).toEqual(["Artifact"]);
        expect(clue!.subtypes).toContain("Clue");
        const def = getDefinition((clue!.card as { id: string }).id);
        expect(def.activatedAbilities).toHaveLength(1);
        expect(def.activatedAbilities![0]).toMatchObject({
            id: "sacrifice-draw",
            oracleText: "{2}, Sacrifice this token: Draw a card.",
        });
    });

    it("an opponent's land entering does NOT trigger (CR 109.2 — you control)", () => {
        const tracker = makeInstance(tirelessTracker.id, {
            id: "tracker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tracker] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [landEntered("oland", "p2")]);
        expect(triggers).toHaveLength(0);
    });

    it("a spell/creature entering does NOT trigger (Landfall is Land-only)", () => {
        const tracker = makeInstance(tirelessTracker.id, {
            id: "tracker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tracker] }),
                makePlayer("p2"),
            ],
        });
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED" as const,
                instanceId: "bear1",
                controllerId: "p1",
                types: ["Creature"] as const,
            },
        ]);
        expect(triggers).toHaveLength(0);
    });
});

describe("Tireless Tracker — sacrifice-a-Clue (+1/+1 counter, CR 701.16 / 205.3, issue #1191)", () => {
    function setup() {
        const tracker = makeInstance(tirelessTracker.id, {
            id: "tracker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const clue = makeInstance(CLUE_TOKEN_ID, {
            id: "clue1",
            controllerId: "p1",
            ownerId: "p1",
            isToken: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tracker, clue] }),
                makePlayer("p2"),
            ],
        });
        return { state };
    }

    it("sacrificing a Clue you control puts a +1/+1 counter on Tireless Tracker", () => {
        const { state } = setup();
        removePermanentTo(state, "clue1", "graveyard", "sacrifice");
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "sac-clue-counter"
        );
        expect(trig).toBeDefined();
        resolveTopOfStack(state);
        const trackerAfter = state.players[0].battlefield.find(
            (c) => c.id === "tracker"
        )!;
        expect(trackerAfter.counters?.["+1/+1"]).toBe(1);
    });

    it("does NOT fire when the sacrificed permanent isn't a Clue (a Servo)", () => {
        const tracker = makeInstance(tirelessTracker.id, {
            id: "tracker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const servo = makeInstance(OTHER_TOKEN_ID, {
            id: "servo1",
            controllerId: "p1",
            ownerId: "p1",
            isToken: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tracker, servo] }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "servo1", "graveyard", "sacrifice");
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "sac-clue-counter"
        );
        expect(trig).toBeUndefined();
    });

    it("does NOT fire when the Clue was destroyed, not sacrificed (CR 701.8 vs 701.16)", () => {
        const { state } = setup();
        removePermanentTo(state, "clue1", "graveyard", "destroy");
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "sac-clue-counter"
        );
        expect(trig).toBeUndefined();
    });

    it("does NOT fire when an OPPONENT sacrifices their own Clue (scope: yours)", () => {
        const tracker = makeInstance(tirelessTracker.id, {
            id: "tracker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const oppClue = makeInstance(CLUE_TOKEN_ID, {
            id: "oclue",
            controllerId: "p2",
            ownerId: "p2",
            isToken: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tracker] }),
                makePlayer("p2", { battlefield: [oppClue] }),
            ],
        });
        removePermanentTo(state, "oclue", "graveyard", "sacrifice");
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "sac-clue-counter"
        );
        expect(trig).toBeUndefined();
    });

    // Wire format (mandatory — the +1/+1 counter is board-visible): the
    // projection strips `card.card` to `{ id }`, but the counter lives on the
    // CardInstanceState itself and must survive projectPublicState unchanged.
    it("wire format: the +1/+1 counter survives projectPublicState", () => {
        const { state } = setup();
        removePermanentTo(state, "clue1", "graveyard", "sacrifice");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "tracker"
        )!;
        expect(slim).toBeDefined();
        expect(slim.counters?.["+1/+1"]).toBe(1);
    });
});
