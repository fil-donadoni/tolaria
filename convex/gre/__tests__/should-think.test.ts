// Pre-search responsiveness gate (issue #113). `shouldThink` must return false
// on trivial passes (so the bot passes immediately, no search) and true on the
// windows worth deliberating: own main phase, combat declarations, and relevant
// instant responses with a non-empty stack. Pure — no mutation. See
// `convex/gre/should-think.ts`.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { shouldThink } from "../should-think";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";

const GIANT = getCardByName("Hill Giant").id; // 3/3
const BOLT = getCardByName("Lightning Bolt").id; // R: 3 dmg any target
const MOUNTAIN = getCardByName("Mountain").id;

function creature(cardId: string, controllerId: string, id: string) {
    return makeInstance(cardId, {
        controllerId,
        ownerId: controllerId,
        id,
        isSummoningSick: false,
    });
}

function land(controllerId: string, id: string) {
    return makeInstance(MOUNTAIN, { controllerId, ownerId: controllerId, id });
}

function bolt(controllerId: string, id: string) {
    return makeInstance(BOLT, {
        controllerId,
        ownerId: controllerId,
        id,
        zone: "hand",
    });
}

describe("shouldThink — trivial passes (issue #113)", () => {
    it("is false when only a bare pass is legal (empty hand, own main)", () => {
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        expect(shouldThink(state, "p1")).toBe(false);
    });

    it("is false when it is not the bot's window", () => {
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            players: [
                makePlayer("p1", { hand: [bolt("p1", "b")] }),
                makePlayer("p2"),
            ],
        });
        // p2 holds priority — p1 owes nothing, so it must not think.
        expect(shouldThink(state, "p1")).toBe(false);
    });

    it("is false holding an instant on the opponent's turn with an empty stack", () => {
        // p1 could cast Bolt, but with nothing on the stack this is a hold-up
        // window on p2's turn: pass, don't burn a search.
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [bolt("p1", "b")],
                    battlefield: [land("p1", "m")],
                }),
                makePlayer("p2", {
                    battlefield: [creature(GIANT, "p2", "ogre")],
                }),
            ],
        });
        expect(shouldThink(state, "p1")).toBe(false);
    });
});

describe("shouldThink — windows worth searching (issue #113)", () => {
    it("is true in the bot's own main phase with a play available", () => {
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { hand: [land("p1", "m")] }),
                makePlayer("p2"),
            ],
        });
        expect(shouldThink(state, "p1")).toBe(true);
    });

    it("is true responding to a spell on the stack (relevant instant)", () => {
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p2",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [bolt("p1", "b")],
                    battlefield: [land("p1", "m")],
                }),
                makePlayer("p2", {
                    battlefield: [creature(GIANT, "p2", "ogre")],
                }),
            ],
        });
        // p2 cast something — non-empty stack makes the instant relevant.
        pushSpell(state, BOLT, "p2");
        state.priorityPlayerId = "p1";
        state.passCount = 0;
        expect(shouldThink(state, "p1")).toBe(true);
    });

    it("is true at the bot's declare-attackers window", () => {
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
            players: [
                makePlayer("p1", {
                    battlefield: [creature(GIANT, "p1", "ogre")],
                }),
                makePlayer("p2"),
            ],
        });
        expect(shouldThink(state, "p1")).toBe(true);
    });

    it("is true at the bot's declare-blockers window", () => {
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
            players: [
                makePlayer("p1", {
                    battlefield: [creature(GIANT, "p1", "wall")],
                }),
                makePlayer("p2", {
                    battlefield: [creature(GIANT, "p2", "atk")],
                }),
            ],
        });
        expect(shouldThink(state, "p1")).toBe(true);
    });

    it("is true during the bot's mulligan declaration", () => {
        const state = makeState({
            phase: "MULLIGAN",
            mulligan: {
                mulligansTaken: [0, 0],
                declarations: [null, null],
                locked: [false, false],
                declaringPlayerId: "p1",
                bottoming: false,
            },
        });
        expect(shouldThink(state, "p1")).toBe(true);
    });
});

describe("shouldThink — purity (issue #113)", () => {
    it("does not mutate the input state", () => {
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { hand: [land("p1", "m")] }),
                makePlayer("p2"),
            ],
        });
        const before = JSON.stringify(state);
        shouldThink(state, "p1");
        expect(JSON.stringify(state)).toBe(before);
    });
});
