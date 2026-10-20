// Standing each-step engines — the library to battlefield family (issue
// #5627, ADR 0151, PRD #5160).
//
// Oath of Druids fires on every player's upkeep (`phaseScope: "each"`,
// CR 603.2b): that player MAY reveal its library until a creature card, put
// it onto the battlefield and mill the rest — but only when an opponent
// controls more creatures than it does, or the trigger has no legal target
// and is removed from the stack (CR 603.3d). Before this slice the engine
// read nothing (issue #5575's read-nothing rule). It now reads per side: the
// expected creature off that side's library, less the milled prefix
// (`EachPlayerSide.digUnits`), taken only when that player gains by it
// (CR 603.5, `stepSideMayArm`), on the sides whose step meets the target
// condition (`stepTargetHolds`).
//
// Readings run through the PRODUCTION leaf (`permanentRealisedValue`,
// `cardValue` with the hand term's lens) over real registry definitions.
import { describe, expect, it } from "vitest";
import type { CardInstanceState, GameState } from "../../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import {
    cardValue,
    handLatentLens,
    permanentRealisedValue,
} from "../../evaluate";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { MAX_LATENT_SCRIPT_VALUE } from "../../cardValue";
import { isEachStepEngineScript } from "../opValuers";
import { forest } from "../../../cards/sets/lea/colorless.cards";
import { grizzlyBears } from "../../../cards/sets/lea/green.cards";
import { oathOfDruids } from "../../../cards/sets/exo/green.cards";

const OATH = oathOfDruids().id;
const LAND = forest().id;
const BEAR = grizzlyBears().id;

interface Side {
    /** Grizzly Bears on the battlefield. */
    creatures: number;
    /** Grizzly Bears in the library, the rest Forests. */
    libraryCreatures: number;
    /** The library's size; twenty by default. */
    librarySize?: number;
    oath?: "board" | "hand";
}

function cards(
    pid: string,
    id: string,
    n: number,
    where: CardInstanceState["zone"]
): CardInstanceState[] {
    return Array.from({ length: n }, () =>
        makeInstance(id, { controllerId: pid, ownerId: pid, zone: where })
    );
}

/** p1 controls (or holds) Oath of Druids; each side controls three Forests
 *  and `creatures` Grizzly Bears, two Forests in hand. */
function board(own: Side, opp: Side): GameState {
    const side = (pid: string, s: Side) =>
        makePlayer(pid, {
            hand: [
                ...cards(pid, LAND, 2, "hand"),
                ...(s.oath === "hand" ? cards(pid, OATH, 1, "hand") : []),
            ],
            library: [
                ...cards(pid, BEAR, s.libraryCreatures, "library"),
                ...cards(
                    pid,
                    LAND,
                    (s.librarySize ?? 20) - s.libraryCreatures,
                    "library"
                ),
            ],
            battlefield: [
                ...(s.oath === "board"
                    ? cards(pid, OATH, 1, "battlefield")
                    : []),
                ...cards(pid, LAND, 3, "battlefield"),
                ...cards(pid, BEAR, s.creatures, "battlefield"),
            ],
        });
    return makeState({ players: [side("p1", own), side("p2", opp)] });
}

/** Oath of Druids' own worth on p1's board: its realised value minus the
 *  flat presence every permanent carries. */
function oathWorth(state: GameState): number {
    const oath = state.players[0].battlefield[0];
    return (
        permanentRealisedValue(state, oath) -
        DEFAULT_EVAL_WEIGHTS.permanentWeight
    );
}

describe("a standing each-step dig reads the board (issue #5627)", () => {
    it("Oath of Druids' script is one the Differential reads", () => {
        const script = oathOfDruids().triggeredAbilities![0].effects!;
        expect(isEachStepEngineScript(script)).toBe(true);
    });

    it("only the side an opponent out-creatures digs: the sign is the controller's, flipped on the mirror", () => {
        // CR 603.3d — on the upkeep of the player with MORE creatures no
        // opponent controls more: no legal target, the trigger does nothing.
        const mine = board(
            { creatures: 0, libraryCreatures: 4, oath: "board" },
            { creatures: 2, libraryCreatures: 4 }
        );
        const theirs = board(
            { creatures: 2, libraryCreatures: 4, oath: "board" },
            { creatures: 0, libraryCreatures: 4 }
        );
        expect(oathWorth(mine)).toBeGreaterThan(0);
        expect(oathWorth(theirs)).toBeLessThan(0);
        expect(oathWorth(mine)).toBeCloseTo(-oathWorth(theirs), 6);
        for (const s of [mine, theirs]) {
            expect(Math.abs(oathWorth(s))).toBeLessThanOrEqual(
                MAX_LATENT_SCRIPT_VALUE
            );
        }
    });

    it("the side whose upkeep it is reads its own library: the better dig is worth more", () => {
        // Forty-card libraries: a dig past many Forests stays under the
        // `MAX_LATENT_SCRIPT_VALUE` bound a richer one reaches.
        const rich = board(
            {
                creatures: 0,
                libraryCreatures: 2,
                librarySize: 40,
                oath: "board",
            },
            { creatures: 2, libraryCreatures: 4 }
        );
        const thin = board(
            {
                creatures: 0,
                libraryCreatures: 1,
                librarySize: 40,
                oath: "board",
            },
            { creatures: 2, libraryCreatures: 4 }
        );
        // Two Bears in forty: fewer Forests milled before the first.
        expect(oathWorth(rich)).toBeGreaterThan(oathWorth(thin));
        expect(oathWorth(thin)).toBeGreaterThan(0);
    });

    it("a player with no creature in its library declines the 'may' (CR 603.5): the dig would mill it, and reads 0", () => {
        const empty = board(
            { creatures: 0, libraryCreatures: 0, oath: "board" },
            { creatures: 2, libraryCreatures: 4 }
        );
        expect(oathWorth(empty)).toBeCloseTo(0, 9);
    });

    it("equal creature counts: no side has a legal target, the engine reads a measured 0", () => {
        // Only p1's library holds creatures: without the CR 603.3d gate its
        // own dig would read alone, a gain.
        const even = board(
            { creatures: 1, libraryCreatures: 4, oath: "board" },
            { creatures: 1, libraryCreatures: 0 }
        );
        expect(oathWorth(even)).toBeCloseTo(0, 9);
    });

    it("hand face equals board face on the same board, whatever the sign", () => {
        const faces = (own: number, opp: number) => {
            const held = board(
                { creatures: own, libraryCreatures: 4, oath: "hand" },
                { creatures: opp, libraryCreatures: 4 }
            );
            const inHand = held.players[0].hand.find(
                (c) => String(c.card.id) === OATH
            )!;
            return {
                handFace: cardValue(
                    held,
                    inHand,
                    handLatentLens(held, "p1", inHand)
                ),
                boardFace: oathWorth(
                    board(
                        { creatures: own, libraryCreatures: 4, oath: "board" },
                        { creatures: opp, libraryCreatures: 4 }
                    )
                ),
            };
        };
        const digs = faces(0, 2);
        expect(digs.handFace).toBeGreaterThan(0);
        expect(digs.handFace).toBeCloseTo(digs.boardFace, 6);
        const feeds = faces(2, 0);
        expect(feeds.handFace).toBeLessThan(0);
        expect(feeds.handFace).toBeCloseTo(feeds.boardFace, 6);
    });
});
