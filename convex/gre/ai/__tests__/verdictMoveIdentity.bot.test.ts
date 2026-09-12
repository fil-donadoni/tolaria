// A Move's identity across two builds of the same position (issue #3483).
//
// The `different-decision` guard compares the decision the Bot actually took
// against the same decision on the position rebuilt from its `ScenarioSpec`.
// It used to compare through `describeMove`, on the stated grounds that the
// describer's sentence was "the only vocabulary they share" — and the describer
// names the PLAYER, so every decision that targeted one read "→ Mr bambury
// (P1)" live and "→ Blade P2" on the rebuild and was refused. These are the
// two halves of the fix: the key that carries no per-world fact, and the guard
// that still refuses a real mismatch once the key is doing the comparing.

import { describe, it, expect } from "vitest";
import { canonicalMoveKey, relativeSeatIndexes } from "../../canonicalMoveKey";
import { describeMove } from "../../describeMove";
import { moveKey } from "../../search";
import {
    candidateSetsDiffer,
    type ComparedCandidate,
} from "../verdicts/lowering";
import {
    buildSetupFreeVerdictState,
    candidateMoves,
} from "../verdicts/candidates";
import { sealOfFire } from "../../../cards/sets/nem/red";
import { grizzlyBears } from "../../../cards/sets/lea/green";
import { hillGiant } from "../../../cards/sets/lea/red";
import { wrennAndSix } from "../../../cards/sets/mh1/multicolor";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import type { Move } from "../../moves";
import type { GameState } from "../../state";
import type { ScenarioSpec } from "../../../debugScenarioSpec";

/** A board whose only decision targets a PLAYER: Seal of Fire's
 *  "Sacrifice this enchantment: It deals 2 damage to any target" costs no mana
 *  and no tap, so both seats and the creature are live targets at priority
 *  (CR 116.2 is not involved — it is an ordinary activated ability, CR 602.1). */
const SEAL_AT_A_PLAYER: ScenarioSpec = {
    cards: [
        { name: sealOfFire.name, owner: "me", zone: "battlefield" },
        { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    landCount: 0,
    libraryCount: 20,
};

/** The Seal's activation aimed at `playerId`. */
function sealAt(state: GameState, botId: string, playerId: string): Move {
    const move = candidateMoves(state, botId).find(
        (candidate) =>
            candidate.kind === "activate-ability" &&
            candidate.targets.some(
                (target) => target.type === "player" && target.id === playerId
            )
    );
    expect(move).toBeDefined();
    return move!;
}

describe("canonicalMoveKey — the vocabulary two builds share (issue #3483)", () => {
    it("is unchanged when a seat is renamed, while the describer's sentence is not", () => {
        const state = buildSetupFreeVerdictState(SEAL_AT_A_PLAYER);
        const [me, opponent] = state.players;
        const move = sealAt(state, me.id, opponent.id);

        const key = canonicalMoveKey(move, state, me.id);
        const sentence = describeMove(move, state);

        // The live board's seats carry the players' real nicknames; the
        // rebuild's carry the blade harness's. That difference alone is what
        // used to refuse this decision.
        me.name = "Mr bambury";
        opponent.name = "Tessa";

        expect(canonicalMoveKey(move, state, me.id)).toBe(key);
        expect(describeMove(move, state)).not.toBe(sentence);
    });

    it("carries no player display name and no per-world instance id", () => {
        const state = buildSetupFreeVerdictState(SEAL_AT_A_PLAYER);
        const [me, opponent] = state.players;
        me.name = "Mr bambury";
        const seal = me.battlefield[0];
        const move = sealAt(state, me.id, opponent.id);

        const key = canonicalMoveKey(move, state, me.id);
        expect(key).not.toContain("Mr bambury");
        expect(key).not.toContain(seal.id);
        expect(key).not.toContain(opponent.id);
        // What it carries instead: the card's DEFINITION id and the target's
        // seat index relative to the decider.
        expect(key).toContain(sealOfFire.id);
        expect(key).toContain("seat#1");

        // And the structural key — right for a tree node, wrong across two
        // builds — does embed the instance id. The two answer different
        // questions, which is why both exist.
        expect(moveKey(move)).toContain(seal.id);
    });

    it("keeps two moves that differ ONLY in which player they target apart", () => {
        const state = buildSetupFreeVerdictState(SEAL_AT_A_PLAYER);
        const [me, opponent] = state.players;

        expect(
            canonicalMoveKey(sealAt(state, me.id, me.id), state, me.id)
        ).not.toBe(
            canonicalMoveKey(sealAt(state, me.id, opponent.id), state, me.id)
        );
    });

    it("indexes seats RELATIVE to the decider, and refuses a frame it has no seat for", () => {
        const state = buildSetupFreeVerdictState(SEAL_AT_A_PLAYER);
        const [me, opponent] = state.players;

        expect([...relativeSeatIndexes(state, me.id)]).toEqual([
            [me.id, 0],
            [opponent.id, 1],
        ]);
        // Same board, other decider: the same two seats, renumbered. A
        // relative index is what lets a third seat be seat 2 rather than a
        // special case.
        expect([...relativeSeatIndexes(state, opponent.id)]).toEqual([
            [me.id, 1],
            [opponent.id, 0],
        ]);
        // No frame at all rather than an absolute one wearing the same name:
        // an absolute index would silently compare two coordinate systems.
        expect(relativeSeatIndexes(state, "not-a-seat").size).toBe(0);
    });
});

/** CR 508.1a — one `declare-attackers` move whose attackers are aimed by
 *  `attackTargets` (attacker id -> planeswalker id): the ONE Move field whose
 *  object KEYS are per-world instance ids. The handles are supplied, so the
 *  same attack can be built on two boards that numbered their instances
 *  differently; an attacker left out of `aimed` goes to the face, which is
 *  always a legal declaration. */
function attackOnPlaneswalker(
    attackers: { cardId: string; id: string }[],
    walker: string,
    aimed: string[]
): { state: GameState; move: Move } {
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: attackers.map((attacker) =>
                    makeInstance(attacker.cardId, { id: attacker.id })
                ),
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(wrennAndSix.id, {
                        id: walker,
                        controllerId: "p2",
                    }),
                ],
            }),
        ],
        phase: "DECLARE_ATTACKERS",
    });
    const attackTargets: Record<string, string> = {};
    for (const id of aimed) attackTargets[id] = walker;
    return {
        state,
        move: {
            kind: "declare-attackers",
            attackerIds: attackers.map((attacker) => attacker.id),
            attackTargets,
        },
    };
}

describe("canonicalMoveKey — the object-KEY cases (PR review, issue #3483)", () => {
    it("is unchanged when two builds number their instances differently", () => {
        // Instance ids are bare integer STRINGS (`allocInstanceId`), and both
        // JS and `JSON.stringify` emit integer-like object keys in ascending
        // NUMERIC order whatever the insertion order was. So an
        // `attackTargets` record serialised as an OBJECT came out in each
        // build's own id order, and the same attack keyed two different ways.
        //
        // TWO DIFFERENT cards, or there is only one canonical key in the record
        // and no order to get wrong. The numbering is the reverse of the
        // canonical order on one side and not on the other: live has the Giant
        // BELOW the Bears numerically, the rebuild has it above.
        const live = attackOnPlaneswalker(
            [
                { cardId: grizzlyBears.id, id: "47" },
                { cardId: hillGiant.id, id: "23" },
            ],
            "9",
            ["47", "23"]
        );
        const rebuilt = attackOnPlaneswalker(
            [
                { cardId: grizzlyBears.id, id: "3" },
                { cardId: hillGiant.id, id: "5" },
            ],
            "7",
            ["3", "5"]
        );

        expect(canonicalMoveKey(live.move, live.state, "p1")).toBe(
            canonicalMoveKey(rebuilt.move, rebuilt.state, "p1")
        );
    });

    it("keeps two attacks that differ only in HOW MANY Bears are aimed apart", () => {
        // The other half: writing the substituted key back into an object
        // OVERWROTE when two keys canonicalised alike, so "both Bears attack
        // the planeswalker" and "one attacks it, one goes to the face"
        // collapsed to one key — two semantically different moves the pick
        // lookup could then confuse for each other.
        const bears = [
            { cardId: grizzlyBears.id, id: "47" },
            { cardId: grizzlyBears.id, id: "23" },
        ];
        const both = attackOnPlaneswalker(bears, "9", ["47", "23"]);
        const one = attackOnPlaneswalker(bears, "9", ["47"]);

        expect(canonicalMoveKey(both.move, both.state, "p1")).not.toBe(
            canonicalMoveKey(one.move, one.state, "p1")
        );
    });
});

describe("canonicalMoveKey — a granted ability is its TEMPLATE (PR review, issue #3483)", () => {
    it("keys `activate-granted-ability` the same whatever the grant counter reached", () => {
        // CR 113.1b — `grant-N` comes off `GameState.nextGrantSeq`, a per-GAME
        // counter: a live game that has made three grants says `grant-4` where
        // the rebuild says `grant-1`. Left unplaced, every player-granted
        // ability activation (Channel's mana ability) would refuse for ever.
        const grant = (id: string): GameState =>
            makeState({
                players: [
                    makePlayer("p1", {
                        grantedAbilities: [
                            {
                                id,
                                sourceCardId: sealOfFire.id,
                                abilityId: "seal-of-fire-sac",
                                duration: "endOfTurn",
                                grantedAtTurn: 1,
                            },
                        ],
                    }),
                    makePlayer("p2"),
                ],
            });
        const move = (id: string): Move => ({
            kind: "activate-granted-ability",
            grantedAbilityInstanceId: id,
            abilityId: "seal-of-fire-sac",
            sourceCardId: sealOfFire.id,
        });

        expect(canonicalMoveKey(move("grant-4"), grant("grant-4"), "p1")).toBe(
            canonicalMoveKey(move("grant-1"), grant("grant-1"), "p1")
        );
        // …and the raw counter value is nowhere in it.
        expect(
            canonicalMoveKey(move("grant-4"), grant("grant-4"), "p1")
        ).not.toContain("grant-4");
    });
});

describe("the candidate-set guard still refuses a real mismatch (issue #3483)", () => {
    const candidate = (
        key: string,
        description: string
    ): ComparedCandidate => ({
        key,
        description,
    });

    it("agrees when both sides name the same keys, whatever order they enumerate in", () => {
        expect(
            candidateSetsDiffer(
                [candidate("a", "pass"), candidate("b", "attack: Bears")],
                [candidate("b", "attack: Bears"), candidate("a", "pass")]
            )
        ).toBeNull();
    });

    it("refuses when the rebuild is MISSING a move the Bot had", () => {
        const difference = candidateSetsDiffer(
            [candidate("a", "pass"), candidate("b", "cast Lightning Bolt")],
            [candidate("a", "pass")]
        );
        expect(difference).toContain('the Bot had "cast Lightning Bolt"');
        expect(difference).toContain("the rebuild does not");
    });

    it("refuses when the rebuild offers an EXTRA move the Bot did not have", () => {
        const difference = candidateSetsDiffer(
            [candidate("a", "pass")],
            [candidate("a", "pass"), candidate("b", "play Mountain")]
        );
        expect(difference).toContain('the rebuild offers "play Mountain"');
        expect(difference).toContain("the Bot did not");
    });

    it("refuses when the keys match but the MULTIPLICITY does not", () => {
        // Interchangeable candidates key identically (the describer's own
        // limit, inherited unchanged), so a list can differ only in how many
        // of one key it holds — which set membership cannot name.
        expect(
            candidateSetsDiffer(
                [
                    candidate("a", "pass"),
                    candidate("b", "attack: Bears"),
                    candidate("b", "attack: Bears"),
                ],
                [candidate("a", "pass"), candidate("b", "attack: Bears")]
            )
        ).toBe("3 move(s) in play against 2 on the rebuild");
    });
});
