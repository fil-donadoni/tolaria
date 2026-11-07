// State-based actions pinned by their CR id: the world rule (CR 704.5k), a
// non-attachment permanent that is attached (CR 704.5p) and a permanent over
// its own counter cap (CR 704.5r), each through the real SBA entry point.
import { describe, it, expect } from "vitest";
import {
    checkAttachmentSBA,
    checkCounterLimitSBA,
    checkStateBasedActions,
    checkWorldRuleSBA,
} from "../sba";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName, withTemporaryDefinition } from "../../cards";

const CROSSROADS = getCardByName("Concordant Crossroads");
const BEARS = getCardByName("Grizzly Bears");
const RASPUTIN = getCardByName("Rasputin Dreamweaver");

describe("world rule (CR 704.5k)", () => {
    it("puts every World permanent but the newest into its owner's graveyard", () => {
        const older = makeInstance(CROSSROADS.id, {
            id: "older",
            worldSeq: 1,
        });
        const newer = makeInstance(CROSSROADS.id, {
            id: "newer",
            controllerId: "p2",
            worldSeq: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [older] }),
                makePlayer("p2", { battlefield: [newer] }),
            ],
        });
        expect(checkWorldRuleSBA(state)).toBe(true);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["older"]);
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "newer",
        ]);
    });
});

describe("attached creature becomes unattached (CR 704.5p)", () => {
    it("unattaches a creature that is neither an Aura nor an Equipment, and it remains on the battlefield", () => {
        const host = makeInstance(BEARS.id, { id: "host" });
        const attached = makeInstance(BEARS.id, {
            id: "attached",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, attached] }),
                makePlayer("p2"),
            ],
        });
        expect(checkAttachmentSBA(state)).toBe(true);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "attached"
        );
        expect(after).toBeDefined();
        expect(after?.attachedTo).toBeUndefined();
        expect(state.players[0].graveyard).toHaveLength(0);
    });
});

describe("counter cap (CR 704.5r)", () => {
    it("removes all but N counters of the capped kind", () => {
        const rasputin = makeInstance(RASPUTIN.id, {
            id: "ras",
            counters: { dream: 9 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rasputin] }),
                makePlayer("p2"),
            ],
        });
        checkStateBasedActions(state);
        expect(rasputin.counters?.dream).toBe(7);
    });

    it("leaves other kinds alone and removes a zero-capped kind entirely", () => {
        const capped = {
            ...BEARS,
            counterLimits: [{ counter: "charge", max: 0 }],
        };
        withTemporaryDefinition(capped, () => {
            const bears = makeInstance(BEARS.id, {
                id: "bears",
                counters: { charge: 2, "+1/+1": 3 },
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [bears] }),
                    makePlayer("p2"),
                ],
            });
            expect(checkCounterLimitSBA(state)).toBe(true);
            expect(bears.counters).toEqual({ "+1/+1": 3 });
        });
    });

    it("does not apply while the permanent has lost all abilities (CR 613.1f)", () => {
        const rasputin = makeInstance(RASPUTIN.id, {
            id: "ras",
            counters: { dream: 9 },
            abilitiesSuppressedBy: [{ sourceId: "humility", seq: 1 }],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rasputin] }),
                makePlayer("p2"),
            ],
        });
        expect(checkCounterLimitSBA(state)).toBe(false);
        expect(rasputin.counters?.dream).toBe(9);
    });
});
