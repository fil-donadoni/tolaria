// Differential Reading of a standing engine on every player's step (issue
// #5164, ADR 0151, PRD #5160).
//
// The defect: Howling Mine's trigger acts on `$event.activePlayerId` — every
// player in turn (CR 603.6a, `phaseScope: "each"`) — and the walker read it
// ONCE, as "the controller draws a card", times the recurrence (issue
// #5151). So the Mine was worth the same extra card to its controller on
// every board, including the one where the opponent is the only player with
// room in hand for it. On a real board the engine is now read per side: what
// each player's extra draw is worth to that player (library-top expectation,
// cleanup discard, CR 514.1), the controller's minus the opponent's.
//
// Every reading runs through the PRODUCTION leaf (`evaluate`,
// `permanentRealisedValue`, `cardValue` with the hand term's lens) over real
// registry definitions, and asserts a direction, never a constant.
import { describe, expect, it } from "vitest";
import type { CardInstanceState, GameState } from "../../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import {
    cardValue,
    evaluate,
    handLatentLens,
    permanentRealisedValue,
} from "../../evaluate";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { cardValueById } from "../../cardValue";
import { forest, howlingMine } from "../../../cards/sets/lea/colorless.cards";
import { grizzlyBears } from "../../../cards/sets/lea/green.cards";
import { shivanDragon } from "../../../cards/sets/lea/red.cards";

const MINE = howlingMine().id;
const BEAR = grizzlyBears().id;
const DRAGON = shivanDragon().id;
const FOREST = forest().id;

interface Side {
    hand: number;
    library?: string;
    mine?: "board" | "hand";
}

function zone(
    pid: string,
    id: string,
    n: number,
    where: CardInstanceState["zone"]
): CardInstanceState[] {
    return Array.from({ length: n }, () =>
        makeInstance(id, { controllerId: pid, ownerId: pid, zone: where })
    );
}

/** A board where p1 controls (or holds) a Howling Mine: each side's hand is
 *  `hand` Grizzly Bears, its library twenty copies of `library`. */
function board(own: Side, opp: Side): GameState {
    const side = (pid: string, s: Side) =>
        makePlayer(pid, {
            hand: [
                ...zone(pid, BEAR, s.hand, "hand"),
                ...(s.mine === "hand" ? zone(pid, MINE, 1, "hand") : []),
            ],
            library: zone(pid, s.library ?? BEAR, 20, "library"),
            battlefield:
                s.mine === "board" ? zone(pid, MINE, 1, "battlefield") : [],
        });
    return makeState({ players: [side("p1", own), side("p2", opp)] });
}

/** The Mine's own worth on p1's board: its realised value minus the flat
 *  presence every permanent carries. */
function mineWorth(state: GameState): number {
    const mine = state.players[0].battlefield[0];
    return (
        permanentRealisedValue(state, mine) -
        DEFAULT_EVAL_WEIGHTS.permanentWeight
    );
}

describe("a standing each-step engine reads the board (issue #5164)", () => {
    it("Howling Mine feeds the side with the room in hand, and the sign flips on the mirror board", () => {
        // CR 514.1 — past seven cards the cleanup discard keeps the best: an
        // extra card into a full hand is worth only what it beats.
        const smallHand = board({ hand: 1, mine: "board" }, { hand: 7 });
        const fullHand = board({ hand: 7, mine: "board" }, { hand: 1 });
        expect(mineWorth(smallHand)).toBeGreaterThan(0);
        expect(mineWorth(fullHand)).toBeLessThan(0);
    });

    it("the position score with the Mine beats the one without it only on the board it feeds", () => {
        const delta = (own: number, opp: number) =>
            evaluate(board({ hand: own, mine: "board" }, { hand: opp }), "p1") -
            evaluate(board({ hand: own }, { hand: opp }), "p1");
        expect(delta(1, 7)).toBeGreaterThan(delta(7, 1));
        expect(delta(7, 1)).toBeLessThan(0);
    });

    it("with equal hands the side with the better library-top expectation is fed", () => {
        // Libraries of dragons against libraries of forests: the same extra
        // card a turn is a Shivan Dragon to one player and a Forest to the
        // other.
        const better = board(
            { hand: 2, library: DRAGON, mine: "board" },
            { hand: 2, library: FOREST }
        );
        const worse = board(
            { hand: 2, library: FOREST, mine: "board" },
            { hand: 2, library: DRAGON }
        );
        expect(mineWorth(better)).toBeGreaterThan(0);
        expect(mineWorth(worse)).toBeLessThan(0);
    });

    it("hand face equals board face on the same board", () => {
        // ADR 0151 / issue #5145 — casting the Mine moves its worth from the
        // hand term to the board term unchanged.
        const held = board({ hand: 1, mine: "hand" }, { hand: 7 });
        const mineInHand = held.players[0].hand.find(
            (c) => String(c.card.id) === MINE
        )!;
        const handFace = cardValue(
            held,
            mineInHand,
            handLatentLens(held, "p1", mineInHand)
        );
        const boardFace = mineWorth(
            board({ hand: 1, mine: "board" }, { hand: 7 })
        );
        expect(handFace).toBeGreaterThan(0);
        expect(handFace).toBeCloseTo(boardFace, 6);
    });

    it("context-free, the Mine keeps its pre-#5164 reading", () => {
        // No board, no sides: a draft pick does not guess who the Mine feeds.
        expect(cardValueById(MINE)).toBeGreaterThan(0);
    });
});
