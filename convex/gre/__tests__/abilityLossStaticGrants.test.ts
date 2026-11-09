// CR 604.1 / 611.3a / 613.1f (issue #7942) — a static ability declared as a
// `CardDefinition` field and read off the battlefield (a granted escape or
// retrace, a graveyard play permission, a library-top play, a library-top
// reveal) applies only while its permanent HAS the ability. A layer-6
// suppressor (Humility on a creature, Titania's Song on a noncreature
// artifact) ends the grant; the grant is back the moment the suppressor leaves.
//
// Every board here drives the suppression through the layer system —
// `beginApplyingStaticEffects` + `recomputeContinuousEffects` — never a
// hand-set `abilitiesSuppressedBy`, so the test reaches the code that writes
// the flag as well as the readers gated on it.

import { describe, it, expect } from "vitest";
import {
    beginApplyingStaticEffects,
    getPlayer,
    recomputeContinuousEffects,
    removePermanentTo,
    type CardInstanceState,
    type GameState,
} from "../state";
import {
    canPlayLandsFromGraveyard,
    canPlayLandsFromTopOfLibrary,
    getLegalActions,
} from "../rules";
import { getGrantedEscape } from "../escape";
import { hasGrantedRetrace } from "../retrace";
import { computeLibraryTopRevealedPlayers } from "../libraryReveal";
import { projectPublicState } from "../../gameProjections";
import { getCardByName, getDefinition } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const HUMILITY = getCardByName("Humility").id;
const TITANIAS_SONG = getCardByName("Titania's Song").id;
const BREACH = getCardByName("Underworld Breach").id;
const SIX = getCardByName("Six").id;
const CRUCIBLE = getCardByName("Crucible of Worlds").id;
const COURSER = getCardByName("Courser of Kruphix").id;
const BEARS = getCardByName("Grizzly Bears").id;
const BOLT = getCardByName("Lightning Bolt").id;
const FOREST = getCardByName("Forest").id;

/** Underworld Breach's grant on a CREATURE body, so Humility (which reaches
 *  creatures only) is the real layer-6 suppressor of it. The grant field is
 *  the printed card's, untouched. */
const BREACH_CREATURE_ID = "test-7942-breach-creature";
function breachCreature(): CardDefinition {
    const breach = getDefinition(BREACH);
    return {
        ...breach,
        id: BREACH_CREATURE_ID,
        name: "Breach Creature (test)",
        types: ["Creature"],
        power: 1,
        toughness: 1,
    };
}

function p1Card(
    defId: string,
    zone: CardInstanceState["zone"],
    id: string
): CardInstanceState {
    return makeInstance(defId, {
        id,
        zone,
        controllerId: "p1",
        ownerId: "p1",
    });
}

function board(over: Parameters<typeof makePlayer>[1]): GameState {
    return makeState({
        players: [makePlayer("p1", over), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

/** Puts `suppressorDefId` onto p1's battlefield and runs the layer system. */
function suppress(state: GameState, suppressorDefId: string): void {
    const source = p1Card(suppressorDefId, "battlefield", "suppressor");
    getPlayer(state, "p1").battlefield.push(source);
    beginApplyingStaticEffects(state, source);
    recomputeContinuousEffects(state);
}

/** The suppressor leaves play; the layer system re-derives. */
function release(state: GameState): void {
    removePermanentTo(state, "suppressor", "graveyard");
    recomputeContinuousEffects(state);
}

function granterSuppressed(state: GameState, granterId: string): boolean {
    const granter = getPlayer(state, "p1").battlefield.find(
        (c) => c.id === granterId
    )!;
    return (granter.abilitiesSuppressedBy?.length ?? 0) > 0;
}

function gyActions(state: GameState, id: string) {
    const p1 = getPlayer(state, "p1");
    return getLegalActions(state, p1, p1.graveyard.find((c) => c.id === id)!);
}

function wireGraveyardCard(state: GameState, id: string) {
    const projected = projectPublicState(state, 1, "p1");
    return projected.players[0].graveyard.find((c) => c.id === id) as {
        castKind?: string;
        legalActions?: string[];
    };
}

describe("ability loss ends a battlefield-static grant (CR 613.1f, issue #7942)", () => {
    it("escape (CR 702.138): Humility on a Breach-shaped creature ends the granted escape, on the wire too", () => {
        withTemporaryDefinition(breachCreature(), () => {
            const fodder = [1, 2, 3].map((n) =>
                p1Card(FOREST, "graveyard", `fodder${n}`)
            );
            const state = board({
                battlefield: [
                    p1Card(BREACH_CREATURE_ID, "battlefield", "granter"),
                    p1Card(getCardByName("Mountain").id, "battlefield", "mtn"),
                ],
                graveyard: [p1Card(BOLT, "graveyard", "bolt"), ...fodder],
            });
            const bolt = () =>
                getPlayer(state, "p1").graveyard.find((c) => c.id === "bolt")!;
            expect(getGrantedEscape(state, bolt())).toBeDefined();
            expect(wireGraveyardCard(state, "bolt").castKind).toBe("escape");

            suppress(state, HUMILITY);
            expect(granterSuppressed(state, "granter")).toBe(true);
            expect(getGrantedEscape(state, bolt())).toBeUndefined();
            expect(wireGraveyardCard(state, "bolt").castKind).toBeUndefined();

            release(state);
            expect(getGrantedEscape(state, bolt())).toBeDefined();
            expect(wireGraveyardCard(state, "bolt").castKind).toBe("escape");
        });
    });

    it("retrace (CR 702.81a): Six under Humility grants no retrace, on the wire too", () => {
        const state = board({
            battlefield: [p1Card(SIX, "battlefield", "granter")],
            graveyard: [p1Card(BEARS, "graveyard", "bears")],
            hand: [p1Card(FOREST, "hand", "forest")],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 },
        });
        const bears = () =>
            getPlayer(state, "p1").graveyard.find((c) => c.id === "bears")!;
        expect(hasGrantedRetrace(state, bears())).toBe(true);
        expect(wireGraveyardCard(state, "bears").castKind).toBe("retrace");

        suppress(state, HUMILITY);
        expect(granterSuppressed(state, "granter")).toBe(true);
        expect(hasGrantedRetrace(state, bears())).toBe(false);
        expect(wireGraveyardCard(state, "bears").castKind).toBeUndefined();

        release(state);
        expect(hasGrantedRetrace(state, bears())).toBe(true);
        expect(wireGraveyardCard(state, "bears").castKind).toBe("retrace");
    });

    it("graveyard play (CR 305.1 permission): Crucible of Worlds under Titania's Song plays no land from the graveyard, on the wire too", () => {
        const state = board({
            battlefield: [p1Card(CRUCIBLE, "battlefield", "granter")],
            graveyard: [p1Card(FOREST, "graveyard", "gyForest")],
        });
        expect(gyActions(state, "gyForest")).toEqual(["play"]);
        expect(wireGraveyardCard(state, "gyForest").legalActions).toEqual([
            "play",
        ]);

        suppress(state, TITANIAS_SONG);
        expect(granterSuppressed(state, "granter")).toBe(true);
        expect(gyActions(state, "gyForest")).toEqual([]);
        expect(wireGraveyardCard(state, "gyForest").legalActions ?? []).toEqual(
            []
        );

        // CR 611.3b — "If this enchantment leaves the battlefield, this
        // effect continues until end of turn": the Song's departure does NOT
        // restore the permission this turn (the other families pin the
        // return, under Humility, which has no such clause).
        release(state);
        expect(granterSuppressed(state, "granter")).toBe(true);
        expect(canPlayLandsFromGraveyard(state, getPlayer(state, "p1"))).toBe(
            false
        );
    });

    it("library-top play: Courser of Kruphix under Humility plays no land off the top", () => {
        const state = board({
            battlefield: [p1Card(COURSER, "battlefield", "granter")],
            library: [p1Card(FOREST, "library", "topForest")],
        });
        const p1 = () => getPlayer(state, "p1");
        expect(canPlayLandsFromTopOfLibrary(state, p1())).toBe(true);

        suppress(state, HUMILITY);
        expect(granterSuppressed(state, "granter")).toBe(true);
        expect(canPlayLandsFromTopOfLibrary(state, p1())).toBe(false);

        release(state);
        expect(canPlayLandsFromTopOfLibrary(state, p1())).toBe(true);
    });

    it("library-top reveal (CR 401.5): Courser of Kruphix under Humility reveals nothing", () => {
        const state = board({
            battlefield: [p1Card(COURSER, "battlefield", "granter")],
            library: [p1Card(FOREST, "library", "topForest")],
        });
        expect(computeLibraryTopRevealedPlayers(state).has("p1")).toBe(true);

        suppress(state, HUMILITY);
        expect(granterSuppressed(state, "granter")).toBe(true);
        expect(computeLibraryTopRevealedPlayers(state).has("p1")).toBe(false);

        release(state);
        expect(computeLibraryTopRevealedPlayers(state).has("p1")).toBe(true);
    });
});
