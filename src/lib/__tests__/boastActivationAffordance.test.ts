// Boast (CR 702.142a, issue #2375) on the CLIENT surface: the zone-listing
// helper the UI actually renders from, driven over a REAL `projectPublicState`
// projection rather than a hand-built view (gre-development.md
// § Frontend wiring analysis / § Proof-of-failure).
//
// Why a card-specific test on top of the generic sweep in
// `activation-affordability.catalogue.test.ts`: that sweep proves the shape is
// gated and un-gated correctly, but it builds its own permanent. This one
// proves the driving field — `hasAttackedThisTurn` — actually SURVIVES the
// wire for the shipped card. `slimCard` strips fat fields, so a GRE-correct
// Boast can still be offered on every untapped creature all game with only the
// server's throw to say no.
//
// Lives on the `src/` side of the project boundary because a file in the convex
// project may not import `src/**`; the engine-side halves of the same rule
// (`assertActivationTimingLegal`, `enumerateMoves`) are asserted in
// `convex/cards/sets/lcc/__tests__/red.test.ts`.

import { describe, it, expect } from "vitest";
import { broadsideBombardiers } from "@convex/cards/sets/lcc/red";
import { grizzlyBears } from "@convex/cards/sets/lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { getStackAbilities } from "../card-utils";
import type { CardInstance } from "~/types/game";
import type { GameState } from "@convex/gre/state";

const BOAST_ID = "broadside-bombardiers-boast-damage";

describe("Broadside Bombardiers — Boast affordance over the wire (CR 702.142a, issue #2375)", () => {
    it("getStackAbilities hides the boast pre-attack and offers it post-attack, over projectPublicState", () => {
        const source = makeInstance(broadsideBombardiers.id, {
            id: "bombardiers",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source, victim] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "POSTCOMBAT_MAIN",
        });

        const listed = (s: GameState) => {
            const projected = projectPublicState(s, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c?.id === "bombardiers"
            ) as CardInstance;
            return getStackAbilities(slim, s.phase).map((a) => a.id);
        };

        // CR 702.142a — never attacked, so the ability is not offered.
        expect(listed(state)).not.toContain(BOAST_ID);

        // The flag `gre/combat.ts` stamps at declare-attackers (CR 508.1) must
        // reach the client through `slimCard` for the affordance to flip.
        source.hasAttackedThisTurn = true;
        expect(listed(state)).toContain(BOAST_ID);
    });
});
