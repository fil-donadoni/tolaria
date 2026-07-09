// Frontend wiring (SURFACE) test for the alternative-cost cast-option picker
// (CR 118.9, issue #690 / PR #1040). The cast-option picker must offer ONLY the
// alternatives the caster can currently afford — a condition-failing or
// unpayable alt (Force of Vigor pitched on your own turn, Snuff Out's "Pay 4
// life" without a Swamp) throws a hard `announceCast` rejection if offered and
// clicked. `affordableAltCostsForCard` (src/lib/card-utils.ts) is the gate the
// hook consults; it delegates to the server predicate `affordableAlternativeCosts`.
//
// The assertion is driven THROUGH the wire reducer: state is projected via
// `projectPublicState` first, then the gate runs on the projected players. A
// hand-built view would mask a field the projection strips — this is the class
// of bug the frontend-wiring rule guards.

import { describe, it, expect } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { affordableAltCostsForCard } from "../card-utils";
import type { CardInstance, Player } from "~/types/game";

const snuffOut = getCardByName("Snuff Out"); // control a Swamp → pay 4 life
const forceOfVigor = getCardByName("Force of Vigor"); // not your turn → exile a green card
const giantGrowth = getCardByName("Giant Growth"); // {G} — green pitch fodder
const swamp = getCardByName("Swamp");

function altIds(
    card: CardInstance,
    caster: string,
    players: Player[],
    active: string
): string[] {
    return affordableAltCostsForCard(card, caster, players, active).map(
        (a) => a.id
    );
}

describe("affordableAltCostsForCard — cast-option picker gate (CR 118.9)", () => {
    // p1 (active) holds Snuff Out + Force of Vigor + a green card, controls a
    // Swamp, 20 life. Mirrors the Free-pitch preset scenario.
    function scenario(activePlayerId: string) {
        const snuffInst = makeInstance(snuffOut.id, {
            id: "snuff",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const fovInst = makeInstance(forceOfVigor.id, {
            id: "fov",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const greenInst = makeInstance(giantGrowth.id, {
            id: "green",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const swampInst = makeInstance(swamp.id, {
            id: "sw1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life: 20,
                    hand: [snuffInst, fovInst, greenInst],
                    battlefield: [swampInst],
                }),
                makePlayer("p2"),
            ],
            activePlayerId,
            priorityPlayerId: "p1",
        });
        // Drive the assertion through the wire projection (viewer = p1).
        const projected = projectPublicState(state, 1, "p1");
        return projected as unknown as {
            players: Player[];
            activePlayerId: string;
        };
    }

    it("offers a satisfiable alt and HIDES a condition-failing one (own turn)", () => {
        const p = scenario("p1");
        const snuffCard = p.players[0].hand.find(
            (c) => c?.id === "snuff"
        ) as CardInstance;
        const fovCard = p.players[0].hand.find(
            (c) => c?.id === "fov"
        ) as CardInstance;

        // Snuff Out: control-a-Swamp holds + 20 life ≥ 4 → the "Pay 4 life" alt
        // IS offered.
        expect(altIds(snuffCard, "p1", p.players, p.activePlayerId)).toContain(
            "pitch-pay-4-life"
        );
        // Force of Vigor: "not your turn" fails on p1's own turn → its pitch alt
        // is NOT offered (the false-comment bug: it must be hidden here).
        expect(
            altIds(fovCard, "p1", p.players, p.activePlayerId)
        ).not.toContain("pitch-exile-green");
    });

    it("offers the not-your-turn alt once it is NOT the caster's turn", () => {
        const p = scenario("p2");
        const fovCard = p.players[0].hand.find(
            (c) => c?.id === "fov"
        ) as CardInstance;
        // A green card (Giant Growth) is in hand to exile → the alt is payable.
        expect(altIds(fovCard, "p1", p.players, p.activePlayerId)).toContain(
            "pitch-exile-green"
        );
    });

    it("HIDES Snuff Out's life alt when the caster controls no Swamp", () => {
        const snuffInst = makeInstance(snuffOut.id, {
            id: "snuff",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    life: 20,
                    hand: [snuffInst],
                    battlefield: [],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
        });
        const projected = projectPublicState(state, 1, "p1") as unknown as {
            players: Player[];
            activePlayerId: string;
        };
        const snuffCard = projected.players[0].hand.find(
            (c) => c?.id === "snuff"
        ) as CardInstance;
        expect(
            altIds(snuffCard, "p1", projected.players, projected.activePlayerId)
        ).not.toContain("pitch-pay-4-life");
    });
});
