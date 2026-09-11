// Bot visibility for the ANNOUNCED-X discard additional cost (issue #2714).
//
// The half of `convex/__tests__/announcedXDiscardCost.test.ts` that touches
// bot-only modules — split out because `bot-suite-boundary.test.ts` requires
// every importer of `gre/moves` / `gre/applyMove` to run in the bot suite.
//
// Two seams, both of which fail SILENTLY if missed:
//   • ENUMERATION — one `cast-spell` Move per legal X. `enumerateCastMoves`
//     derived its X axis from the MANA cost alone (`hasX`) plus the flashback
//     exile leg, so a card whose variable lives in an additional cost and
//     whose printed cost carries no `{X}` pip at all got `chosenX: undefined`
//     — and `announceCast` rejects that outright ("Must choose X (>= 0) cards
//     to discard"), which is the bot-freeze shape of ADR 0047: a Move the Bot
//     generated itself and the server refuses.
//   • CHARGE — the search sandboxes actually discard the X cards announced.
//     Every X prices identically otherwise, so the search would always take
//     the largest one (Sickening Dreams for the whole hand, every game). There
//     are TWO sandboxes and they are separate code paths —
//     `applyMoveForSearch` (the greedy/dominance sandbox) and
//     `applyMoveInSearch` (the ISMCTS tree) — so each is asserted on its own.

import { describe, it, expect } from "vitest";
import { enumerateMoves } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { getPlayer, type GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { sickeningDreams } from "../../cards/sets/tor";
import { grizzlyBears, lightningBolt } from "../../cards/sets/lea";

const SWAMP = "6176936d-72e2-4205-8871-4c5a4f1cb2d8";

/** p1 holds Sickening Dreams plus `spare` other cards, with two untapped
 *  Swamps and `{B}{B}` floating; p2 fields a Grizzly Bears. */
function board(spare: number): GameState {
    const spell = makeInstance(sickeningDreams.id, {
        id: "sd",
        zone: "hand",
        controllerId: "p1",
        ownerId: "p1",
    });
    const spares = Array.from({ length: spare }, (_, i) =>
        makeInstance(lightningBolt.id, {
            id: `spare${i}`,
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const lands = Array.from({ length: 2 }, (_, i) =>
        makeInstance(SWAMP, {
            id: `swamp${i}`,
            zone: "battlefield",
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const bears = makeInstance(grizzlyBears.id, {
        id: "bears",
        zone: "battlefield",
        controllerId: "p2",
        ownerId: "p2",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [spell, ...spares],
                battlefield: lands,
                manaPool: { B: 2 },
            }),
            makePlayer("p2", { battlefield: [bears] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

const castXs = (state: GameState) =>
    enumerateMoves(state, "p1")
        .filter((m) => m.kind === "cast-spell" && m.cardInstanceId === "sd")
        .map((m) => (m.kind === "cast-spell" ? m.chosenX : undefined));

const castAtX = (state: GameState, x: number) =>
    enumerateMoves(state, "p1").find(
        (m) =>
            m.kind === "cast-spell" &&
            m.cardInstanceId === "sd" &&
            m.chosenX === x
    )!;

describe("Sickening Dreams — Bot visibility (one Move per legal X)", () => {
    it("enumerates every X from 0 to the hand ceiling, never `undefined`", () => {
        // Two spares = X may be 0, 1 or 2. The cast card itself is never
        // eligible fodder (CR 601.2a), so the ceiling is 2, not 3.
        expect(new Set(castXs(board(2)))).toEqual(new Set([0, 1, 2]));
    });

    it("offers X = 0 alone on a hand holding nothing but the spell", () => {
        expect(castXs(board(0))).toEqual([0]);
    });

    it("prices the ceiling in CARDS, not in the mana still untapped", () => {
        // Four spares but only {B}{B} floating and two lands: an X axis read
        // off `maxAffordableX` would collapse to the mana left over, which is
        // the wrong resource entirely — the discard is paid in cards.
        expect(new Set(castXs(board(4)))).toEqual(new Set([0, 1, 2, 3, 4]));
    });
});

describe("Sickening Dreams — the search sandboxes CHARGE the X they announced", () => {
    it("the GREEDY sandbox (applyMoveForSearch) discards exactly X cards", () => {
        const state = board(3);
        const after0 = getPlayer(
            applyMoveForSearch(state, "p1", castAtX(state, 0)),
            "p1"
        );
        expect(
            after0.graveyard.filter((c) => c.id.startsWith("spare"))
        ).toEqual([]);

        const after2 = getPlayer(
            applyMoveForSearch(state, "p1", castAtX(state, 2)),
            "p1"
        );
        expect(
            after2.graveyard.filter((c) => c.id.startsWith("spare"))
        ).toHaveLength(2);
    });

    it("the ISMCTS sandbox (applyMoveInSearch) discards exactly X cards too", () => {
        // The tree's own apply path, mutating IN PLACE — cloned per move so the
        // two rollouts start from the same board and the assertion can never
        // compare a state with itself (proof-of-failure shape 2).
        const state = board(3);
        const world0 = structuredClone(state);
        applyMoveInSearch(world0, "p1", castAtX(state, 0));
        expect(
            getPlayer(world0, "p1").graveyard.filter((c) =>
                c.id.startsWith("spare")
            )
        ).toEqual([]);

        const world2 = structuredClone(state);
        applyMoveInSearch(world2, "p1", castAtX(state, 2));
        expect(
            getPlayer(world2, "p1").graveyard.filter((c) =>
                c.id.startsWith("spare")
            )
        ).toHaveLength(2);
    });
});
