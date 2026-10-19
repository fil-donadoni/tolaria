// Standing each-step mill engines (issue #5625, ADR 0151, PRD #5160).
//
// The defect: Worry Beads' trigger has the player whose upkeep it is mill a
// card (`$event.activePlayerId`, `phaseScope: "each"`, CR 603.2b) and the
// Differential Reading had no side reader for it, so the engine read NOTHING
// on every board (issue #5575) — the same Latent Floor beside an opponent one
// draw from decking as beside two fat libraries. The mill is now read per
// side (`EachPlayerSide.millLoss`): the library's order is hidden, so a
// milled card costs only the library it shortens, at the leaf evaluator's
// own decking term (CR 104.3c / 704.5b) — nothing above `deckingHorizon`,
// steeper as decking nears. A graveyard the evaluator credits (recursion
// access, CR 702.138's granted escape) may make the mill a gain this reader
// does not price: that side is unreadable and the engine reads nothing.
//
// Readings run through the PRODUCTION leaf (`permanentRealisedValue`,
// `cardValue` with the hand term's lens) over real registry definitions.
import { describe, expect, it } from "vitest";
import { registeredDefinitions } from "../../../cards";
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
import { dslStandingAbilityScriptValue } from "../cardScriptValue";
import { contextFreeGrounding } from "../grounding";
import { isEachStepEngineScript } from "../opValuers";
import { forest } from "../../../cards/sets/lea/colorless.cards";
import { grizzlyBears } from "../../../cards/sets/lea/green.cards";
import { raiseDead } from "../../../cards/sets/lea/black.cards";
import { underworldBreach } from "../../../cards/sets/thb/red.cards";

const BEADS = registeredDefinitions().find((d) => d.name === "Worry Beads")!;
const BASIC = forest().id;
const BEAR = grizzlyBears().id;
const RAISE_DEAD = raiseDead().id;
const BREACH = underworldBreach().id;

interface Side {
    library: number;
    beads?: "board" | "hand";
    /** A card in hand that returns a creature from the graveyard. */
    recursion?: boolean;
    /** A permanent granting escape to its controller's graveyard. */
    escape?: boolean;
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

/** p1 controls (or holds) Worry Beads; each side controls three Forests,
 *  holds two Grizzly Bears and a library of `library` Bears. */
function board(own: Side, opp: Side): GameState {
    const side = (pid: string, s: Side) =>
        makePlayer(pid, {
            hand: [
                ...cards(pid, BEAR, 2, "hand"),
                ...(s.beads === "hand" ? cards(pid, BEADS.id, 1, "hand") : []),
                ...(s.recursion ? cards(pid, RAISE_DEAD, 1, "hand") : []),
            ],
            library: cards(pid, BEAR, s.library, "library"),
            battlefield: [
                ...(s.beads === "board"
                    ? cards(pid, BEADS.id, 1, "battlefield")
                    : []),
                ...cards(pid, BASIC, 3, "battlefield"),
                ...(s.escape ? cards(pid, BREACH, 1, "battlefield") : []),
            ],
        });
    return makeState({ players: [side("p1", own), side("p2", opp)] });
}

/** Worry Beads' own worth on p1's board: its realised value minus the flat
 *  presence every permanent carries. */
function beadsWorth(state: GameState): number {
    const beads = state.players[0].battlefield[0];
    return (
        permanentRealisedValue(state, beads) -
        DEFAULT_EVAL_WEIGHTS.permanentWeight
    );
}

/** The engine's standing reading on `state`'s board, through the hand
 *  term's lens — `undefined` when it reads nothing. */
function standingReading(state: GameState): number | undefined {
    const anchor = state.players[0].hand[0];
    return dslStandingAbilityScriptValue(
        BEADS,
        contextFreeGrounding(),
        handLatentLens(state, "p1", anchor)!
    );
}

describe("a standing each-step mill reads the board (issue #5625)", () => {
    it("Worry Beads is a mill-family engine the Differential reads", () => {
        const trigger = BEADS.triggeredAbilities![0];
        expect(isEachStepEngineScript(trigger.effects!)).toBe(true);
    });

    it("Worry Beads is worth what it costs the side near decking, and the sign flips on the mirror", () => {
        // CR 104.3c / 704.5b — only the short library pays: a library past
        // the decking horizon loses nothing to a milled card.
        const theirs = board({ library: 30, beads: "board" }, { library: 5 });
        const mine = board({ library: 5, beads: "board" }, { library: 30 });
        expect(beadsWorth(theirs)).toBeGreaterThan(0);
        expect(beadsWorth(mine)).toBeLessThan(0);
        for (const s of [theirs, mine]) {
            expect(Math.abs(beadsWorth(s))).toBeLessThan(
                MAX_LATENT_SCRIPT_VALUE
            );
        }
    });

    it("two libraries past the decking horizon read a MEASURED zero", () => {
        // ADR 0151 rule 2 — read off both boards, it nets to nothing.
        expect(standingReading(board({ library: 30 }, { library: 30 }))).toBe(
            0
        );
    });

    it("hand face equals board face on the same board, whatever the sign", () => {
        const faces = (own: number, opp: number) => {
            const held = board(
                { library: own, beads: "hand" },
                { library: opp }
            );
            const inHand = held.players[0].hand.find(
                (c) => String(c.card.id) === BEADS.id
            )!;
            return {
                handFace: cardValue(
                    held,
                    inHand,
                    handLatentLens(held, "p1", inHand)
                ),
                boardFace: beadsWorth(
                    board({ library: own, beads: "board" }, { library: opp })
                ),
            };
        };
        const takes = faces(30, 5);
        expect(takes.handFace).toBeGreaterThan(0);
        expect(takes.handFace).toBeCloseTo(takes.boardFace, 6);
        const costs = faces(5, 30);
        expect(costs.handFace).toBeLessThan(0);
        expect(costs.handFace).toBeCloseTo(costs.boardFace, 6);
    });

    it("a side whose graveyard the evaluator credits reads nothing, whichever side it is", () => {
        // A milled card may be a gain this reader does not price — Raise Dead
        // in hand (recursion access) or a CR 702.138 escape grant on the
        // battlefield: fail-closed, ADR 0151 §1.
        expect(
            standingReading(board({ library: 30 }, { library: 5 }))
        ).toBeGreaterThan(0);
        for (const credited of [
            board({ library: 30 }, { library: 5, recursion: true }),
            board({ library: 30, recursion: true }, { library: 5 }),
            board({ library: 30 }, { library: 5, escape: true }),
            board({ library: 30, escape: true }, { library: 5 }),
        ]) {
            expect(standingReading(credited)).toBeUndefined();
        }
    });
});
