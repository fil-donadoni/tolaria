// #481 — frontend integration for battlefield-scanned global attack
// restrictions (Moat, Akron Legionnaire, CR 508.1c). `useBattlefieldVisualState`
// grays out attackers the server would reject by calling the shared
// `globalAttackProhibitionReason` helper (in `@convex/cards/attackRestrictions`,
// the only frontend-safe path — the hook must not import from `convex/gre/`).
// These tests exercise the helper with the same `Player[]`-shaped board the
// client passes, proving the GRE → game.ts → UI gate agrees at all three layers.

import { describe, it, expect } from "vitest";
import { globalAttackProhibitionReason } from "@convex/cards/attackRestrictions";
import {
    moat,
    akronLegionnaire,
    tundraWolves,
    azureDrake,
} from "@convex/cards/sets/leg";
import type { CardInstance, Player } from "~/types/game";

const CLAY_STATUE_ID = "64975352-8d35-4d02-94ac-fa0c6ee12409"; // artifact creature

function inst(
    cardId: string,
    overrides: Partial<CardInstance> = {}
): CardInstance {
    return {
        id: overrides.id ?? `inst-${cardId.slice(0, 6)}`,
        card: { id: cardId },
        controllerId: overrides.controllerId ?? "p1",
        ...overrides,
    } as CardInstance;
}

function player(id: string, battlefield: CardInstance[]): Player {
    return { id, battlefield } as Player;
}

describe("globalAttackProhibitionReason (client-side attacker gate, CR 508.1c)", () => {
    it("Moat: marks a non-flying attacker as forbidden", () => {
        const board = [
            player("p1", [
                inst(moat.id, { id: "moat" }),
                inst(tundraWolves.id, { id: "grounded", staticAbilities: [] }),
            ]),
            player("p2", []),
        ];
        const grounded = board[0].battlefield[1];
        expect(
            globalAttackProhibitionReason(grounded as never, {
                players: board as never,
            })
        ).toBeDefined();
    });

    it("Moat: a flier is not forbidden", () => {
        const board = [
            player("p1", [
                inst(moat.id, { id: "moat" }),
                inst(azureDrake.id, {
                    id: "flier",
                    staticAbilities: ["flying"],
                }),
            ]),
            player("p2", []),
        ];
        const flier = board[0].battlefield[1];
        expect(
            globalAttackProhibitionReason(flier as never, {
                players: board as never,
            })
        ).toBeUndefined();
    });

    it("Akron: your vanilla creature is forbidden; Akron and artifact creatures are not", () => {
        const board = [
            player("p1", [
                inst(akronLegionnaire.id, { id: "akron" }),
                inst(tundraWolves.id, { id: "ally", staticAbilities: [] }),
                inst(CLAY_STATUE_ID, { id: "robot" }),
            ]),
            player("p2", []),
        ];
        const [akron, ally, robot] = board[0].battlefield;
        expect(
            globalAttackProhibitionReason(ally as never, {
                players: board as never,
            })
        ).toBeDefined();
        expect(
            globalAttackProhibitionReason(akron as never, {
                players: board as never,
            })
        ).toBeUndefined();
        expect(
            globalAttackProhibitionReason(robot as never, {
                players: board as never,
            })
        ).toBeUndefined();
    });

    it("returns undefined on an unrestricted board", () => {
        const board = [
            player("p1", [
                inst(tundraWolves.id, { id: "c1", staticAbilities: [] }),
            ]),
            player("p2", []),
        ];
        expect(
            globalAttackProhibitionReason(board[0].battlefield[0] as never, {
                players: board as never,
            })
        ).toBeUndefined();
    });
});
