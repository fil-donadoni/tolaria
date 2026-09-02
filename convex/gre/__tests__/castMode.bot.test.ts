// Cast-MODE characteristics in the two search executors (CR 601.2b, issue
// #2796).
//
// A cast mode is an alternative cost that changes what the spell IS, or what
// becomes of the permanent it makes — Bestow (CR 702.103b), Morph (CR 702.37c),
// Dash (CR 702.109a), Evoke (CR 702.74b) — as opposed to one that only changes
// the price. This engine builds a cast's stack item at two SEARCH sites, the
// greedy 1-ply sandbox (`applyMoveForSearch`) and the ISMCTS in-tree executor
// (`applyMoveInSearch`), and each used to carry its own hand-written list of
// modes: the sandbox stamped bestow and dash, the tree stamped morph alone.
//
// The cost of that is not a mis-valuation, it is BLINDNESS. A mode the executor
// drops resolves into the same board as the printed-cost cast, so the two lines
// are indistinguishable at every depth and every iteration budget, the reward
// band saturates identically, and the root pick falls through every tie-break
// to rollout noise. That is issue #2796 as reported: the bot bestowed a +1/+1
// Aura onto the OPPONENT's creature, on a coin flip.
//
// Lives in `*.bot.test.ts` because it imports the enumerator and the search
// (`bot-suite-boundary.test.ts` enforces the split).

import { describe, it, expect } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { enumerateMoves, type Move } from "../moves";
import { MORPH_CAST_ALT_COST_ID } from "../morph";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch, policyValue } from "../search";
import { applyCastModeCharacteristics, type CastMode } from "../castMode";
import { evaluate } from "../evaluate";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { cloneGameState } from "../clone";
import { resolveTopOfStack } from "../state";
import type { CardDefinition } from "../../cards/types";
import type { CardInstanceState, GameState } from "../state";

const FOREST = getCardByName("Forest").id;
const PLAINS = getCardByName("Plains").id;
const MOUNTAIN = getCardByName("Mountain").id;

/** The cast-mode markers a stack item / permanent can carry. Compared as a
 *  whole so a mode that stamps the WRONG thing fails as loudly as one that
 *  stamps nothing. */
function modeMarkersOf(card: CardInstanceState) {
    return {
        bestowed: card.bestowed === true,
        faceDown: card.faceDown === true,
        dashed: card.dashed === true,
        evoked: card.evoked === true,
        types: [...(card.types ?? [])].sort(),
    };
}

/** A position in which `card` is castable, plus the opponent creature a
 *  targeted mode can point at. */
function positionFor(
    card: string,
    landId: string,
    landCount: number
): GameState {
    const def = getCardByName(card);
    const lands = Array.from({ length: landCount }, (_, i) =>
        makeInstance(landId, { id: `land${i}`, controllerId: "p1" })
    );
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(def.id, {
                        id: "subject",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: lands,
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(getCardByName("Hill Giant").id, {
                        id: "theirs",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

type ModeFixture = {
    /** A card carrying this mode. */
    card: string;
    land: string;
    landCount: number;
    /** Whether `enumerateMoves` offers this mode's cast today. `false` is a
     *  statement about the ENUMERATOR, not about the mode: the census still
     *  owes the mode a stamper, and the row below proves it has one. */
    enumerated: boolean;
    /** What the mode must have stamped on the resulting object. */
    assertStamped: (markers: ReturnType<typeof modeMarkersOf>) => void;
};

/** `Record<CastMode, …>` is the point: a mode added to the union cannot compile
 *  until it names a card here and says what that card's cast must stamp. */
const MODE_FIXTURES: Record<CastMode, ModeFixture> = {
    // CR 702.103b — an Aura spell with enchant creature, and not a creature
    // spell: the type line is rewritten and the `bestowed` marker rides on.
    bestow: {
        card: "Springheart Nantuko",
        land: FOREST,
        landCount: 2,
        enumerated: true,
        assertStamped: (m) => {
            expect(m.bestowed).toBe(true);
            expect(m.types).toEqual(["Enchantment"]);
        },
    },
    // CR 702.37c — a 2/2 face-down creature with no text, name, subtypes or
    // mana cost.
    morph: {
        card: "Exalted Angel",
        land: PLAINS,
        landCount: 6,
        enumerated: true,
        assertStamped: (m) => {
            expect(m.faceDown).toBe(true);
        },
    },
    // CR 702.109a — the marker `dashTrigger` reads for the haste grant and the
    // delayed return to hand.
    dash: {
        card: "Ragavan, Nimble Pilferer",
        land: MOUNTAIN,
        landCount: 2,
        enumerated: true,
        assertStamped: (m) => {
            expect(m.dashed).toBe(true);
        },
    },
    // CR 702.74b — the marker `evokeTrigger` reads to sacrifice the permanent
    // as it enters. NOT enumerated today (the Bot is never offered an evoke
    // cast), so this row pins the census entry rather than an executor path:
    // the day `enumerateMoves` offers one, both executors already stamp it.
    evoke: {
        card: "Endurance",
        land: FOREST,
        landCount: 3,
        enumerated: false,
        assertStamped: (m) => {
            expect(m.evoked).toBe(true);
        },
    },
};

/** The enumerated cast of `subject` paying `mode`'s alternative cost. */
function modeCastMove(state: GameState, mode: CastMode): Move {
    const def = getCardByName(MODE_FIXTURES[mode].card);
    const casts = enumerateMoves(state, "p1").filter(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" && m.cardInstanceId === "subject"
    );
    const variant = casts.find((m) => m.alternativeCostId !== undefined);
    if (!variant) {
        throw new Error(
            `no alternative-cost cast enumerated for ${def.name} — the fixture, not the executor, is wrong`
        );
    }
    return variant;
}

/** The `subject` object after `move` is applied, wherever it ended up — still
 *  on the stack (the ISMCTS executor leaves it there by design) or already on
 *  the battlefield (the greedy sandbox resolves it). */
function subjectAfter(state: GameState): CardInstanceState {
    const everywhere: CardInstanceState[] = [
        ...state.stack,
        ...state.players.flatMap((p) => p.battlefield),
    ];
    const found = everywhere.find((c) => c.id === "subject");
    if (!found) throw new Error("subject vanished");
    return found;
}

/** The alt-cost id that selects `mode` on `def`. An exhaustive switch, so a
 *  mode added to `CastMode` cannot compile until this fixture knows how to
 *  announce it. */
function altCostIdFor(def: CardDefinition, mode: CastMode): string {
    switch (mode) {
        // Synthesized by the rule, not declared by the card (CR 702.37a).
        case "morph":
            return MORPH_CAST_ALT_COST_ID;
        case "bestow":
            return def.bestow?.id ?? "";
        case "dash":
            return def.dash?.id ?? "";
        case "evoke":
            return def.evoke?.id ?? "";
    }
}

describe("cast modes reach BOTH search executors (CR 601.2b, issue #2796)", () => {
    for (const mode of Object.keys(MODE_FIXTURES) as CastMode[]) {
        const fixture = MODE_FIXTURES[mode];

        it(`${mode}: the census stamps the mode's characteristics`, () => {
            const state = positionFor(
                fixture.card,
                fixture.land,
                fixture.landCount
            );
            const subject = state.players[0].hand.find(
                (c) => c.id === "subject"
            )!;
            const item = structuredClone(subject);
            const altCostId = altCostIdFor(getCardByName(fixture.card), mode);
            applyCastModeCharacteristics(item, altCostId);
            fixture.assertStamped(modeMarkersOf(item));
        });

        if (!fixture.enumerated) continue;

        it(`${mode}: the ISMCTS tree and the greedy sandbox agree`, () => {
            const state = positionFor(
                fixture.card,
                fixture.land,
                fixture.landCount
            );
            const move = modeCastMove(state, mode);

            const greedy = applyMoveForSearch(state, "p1", move);
            const tree = cloneGameState(state);
            applyMoveInSearch(tree, "p1", move);

            const treeMarkers = modeMarkersOf(subjectAfter(tree));
            expect(treeMarkers).toEqual(modeMarkersOf(subjectAfter(greedy)));
            // …and both agree on the RIGHT thing, not merely with each other:
            // two executors that both dropped the mode would agree too.
            fixture.assertStamped(treeMarkers);
        });
    }
});

// ---------------------------------------------------------------------------
// The seam the root decision reads (issue #2796 acceptance criterion 4)
// ---------------------------------------------------------------------------

/** p1 holds Springheart Nantuko with two untapped Forests; `mine` adds a
 *  creature p1 controls beside the opponent's Hill Giant. */
function bestowPosition(mine: boolean): GameState {
    const state = positionFor("Springheart Nantuko", FOREST, 2);
    if (mine) {
        state.players[0].battlefield.push(
            makeInstance(getCardByName("Grizzly Bears").id, {
                id: "mine",
                controllerId: "p1",
            })
        );
    }
    return state;
}

function castsOf(state: GameState) {
    return enumerateMoves(state, "p1").filter(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" && m.cardInstanceId === "subject"
    );
}

/** `policyValue` for `move` — the one-resolution-deep value the action priors
 *  and the rollout default policy both read. */
function seamValue(state: GameState, move: Move): number {
    const probe = cloneGameState(state);
    applyMoveInSearch(probe, "p1", move);
    return policyValue(probe, "p1", move, DEFAULT_EVAL_WEIGHTS);
}

/** `evaluate` once the announcement has fully RESOLVED — the ranking the issue
 *  established is already correct, and the one the seam must agree with. */
function resolvedValue(state: GameState, move: Move): number {
    const probe = cloneGameState(state);
    applyMoveInSearch(probe, "p1", move);
    let guard = 0;
    while (probe.stack.length > 0 && guard++ < 20) resolveTopOfStack(probe);
    return evaluate(probe, "p1", DEFAULT_EVAL_WEIGHTS);
}

describe("bestow variants are discriminated at the seam (CR 702.103b, issue #2796)", () => {
    it("keeps the bestow-onto-the-opponent cast ENUMERATED — this is a preference, not a legality filter", () => {
        const casts = castsOf(bestowPosition(true));
        const targets = casts.map((m) => m.targets.map((t) => t.id).join(","));
        // CR 702.103b — "enchant creature" names no controller, so all three
        // announcements stay legal and the search must keep seeing them.
        expect(targets).toContain("theirs");
        expect(targets).toContain("mine");
        expect(targets).toContain("");
    });

    it("ranks printed cast > bestow onto own > bestow onto the opponent, with the same sign as the resolved evaluation", () => {
        const state = bestowPosition(true);
        const casts = castsOf(state);
        const byTarget = (id: string) =>
            casts.find((m) => (m.targets[0]?.id ?? "") === id)!;

        const printed = byTarget("");
        const own = byTarget("mine");
        const gift = byTarget("theirs");

        const seam = {
            printed: seamValue(state, printed),
            own: seamValue(state, own),
            gift: seamValue(state, gift),
        };
        const resolved = {
            printed: resolvedValue(state, printed),
            own: resolvedValue(state, own),
            gift: resolvedValue(state, gift),
        };

        // The ordering the issue measured on the RESOLVED boards…
        expect(resolved.printed).toBeGreaterThan(resolved.own);
        expect(resolved.own).toBeGreaterThan(resolved.gift);
        // …is the ordering the value the root decision reads now carries. This
        // is the assertion that fails on the parent commit: with the mode
        // dropped, all three lines resolved into a plain 1/1 entering and every
        // one of these six numbers was identical.
        expect(seam.printed).toBeGreaterThan(seam.own);
        expect(seam.own).toBeGreaterThan(seam.gift);
    });
});
