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
        passCount: state.passCount,
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
    const position = deriveRightHalfPosition(anchor, discriminant, change);
    // The derivation copies: the anchor is never touched.
    expect(anchor).toEqual(before);
    const built = buildRightHalf(anchor, discriminant, position, judged);
    return {
        anchor,
        judged,
        position,
        built,
        anchorBoard: boardOf(buildVerdictState(anchor)),
        halfBoard: "state" in built ? boardOf(built.state) : undefined,
    };
}

describe("deriving a Minimal Pair's right-hand half, one prefill per Discriminant kind (issue #4795, ADR 0148)", () => {
    it("`step` moves the decision to the named step with the state that step implies — CR 106.4, 117.3a, 117.3d", () => {
        const { built, anchorBoard, halfBoard } = derive(
            { ...MAIN_PHASE, manaPool: { me: { R: 1 } } },
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
            // The half is the same decision, so the same seat owes it — and
            // it holds priority in the opponent's step only because the
            // opponent passed it over (CR 117.3a/117.3d).
            priority: "me",
            passCount: 1,
            seats: {
                ...anchorBoard.seats,
                me: { ...anchorBoard.seats.me, manaPool: {}, landsPlayed: 0 },
            },
        });
    });

    it("`step` within the decider's own turn keeps the turn and banks no pass — CR 117.3a", () => {
        const { anchorBoard, halfBoard } = derive(
            { ...MAIN_PHASE, passCount: 1, priority: "me" },
            conditional("step", "my own end step"),
            { kind: "step", phase: "END_STEP", activePlayer: "me" }
        );
        expect(anchorBoard.passCount).toBe(1);
        expect(halfBoard).toEqual({
            ...anchorBoard,
            phase: "END_STEP",
            passCount: 0,
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

    it("`life` sets the named figure", () => {
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

    it("`other` is the bare copy — a prefill to touch up, refused as a pair until it is", () => {
        const { anchor, judged, position, built } = derive(
            MAIN_PHASE,
            conditional("other", "the opponent is tapped out in spirit"),
            { kind: "other" }
        );
        expect(position).toEqual({ spec: anchor.spec, seat: anchor.seat });
        expect("refusal" in built && built.refusal.reason).toBe("no-change");

        // Touched up, it builds — and, not being a `sequence`, owes no trace
        // check even though the fit may not read what the tester changed.
        const touched = {
            ...position,
            spec: {
                ...position.spec,
                cards: position.spec.cards.map((c) =>
                    c.name === "Hill Giant" ? { ...c, tapped: true } : c
                ),
            },
        };
        const accepted = buildRightHalf(
            anchor,
            conditional("other", "the opponent is tapped out in spirit"),
            touched,
            judged
        );
        expect(
            "refusal" in accepted ? accepted.refusal : undefined
        ).toBeUndefined();
    });

    it("an edit that leaves the figure where it was is the anchor, and is refused", () => {
        const { built } = derive(
            { ...MAIN_PHASE, life: { opp: 7 } },
            conditional("life", "the opponent at 7"),
            { kind: "life", seat: "opp", life: 7 }
        );
        expect("refusal" in built && built.refusal.reason).toBe("no-change");
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
        const { position, built, anchorBoard, halfBoard } = derive(
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
        expect(position.setup).toEqual([
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

describe("the implied state and the edges of each prefill (issue #4795, review)", () => {
    it("`step` to the next turn: cleanup removes marked damage, the per-turn tallies clear, the turn count moves — CR 514.2", () => {
        const { anchor } = anchorOn(MAIN_PHASE, conditional("step", "x"));
        const spec: ScenarioSpec = {
            ...MAIN_PHASE,
            cards: MAIN_PHASE.cards.map((c) =>
                c.name === "Hill Giant"
                    ? { ...c, damageMarked: 2, activations: { a: 1 } }
                    : c
            ),
            turnsTaken: { me: 3, opp: 2 },
            qualifyingActionThisTurn: { me: true },
            restrictedMana: { me: [{ color: "R", amount: 1 }] },
        };
        const half = deriveRightHalfPosition(
            { ...anchor, spec },
            conditional("step", "the opponent's end step"),
            { kind: "step", phase: "END_STEP", activePlayer: "opp" }
        ).spec;
        const giant = half.cards.find((c) => c.name === "Hill Giant")!;
        expect(giant.damageMarked).toBeUndefined();
        expect(giant.activations).toBeUndefined();
        expect(half.turnsTaken).toEqual({ me: 3, opp: 3 });
        expect(half.qualifyingActionThisTurn).toBeUndefined();
        expect(half.qualifyingActionLastTurn).toEqual({ me: true });
        expect(half.restrictedMana).toBeUndefined();
    });

    it("`step` drops a combat outside the combat phase, and the old turn's combat inside the new one's — CR 506.1", () => {
        const { anchor } = anchorOn(MAIN_PHASE, conditional("step", "x"));
        const inCombat: ScenarioSpec = {
            ...MAIN_PHASE,
            phase: "DECLARE_ATTACKERS",
            combat: { attackers: ["Grizzly Bears"], confirmed: true },
        };
        const step = (phase: DiscriminantChange & { kind: "step" }) =>
            deriveRightHalfPosition(
                { ...anchor, spec: inCombat },
                conditional("step", phase.phase),
                phase
            ).spec.combat;
        expect(
            step({
                kind: "step",
                phase: "DECLARE_BLOCKERS",
                activePlayer: "me",
            })
        ).toEqual(inCombat.combat);
        expect(
            step({ kind: "step", phase: "POSTCOMBAT_MAIN", activePlayer: "me" })
        ).toBeUndefined();
        expect(
            step({
                kind: "step",
                phase: "DECLARE_BLOCKERS",
                activePlayer: "opp",
            })
        ).toBeUndefined();
    });

    it("`card` remove narrowed by zone takes the copy in that zone only", () => {
        const { anchorBoard, halfBoard } = derive(
            {
                ...MAIN_PHASE,
                cards: [
                    ...MAIN_PHASE.cards,
                    { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                ],
            },
            conditional("card", "Grizzly Bears"),
            {
                kind: "card",
                op: "remove",
                name: "Grizzly Bears",
                owner: "me",
                zone: "graveyard",
            }
        );
        expect(anchorBoard.seats.me.graveyard).toEqual(["Grizzly Bears"]);
        expect(halfBoard).toEqual({
            ...anchorBoard,
            seats: {
                ...anchorBoard.seats,
                me: { ...anchorBoard.seats.me, graveyard: [] },
            },
        });
    });

    it("`stack` add puts the object on top — CR 405.1", () => {
        const { anchorBoard, halfBoard } = derive(
            {
                ...MAIN_PHASE,
                stack: [
                    { kind: "spell", name: "Giant Growth", controller: "opp" },
                ],
                priority: "me",
            },
            conditional("stack", "Shock"),
            {
                kind: "stack",
                op: "add",
                item: { kind: "spell", name: "Shock", controller: "opp" },
            }
        );
        expect(halfBoard).toEqual({
            ...anchorBoard,
            stack: ["Giant Growth", "Shock"],
        });
    });

    it("finds the judged move by its sentence when the anchor's key names another move, or none", () => {
        const discriminant = conditional("life", "the opponent at 3");
        const { anchor, judged } = anchorOn(MAIN_PHASE, discriminant);
        const position = deriveRightHalfPosition(anchor, discriminant, {
            kind: "life",
            seat: "opp",
            life: 3,
        });
        const other = anchor.candidates.find(
            (c) => c.description !== judged.description
        )!;
        for (const key of [other.key, "stale"]) {
            const built = buildRightHalf(anchor, discriminant, position, {
                ...judged,
                key,
            });
            expect("candidate" in built && built.candidate.description).toBe(
                judged.description
            );
        }
    });

    it("refuses a judged move the half offers twice under one sentence, once the key no longer names it", () => {
        const discriminant = conditional("card", "Hill Giant");
        const { anchor, judged } = anchorOn(MAIN_PHASE, discriminant, (d) =>
            d.includes("Lightning Bolt → Hill Giant")
        );
        const position = deriveRightHalfPosition(anchor, discriminant, {
            kind: "card",
            op: "add",
            // Tapped, so the two Giants are not interchangeable (issue #3593)
            // and survive as two candidates reading one sentence.
            card: {
                name: "Hill Giant",
                owner: "opp",
                zone: "battlefield",
                tapped: true,
            },
        });
        // The anchor's key still names the first Giant: it stands.
        expect(
            "candidate" in
                buildRightHalf(anchor, discriminant, position, judged)
        ).toBe(true);
        // A key that names nothing leaves only the sentence, which reads two.
        const built = buildRightHalf(anchor, discriminant, position, {
            ...judged,
            key: "stale",
        });
        expect("refusal" in built && built.refusal.reason).toBe("move-missing");
    });

    it("refuses a half where the anchor's seat owes no decision", () => {
        const { built } = derive(
            MAIN_PHASE,
            conditional("step", "the opponent's end step, their priority"),
            {
                kind: "step",
                phase: "END_STEP",
                activePlayer: "opp",
                priority: "opp",
            }
        );
        expect("refusal" in built && built.refusal.reason).toBe("not-deciding");
    });
});
