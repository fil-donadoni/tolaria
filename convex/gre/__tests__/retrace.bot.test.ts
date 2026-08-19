// Bot visibility + costing for Retrace (CR 702.81, issue #2358).
//
// The half of `retrace.test.ts` that touches bot-only modules — split out
// because `bot-suite-boundary.test.ts` requires every importer of `gre/moves` /
// `gre/applyMove` / `gre/search` to run in the bot suite.
//
// Three seams, each of which fails SILENTLY if missed:
//   • ENUMERATION — `enumerateMoves` never looked at the graveyard for a CAST
//     (only for a land PLAY and for graveyard-source activated abilities), so a
//     Bot holding Wrenn and Six's emblem could never use it.
//   • ZONE — both search sandboxes hard-coded hand/library for a `cast-spell`,
//     so a graveyard cast would throw "Card <id> not found in hand".
//   • CHARGE — the sandbox must actually discard the land. This one is not an
//     accuracy nicety: CR 702.81a exiles nothing, so the spell returns to the
//     graveyard on resolution (CR 608.2m) and is castable again. The discarded
//     land is the ONLY thing that terminates the line; an uncharged sandbox
//     models a free, unbounded recast loop.
//
// There are TWO sandboxes and they are separate code paths —
// `applyMoveForSearch` (`applyMove.ts`, the greedy/dominance sandbox) and
// `applyMoveInSearch` (`search.ts`, the ISMCTS tree) — so each is asserted on
// its own.

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
import { WRENN_AND_SIX_EMBLEM_ID } from "../../cards/emblems";
import { grizzlyBears, lightningBolt, mountain } from "../../cards/sets/lea";

/** p1 has the Wrenn and Six emblem, a Lightning Bolt in the graveyard, two
 *  untapped Mountains, and `handLands` Mountains (plus `handOther` non-lands)
 *  in hand. */
function board(opts: { handLands: number; handOther?: number }): GameState {
    const bolt = makeInstance(lightningBolt.id, {
        id: "gyBolt",
        zone: "graveyard",
        controllerId: "p1",
        ownerId: "p1",
    });
    const handLands = Array.from({ length: opts.handLands }, (_, i) =>
        makeInstance(mountain.id, {
            id: `handLand${i}`,
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const handOther = Array.from({ length: opts.handOther ?? 0 }, (_, i) =>
        makeInstance(grizzlyBears.id, {
            id: `handOther${i}`,
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const lands = Array.from({ length: 2 }, (_, i) =>
        makeInstance(mountain.id, {
            id: `bfLand${i}`,
            zone: "battlefield",
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [...handLands, ...handOther],
                battlefield: lands,
                graveyard: [bolt],
            }),
            makePlayer("p2"),
        ],
        emblems: [
            {
                id: "emblem-1",
                ownerId: "p1",
                emblemId: WRENN_AND_SIX_EMBLEM_ID,
                name: "Wrenn and Six emblem",
                text: "Instant and sorcery cards in your graveyard have retrace.",
            },
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function retraceCasts(state: GameState) {
    return enumerateMoves(state, "p1").filter(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === "gyBolt"
    );
}

/** The enumerated retrace cast aimed at the OPPONENT — `enumerateCastMoves`
 *  emits one Move per legal "any target" (CR 115.4), so the first is not
 *  necessarily the one whose payoff is observable on p2's life total. */
function retraceCastAtOpponent(state: GameState) {
    return retraceCasts(state).find(
        (m) =>
            m.kind === "cast-spell" &&
            m.targets.some((t) => t.type === "player" && t.id === "p2")
    );
}

describe("Retrace — Bot visibility (CR 702.81a)", () => {
    it("enumerates a cast-spell Move for the graveyard card the emblem reaches", () => {
        expect(retraceCasts(board({ handLands: 1 })).length).toBeGreaterThan(0);
    });

    it("enumerates NOTHING when the land discard cannot be paid", () => {
        // CR 702.81a / 601.2f — the additional cost gates announcement. A hand
        // of non-lands is not a payment.
        expect(retraceCasts(board({ handLands: 0, handOther: 2 }))).toEqual([]);
    });

    it("enumerates NOTHING without the emblem (no grant, no permission)", () => {
        const state = board({ handLands: 1 });
        state.emblems = undefined;
        expect(retraceCasts(state)).toEqual([]);
    });

    it("the GREEDY sandbox casts from the graveyard, charges the land, and returns the spell to the graveyard", () => {
        const state = board({ handLands: 2 });
        const move = retraceCastAtOpponent(state)!;

        const after = applyMoveForSearch(state, "p1", move);
        const p1 = getPlayer(after, "p1");

        // CR 702.81a — exactly ONE land card left the hand for the graveyard.
        expect(p1.hand.filter((c) => c.id.startsWith("handLand"))).toHaveLength(
            1
        );
        expect(
            p1.graveyard.filter((c) => c.id.startsWith("handLand"))
        ).toHaveLength(1);
        // CR 608.2m — the spell resolved and went BACK to the graveyard, not to
        // exile, so the Bot's model keeps it retraceable.
        expect(p1.graveyard.some((c) => c.id === "gyBolt")).toBe(true);
        expect(p1.exile.some((c) => c.id === "gyBolt")).toBe(false);
        expect(getPlayer(after, "p2").life).toBe(17);
    });

    it("the ISMCTS sandbox (applyMoveInSearch) charges the same land discard", () => {
        const state = board({ handLands: 2 });
        const move = retraceCastAtOpponent(state)!;

        applyMoveInSearch(state, "p1", move);
        const p1 = getPlayer(state, "p1");

        expect(p1.hand.filter((c) => c.id.startsWith("handLand"))).toHaveLength(
            1
        );
        expect(
            p1.graveyard.filter((c) => c.id.startsWith("handLand"))
        ).toHaveLength(1);
        // The ISMCTS sandbox leaves the spell ON THE STACK (the opponent still
        // gets priority), so the graveyard return is the greedy sandbox's
        // assertion above; what this one owns is that the card left the
        // GRAVEYARD zone (not the hand) and that its stack item is flagged
        // cast-from-graveyard with NO exile-on-resolve (CR 702.81a).
        expect(p1.graveyard.some((c) => c.id === "gyBolt")).toBe(false);
        const item = state.stack.find((s) => s.id === "gyBolt")!;
        expect(item.castFromGraveyard).toBe(true);
        expect(item.exileOnResolve).toBeUndefined();
    });

    it("the recast loop TERMINATES: each cast consumes a land, so N lands buy N casts", () => {
        // The property the discard charge exists to protect. With two lands in
        // hand the sandbox can retrace twice and then the move disappears.
        let state = board({ handLands: 2 });
        for (let i = 0; i < 2; i++) {
            const move = retraceCastAtOpponent(state);
            expect(move).toBeDefined();
            state = applyMoveForSearch(state, "p1", move!);
            // Refill the pool the same way a real turn would: the sandbox taps
            // lands per move, so untap for the next iteration.
            for (const perm of getPlayer(state, "p1").battlefield) {
                perm.isTapped = false;
            }
        }
        expect(getPlayer(state, "p1").hand).toEqual([]);
        expect(retraceCasts(state)).toEqual([]);
    });
});
