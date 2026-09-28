// Deriving a Minimal Pair's right-hand half from its anchor (issue #4795,
// PRD #4792, ADR 0148).
//
// Every test runs on a REAL built position: the anchor rebuilds through
// `buildVerdictState`, the half is derived and rebuilt through the same
// builder, and the two built states are compared through one board summary —
// so "differs only in the declared Discriminant" is read off the engine's own
// state, never off the spec the derivation wrote.

import { describe, expect, it } from "vitest";
import type { ScenarioSpec } from "../../../debugScenarioSpec";
import { tryGetDefinition } from "../../../cards";
import { describeMove } from "../../describeMove";
import { moveKey } from "../../search";
import type { GameState } from "../../state";
import { BladeSetupError } from "../blade/setup";
import { seatPlayerId } from "../blade/matcher";
import {
    deriveRightHalfPosition,
    PairDerivationError,
    type DiscriminantChange,
} from "../verdicts/pairDerivation";
import { buildRightHalf } from "../verdicts/pairTrace";
import { buildVerdictState, candidateMoves } from "../verdicts/position";
import type {
    Discriminant,
    Verdict,
    VerdictCandidate,
} from "../verdicts/types";

/** The PRD's own fixture shape: a burn spell held in the caster's main phase,
 *  where "cast it now" is the judged move. */
const MAIN_PHASE: ScenarioSpec = {
    cards: [
        { name: "Lightning Bolt", owner: "me", zone: "hand" },
        { name: "Grizzly Bears", owner: "me", zone: "hand" },
        { name: "Mountain", owner: "me", zone: "battlefield", count: 2 },
        { name: "Forest", owner: "me", zone: "battlefield", count: 2 },
        { name: "Hill Giant", owner: "opp", zone: "battlefield" },
        { name: "Counterspell", owner: "opp", zone: "hand" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 5,
    landCount: 0,
    libraryCount: 10,
    landsPlayed: { me: 1 },
};

const conditional = (
    kind: Discriminant["kind"],
    detail: string
): Discriminant => ({ kind, detail });

/** A Conditional Verdict on `spec`, forbidding the first move `pick` accepts. */
function anchorOn(
    spec: ScenarioSpec,
    discriminant: Discriminant,
    pick: (description: string) => boolean = (d) => d.includes("Lightning Bolt")
): { anchor: Verdict; judged: VerdictCandidate } {
    const bare: Verdict = {
        id: "anchor",
        spec,
        seat: "me",
        candidates: [],
        answer: { kind: "forbidden", forbiddenIndexes: [0] },
        author: "test",
        createdAt: "2026-09-28T00:00:00.000Z",
        source: "authored",
    };
    const state = buildVerdictState(bare);
    const candidates = candidateMoves(state, seatPlayerId(state, "me")).map(
        (move) => ({
            key: moveKey(move),
            description: describeMove(move, state),
        })
    );
    const index = candidates.findIndex((c) => pick(c.description));
    expect(index).toBeGreaterThanOrEqual(0);
    return {
        anchor: {
            ...bare,
            candidates,
            answer: { kind: "forbidden", forbiddenIndexes: [index] },
            classification: { kind: "conditional", discriminant },
        },
        judged: candidates[index],
    };
}

/** What a position IS, read off the built state by seat. */
function boardOf(state: GameState) {
    const seats = { me: state.players[0], opp: state.players[1] };
    const nameOf = (c: { card: Record<string, unknown> }) =>
        tryGetDefinition(c.card.id as string)?.name ?? "(hidden)";
    const zone = (cards: { card: Record<string, unknown> }[]) =>
        cards.map(nameOf).sort();
    const bySeat = Object.fromEntries(
        Object.entries(seats).map(([seat, p]) => [
            seat,
            {
                life: p.life,
                hand: zone(p.hand),
                battlefield: p.battlefield
                    .map((c) => `${nameOf(c)}${c.isTapped ? " (tapped)" : ""}`)
                    .sort(),
                graveyard: zone(p.graveyard),
                exile: zone(p.exile),
                library: p.library.length,
                manaPool: Object.fromEntries(
                    Object.entries(p.manaPool).filter(([, n]) => n > 0)
                ),
                landsPlayed: p.landsPlayedThisTurn ?? 0,
            },
        ])
    );
    const seatOf = (id: string | undefined) =>
        id === seats.me.id ? "me" : id === seats.opp.id ? "opp" : id;
    return {
        seats: bySeat,
        phase: state.phase,
        turn: state.turn,
        active: seatOf(state.activePlayerId),
        priority: seatOf(state.priorityPlayerId),
        stack: state.stack.map(nameOf),
    };
}

/** Build the anchor and its derived half; return both boards. */
function derive(
    spec: ScenarioSpec,
    discriminant: Discriminant,
    change: DiscriminantChange,
    pick?: (description: string) => boolean
) {
    const { anchor, judged } = anchorOn(spec, discriminant, pick);
    const before = structuredClone(anchor);
    const built = buildRightHalf(anchor, discriminant, change, judged);
    // The derivation copies: the anchor is never touched.
    expect(anchor).toEqual(before);
    return {
        anchor,
        judged,
        built,
        anchorBoard: boardOf(buildVerdictState(anchor)),
        halfBoard: "state" in built ? boardOf(built.state) : undefined,
    };
}

describe("deriving a Minimal Pair's right-hand half, one prefill per Discriminant kind (issue #4795, ADR 0148)", () => {
    it("`step` moves the decision to the named step with the state that step implies — CR 500.1, 106.4, 117.4", () => {
        const { built, anchorBoard, halfBoard } = derive(
            { ...MAIN_PHASE, manaPool: { me: { R: 1 } }, passCount: 1 },
            conditional("step", "the opponent's end step"),
            { kind: "step", phase: "END_STEP", activePlayer: "opp" }
        );
        expect("refusal" in built).toBe(false);
        expect(anchorBoard.seats.me.manaPool).toEqual({ R: 1 });
        expect(anchorBoard.seats.me.landsPlayed).toBe(1);
        expect(halfBoard).toEqual({
            ...anchorBoard,
            phase: "END_STEP",
            // A new turn holder is a later turn: the anchor's land drop and
            // floating mana were THIS turn's, not the next one's.
            turn: anchorBoard.turn + 1,
            active: "opp",
            // The half is the same decision, so the same seat owes it.
            priority: "me",
            seats: {
                ...anchorBoard.seats,
                me: { ...anchorBoard.seats.me, manaPool: {}, landsPlayed: 0 },
            },
        });
    });

    it("`card` adds the named card, and nothing else", () => {
        const { anchorBoard, halfBoard } = derive(
            MAIN_PHASE,
            conditional("card", "Counterspell"),
            {
                kind: "card",
                op: "add",
                card: { name: "Counterspell", owner: "opp", zone: "hand" },
            }
        );
        expect(halfBoard!.seats.opp.hand).toEqual(
            [...anchorBoard.seats.opp.hand, "Counterspell"].sort()
        );
        expect(halfBoard).toEqual({
            ...anchorBoard,
            seats: {
                ...anchorBoard.seats,
                opp: {
                    ...anchorBoard.seats.opp,
                    hand: halfBoard!.seats.opp.hand,
                },
            },
        });
    });

    it("`card` removes one copy of the named card, narrowed by zone, and nothing else", () => {
        const { anchorBoard, halfBoard } = derive(
            MAIN_PHASE,
            conditional("card", "Mountain"),
            { kind: "card", op: "remove", name: "Mountain", owner: "me" }
        );
        expect(halfBoard).toEqual({
            ...anchorBoard,
            seats: {
                ...anchorBoard.seats,
                me: {
                    ...anchorBoard.seats.me,
                    battlefield: ["Forest", "Forest", "Mountain"],
                },
            },
        });
        // A name in two zones of one seat, with no zone to narrow it, is
        // refused rather than guessed.
        expect(() =>
            derive(
                {
                    ...MAIN_PHASE,
                    cards: [
                        ...MAIN_PHASE.cards,
                        {
                            name: "Grizzly Bears",
                            owner: "me",
                            zone: "graveyard",
                        },
                    ],
                },
                conditional("card", "Grizzly Bears"),
                {
                    kind: "card",
                    op: "remove",
                    name: "Grizzly Bears",
                    owner: "me",
                }
            )
        ).toThrow(PairDerivationError);
    });

    it("`life` sets the named figure — CR 119.1", () => {
        const { anchorBoard, halfBoard } = derive(
            MAIN_PHASE,
            conditional("life", "the opponent at 3"),
            { kind: "life", seat: "opp", life: 3 }
        );
        expect(anchorBoard.seats.opp.life).not.toBe(3);
        expect(halfBoard).toEqual({
            ...anchorBoard,
            seats: {
                ...anchorBoard.seats,
                opp: { ...anchorBoard.seats.opp, life: 3 },
            },
        });
    });

    it("`mana` sets the named figure — CR 106.4", () => {
        const { anchorBoard, halfBoard } = derive(
            MAIN_PHASE,
            conditional("mana", "one red floating"),
            { kind: "mana", seat: "me", pool: { R: 1, G: 0 } }
        );
        expect(halfBoard).toEqual({
            ...anchorBoard,
            seats: {
                ...anchorBoard.seats,
                me: { ...anchorBoard.seats.me, manaPool: { R: 1 } },
            },
        });
    });

    it("`stack` edits the named stack object — CR 405.1", () => {
        const onStack: ScenarioSpec = {
            ...MAIN_PHASE,
            stack: [{ kind: "spell", name: "Giant Growth", controller: "opp" }],
            priority: "me",
        };
        const { anchorBoard, halfBoard } = derive(
            onStack,
            conditional("stack", "Giant Growth"),
            { kind: "stack", op: "remove", index: 0 }
        );
        expect(anchorBoard.stack).toEqual(["Giant Growth"]);
        expect(halfBoard).toEqual({ ...anchorBoard, stack: [] });

        const replaced = derive(
            onStack,
            conditional("stack", "Lightning Bolt"),
            {
                kind: "stack",
                op: "replace",
                index: 0,
                item: {
                    kind: "spell",
                    name: "Lightning Bolt",
                    controller: "opp",
                },
            }
        );
        expect(replaced.halfBoard).toEqual({
            ...replaced.anchorBoard,
            stack: ["Lightning Bolt"],
        });
        expect(() =>
            deriveRightHalfPosition(
                replaced.anchor,
                conditional("stack", "nothing"),
                { kind: "stack", op: "remove", index: 3 }
            )
        ).toThrow(PairDerivationError);
    });

    it("`other` is the bare copy", () => {
        const { anchor, built, anchorBoard, halfBoard } = derive(
            MAIN_PHASE,
            conditional("other", "the opponent is tapped out in spirit"),
            { kind: "other" }
        );
        expect(halfBoard).toEqual(anchorBoard);
        expect(built.position).toEqual({
            spec: anchor.spec,
            seat: anchor.seat,
        });
    });

    it("an edit of another kind does not realise the Discriminant", () => {
        const { anchor } = anchorOn(MAIN_PHASE, conditional("step", "x"));
        expect(() =>
            deriveRightHalfPosition(anchor, conditional("step", "x"), {
                kind: "life",
                seat: "opp",
                life: 3,
            })
        ).toThrow(PairDerivationError);
    });
});

describe("`sequence` — the earlier move through real setup (issue #4795, ADR 0148)", () => {
    it("appends the earlier move as setup steps and builds the board it really leaves", () => {
        const { built, anchorBoard, halfBoard } = derive(
            MAIN_PHASE,
            conditional("sequence", "Grizzly Bears already cast"),
            {
                kind: "sequence",
                steps: [
                    { kind: "cast", card: "Grizzly Bears" },
                    { kind: "pass", seat: "opp" },
                ],
            }
        );
        expect("refusal" in built ? built.refusal : undefined).toBeUndefined();
        expect(built.position.setup).toEqual([
            { kind: "cast", card: "Grizzly Bears" },
            { kind: "pass", seat: "opp" },
        ]);
        // The Bears resolved through the engine (`cast` + the opponent's
        // `pass`, CR 608): out of the hand, onto the battlefield, paid for
        // with two of the four lands.
        expect(halfBoard!.seats.me.hand).toEqual(["Lightning Bolt"]);
        expect(anchorBoard.seats.me.battlefield).toEqual([
            "Forest",
            "Forest",
            "Mountain",
            "Mountain",
        ]);
        expect(halfBoard!.seats.me.battlefield).toEqual([
            "Forest",
            "Forest (tapped)",
            "Grizzly Bears",
            "Mountain",
            "Mountain (tapped)",
        ]);
        expect(halfBoard!.seats.opp).toEqual(anchorBoard.seats.opp);
    });

    it("throws when a step finds no purchase, as setup steps do", () => {
        expect(() =>
            derive(
                MAIN_PHASE,
                conditional("sequence", "a spell that is not in hand"),
                {
                    kind: "sequence",
                    steps: [{ kind: "cast", card: "Shivan Dragon" }],
                }
            )
        ).toThrow(BladeSetupError);
    });

    it("refuses, with its named reason, an earlier move that leaves no trace on the board", () => {
        const { built } = derive(
            MAIN_PHASE,
            conditional(
                "sequence",
                "looked at the top of the opponent's library"
            ),
            {
                kind: "sequence",
                steps: [{ kind: "know-library-top", count: 1, of: "opp" }],
            }
        );
        expect("refusal" in built && built.refusal.reason).toBe("no-trace");
        expect("refusal" in built && built.refusal.detail).toContain(
            "leaves no trace on the board"
        );
    });
});
