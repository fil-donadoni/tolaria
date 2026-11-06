// Differential Reading of a standing engine on every player's step (issue
// #5164, ADR 0151, PRD #5160).
//
// The defect: Howling Mine's trigger acts on `$event.activePlayerId` — every
// player in turn (CR 603.2b, `phaseScope: "each"`) — and the walker read it
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
    evaluateCreature,
    handLatentLens,
    permanentRealisedValue,
} from "../../evaluate";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { cardValueById, MAX_LATENT_SCRIPT_VALUE } from "../../cardValue";
import { creatureValueRaw, nonCreatureBodyRaw } from "../../creatureBody";
import { isCreature } from "../../constants";
import { syncLayers2to5 } from "../../layers2to5";
import { withTemporaryDefinition } from "../../../cards/registry";
import { forest, howlingMine } from "../../../cards/sets/lea/colorless.cards";
import { animateArtifact } from "../../../cards/sets/lea/blue.cards";
import { keldonTwilight } from "../../../cards/sets/pls/multicolor.cards";
import { opalescence } from "../../../cards/sets/uds/white.cards";
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
        // A reading, not a sign function: one extra card a turn sits well
        // inside the latent cap on both sides.
        for (const s of [smallHand, fullHand]) {
            expect(Math.abs(mineWorth(s))).toBeLessThan(
                MAX_LATENT_SCRIPT_VALUE
            );
        }
    });

    it("the position score with the Mine beats the one without it only on the board it feeds", () => {
        const delta = (own: number, opp: number) =>
            evaluate(board({ hand: own, mine: "board" }, { hand: opp }), "p1") -
            evaluate(board({ hand: own }, { hand: opp }), "p1");
        expect(delta(1, 7)).toBeGreaterThan(delta(7, 1));
        expect(delta(7, 1)).toBeLessThan(0);
    });

    it("one card into a hand at the maximum hand size moves the reading by less than one firing stream (issue #5579)", () => {
        // CR 514.1 is read over the hands that reach cleanup, not the leaf's:
        // the turn's draw (CR 504.1) and a main phase lie between. One firing
        // stream = one extra card kept whole on one side, none on the other
        // (an empty hand against a hand far past the maximum, whose drawn
        // Bear beats no Bear it holds).
        const stream = mineWorth(
            board({ hand: 0, mine: "board" }, { hand: 10 })
        );
        expect(stream).toBeGreaterThan(0);
        const step =
            mineWorth(board({ hand: 6, mine: "board" }, { hand: 7 })) -
            mineWorth(board({ hand: 7, mine: "board" }, { hand: 7 }));
        expect(step).toBeGreaterThan(0);
        expect(step).toBeLessThan(stream);
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
        // Dragons outdraw Bears: a smaller library gap (Dragon over Bear)
        // still feeds the better side, inside the cap. Read against a
        // library of Bears, not of Forests — a Bear a turn over a
        // Forest a turn already reaches MAX_LATENT_SCRIPT_VALUE at the
        // recurrence prior (issue #7819), where the bound, by design, no
        // longer orders the two.
        const dragons = board(
            { hand: 2, library: DRAGON, mine: "board" },
            { hand: 2, library: BEAR }
        );
        const bears = board(
            { hand: 2, library: BEAR, mine: "board" },
            { hand: 2, library: BEAR }
        );
        expect(mineWorth(dragons)).toBeLessThan(MAX_LATENT_SCRIPT_VALUE);
        expect(mineWorth(dragons)).toBeGreaterThan(mineWorth(bears));
    });

    it("hand and board read one Differential: at fraction 1 the faces match", () => {
        // ADR 0151 / issue #5145 — both faces measure the same board; the hand
        // only takes its fitted share of it (issue #8295, the describe below).
        const full = { ...DEFAULT_EVAL_WEIGHTS, heldDifferentialFraction: 1 };
        const held = board({ hand: 1, mine: "hand" }, { hand: 7 });
        const mineInHand = held.players[0].hand.find(
            (c) => String(c.card.id) === MINE
        )!;
        const handFace = cardValue(
            held,
            mineInHand,
            handLatentLens(held, "p1", mineInHand, full)
        );
        const boardFace = mineWorth(
            board({ hand: 1, mine: "board" }, { hand: 7 })
        );
        expect(handFace).toBeGreaterThan(0);
        expect(handFace).toBeLessThan(MAX_LATENT_SCRIPT_VALUE);
        expect(handFace).toBeCloseTo(boardFace, 6);
    });

    it("context-free, the Mine carries no fixed sign: it reads as a blank card of its mana value", () => {
        // ADR 0151 §1 — no board, no sides: a draft pick does not guess who
        // the Mine feeds, so the engine reads nothing and the Latent Floor
        // stands (the script is incomplete, issue #5161).
        expect(cardValueById(MINE)).toBe(nonCreatureBodyRaw(2));
    });

    it("a Mine tapped on this leaf reads as the untapped one: its untap step restores it (issue #5574)", () => {
        // CR 603.4 "if Howling Mine is untapped" is decided per side against
        // the source as its controller's untap step leaves it (CR 502.3) —
        // the engine is a recurrence over future steps, so a Mine tapped now
        // still feeds the table next turn. The opponent's hand sits far past
        // the maximum, so its own side reads nothing whichever way its step
        // finds the Mine (issue #5578 reads that side).
        const untapped = board({ hand: 1, mine: "board" }, { hand: 10 });
        const tapped = board({ hand: 1, mine: "board" }, { hand: 10 });
        tapped.players[0].battlefield[0].isTapped = true;
        expect(mineWorth(tapped)).toBeGreaterThan(0);
        expect(mineWorth(tapped)).toBeCloseTo(mineWorth(untapped), 6);
    });
});

describe("a held engine is priced below the one on the board (issue #8295)", () => {
    it("the fraction scales the Mine in hand and never on the board", () => {
        // An each-step engine recurs on the board face, which stays whole;
        // credited whole in hand too, casting ties holding.
        const full = { ...DEFAULT_EVAL_WEIGHTS, heldDifferentialFraction: 1 };
        const onBoard = board({ hand: 1, mine: "board" }, { hand: 7 });
        const mine = onBoard.players[0].battlefield[0];
        expect(permanentRealisedValue(onBoard, mine)).toBeCloseTo(
            permanentRealisedValue(onBoard, mine, full),
            9
        );
        const inHand = board({ hand: 1, mine: "hand" }, { hand: 7 });
        const held = inHand.players[0].hand.find((c) => c.card.id === MINE)!;
        const read = (w: typeof full) =>
            cardValue(inHand, held, handLatentLens(inHand, "p1", held, w));
        expect(read(full)).toBeGreaterThan(0);
        expect(read(DEFAULT_EVAL_WEIGHTS)).toBeCloseTo(
            DEFAULT_EVAL_WEIGHTS.heldDifferentialFraction * read(full),
            9
        );
    });

    it("a Mine that would feed only the opponent reads 0 in hand, below 0 on the board", () => {
        // CR 113.6 — the trigger functions only once the Mine stands: in hand
        // it does nothing, so the card can simply stay there.
        const inHand = board({ hand: 7, mine: "hand" }, { hand: 1 });
        const held = inHand.players[0].hand.find((c) => c.card.id === MINE)!;
        expect(
            cardValue(inHand, held, handLatentLens(inHand, "p1", held))
        ).toBe(0);
        const onBoard = board({ hand: 7, mine: "board" }, { hand: 1 });
        expect(
            permanentRealisedValue(onBoard, onBoard.players[0].battlefield[0])
        ).toBeLessThan(0);
    });
});

describe("an animated each-step engine keeps its Differential Reading (issue #5576)", () => {
    /** `board`, with p1's Mine enchanted by an Animate Artifact: a 2/2
     *  artifact creature that keeps its trigger (CR 613.1d / 613.4b). */
    function animated(own: number, opp: number): GameState {
        const state = board({ hand: own, mine: "board" }, { hand: opp });
        const p1 = state.players[0];
        const mine = p1.battlefield[0];
        p1.battlefield.push(
            makeInstance(animateArtifact().id, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
                attachedTo: mine.id,
            })
        );
        syncLayers2to5(state);
        return state;
    }

    /** The engine half of the animated Mine's creature face: its realized
     *  worth minus the vanilla 2/2 body it became. */
    function engineHalf(state: GameState): number {
        const mine = state.players[0].battlefield[0];
        expect(isCreature(mine)).toBe(true);
        return evaluateCreature(state, mine) - creatureValueRaw(2, 2, 2, []);
    }

    it("the creature face carries the engine the non-creature board face reads, whatever the sign", () => {
        // ADR 0151 — one number on every face: animating the Mine adds its
        // body and leaves its engine worth where it was, on the board that
        // feeds its controller and on the one that feeds the opponent.
        const feeds = engineHalf(animated(1, 7));
        expect(feeds).toBeGreaterThan(0);
        expect(feeds).toBeCloseTo(
            mineWorth(board({ hand: 1, mine: "board" }, { hand: 7 })),
            6
        );
        const starves = engineHalf(animated(7, 1));
        expect(starves).toBeLessThan(0);
        expect(starves).toBeCloseTo(
            mineWorth(board({ hand: 7, mine: "board" }, { hand: 1 })),
            6
        );
    });

    it("a PRINTED creature's each-step trigger reads the board at weight 1 (issue #5626; issue #5151's scope)", () => {
        // The same trigger on an artifact creature printed 2/2 (Magus of the
        // Vineyard's shape): the realized reader takes the board lens, so the
        // engine reads per side, but keeps weight 1 — one firing, not the
        // recurring stream the non-creature face reads.
        const golem = {
            ...howlingMine(),
            types: ["Artifact", "Creature"],
            power: 2,
            toughness: 2,
        } as ReturnType<typeof howlingMine>;
        const recurring = {
            feeds: mineWorth(board({ hand: 1, mine: "board" }, { hand: 7 })),
            starves: mineWorth(board({ hand: 7, mine: "board" }, { hand: 1 })),
        };
        withTemporaryDefinition(golem, () => {
            const half = (own: number, opp: number) => {
                const state = board(
                    { hand: own, mine: "board" },
                    { hand: opp }
                );
                const mine = state.players[0].battlefield[0];
                return (
                    evaluateCreature(state, mine) -
                    creatureValueRaw(2, 2, 2, [])
                );
            };
            const feeds = half(1, 7);
            expect(feeds).toBeGreaterThan(0);
            expect(feeds).toBeLessThan(recurring.feeds);
            const starves = half(7, 1);
            expect(starves).toBeLessThan(0);
            expect(starves).toBeGreaterThan(recurring.starves);
        });
    });

    it("an animated engine whose edict can take ITSELF prices its own loss without re-reading itself", () => {
        // Keldon Twilight under Opalescence is a creature its own each-step
        // sacrifice can take (CR 701.21a): pricing that loss is valuing the
        // Twilight, whose engine reads the same edict. The inner valuation
        // takes no lens (the engine reads nothing there), so the leaf
        // terminates instead of overflowing the stack.
        const pid = (p: string) => ({
            controllerId: p,
            ownerId: p,
            enteredOnTurn: 0,
        });
        const side = (p: string, own: boolean) =>
            makePlayer(p, {
                hand: [makeInstance(BEAR, { ...pid(p), zone: "hand" })],
                library: zone(p, BEAR, 10, "library"),
                battlefield: own
                    ? [
                          makeInstance(keldonTwilight().id, {
                              ...pid(p),
                              zone: "battlefield",
                          }),
                          makeInstance(opalescence().id, {
                              ...pid(p),
                              zone: "battlefield",
                          }),
                      ]
                    : [makeInstance(BEAR, { ...pid(p), zone: "battlefield" })],
            });
        const state = makeState({
            players: [side("p1", true), side("p2", false)],
            turn: 3,
        });
        syncLayers2to5(state);
        const twilight = state.players[0].battlefield[0];
        expect(isCreature(twilight)).toBe(true);
        expect(Number.isFinite(evaluateCreature(state, twilight))).toBe(true);
        expect(Number.isFinite(evaluate(state, "p1"))).toBe(true);
    });
});
