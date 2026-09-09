// Cast-MODE characteristics in the two search executors (CR 601.2b, issue
// #2796).
//
// A cast mode is an alternative cost that changes what the spell IS, or what
// becomes of the permanent it makes — Bestow (CR 702.103b), Morph (CR 702.37c),
// Dash (CR 702.109a), Evoke (CR 702.74a) — as opposed to one that only changes
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
import { getAllCards, getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { enumerateMoves, type Move } from "../moves";
import { MORPH_CAST_ALT_COST_ID } from "../morph";
import { adventureCastAltCostId } from "../adventure";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch, policyValue } from "../search";
import {
    applyCastModeCharacteristics,
    castModeIdsAreUnambiguous,
    type CastMode,
} from "../castMode";
import { evaluate } from "../evaluate";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { cloneGameState } from "../clone";
import { resolveTopOfStack } from "../state";
import type { CardDefinition } from "../../cards/types";
import type { CardInstanceState, GameState } from "../state";
import { NO_BOARD_LAYER_VIEW } from "../layers";

const FOREST = getCardByName("Forest").id;
const PLAINS = getCardByName("Plains").id;
const MOUNTAIN = getCardByName("Mountain").id;
const ISLAND = getCardByName("Island").id;

/** Every characteristic a cast mode can change. Deliberately WIDER than the
 *  boolean markers (PR #3056 review finding 6): `applyBestowCharacteristics`
 *  also rewrites the subtypes, clears P/T and stamps the enchant restriction,
 *  so an executor that set `bestowed` and the type line but left the printed
 *  1/1 on the stack item would pass a marker-only comparison while the search
 *  valued a phantom body. Compared as a whole, so stamping the WRONG thing
 *  fails as loudly as stamping nothing. */
function modeMarkersOf(card: CardInstanceState) {
    return {
        bestowed: card.bestowed === true,
        faceDown: card.faceDown === true,
        dashed: card.dashed === true,
        evoked: card.evoked === true,
        overloaded: card.overloaded === true,
        // CR 715.3b — the Adventure's mark IS the retained front id
        // (`adventureOf`), not a boolean beside it; the identity swap it
        // records is what the type/subtype/P-T fields below then show.
        adventure: card.adventureOf !== undefined,
        cardId: (card.card as { id?: string }).id,
        types: [...(card.types ?? [])].sort(),
        subtypes: [...(card.subtypes ?? [])].sort(),
        power: card.power,
        toughness: card.toughness,
        enchantRestriction: card.grantedEnchantRestriction,
    };
}

/** Every cast-instance marker, cleared — what `resetStackTransientState` leaves
 *  behind on a spell that resolved out of the stack (CR 400.7). */
const CLEARED_MARKERS = {
    bestowed: undefined,
    faceDown: undefined,
    dashed: undefined,
    evoked: undefined,
    overloaded: undefined,
    adventureOf: undefined,
} as const;

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
    /** True when the card is an INSTANT or SORCERY, so the greedy sandbox — which
     *  resolves the spell — has already run the cast-instance gate
     *  (`resetStackTransientState`, CR 400.7) by the time the subject is
     *  inspected, while the ISMCTS tree still holds it on the stack. The two
     *  executors are then looking at DIFFERENT MOMENTS, and comparing their
     *  markers for equality asks the wrong question. The stronger pair of
     *  claims is asserted instead: the tree stamped the mode, and the greedy
     *  side CLEARED it on the way to the graveyard — the leak PR #3288's review
     *  finding 1 was about. */
    clearsOnResolve?: boolean;
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
            expect(m.subtypes).toEqual(["Aura"]);
            // CR 702.103b — an Aura spell has no power or toughness. Leaving
            // the printed 1/1 on would have the search valuing a body the
            // bestow line does not produce.
            expect(m.power).toBeUndefined();
            expect(m.toughness).toBeUndefined();
            expect(m.enchantRestriction).toBeDefined();
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
    // CR 702.74a — the marker `evokeTrigger` reads to sacrifice the permanent
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
    // CR 702.96a — the marker `buildSpellContext` reads to swap the script's
    // `forEach { set: "targets" }` member set from the announced targets to
    // every matching object (CR 702.96b). Damn's printed cost is {B}{B} and its
    // overload cost {2}{W}{W}, so a board of four Plains offers the OVERLOAD
    // cast and nothing else — which is also the point of the mode: unstamped,
    // an overloaded Damn resolves as the one-creature removal spell the
    // printed cast already was, and the tree cannot tell a wrath from a Doom
    // Blade.
    overload: {
        card: "Damn",
        land: PLAINS,
        landCount: 4,
        enumerated: true,
        clearsOnResolve: true,
        assertStamped: (m) => {
            expect(m.overloaded).toBe(true);
        },
    },
    // CR 715.3b — "while on the stack as an Adventure, the spell has ONLY its
    // alternative characteristics." The only row whose stamp is an IDENTITY
    // swap: the object on the stack becomes the registered twin, so the
    // 3/1 Faerie Rogue is gone and an Instant — Adventure is there instead.
    // Unstamped, the tree prices Petty Theft as a 3/1 body it never gets, and
    // (worse) resolves the creature half for the Adventure's price.
    adventure: {
        card: "Brazen Borrower",
        land: ISLAND,
        landCount: 2,
        enumerated: true,
        clearsOnResolve: true,
        assertStamped: (m) => {
            expect(m.adventure).toBe(true);
            expect(m.cardId).toBe(
                `${getCardByName("Brazen Borrower").id}#adventure`
            );
            expect(m.types).toEqual(["Instant"]);
            expect(m.subtypes).toEqual(["Adventure"]);
            // CR 715.3b — an Instant has no power or toughness. Leaving the
            // printed 3/1 on would have the search valuing a body the
            // Adventure line does not produce.
            expect(m.power).toBeUndefined();
            expect(m.toughness).toBeUndefined();
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
 *  on the stack (the ISMCTS executor leaves it there by design), already on the
 *  battlefield (the greedy sandbox resolves a permanent spell), or in the
 *  graveyard (CR 608.2m — the greedy sandbox resolving an INSTANT or SORCERY,
 *  which is what an overload card is). */
function subjectAfter(state: GameState): CardInstanceState {
    const everywhere: CardInstanceState[] = [
        ...state.stack,
        ...state.players.flatMap((p) => p.battlefield),
        ...state.players.flatMap((p) => p.graveyard),
        // CR 715.3d — a resolved Adventure is EXILED instead of being put into
        // its owner's graveyard, so the greedy sandbox leaves its subject here.
        ...state.players.flatMap((p) => p.exile),
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
        case "overload":
            return def.overload?.id ?? "";
        // CR 715.3 — synthesized like morph's, but per-card (the id carries the
        // parent's own id, since it is the twin's identity the stamp needs).
        case "adventure":
            return adventureCastAltCostId(def);
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
            applyCastModeCharacteristics(NO_BOARD_LAYER_VIEW, item, altCostId);
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
            if (fixture.clearsOnResolve) {
                // An instant/sorcery: the greedy sandbox resolved it, so its
                // subject is in the GRAVEYARD with the cast-instance markers
                // already cleared (CR 400.7). Equality would compare two
                // different moments; assert both halves separately instead —
                // the tree stamped the mode, and the greedy side did not carry
                // it out of the stack.
                const greedySubject = subjectAfter(greedy);
                expect(greedySubject.zone).not.toBe("stack");
                expect(modeMarkersOf(greedySubject)).toEqual(
                    modeMarkersOf({ ...greedySubject, ...CLEARED_MARKERS })
                );
            } else {
                expect(treeMarkers).toEqual(
                    modeMarkersOf(subjectAfter(greedy))
                );
            }
            // …and both agree on the RIGHT thing, not merely with each other:
            // two executors that both dropped the mode would agree too.
            fixture.assertStamped(treeMarkers);
        });
    }
});

describe("cast-mode ids answer ONE mode, catalogue-wide (CR 601.2b)", () => {
    // PR #3056 review finding 2: `castModeOf` scans morph → bestow → dash →
    // evoke, while `getAlternativeCost` (`alternativeCost.ts`) scans the
    // reverse. Both answer "which alternative cost is this id?" and both are
    // consulted about the same cast — the search through the first, the real
    // mutation path through the second — so a card declaring two mode fields
    // under one id would have them stamp DIFFERENT characteristics for the same
    // announcement. Nothing in either function detects that; this does, over
    // the whole catalogue, before a card ships it.
    it("no shipped card declares two cast modes under the same alt-cost id", () => {
        const offenders = getAllCards()
            .filter((def) => !castModeIdsAreUnambiguous(def))
            .map((def) => def.name);
        expect(offenders).toEqual([]);
    });

    it("detects a card that does — the sweep above is not vacuous", () => {
        // A definition is the cheapest possible fixture here: the predicate
        // reads nothing but the mode fields, and asserting it over a catalogue
        // that happens to be clean proves only that the catalogue is clean.
        const colliding = {
            ...getCardByName("Springheart Nantuko"),
            dash: { id: "bestow", description: "collides", mana: { X: 1 } },
        } as CardDefinition;
        expect(castModeIdsAreUnambiguous(colliding)).toBe(false);
    });
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

describe("a cast mode is priced against its OWN characteristics (CR 601.2f)", () => {
    // PR #3302 review finding 1, on the seam the Bot owns. `enumerateCastMoves`
    // builds a real `tapPlan` from a real cost, so a variant priced against the
    // printed card is not merely mis-valued — it is not enumerated at all when
    // the board covers only the true price, and the Bot never sees the line.
    //
    // Mana Matrix ("Instant and enchantment spells you cast cost {2} less")
    // reads a CARD TYPE, which is exactly what an announced cast mode changes:
    // Petty Theft is an Instant, Brazen Borrower is a Creature.
    it("enumerates the Adventure off ONE Island under Mana Matrix", () => {
        const state = positionFor("Brazen Borrower", ISLAND, 1);
        state.players[0].battlefield.push(
            makeInstance(getCardByName("Mana Matrix").id, {
                id: "matrix",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const adventureCasts = enumerateMoves(state, "p1").filter(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell" &&
                m.cardInstanceId === "subject" &&
                (m.alternativeCostId ?? "").startsWith("adventure:")
        );
        // {1}{U} reduced by {2} is {U}: one Island covers it, and the plan taps
        // exactly that one. Priced against the printed Creature there is no
        // reduction, `planManaPayment` returns null and this list is empty.
        expect(adventureCasts.length).toBeGreaterThan(0);
        expect(adventureCasts[0].tapPlan).toHaveLength(1);
    });

    it("still prices a MORPH cast face down — the seam answers for every mode", () => {
        // The regression the unification could introduce, and the reason this
        // test exists at all: the three sites that price a cast used to carry
        // their own `faceDownCastView` call, and they now share
        // `castSubjectView`. If that seam ever stops composing morph in, morph
        // silently reverts to being priced as the printed card — which is
        // issue #2970's bug, not a new one, and nothing else here would catch
        // it (measured: removing the branch left the whole suite green).
        //
        // Gloom ("White spells cost {3} more to cast", `lea/black.ts`) reads a
        // COLOUR, and CR 702.37c strips it: a face-down spell is a colourless
        // nameless 2/2. Six Plains cover the {3} morph cost taxed to {6}, and
        // exactly cover the untaxed {3} with three to spare — so the tap plan's
        // SIZE is what separates the two readings.
        const state = positionFor("Exalted Angel", PLAINS, 6);
        state.players[1].battlefield.push(
            makeInstance(getCardByName("Gloom").id, {
                id: "gloom",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const morphCasts = enumerateMoves(state, "p1").filter(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell" &&
                m.cardInstanceId === "subject" &&
                m.alternativeCostId === MORPH_CAST_ALT_COST_ID
        );
        expect(morphCasts.length).toBeGreaterThan(0);
        // {3}, not {3} + Gloom's {3}.
        expect(morphCasts[0].tapPlan).toHaveLength(3);
    });
});
