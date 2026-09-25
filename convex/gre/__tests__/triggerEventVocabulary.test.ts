// The event vocabulary a declared trigger carries (issue #3516, PRD #3397).
//
// The walk is exercised end-to-end through real positions in
// `gre/ai/__tests__/verdictStackLowering.bot.test.ts`; what lives here is the
// shape a live game cannot produce but an authored spec or a future event
// field can — the fail-closed edges.

import { describe, expect, it } from "vitest";
import {
    lowerTriggerEvent,
    rebuildTriggerEvent,
} from "../triggerEventVocabulary";
import type { GameEvent } from "../../cards/types";

const PORTS = {
    object: (id: string) =>
        id === "1"
            ? ({
                  zone: "battlefield",
                  name: "Grizzly Bears",
                  seat: "me",
              } as const)
            : undefined,
    player: (id: string) => (id === "p1" ? ("me" as const) : undefined),
    target: () => undefined,
};

describe("the trigger event vocabulary is exhaustive over GameEvent (issue #3516)", () => {
    it("refuses a `residue` field by name rather than dropping it", () => {
        const outcome = lowerTriggerEvent(
            {
                type: "CARDS_EXILED",
                cards: [
                    { cardInstanceId: "1", fromZone: "library", ownerId: "p1" },
                ],
            } as unknown as GameEvent,
            PORTS
        );
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.fields).toEqual(["cards"]);
    });

    it("refuses an `objectList` field that is present but not a list", () => {
        // An empty list would travel as a legitimate "no objects", which a
        // "damaged by" clause reads as a different board (CR 603.2).
        const outcome = lowerTriggerEvent(
            {
                type: "ATTACKERS_DECLARED",
                attackingPlayerId: "p1",
                attackerIds: "1",
            } as unknown as GameEvent,
            PORTS
        );
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.fields).toEqual(["attackerIds"]);
    });

    it("refuses an object the ports cannot name, by field", () => {
        const outcome = lowerTriggerEvent(
            {
                type: "PERMANENT_ENTERED",
                instanceId: "99",
                controllerId: "p1",
                types: ["Creature"],
            } as unknown as GameEvent,
            PORTS
        );
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.fields).toEqual(["instanceId"]);
    });

    it("round-trips an event whose every field the ports CAN name", () => {
        const outcome = lowerTriggerEvent(
            {
                type: "PERMANENT_ENTERED",
                instanceId: "1",
                controllerId: "p1",
                types: ["Creature"],
                wasCast: true,
            } as unknown as GameEvent,
            PORTS
        );
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        const rebuilt = rebuildTriggerEvent(outcome.event, {
            object: () => "7",
            player: () => "q1",
            target: () => ({ type: "player", id: "q1" }),
        });
        expect(rebuilt).toEqual({
            type: "PERMANENT_ENTERED",
            instanceId: "7",
            controllerId: "q1",
            types: ["Creature"],
            wasCast: true,
        });
    });
});
