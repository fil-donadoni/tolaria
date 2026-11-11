// Per-card test for bok/black.cards.ts. Goryo's Vengeance (hand-tail, issue
// #8806) is the first announced graveyard target gated on a SUPERTYPE, so the
// load-bearing assertions are the offered set (`getLegalTargets`) and the
// accepted set (`applyOneTargetSelection`, the real `selectTarget` logic)
// both refusing a nonlegendary creature card, then the resolution itself.
import { describe, it, expect } from "vitest";
import { resolveTopOfStack } from "../../../../gre/state";
import { fireDelayedTriggers } from "../../../../gre/phases";
import {
    getLegalTargets,
    pendingTargetFiltersFromRequirement,
    NO_TARGETING_SOURCE,
} from "../../../../gre/rules";
import { applyOneTargetSelection } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup.helper";
import { getDefinition } from "../../../index";
import { preloadDefinitions } from "../../../registry";
import { resolveCardExport } from "../../../defineCard";
import { goryosVengeance as goryosModuleExport } from "../black.cards";

// The PR head carries no catalogue row for the card (ADR 0157: derived state
// is regenerated post-merge), so register the module's own definition.
preloadDefinitions([resolveCardExport(goryosModuleExport)!]);

const goryosVengeance = getDefinition("3027e6c5-eed3-44e7-bb12-67569721af99");
// Legendary creature (APC 11) and a nonlegendary one.
const gerrardCapashen = getDefinition("ccca800f-e850-4bec-95d0-70280b51b7a7");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

const inGraveyard = (id: string, cardId: string, owner = "p1") =>
    makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "graveyard",
    });

function setup() {
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(goryosVengeance.id, {
                        id: "goryo",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                graveyard: [
                    inGraveyard("gy-legend", gerrardCapashen.id),
                    inGraveyard("gy-bears", grizzlyBears.id),
                ],
            }),
            makePlayer("p2", {
                graveyard: [inGraveyard("gy-theirs", gerrardCapashen.id, "p2")],
            }),
        ],
    });
}

describe("Goryo's Vengeance (CR 205.4a legendary, CR 400.7 reanimation, CR 702.10 haste, CR 603.7 delayed exile)", () => {
    const req = goryosVengeance.targetRequirement!;

    it("offers only a legendary creature card from YOUR graveyard", () => {
        const legal = getLegalTargets(
            setup(),
            req,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(legal).toEqual(["gy-legend"]);
    });

    it("accepts the legendary card and rejects a nonlegendary one at selection", () => {
        const pending = () => ({
            playerId: "p1",
            cardInstanceId: "goryo",
            targetType: req.type,
            count: 1 as const,
            selected: [],
            kind: "cast" as const,
            ...pendingTargetFiltersFromRequirement(req, undefined),
        });
        const accept = setup();
        accept.pendingTarget = pending();
        expect(() =>
            applyOneTargetSelection(accept, "p1", {
                targetType: "graveyard-card",
                targetId: "gy-legend",
                targetPlayerId: "p1",
            })
        ).not.toThrow();
        const reject = setup();
        reject.pendingTarget = pending();
        expect(() =>
            applyOneTargetSelection(reject, "p1", {
                targetType: "graveyard-card",
                targetId: "gy-bears",
                targetPlayerId: "p1",
            })
        ).toThrow();
    });

    it("returns the target hasted and exiles exactly it at the next end step", () => {
        const state = setup();
        pushSpell(state, goryosVengeance.id, "p1", [
            { type: "graveyard-card", id: "gy-legend", playerId: "p1" },
        ]);
        resolveTopOfStack(state);

        const entered = state.players[0].battlefield.find(
            (c) => c.id === "gy-legend"
        );
        expect(entered).toBeDefined();
        expect(entered!.staticAbilities).toContain("haste");
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "gy-bears"
        );

        // Wire format: the returned creature survives the projection.
        const projected = projectPublicState(state, 1, "p2");
        expect(
            projected.players[0].battlefield.some((c) => c.id === "gy-legend")
        ).toBe(true);

        expect(state.delayedTriggers![0].payload).toEqual({
            captured: "gy-legend",
        });
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "gy-legend")
        ).toBe(false);
        expect(state.players[0].exile.map((c) => c.id)).toContain("gy-legend");
    });
});
