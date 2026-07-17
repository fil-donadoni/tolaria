// Keyword counters (CR 122.1c / 613.4d, issue #1194) — a counter whose TYPE
// case-insensitively names an implemented keyword ability GRANTS that
// keyword ("a flying counter" grants flying) for as long as at least one
// counter of the type remains. Exercises `SpellContext.addCounter` /
// `removeCounter`'s keyword-grant sync directly (the same primitives the
// `counters` Effect Script Op already calls — no new Op, generalized
// primitive behavior).

import { describe, it, expect } from "vitest";
import { buildSpellContext, type StackItem } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import { grizzlyBears } from "../../cards/sets/lea/green";

function pushItem(state: ReturnType<typeof makeState>): StackItem {
    return pushSpell(state, grizzlyBears.id, "p1");
}

describe("keyword counters (CR 122.1c / 613.4d, issue #1194)", () => {
    it("a flying counter grants flying while present", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        const ctx = buildSpellContext(state, item);
        expect(bear.staticAbilities).not.toContain("flying");

        ctx.addCounter({ type: "permanent", id: "bear1" }, "flying", 1);
        expect(bear.staticAbilities).toContain("flying");
        expect(bear.counters).toEqual({ flying: 1 });

        // Wire format — a granted keyword is board-visible (evasion changes
        // how blocks are shown) and must survive the projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        expect(slim.staticAbilities).toContain("flying");
    });

    it("removing the last flying counter splices the grant back out", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        const ctx = buildSpellContext(state, item);
        ctx.addCounter({ type: "permanent", id: "bear2" }, "flying", 1);
        expect(bear.staticAbilities).toContain("flying");

        ctx.removeCounter({ type: "permanent", id: "bear2" }, "flying", 1);
        expect(bear.staticAbilities).not.toContain("flying");
        expect(bear.counters).toBeUndefined();
    });

    it("a partial removal (2 flying counters -> 1) leaves the keyword granted", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear3",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        const ctx = buildSpellContext(state, item);
        ctx.addCounter({ type: "permanent", id: "bear3" }, "flying", 2);
        ctx.removeCounter({ type: "permanent", id: "bear3" }, "flying", 1);
        expect(bear.staticAbilities).toContain("flying");
        expect(bear.counters).toEqual({ flying: 1 });
        // Only ONE occurrence was ever pushed (grant is once-per-transition,
        // not once-per-counter) — no duplicate to accumulate/strip.
        expect(bear.staticAbilities.filter((a) => a === "flying").length).toBe(
            1
        );
    });

    it("a natively-printed keyword survives the grant's removal (CR 113.1 — only one occurrence spliced)", () => {
        // Simulate a creature that ALREADY has flying printed, then also
        // receives a flying counter (redundant, CR 702.9). Removing the
        // counter must strip only the counter-sourced occurrence.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear4",
            controllerId: "p1",
            ownerId: "p1",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        const ctx = buildSpellContext(state, item);
        ctx.addCounter({ type: "permanent", id: "bear4" }, "flying", 1);
        expect(bear.staticAbilities.filter((a) => a === "flying").length).toBe(
            2
        );
        ctx.removeCounter({ type: "permanent", id: "bear4" }, "flying", 1);
        expect(bear.staticAbilities).toContain("flying"); // printed copy survives
        expect(bear.staticAbilities.filter((a) => a === "flying").length).toBe(
            1
        );
    });

    it("a non-keyword counter type (+1/+1) grants nothing", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear5",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        const ctx = buildSpellContext(state, item);
        ctx.addCounter({ type: "permanent", id: "bear5" }, "+1/+1", 1);
        expect(bear.staticAbilities).toEqual([]);
        expect(bear.grantedStaticAbilities).toBeUndefined();
    });

    it("a counter naming a planned/out-of-scope keyword grants nothing (Guard-A-style gate)", () => {
        // "Ward" is `status: "planned"` in the registry (no engine
        // enforcement) — a "ward" counter must stay inert, mirroring the
        // Guard A gate for a card's OWN declared `staticAbilities`.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear6",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        const ctx = buildSpellContext(state, item);
        ctx.addCounter({ type: "permanent", id: "bear6" }, "ward", 1);
        expect(bear.staticAbilities).not.toContain("ward");
    });

    it("is idempotent across repeated adds while the counter stays present", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear7",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        const item = pushItem(state);
        const ctx = buildSpellContext(state, item);
        ctx.addCounter({ type: "permanent", id: "bear7" }, "flying", 1);
        ctx.addCounter({ type: "permanent", id: "bear7" }, "flying", 1);
        ctx.addCounter({ type: "permanent", id: "bear7" }, "flying", 1);
        expect(bear.counters).toEqual({ flying: 3 });
        expect(bear.staticAbilities.filter((a) => a === "flying").length).toBe(
            1
        );
    });
});
