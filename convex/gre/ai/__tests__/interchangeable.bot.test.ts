// Interchangeable-candidate collapse (issue #3593) — the "dominated by EACH
// OTHER" seam, beside dominance's "dominated by `pass`".
//
// Every assertion here is stated twice, exactly as `dominance.bot.test.ts`
// states its proofs: the interchangeable position (collapsed to one) and its
// NEGATIVE CONTROL, the same two cards differing on ONE axis a rule can read
// (never collapsed). The axes are the ones issue #3593 names — tapped, damage
// marked, counters, attachments, summoning sickness — plus the two the
// implementation has to get right to be safe at all: a card something ELSE in
// the state points at, and aliasing (one card named twice is not two cards).

import { describe, expect, it } from "vitest";
import type { GameState } from "../../state";
import type { Move } from "../../moves";
import { enumerateMoves } from "../../moves";
import { buildBladeState } from "../blade/runner";
import type { BladeScenario } from "../blade/types";
import { moveKey } from "../../search";
import { collapseInterchangeableMoves, moveCardRefs } from "../interchangeable";
import { buildSetupFreeVerdictState } from "../verdicts/candidates";
import { evalPairsOf } from "../verdicts/evalPairs";
import type { Verdict } from "../verdicts/types";
import type { ScenarioSpec } from "../../../debugScenarioSpec";

function build(spec: BladeScenario["spec"]): GameState {
    return buildBladeState({
        label: "interchangeable-unit",
        spec,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
    });
}

function me(state: GameState): string {
    return state.players[0].id;
}

/** Moves of one kind, with and without the collapse — the two halves every
 *  case below compares. */
function movesOf(
    state: GameState,
    kind: Move["kind"],
    collapsed: boolean
): Move[] {
    return enumerateMoves(
        state,
        me(state),
        collapsed ? { collapseInterchangeable: true } : undefined
    ).filter((m) => m.kind === kind);
}

/** The Treetop Village animations (`{1}{G}: becomes a 3/3`, CR 205.1b) a
 *  position offers, with and without the collapse. */
function animations(state: GameState, collapsed: boolean): Move[] {
    return movesOf(state, "activate-ability", collapsed).filter(
        (m) =>
            m.kind === "activate-ability" &&
            m.abilityId === "treetop-village-animate"
    );
}

/** Two Shivan Dragons: firebreathing ("{R}: +1/+0", CR 702.—, no tap in the
 *  cost) is the ability that stays activatable on a TAPPED and on a
 *  SUMMONING-SICK creature, so every axis below can be varied without the
 *  candidate disappearing for an unrelated legality reason. */
function twoDragons(
    second: Partial<ScenarioSpec["cards"][number]> = {},
    extra: ScenarioSpec["cards"] = []
): GameState {
    return build({
        cards: [
            { name: "Shivan Dragon", owner: "me", zone: "battlefield" },
            {
                name: "Shivan Dragon",
                owner: "me",
                zone: "battlefield",
                ...second,
            },
            ...extra,
        ],
        phase: "PRECOMBAT_MAIN",
        turn: 8,
        landCount: 6,
        libraryCount: 20,
    });
}

// ---------------------------------------------------------------------------

describe("collapse — two copies of a card are ONE option (issue #3593)", () => {
    it("collapses two Brushlands in hand to a single play-land", () => {
        const state = build({
            cards: [
                { name: "Brushland", owner: "me", zone: "hand" },
                { name: "Brushland", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        });
        expect(movesOf(state, "play-land", false)).toHaveLength(2);
        expect(movesOf(state, "play-land", true)).toHaveLength(1);
    });

    it("picks the LOWEST instance id as the representative, both builds", () => {
        const spec: BladeScenario["spec"] = {
            cards: [
                { name: "Brushland", owner: "me", zone: "hand" },
                { name: "Brushland", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        };
        const both = movesOf(build(spec), "play-land", false).map(
            (m) => moveCardRefs(m)[0]
        );
        const lowest = [...both].sort((a, b) => Number(a) - Number(b))[0];
        expect(both).toHaveLength(2);

        const first = movesOf(build(spec), "play-land", true);
        const second = movesOf(build(spec), "play-land", true);
        expect(moveCardRefs(first[0])[0]).toBe(lowest);
        expect(moveCardRefs(second[0])[0]).toBe(lowest);
    });

    it("collapses three identical Treetop Village animations to one", () => {
        // Issue #3593's headline case. The Forests fund the animation, so all
        // three candidates are "animate a Village, tapping those two Forests"
        // and the boards they reach are the same board.
        const state = build({
            cards: [
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "battlefield" },
                { name: "Treetop Village", owner: "me", zone: "battlefield" },
                { name: "Treetop Village", owner: "me", zone: "battlefield" },
                { name: "Treetop Village", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        });
        expect(animations(state, false)).toHaveLength(3);
        expect(animations(state, true)).toHaveLength(1);
    });

    it("keeps the self-funding animation apart from the one paid by others", () => {
        // Three Villages and nothing else: two of the candidates tap the
        // animated Village ITSELF for part of the cost and reach a board where
        // the 3/3 is tapped; the third taps the other two and leaves the 3/3
        // untapped. Interchangeable is not "same card name" — the boards
        // differ, so the collapse must NOT take this from three to one.
        const state = build({
            cards: [
                { name: "Treetop Village", owner: "me", zone: "battlefield" },
                { name: "Treetop Village", owner: "me", zone: "battlefield" },
                { name: "Treetop Village", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 8,
            landCount: 0,
            libraryCount: 20,
        });
        expect(animations(state, false)).toHaveLength(3);
        expect(animations(state, true)).toHaveLength(2);
    });

    it("leaves a hand of DIFFERENT cards untouched", () => {
        const state = build({
            cards: [
                { name: "Brushland", owner: "me", zone: "hand" },
                { name: "Treetop Village", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        });
        expect(movesOf(state, "play-land", true)).toHaveLength(2);
    });
});

describe("negative controls — one axis a rule can read keeps two options", () => {
    const pumps = (state: GameState, collapsed: boolean): Move[] =>
        movesOf(state, "activate-ability", collapsed).filter(
            (m) =>
                m.kind === "activate-ability" &&
                m.abilityId === "shivan-dragon-pump"
        );

    it("BASELINE: two identical Shivan Dragons collapse to one pump", () => {
        const state = twoDragons();
        expect(pumps(state, false).length).toBeGreaterThan(1);
        expect(pumps(state, true)).toHaveLength(1);
    });

    it("tapped ≠ untapped (CR 302.6 reads it, and so does every tap cost)", () => {
        const state = twoDragons({ tapped: true });
        expect(pumps(state, true).length).toBeGreaterThan(1);
    });

    it("damage marked distinguishes two copies (CR 120.3)", () => {
        const state = twoDragons({ damageMarked: 2 });
        expect(pumps(state, true).length).toBeGreaterThan(1);
    });

    it("counters distinguish two copies (CR 122.1)", () => {
        const state = twoDragons({ counters: { "+1/+1": 1 } });
        expect(pumps(state, true).length).toBeGreaterThan(1);
    });

    it("summoning sickness distinguishes two copies (CR 302.6)", () => {
        const state = twoDragons({ summoningSick: true });
        expect(pumps(state, true).length).toBeGreaterThan(1);
    });

    it("an ATTACHMENT distinguishes two copies, though it writes nothing on the host (CR 303.4)", () => {
        // The one axis a per-card field comparison cannot see: an Aura's
        // `attachedTo` lives on the AURA, and P/T is computed through the
        // layer pipeline at read time rather than stored, so the two hosts
        // carry byte-identical instance state. What separates them is that
        // something else in the position NAMES one of them.
        const state = twoDragons({}, [
            {
                name: "Holy Strength",
                owner: "me",
                zone: "battlefield",
                attachedTo: "Shivan Dragon",
            },
        ]);
        expect(pumps(state, true).length).toBeGreaterThan(1);
    });
});

describe("aliasing — one card named twice is not two cards", () => {
    it("keeps a move naming ONE copy twice apart from one naming both", () => {
        const state = twoDragons();
        const [a, b] = state.players[0].battlefield
            .filter((c) => c.types.includes("Creature"))
            .map((c) => c.id);
        const twice: Move = {
            kind: "resolution-choice",
            stackItemId: "s1",
            step: 0,
            choiceId: "c1",
            cardInstanceIds: [a, a],
        };
        const both: Move = { ...twice, cardInstanceIds: [a, b] };
        const mirrored: Move = { ...twice, cardInstanceIds: [b, a] };

        expect(collapseInterchangeableMoves(state, [twice, both])).toHaveLength(
            2
        );
        // …while the two ORDERINGS of the same pair of interchangeable cards
        // are one option, which is the whole point.
        expect(
            collapseInterchangeableMoves(state, [both, mirrored])
        ).toHaveLength(1);
    });
});

describe("the collapse is off the legality path", () => {
    it("an unflagged enumeration still offers every copy", () => {
        const state = build({
            cards: [
                { name: "Brushland", owner: "me", zone: "hand" },
                { name: "Brushland", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 3,
            landCount: 2,
            libraryCount: 20,
        });
        expect(
            enumerateMoves(state, me(state)).filter(
                (m) => m.kind === "play-land"
            )
        ).toHaveLength(2);
    });

    it("never removes `pass`", () => {
        const state = twoDragons();
        const collapsed = enumerateMoves(state, me(state), {
            collapseInterchangeable: true,
        });
        expect(collapsed.some((m) => m.kind === "pass")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// The migration: a stored Verdict whose key names a collapsed-away copy.

const TWO_BRUSHLANDS: ScenarioSpec = {
    cards: [
        { name: "Brushland", owner: "me", zone: "hand" },
        { name: "Brushland", owner: "me", zone: "hand" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    landCount: 2,
    libraryCount: 20,
};

/** The two `play-land` moves the enumerator offered BEFORE the collapse, in
 *  enumeration order — what a verdict recorded then would have keyed on. */
function preCollapseLandDrops(): { keys: string[]; representative: string } {
    const state = buildSetupFreeVerdictState(TWO_BRUSHLANDS);
    const drops = enumerateMoves(state, state.players[0].id).filter(
        (m) => m.kind === "play-land"
    );
    expect(drops).toHaveLength(2);
    const collapsed = collapseInterchangeableMoves(state, drops);
    expect(collapsed).toHaveLength(1);
    return {
        keys: drops.map(moveKey),
        representative: moveKey(collapsed[0]),
    };
}

function verdict(candidateKeys: string[], rightIndexes: number[]): Verdict {
    return {
        id: "interchangeable-migration",
        spec: TWO_BRUSHLANDS,
        seat: "me",
        candidates: candidateKeys.map((key, i) => ({
            key,
            description: `candidate ${i}`,
        })),
        answer: { kind: "right", rightIndexes },
        author: "test",
        createdAt: "2026-09-14T00:00:00.000Z",
        source: "authored",
    };
}

describe("stored Verdicts survive the collapse (issue #3593)", () => {
    it("resolves a key naming the collapsed-away copy to the representative", () => {
        const { keys, representative } = preCollapseLandDrops();
        const staleSide = keys.find((k) => k !== representative);
        expect(staleSide).toBeDefined();

        const out = evalPairsOf(
            verdict([staleSide!, JSON.stringify({ kind: "pass" })], [0])
        );
        expect(out.error).toBeUndefined();
        expect(out.pairs).toHaveLength(1);
    });

    it("drops the vacuous copy-beats-copy pair instead of asserting it", () => {
        const { keys } = preCollapseLandDrops();
        const out = evalPairsOf(verdict(keys, [0]));
        expect(out.pairs).toHaveLength(0);
        expect(out.error).toMatch(/interchangeable/);
    });

    it("still reports a key the position genuinely no longer offers", () => {
        const out = evalPairsOf(
            verdict(
                [JSON.stringify({ kind: "play-land", cardInstanceId: "9999" })],
                [0]
            )
        );
        expect(out.error).toMatch(/no longer enumerated/);
    });
});
