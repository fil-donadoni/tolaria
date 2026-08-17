// Per-card behavior tests for colorless cards in
// `convex/cards/sets/exo/colorless.ts` (Exodus, split by colour per ADR
// 0043). City of Traitors' triggered ability is a `resolve()` card (the
// card's own comment documents why the `sacrifice` Op can't express a
// "sacrifice $source directly" effect) — the full `resolve()` regime applies
// (`.claude/rules/gre-development.md` § Card testing convention). Fixtures
// from `convex/cards/__tests__/setup.ts`. Vintage Cube free tranche (issue
// #675, ADR 0041).

import { describe, it, expect } from "vitest";
import { cityOfTraitors } from "..";
import { getCardByName } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { applyPlayLand } from "../../../../gre/playLand";
import {
    processPendingActionTriggers,
    resolveTopOfStack,
} from "../../../../gre/state";

const FOREST = getCardByName("Forest").id;

describe("City of Traitors (CR 603.2 triggered ability, CR 701.21 sacrifice)", () => {
    it("sacrifices itself when the controller plays another land", () => {
        const city = makeInstance(cityOfTraitors.id, {
            id: "city",
            controllerId: "p1",
            ownerId: "p1",
        });
        const forest = makeInstance(FOREST, { id: "forest", zone: "hand" });
        const player = makePlayer("p1", {
            battlefield: [city],
            hand: [forest],
        });
        const state = makeState({ players: [player, makePlayer("p2")] });

        // Playing the second land emits PERMANENT_ENTERED (CR 603.6a); the
        // trigger system (`processPendingActionTriggers`, called from inside
        // `applyPlayLand`) picks up City of Traitors' matching trigger and
        // pushes it onto the stack awaiting resolution.
        applyPlayLand(state, player, "forest");
        expect(
            state.stack.some(
                (s) => s.triggeredAbilityId === "city-of-traitors-sac"
            )
        ).toBe(true);

        resolveTopOfStack(state);

        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "city"
        );
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("city");
        // The second land played is unaffected — only City of Traitors itself
        // is sacrificed.
        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "forest"
        );
    });

    it("does NOT sacrifice itself on its own entry (event.instanceId !== self.id)", () => {
        const city = makeInstance(cityOfTraitors.id, {
            id: "city",
            zone: "hand",
        });
        const player = makePlayer("p1", { hand: [city] });
        const state = makeState({ players: [player, makePlayer("p2")] });

        applyPlayLand(state, player, "city");

        expect(state.stack.length).toBe(0);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain("city");
    });

    it("does NOT sacrifice on a fetched land that merely ENTERS (CR 305.2 — not played)", () => {
        // A land put onto the battlefield by an effect (fetch/tutor) emits a
        // PERMANENT_ENTERED with no `wasPlayed`. City of Traitors' trigger is
        // "when you PLAY another land" and must not fire on a mere entry.
        const city = makeInstance(cityOfTraitors.id, {
            id: "city",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", { battlefield: [city] });
        const state = makeState({ players: [player, makePlayer("p2")] });

        state.pendingEvents = [
            {
                type: "PERMANENT_ENTERED" as const,
                instanceId: "fetched-land",
                controllerId: "p1",
                types: ["Land" as const],
                // no `wasPlayed` — put onto the battlefield by an effect
            },
        ];
        processPendingActionTriggers(state);

        expect(state.stack.length).toBe(0);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain("city");
    });

    it("does NOT sacrifice when the OPPONENT plays a land (controller-scoped)", () => {
        const city = makeInstance(cityOfTraitors.id, {
            id: "city",
            controllerId: "p1",
            ownerId: "p1",
        });
        const forest = makeInstance(FOREST, {
            id: "forest",
            controllerId: "p2",
            zone: "hand",
        });
        const p1 = makePlayer("p1", { battlefield: [city] });
        const p2 = makePlayer("p2", { hand: [forest] });
        const state = makeState({ players: [p1, p2] });

        applyPlayLand(state, p2, "forest");

        expect(state.stack.length).toBe(0);
        expect(state.players[0].battlefield.map((c) => c.id)).toContain("city");
    });
});
