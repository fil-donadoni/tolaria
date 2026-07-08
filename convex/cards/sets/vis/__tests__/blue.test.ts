// VIS — per-card behavior tests for blue cards in
// `convex/cards/sets/vis/blue.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import { visionCharm } from "../blue";
import { island, forest, blackLotus } from "../../lea/colorless";
import { grizzlyBears } from "../../lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { advancePhase } from "../../../../gre/phases";
import { projectPublicState } from "../../../../gameProjections";

/** Answer the head pending choice with `picks` (an option id for
 *  requestOptionChoice, or permanent ids for requestChoice). Drives the
 *  staged-resume resolution forward one round-trip. */
function answer(state: GameState, picks: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: picks,
    });
}

describe("Vision Charm (VIS, {U} modal instant — CR 700.2)", () => {
    it("is a {U} instant with the three modern-oracle modes", () => {
        expect(visionCharm.manaCost).toEqual({ U: 1 });
        expect(visionCharm.types).toEqual(["Instant"]);
        expect(visionCharm.oracleText).toContain("Target player mills four");
        expect(visionCharm.oracleText).toContain("basic land type");
        expect(visionCharm.oracleText).toContain("Target artifact phases out");
    });

    it("mode 1 — target player mills four cards (CR 701.17)", () => {
        const lib = Array.from({ length: 6 }, (_, i) =>
            makeInstance(grizzlyBears.id, {
                id: `lib${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { library: lib })],
        });
        pushSpell(state, visionCharm.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on mode pick
        answer(state, ["mill"]); // choose mode
        answer(state, ["p2"]); // choose the milled player

        const p2 = state.players[1];
        expect(p2.graveyard).toHaveLength(4);
        expect(p2.library).toHaveLength(2);
        expect(state.pendingChoices ?? []).toEqual([]);
    });

    it("mode 1 — stops early when the library empties (CR 701.17a)", () => {
        const lib = Array.from({ length: 2 }, (_, i) =>
            makeInstance(grizzlyBears.id, {
                id: `lib${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { library: lib })],
        });
        pushSpell(state, visionCharm.id, "p1");
        resolveTopOfStack(state);
        answer(state, ["mill"]);
        answer(state, ["p2"]);
        expect(state.players[1].graveyard).toHaveLength(2);
        expect(state.players[1].library).toHaveLength(0);
    });

    it("mode 2 — lands of the chosen type become the chosen basic type until end of turn (CR 305.7)", () => {
        const isl = makeInstance(island.id, {
            id: "isl",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const fst = makeInstance(forest.id, {
            id: "fst",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [isl, fst] }),
                makePlayer("p2"),
            ],
        });
        // WITHOUT the effect: the Island is an Island, the Forest a Forest.
        expect(
            state.players[0].battlefield.find((c) => c.id === "isl")!.subtypes
        ).toEqual(["Island"]);

        pushSpell(state, visionCharm.id, "p1");
        resolveTopOfStack(state);
        answer(state, ["land-type"]); // mode
        answer(state, ["Island"]); // from type
        answer(state, ["Swamp"]); // to type

        // WITH the effect: only the Island became a Swamp; the Forest is
        // untouched, and the change is scoped to end of turn.
        const islAfter = state.players[0].battlefield.find(
            (c) => c.id === "isl"
        )!;
        const fstAfter = state.players[0].battlefield.find(
            (c) => c.id === "fst"
        )!;
        expect(islAfter.subtypes).toEqual(["Swamp"]);
        expect(fstAfter.subtypes).toEqual(["Forest"]);
        expect(islAfter.temporarySubtypeChange?.duration.phase).toBe(
            "end-of-turn"
        );

        // Wire format — the subtype change survives projectPublicState.
        const projected = projectPublicState(state, 1, "p1");
        const slimIsl = projected.players[0].battlefield.find(
            (c) => c.id === "isl"
        )!;
        expect(slimIsl.subtypes).toEqual(["Swamp"]);
    });

    it("mode 3 — target artifact phases out and returns on the controller's next untap step (CR 702.26)", () => {
        const lotus = makeInstance(blackLotus.id, {
            id: "lotus",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lotus] }),
                makePlayer("p2"),
            ],
            turn: 1,
            activePlayerId: "p1",
        });
        pushSpell(state, visionCharm.id, "p1");
        resolveTopOfStack(state);
        answer(state, ["phase"]); // mode
        answer(state, ["lotus"]); // target artifact

        // Phased out: gone from the battlefield, held in an untap-cycle bundle
        // stamped with the turn it phased out (CR 702.26f skip-first guard).
        expect(
            state.players[0].battlefield.find((c) => c.id === "lotus")
        ).toBeUndefined();
        expect(state.phasedOut).toHaveLength(1);
        expect(state.phasedOut![0].returnOn).toEqual({ kind: "untap-cycle" });
        expect(state.phasedOut![0].phasedOutTurn).toBe(1);

        // Advance through p2's turn to p1's NEXT untap step (turn 3). The
        // phasing turn-based action phases the artifact back in (CR 502.1).
        state.activePlayerId = "p2";
        state.turn = 2;
        state.phase = "END_STEP";
        advancePhase(state);
        expect(state.activePlayerId).toBe("p1");
        expect(
            state.players[0].battlefield.find((c) => c.id === "lotus")
        ).toBeDefined();
        expect(state.phasedOut ?? []).toHaveLength(0);
    });

    it("phased-out permanent is visible on the wire per hidden-info rules (gameProjections)", () => {
        const lotus = makeInstance(blackLotus.id, {
            id: "lotus",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lotus] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, visionCharm.id, "p1");
        resolveTopOfStack(state);
        answer(state, ["phase"]);
        answer(state, ["lotus"]);

        // Phasing is public (set aside face-up): both the controller and the
        // opponent see the bundle, and the card def is slimmed to `{ id }`.
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            expect(projected.phasedOut).toHaveLength(1);
            const bundleCard = projected.phasedOut![0].cards[0];
            expect(bundleCard.id).toBe("lotus");
            expect(bundleCard.card).toEqual({ id: blackLotus.id });
        }
    });
});
