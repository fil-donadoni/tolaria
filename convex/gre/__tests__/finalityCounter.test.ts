// Finality counter (MH3 keyword counter, issue #1323 — Emperor of Bones'
// reanimation clause: "put a creature card exiled with this creature onto
// the battlefield ... with a finality counter on it"). CR 122.1h: "One or
// more finality counters on a permanent create a single replacement effect
// that stops the permanent from going to the graveyard. That effect is 'If
// this permanent would be put into a graveyard from the battlefield, exile
// it instead.'"
//
// Modeled as an INTRINSIC per-instance-counter check at `removePermanentTo`
// (`gre/state.ts`) — the single funnel every battlefield departure already
// routes through (mirrors the adjacent `exileOnLeave` per-instance flag) —
// rather than a per-card `replacementEffects[]` entry (Dauthi Voidwalker's
// void counter shape): ANY creature card Emperor of Bones reanimates can
// carry the counter, not just a card that declares the rule itself.
import { describe, it, expect } from "vitest";
import type { CardInstanceState } from "../state";
import { removePermanentTo, flushPendingEvents } from "../state";
import { checkZeroToughnessSBA } from "../sba";
import { makePlayer, makeState } from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";

function creature(
    id: string,
    ownerId: string,
    opts: { toughness?: number; counters?: Record<string, number> } = {}
): CardInstanceState {
    return {
        id,
        card: { id: `def-${id}` },
        types: ["Creature"],
        subtypes: [],
        power: 1,
        toughness: opts.toughness ?? 1,
        staticAbilities: [],
        controllerId: ownerId,
        ownerId,
        zone: "battlefield",
        isTapped: false,
        counters: opts.counters,
    };
}

describe("finality counter (CR 122.1h, MH3, issue #1323) — graveyard-bound-from-battlefield redirect", () => {
    it("redirects a battlefield death (SBA, 0 toughness) to exile instead of the graveyard", () => {
        const dying = creature("victim", "p1", {
            toughness: 0,
            counters: { finality: 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dying] }),
                makePlayer("p2"),
            ],
        });
        checkZeroToughnessSBA(state);
        const p1 = state.players[0];
        expect(p1.battlefield.some((c) => c.id === "victim")).toBe(false);
        expect(p1.graveyard).toHaveLength(0);
        expect(p1.exile.some((c) => c.id === "victim")).toBe(true);
    });

    it("does NOT redirect a battlefield death for a creature with NO finality counter (control case)", () => {
        const dying = creature("victim2", "p1", { toughness: 0 });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dying] }),
                makePlayer("p2"),
            ],
        });
        checkZeroToughnessSBA(state);
        const p1 = state.players[0];
        expect(p1.graveyard.some((c) => c.id === "victim2")).toBe(true);
        expect(p1.exile).toHaveLength(0);
    });

    it("does NOT redirect a finality-countered permanent bounced to hand (ruling: only intercepts a graveyard-bound move)", () => {
        const bounced = creature("bounced", "p1", {
            counters: { finality: 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bounced] }),
                makePlayer("p2"),
            ],
        });
        const moved = removePermanentTo(state, "bounced", "hand");
        expect(moved?.zone).toBe("hand");
        const p1 = state.players[0];
        expect(p1.hand.some((c) => c.id === "bounced")).toBe(true);
        expect(p1.exile).toHaveLength(0);
    });

    it("redirects a directly-sacrificed finality-countered permanent (removePermanentTo, cause: sacrifice)", () => {
        const sacked = creature("sacked", "p1", { counters: { finality: 1 } });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sacked] }),
                makePlayer("p2"),
            ],
        });
        const moved = removePermanentTo(
            state,
            "sacked",
            "graveyard",
            "sacrifice"
        );
        expect(moved?.zone).toBe("exile");
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[0].exile.some((c) => c.id === "sacked")).toBe(
            true
        );
        flushPendingEvents(state);
    });

    it("wire format: the redirected exile lands correctly in projectPublicState for both viewers", () => {
        const dying = creature("victim3", "p1", {
            toughness: 0,
            counters: { finality: 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dying] }),
                makePlayer("p2"),
            ],
        });
        checkZeroToughnessSBA(state);
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const p1Slim = projected.players.find((p) => p.id === "p1")!;
            expect(p1Slim.graveyard).toHaveLength(0);
            expect(p1Slim.exile.some((c) => c.id === "victim3")).toBe(true);
        }
    });
});
