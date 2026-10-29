// CR 109.2a / 109.2b / 105.3 / 613.1e — an every-zone colour grant
// (`StaticColorGrant.affectsEveryZone`, issue #7208): Painter's Servant's "All
// cards that aren't on the battlefield, spells, and permanents are the chosen
// color in addition to their other colors."
//
// The grant is DERIVED OUTPUT (`grantedColors`) written by `syncLayers2to5`
// onto every object the text names — permanents, spells, and cards in a hand,
// library, graveyard or exile — and read through the one colour authority,
// `getEffectiveColors`. These tests drive the real sync, the real SPELL_CAST
// choke point and the real projection.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards";
import { getEffectiveColors } from "../../cards/effectiveColors";
import type {
    CardDefinition,
    PermanentView,
    StaticColorGrant,
} from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import { counterspell } from "../../cards/sets/lea/blue.cards";
import { lightningBolt } from "../../cards/sets/lea/red.cards";
import { projectPublicState } from "../../gameProjections";
import { syncLayers2to5 } from "../layers2to5";
import { emitSpellCastEvent, type GameState } from "../state";
import type { CardInstanceState } from "../state/declarations";

const PAINTER_ID = "test-7208-every-zone-painter";

function painter(
    grant: Partial<Pick<StaticColorGrant, "colors" | "affectsEveryZone">> = {}
): CardDefinition {
    return {
        ...grizzlyBears(),
        id: PAINTER_ID,
        name: "Every-Zone Painter",
        staticEffects: [
            {
                kind: "color-grant",
                applies: () => true,
                colors: "chosen-color",
                affectsEveryZone: true,
                ...grant,
            },
        ],
    };
}

/** P1 controls the painter (chosen colour blue); one red card sits in every
 *  zone, plus a red spell on the stack. */
function board(chosen: string | null = "U") {
    const source = makeInstance(PAINTER_ID, {
        id: "painter",
        controllerId: "p1",
        ownerId: "p1",
        ...(chosen ? { chosenModeId: chosen } : {}),
    });
    const red = (id: string) =>
        makeInstance(lightningBolt().id, {
            id,
            controllerId: "p2",
            ownerId: "p2",
        });
    const permanent = makeInstance(grizzlyBears().id, {
        id: "bears",
        controllerId: "p2",
        ownerId: "p2",
    });
    const zones = {
        hand: red("in-hand"),
        library: red("in-library"),
        graveyard: red("in-graveyard"),
        exile: red("in-exile"),
    };
    const state: GameState = makeState({
        players: [
            makePlayer("p1", { battlefield: [source] }),
            makePlayer("p2", {
                battlefield: [permanent],
                hand: [zones.hand],
                library: [zones.library],
                graveyard: [zones.graveyard],
                exile: [zones.exile],
            }),
        ],
    });
    const spell = pushSpell(state, lightningBolt().id, "p2");
    return { state, source, permanent, zones, spell };
}

const colorsOf = (card: unknown) =>
    [...getEffectiveColors(card as PermanentView)].sort();

describe("every-zone colour grant (CR 109.2a / 109.2b / 613.1e)", () => {
    it("adds the chosen colour to cards in every zone, spells and permanents, keeping their own (CR 105.3)", () => {
        withTemporaryDefinition(painter(), () => {
            const { state, permanent, zones, spell } = board();
            syncLayers2to5(state);
            for (const card of Object.values(zones)) {
                expect(colorsOf(card)).toEqual(["R", "U"]);
            }
            expect(colorsOf(spell)).toEqual(["R", "U"]);
            expect(colorsOf(permanent)).toEqual(["G", "U"]);
        });
    });

    it("without `affectsEveryZone` the same grant reaches permanents only (CR 109.2, fail-closed)", () => {
        withTemporaryDefinition(
            painter({ affectsEveryZone: undefined }),
            () => {
                const { state, permanent, zones, spell } = board();
                syncLayers2to5(state);
                for (const card of Object.values(zones)) {
                    expect(colorsOf(card)).toEqual(["R"]);
                }
                expect(colorsOf(spell)).toEqual(["R"]);
                expect(colorsOf(permanent)).toEqual(["G", "U"]);
            }
        );
    });

    it("a source with no colour chosen grants nothing", () => {
        withTemporaryDefinition(painter(), () => {
            const { state, permanent, zones } = board(null);
            syncLayers2to5(state);
            expect(colorsOf(zones.hand)).toEqual(["R"]);
            expect(colorsOf(permanent)).toEqual(["G"]);
        });
    });

    it("the grant ends everywhere when the source leaves the battlefield (CR 611.3b)", () => {
        withTemporaryDefinition(painter(), () => {
            const { state, zones, spell } = board();
            syncLayers2to5(state);
            expect(colorsOf(zones.library)).toEqual(["R", "U"]);

            state.players[0].battlefield = [];
            syncLayers2to5(state);
            for (const card of Object.values(zones)) {
                expect(colorsOf(card)).toEqual(["R"]);
                expect(
                    (card as CardInstanceState).grantedColors
                ).toBeUndefined();
            }
            expect(colorsOf(spell)).toEqual(["R"]);
        });
    });

    it("a cast trigger sees the granted colour on the SPELL_CAST event (CR 601.2i)", () => {
        withTemporaryDefinition(painter(), () => {
            const { state } = board();
            const cast = pushSpell(state, counterspell().id, "p2");
            state.pendingEvents = [];
            emitSpellCastEvent(state, cast);
            const event = (state.pendingEvents ?? []).find(
                (e) => e.type === "SPELL_CAST"
            ) as { spellColors?: string[] } | undefined;
            expect(event).toBeDefined();
            expect([...(event!.spellColors ?? [])].sort()).toEqual(["U"]);

            const bolt = pushSpell(state, lightningBolt().id, "p2");
            state.pendingEvents = [];
            emitSpellCastEvent(state, bolt);
            const boltEvent = (state.pendingEvents ?? []).find(
                (e) => e.type === "SPELL_CAST"
            ) as { spellColors?: string[] } | undefined;
            expect([...(boltEvent!.spellColors ?? [])].sort()).toEqual([
                "R",
                "U",
            ]);
        });
    });

    it("wire format: the client reads the grant on hand, graveyard, exile, stack and battlefield", () => {
        withTemporaryDefinition(painter(), () => {
            const { state } = board();
            syncLayers2to5(state);
            const owner = projectPublicState(state, 1, "p2");
            const p2 = owner.players[1];
            expect(colorsOf(p2.hand[0])).toEqual(["R", "U"]);
            expect(colorsOf(p2.graveyard[0])).toEqual(["R", "U"]);
            expect(colorsOf(p2.exile[0])).toEqual(["R", "U"]);
            expect(colorsOf(p2.battlefield[0])).toEqual(["G", "U"]);
            expect(colorsOf(owner.stack[0])).toEqual(["R", "U"]);

            // CR 402.3 — the opponent's hand stays hidden: the grant rides no
            // channel the viewer cannot already see.
            const opponent = projectPublicState(state, 1, "p1");
            expect(opponent.players[1].hand[0]).toBeNull();
        });
    });
});
