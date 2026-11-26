import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    submitChoice,
} from "../../../__tests__/setup.helper";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import { resolveTopOfStack } from "../../../../gre/state";
import { getLegalActions } from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition, withTemporaryDefinition } from "../../../index";
import type { CardDefinition } from "../../../types";
import { preloadDefinitions } from "../../../registry";
import { resolveCardExport } from "../../../defineCard";
import { livingEnd as livingEndModuleExport } from "../black.cards";

// The PR head carries no `definition-index.json` row for the card (ADR 0157:
// derived state is regenerated post-merge), so register the module's own
// definition rather than depend on the lazy catalogue source.
preloadDefinitions([resolveCardExport(livingEndModuleExport)!]);
const livingEnd = getDefinition("3be0ff69-d9f3-4b81-b02f-1360e4064aff");

const BEARS = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870").id; // Grizzly Bears
const BOLT = getDefinition("d573ef03-4730-45aa-93dd-e45ac1dbaf4a").id; // Lightning Bolt
const SWAMP = getDefinition("6176936d-72e2-4205-8871-4c5a4f1cb2d8").id; // Swamp

function card(
    defId: string,
    id: string,
    ownerId: string,
    zone: CardInstanceState["zone"]
): CardInstanceState {
    return makeInstance(defId, { id, controllerId: ownerId, ownerId, zone });
}

const ids = (cards: { id: string }[]) => cards.map((c) => c.id).sort();

// Living End — "Each player exiles all creature cards from their graveyard,
// then sacrifices all creatures they control, then puts all cards they exiled
// this way onto the battlefield." CR 608.2c (the steps run in the order
// written), CR 701.21a (sacrifice), CR 110.2a (each card enters
// under its owner's control), CR 118.6 (no mana cost: no hand cast).
describe("Living End (CR 608.2c, CR 701.21a, CR 118.6)", () => {
    function resolveLivingEnd(): GameState {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [
                        card(BEARS, "my-dead", "p1", "graveyard"),
                        card(BOLT, "my-bolt", "p1", "graveyard"),
                    ],
                    battlefield: [
                        card(BEARS, "my-live", "p1", "battlefield"),
                        card(SWAMP, "my-swamp", "p1", "battlefield"),
                    ],
                }),
                makePlayer("p2", {
                    graveyard: [card(BEARS, "their-dead", "p2", "graveyard")],
                    battlefield: [
                        card(BEARS, "their-live", "p2", "battlefield"),
                    ],
                }),
            ],
        });
        pushSpell(state, livingEnd.id, "p1");
        resolveTopOfStack(state);
        return state;
    }

    it("swaps every player's creatures on the battlefield for the creature cards in their graveyard", () => {
        const [p1, p2] = resolveLivingEnd().players;
        expect(ids(p1.battlefield)).toEqual(["my-dead", "my-swamp"]);
        expect(ids(p2.battlefield)).toEqual(["their-dead"]);
        // The sacrificed creatures reach the graveyard AFTER the exile, so they
        // stay there; a noncreature card is never exiled.
        expect(ids(p1.graveyard)).toContain("my-live");
        expect(ids(p1.graveyard)).toContain("my-bolt");
        expect(ids(p1.graveyard)).not.toContain("my-dead");
        expect(ids(p2.graveyard)).toEqual(["their-live"]);
        expect(p1.exile).toEqual([]);
        expect(p2.exile).toEqual([]);
    });

    it("each returned card enters under its owner's control, on the wire too", () => {
        const state = resolveLivingEnd();
        const wire = projectPublicState(state, 1, "p1").players;
        expect(
            wire[1].battlefield.find((c) => c.id === "their-dead")?.controllerId
        ).toBe("p2");
        expect(
            wire[0].battlefield.find((c) => c.id === "my-dead")?.controllerId
        ).toBe("p1");
    });

    it("is never cast from hand: its absent mana cost is unpayable", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [card(livingEnd.id, "le", "p1", "hand")],
                    battlefield: [0, 1, 2, 3].map((i) =>
                        card(SWAMP, `s${i}`, "p1", "battlefield")
                    ),
                }),
                makePlayer("p2"),
            ],
        });
        const [p1] = state.players;
        expect(getLegalActions(state, p1, p1.hand[0])).not.toContain("cast");
    });

    it("a cascade hit casts it for free (CR 702.85a, CR 118.6a) and it resolves", () => {
        const CASCADER: CardDefinition = {
            id: "test-living-end-cascader",
            name: "Test Living End Cascader",
            rarity: "common",
            manaCost: { X: 2, R: 1 },
            types: ["Sorcery"],
            effects: [{ op: "cascade", player: "controller" }],
        };
        withTemporaryDefinition(CASCADER, () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        library: [card(livingEnd.id, "le", "p1", "library")],
                        graveyard: [card(BEARS, "my-dead", "p1", "graveyard")],
                    }),
                    makePlayer("p2"),
                ],
            });
            pushSpell(state, CASCADER.id, "p1");
            resolveTopOfStack(state);
            expect(
                state.pendingChoices?.[0]?.options?.map((o) => o.id)
            ).toContain("cast");
            submitChoice(state, ["cast"]);
            expect(state.stack.map((s) => s.id)).toEqual(["le"]);
            resolveTopOfStack(state);
            expect(ids(state.players[0].battlefield)).toEqual(["my-dead"]);
        });
    });
});
