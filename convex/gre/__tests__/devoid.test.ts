// CR 702.114a — devoid: "This object is colorless." A characteristic-defining
// ability (CR 604.3), so it holds in every zone and outside the game, overriding
// the colours of a mana cost the card must still pay. These tests drive the
// colour authority, the SPELL_CAST choke point, the projection and the readers
// that derive colour from a slim `{ id }`.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards";
import {
    getCardColorIdentity,
    getCardColors,
    getColorsFromCost,
} from "../../cards/colors";
import { getEffectiveColors } from "../../cards/effectiveColors";
import { colorDefiningCostForCardId } from "../../cards/manaCostLookup";
import { getInstanceManaCost } from "../../cards/registry";
import type { CardDefinition, PermanentView } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import { projectPublicState } from "../../gameProjections";
import { describeDamageSource } from "../replacements";
import { buildStateFromScenario } from "../scenarioBuilder";
import { buildSpellContext, emitSpellCastEvent } from "../state";

const DEVOID_ID = "test-devoid-bears";

/** A {1}{G} creature with devoid: a green cost on a colourless object. */
const devoidBears = (): CardDefinition => ({
    ...grizzlyBears(),
    id: DEVOID_ID,
    name: "Devoid Test Bears",
    staticAbilities: ["devoid"],
});

const colorsOf = (card: unknown) => getEffectiveColors(card as PermanentView);

const devoidCard = (id: string, overrides: Record<string, unknown> = {}) =>
    makeInstance(DEVOID_ID, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        ...overrides,
    });

function board() {
    const zones = {
        hand: devoidCard("in-hand"),
        library: devoidCard("in-library"),
        graveyard: devoidCard("in-graveyard"),
        exile: devoidCard("in-exile"),
    };
    const permanent = devoidCard("on-battlefield");
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [permanent],
                hand: [zones.hand],
                library: [zones.library],
                graveyard: [zones.graveyard],
                exile: [zones.exile],
            }),
            makePlayer("p2"),
        ],
    });
    return { state, permanent, zones };
}

describe("devoid (CR 702.114a)", () => {
    it("the card is colourless while its cost still demands its coloured pips", () => {
        const def = devoidBears();
        expect(getCardColors(def)).toEqual([]);
        expect(getColorsFromCost(def.manaCost)).toEqual(["G"]);
    });

    it("is colourless in every zone and on the stack (CR 604.3)", () => {
        withTemporaryDefinition(devoidBears(), () => {
            const { state, permanent, zones } = board();
            for (const card of Object.values(zones)) {
                expect(colorsOf(card)).toEqual([]);
            }
            expect(colorsOf(permanent)).toEqual([]);
            expect(colorsOf(pushSpell(state, DEVOID_ID, "p1"))).toEqual([]);
        });
    });

    it("keeps the mana cost: the override is colour only (CR 202.2)", () => {
        withTemporaryDefinition(devoidBears(), () => {
            expect(getInstanceManaCost(devoidCard("c"))).toEqual(
                devoidBears().manaCost
            );
        });
    });

    it("a cast trigger reads a colourless spell on SPELL_CAST (CR 601.2i)", () => {
        withTemporaryDefinition(devoidBears(), () => {
            const { state } = board();
            const spell = pushSpell(state, DEVOID_ID, "p1");
            state.pendingEvents = [];
            emitSpellCastEvent(state, spell);
            const event = (state.pendingEvents ?? []).find(
                (e) => e.type === "SPELL_CAST"
            ) as { spellColors?: string[] } | undefined;
            expect(event?.spellColors).toEqual([]);
        });
    });

    it("a later colour effect still paints it: the CDA applies first (CR 613.3)", () => {
        withTemporaryDefinition(devoidBears(), () => {
            expect(
                colorsOf(
                    devoidCard("granted", {
                        grantedColors: [{ color: "U" }],
                    })
                )
            ).toEqual(["U"]);
            expect(
                colorsOf(devoidCard("set", { colorOverride: ["R"] }))
            ).toEqual(["R"]);
        });
    });

    it("stays colourless once its abilities are removed: layer 5 precedes layer 6 (CR 613.6)", () => {
        withTemporaryDefinition(devoidBears(), () => {
            expect(
                colorsOf(devoidCard("stripped", { staticAbilities: [] }))
            ).toEqual([]);
        });
    });

    it("a copy of a devoid permanent is colourless, a devoid card copying a coloured one is not (CR 707.2a)", () => {
        withTemporaryDefinition(devoidBears(), () => {
            expect(
                colorsOf(
                    makeInstance(DEVOID_ID, {
                        id: "copy",
                        copiedFrom: grizzlyBears().id,
                    })
                )
            ).toEqual([]);
            expect(
                colorsOf(
                    makeInstance(grizzlyBears().id, {
                        id: "copier",
                        copiedFrom: DEVOID_ID,
                    })
                )
            ).toEqual(["G"]);
        });
    });

    it("keeps its cost's colours in its colour identity (CR 903.4)", () => {
        expect(getCardColorIdentity(devoidBears())).toEqual(["G"]);
    });

    it("the slim `{ id }` colour readers see no colour-defining cost", () => {
        withTemporaryDefinition(devoidBears(), () => {
            expect(colorDefiningCostForCardId(DEVOID_ID)).toBeUndefined();
        });
        expect(colorDefiningCostForCardId(grizzlyBears().id)).toEqual(
            grizzlyBears().manaCost
        );
    });

    it("a damage source and a hand card read colourless (CR 609.7, CR 702.114a)", () => {
        withTemporaryDefinition(devoidBears(), () => {
            const { state } = board();
            expect(
                describeDamageSource(state, "on-battlefield").colors
            ).toEqual([]);
            const spell = pushSpell(state, DEVOID_ID, "p1");
            expect(describeDamageSource(state, spell.id).colors).toEqual([]);
            const ctx = buildSpellContext(state, spell);
            expect(
                ctx.getHandCards("p1").find((c) => c.id === "in-hand")?.colors
            ).toEqual([]);
        });
    });

    it("wire format: the client reads it colourless in every zone it can see", () => {
        withTemporaryDefinition(devoidBears(), () => {
            const { state } = board();
            const p1 = projectPublicState(state, 1, "p1").players[0];
            expect(colorsOf(p1.hand[0])).toEqual([]);
            expect(colorsOf(p1.graveyard[0])).toEqual([]);
            expect(colorsOf(p1.exile[0])).toEqual([]);
            expect(colorsOf(p1.battlefield[0])).toEqual([]);
        });
    });

    it("a scenario seeds the lands that cast it, from its cost and not its colour", () => {
        const bears = { ...grizzlyBears(), staticAbilities: ["devoid"] };
        withTemporaryDefinition(bears, () => {
            const built = buildStateFromScenario(makeState(), {
                cards: [{ name: bears.name, owner: "me", zone: "hand" }],
                landCount: 2,
            });
            const lands = built.players[0].battlefield;
            expect(lands).toHaveLength(2);
            for (const land of lands) expect(land.subtypes).toContain("Forest");
        });
    });
});
