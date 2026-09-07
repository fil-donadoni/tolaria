// The ordered-top family as an in-tree ISMCTS decision node (issue #2996) —
// Scry (CR 701.22), Surveil (CR 701.25), Ponder-style reordering, and
// Explore's keep-or-bin tail (CR 701.44a).
//
// Before this, `order-top` was the one choice kind whose ANSWER SHAPE the
// `Move` union could not express: an ordered-top submission carries TWO
// ordered lists (the cards kept on top and the cards sent to the second zone)
// and `resolution-choice` had only `cardInstanceIds`. So there was no
// generator, the choice was never a decision node, and the whole policy was
// `brain.ts`'s minimal-legal `bestFirst(candidates)` with an empty
// `secondZoneIds` — the bot NEVER sent a card to the bottom or the graveyard.
//
// What this file pins:
//   - the kind is registered and `enumerateMoves` is non-empty at the choice;
//   - the generator is SELF-PRUNING: at most `ORDER_TOP_MAX_CANDIDATES`
//     policies whatever the look window's width, and exactly two at n = 1
//     (the Explore shape);
//   - every emitted answer PARTITIONS `candidateIds`, which is what the
//     resolver demands ("order-top must place every looked-at card once") —
//     an answer that does not is one the search applies and the engine
//     rejects;
//   - the ORDERING is by worth against the rest of the library, and the
//     fateseal polarity (CR 701.29 — a foreign library) is the same question
//     with the sign flipped;
//   - a reorder-only choice (`destination: "none"`, Ponder) is declined, so
//     the minimal-legal default keeps answering it;
//   - the answers survive the round trip through the REAL resolver
//     (`applyMoveInSearch` → `applyPendingChoiceSubmit` →
//     `SpellContext.orderTop`), which is what makes `secondZoneIds` reach the
//     library bottom rather than being dropped on the floor;
//   - `determinize` PINS the open peek, without which the search decides
//     "keep this card" about a card the next iteration re-dealt away.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import type { GameState, PendingChoice, StackItem } from "../../state";
import { buildSpellContext, getPlayer, resolveTopOfStack } from "../../state";
import type { LibraryDestination } from "../../types";
import { enumerateMoves, type Move } from "../../moves";
import { applyMoveInSearch } from "../../search";
import { determinize } from "../../determinize";
import { makeRng } from "../../rng";
import {
    CHOICE_TOP_K,
    choiceCandidates,
    hasChoiceCandidateGenerator,
    isSearchableChoiceNode,
} from "../choiceCandidates";
import { ornithopter } from "../../../cards/sets/atq/colorless";
import { crawWurm, grizzlyBears } from "../../../cards/sets/lea/green";
import { island } from "../../../cards/sets/lea/colorless";
import { preordain } from "../../../cards/sets/m11/blue";
import { consider } from "../../../cards/sets/mid/blue";

// Definition ids, the vocabulary `makeInstance` and the partition helper speak.
const ORNITHOPTER = ornithopter.id; // 0/2 for {0} — a near-worthless draw
const CRAW_WURM = crawWurm.id; // 6/4 for {4}{G}{G} — a real threat
const GRIZZLY_BEARS = grizzlyBears.id;
const ISLAND = island.id;
const PREORDAIN = preordain.id; // Scry 2, then draw (CR 701.22)
const CONSIDER = consider.id; // Surveil 1, then draw (CR 701.25)

/** GENERATOR fixture: a live `order-top` choice over `top`, with `rest` below
 *  it, raised through the REAL primitive (`SpellContext.orderTop`) on a bare
 *  stack item.
 *
 *  The item's card is a vanilla creature ON PURPOSE. `applyPendingChoiceSubmit`
 *  does not itself move any card: it STORES the two lists on the stack item and
 *  resumes the resolution, and the library work happens when the resolving
 *  script calls `orderTop` a second time and reads them back. A bare item has
 *  no script to call it, so this fixture can raise a choice and score its
 *  candidates but can never ROUND-TRIP one — the tests that need the resolver
 *  use {@link stateWithRealScry} instead. Keeping the two apart is what stops a
 *  round-trip assertion passing vacuously against a choice nothing applies.
 *
 *  It buys one thing the real-card fixture cannot: an arbitrary `destination`
 *  and `chooserId`, so the reorder-only shape and CR 701.29 fateseal (no
 *  shipped card of which reaches a scry-shaped choice without a planeswalker)
 *  are expressible. */
function stateWithOrderTop(opts: {
    top: string[];
    rest: string[];
    destination: LibraryDestination;
    /** CR 701.29 fateseal — the chooser is not the library's owner. */
    fateseal?: boolean;
}): { state: GameState; choice: PendingChoice; chooserId: string } {
    const chooserId = opts.fateseal ? "p2" : "p1";
    const library = [
        ...opts.top.map((id) => makeInstance(id)),
        ...opts.rest.map((id) => makeInstance(id)),
    ];
    const state = makeState({
        players: [
            makePlayer("p1", { library }),
            makePlayer("p2", {
                library: opts.rest.map((id) => makeInstance(id)),
            }),
        ],
    });
    const item: StackItem = {
        ...makeInstance(GRIZZLY_BEARS, { controllerId: "p1", ownerId: "p1" }),
        id: "s1",
        castById: "p1",
        targets: [],
        resolutionStep: 0,
    };
    state.stack.push(item);
    const suspended = buildSpellContext(state, item).orderTop(
        "p1",
        opts.top.length,
        {
            destination: opts.destination,
            ...(opts.fateseal ? { chooserId } : {}),
        }
    );
    expect(suspended).toBe(false);
    const choice = state.pendingChoices![0];
    state.priorityPlayerId = chooserId;
    return { state, choice, chooserId };
}

/** ROUND-TRIP fixture: a real spell on the stack, resolved once so its own
 *  `scryReorder` Op raises the choice. Two spells, one per destination:
 *  Preordain, "Scry 2, then draw a card" — Scry is CR 701.22; and Consider,
 *  "Surveil 1. Draw a card." — Surveil is CR 701.25. Because the
 *  choice belongs to a script that will be re-entered, submitting an answer
 *  really moves cards, which is the only way to prove `secondZoneIds` survives
 *  the trip from the `Move` to the library. */
function stateWithRealScry(opts: {
    spell: string;
    top: string[];
    rest: string[];
}): { state: GameState; choice: PendingChoice; chooserId: string } {
    const library = [
        ...opts.top.map((id) => makeInstance(id)),
        ...opts.rest.map((id) => makeInstance(id)),
    ];
    const state = makeState({
        players: [
            makePlayer("p1", { library }),
            makePlayer("p2", {
                library: opts.rest.map((id) => makeInstance(id)),
            }),
        ],
    });
    state.stack.push({
        ...makeInstance(opts.spell, { controllerId: "p1", ownerId: "p1" }),
        id: "s1",
        castById: "p1",
        targets: [],
        resolutionStep: 0,
    });
    resolveTopOfStack(state);
    const choice = state.pendingChoices![0];
    expect(choice?.kind).toBe("order-top");
    state.priorityPlayerId = "p1";
    return { state, choice, chooserId: "p1" };
}

/** The kept / binned card DEFINITION ids of an `order-top` answer, in order. */
function partition(
    state: GameState,
    ownerId: string,
    move: Move
): { kept: string[]; binned: string[] } {
    if (move.kind !== "resolution-choice") throw new Error("wrong move kind");
    const byId = new Map(
        getPlayer(state, ownerId).library.map((c) => [
            c.id,
            (c.card as { id: string }).id,
        ])
    );
    return {
        kept: move.cardInstanceIds.map((id) => byId.get(id) ?? id),
        binned: (move.secondZoneIds ?? []).map((id) => byId.get(id) ?? id),
    };
}

describe("order-top is an in-tree decision node (issue #2996)", () => {
    it("is a registered generator, so `enumerateMoves` answers the choice", () => {
        expect(hasChoiceCandidateGenerator("order-top")).toBe(true);
        const { state, chooserId } = stateWithOrderTop({
            top: [ORNITHOPTER, ORNITHOPTER],
            rest: Array(10).fill(CRAW_WURM),
            destination: "library-bottom",
        });
        const moves = enumerateMoves(state, chooserId);
        expect(moves.length).toBeGreaterThan(0);
        expect(moves.every((m) => m.kind === "resolution-choice")).toBe(true);
    });

    it("declines a reorder-only choice, leaving it to the minimal-legal default", () => {
        // CR 701.22 with `destination: "none"` (Ponder / Index) — every card
        // stays on top and only the order changes, which this generator never
        // branches on. It is also the shape where a non-empty second list is
        // WRONG: `orderTop` moves nothing for "none" and then reorders the kept
        // cards assuming they are still the library's top run.
        const { state, choice, chooserId } = stateWithOrderTop({
            top: [CRAW_WURM, ORNITHOPTER],
            rest: Array(10).fill(ISLAND),
            destination: "none",
        });
        expect(choiceCandidates(state, choice)).toEqual([]);
        expect(isSearchableChoiceNode(choice)).toBe(false);
        expect(enumerateMoves(state, chooserId)).toEqual([]);
    });
});

describe("order-top generator is self-pruning (contract property 1)", () => {
    it("emits at most four policies however wide the look window", () => {
        // The honest answer space over "which subset stays on top, in which
        // order" is 65 answers at n = 4 and 326 at n = 5; the generator emits
        // four policies regardless, so `CHOICE_TOP_K` never has to truncate an
        // alphabetically-admitted set.
        for (const n of [2, 3, 4, 5, 6]) {
            const { state, choice } = stateWithOrderTop({
                top: Array(n).fill(ORNITHOPTER),
                rest: Array(10).fill(CRAW_WURM),
                destination: "library-bottom",
            });
            const candidates = choiceCandidates(state, choice);
            expect(candidates.length).toBeLessThanOrEqual(4);
            expect(candidates.length).toBeLessThanOrEqual(CHOICE_TOP_K);
        }
    });

    it("collapses to exactly keep-or-bin at n = 1 — the Explore shape", () => {
        // CR 701.44a — Explore's tail is `orderTop` at n = 1 with
        // `destination: "graveyard"`, and its whole decision is the two
        // branches the four policies degenerate to.
        const { state, choice } = stateWithOrderTop({
            top: [ORNITHOPTER],
            rest: Array(10).fill(CRAW_WURM),
            destination: "graveyard",
        });
        const candidates = choiceCandidates(state, choice);
        expect(candidates.length).toBe(2);
        const shapes = candidates.map((c) => partition(state, "p1", c.move));
        expect(shapes).toContainEqual({ kept: [], binned: [ORNITHOPTER] });
        expect(shapes).toContainEqual({ kept: [ORNITHOPTER], binned: [] });
    });

    it("every candidate PARTITIONS the looked-at window", () => {
        // The resolver rejects anything else ("order-top must place every
        // looked-at card once"), and a rejected submission is a move the
        // search applies and the engine refuses.
        const { state, choice } = stateWithOrderTop({
            top: [CRAW_WURM, ORNITHOPTER, ISLAND],
            rest: Array(10).fill(GRIZZLY_BEARS),
            destination: "library-bottom",
        });
        const looked = new Set(choice.candidateIds);
        for (const candidate of choiceCandidates(state, choice)) {
            const move = candidate.move;
            if (move.kind !== "resolution-choice") throw new Error("kind");
            const placed = [
                ...move.cardInstanceIds,
                ...(move.secondZoneIds ?? []),
            ];
            expect(new Set(placed).size).toBe(placed.length);
            expect(new Set(placed)).toEqual(looked);
        }
    });
});

describe("order-top ranks by worth, and flips for a foreign library", () => {
    it("keeps the best card on top of the bot's OWN library", () => {
        const { state, choice } = stateWithOrderTop({
            top: [ORNITHOPTER, CRAW_WURM],
            rest: Array(10).fill(ISLAND),
            destination: "library-bottom",
        });
        const keepOne = choiceCandidates(state, choice)
            .map((c) => partition(state, "p1", c.move))
            .find((p) => p.kept.length === 1);
        expect(keepOne).toEqual({ kept: [CRAW_WURM], binned: [ORNITHOPTER] });
    });

    it("CR 701.29 fateseal — buries the best card of an OPPONENT's library", () => {
        // Jace, the Mind Sculptor's +2 looks at the TARGET player's library and
        // the CONTROLLER decides. Same ranking, opposite sign: for their
        // library the best card belongs at the bottom.
        const { state, choice } = stateWithOrderTop({
            top: [ORNITHOPTER, CRAW_WURM],
            rest: Array(10).fill(ISLAND),
            destination: "library-bottom",
            fateseal: true,
        });
        const keepOne = choiceCandidates(state, choice)
            .map((c) => partition(state, "p1", c.move))
            .find((p) => p.kept.length === 1);
        expect(keepOne).toEqual({ kept: [ORNITHOPTER], binned: [CRAW_WURM] });
    });
});

describe("order-top answers survive the real resolver", () => {
    it("`applyMoveInSearch` bottoms the binned cards and keeps the rest on top", () => {
        // The whole point of the Move widening: without `secondZoneIds` on the
        // Move, this submission is a kept list that does not cover
        // `candidateIds` and `applyPendingChoiceSubmit` throws.
        const { state, choice, chooserId } = stateWithRealScry({
            spell: PREORDAIN,
            top: [ORNITHOPTER, CRAW_WURM],
            rest: Array(10).fill(ISLAND),
        });
        const binAll = choiceCandidates(state, choice).find(
            (c) =>
                c.move.kind === "resolution-choice" &&
                c.move.cardInstanceIds.length === 0
        );
        expect(binAll).toBeDefined();
        applyMoveInSearch(state, chooserId, binAll!.move);

        const library = getPlayer(state, "p1").library;
        expect(state.pendingChoices ?? []).toEqual([]);
        // Both looked-at cards are now at the true bottom (CR 701.22).
        const bottomTwo = library
            .slice(-2)
            .map((c) => (c.card as { id: string }).id)
            .sort();
        expect(bottomTwo).toEqual([CRAW_WURM, ORNITHOPTER].sort());
        expect((library[0].card as { id: string }).id).toBe(ISLAND);
    });

    it("CR 701.25 — a graveyard destination really bins the card", () => {
        const { state, choice, chooserId } = stateWithRealScry({
            spell: CONSIDER,
            top: [ORNITHOPTER],
            rest: Array(10).fill(CRAW_WURM),
        });
        const bin = choiceCandidates(state, choice).find(
            (c) =>
                c.move.kind === "resolution-choice" &&
                c.move.cardInstanceIds.length === 0
        );
        applyMoveInSearch(state, chooserId, bin!.move);
        const owner = getPlayer(state, "p1");
        // Consider itself lands there too once it finishes resolving
        // (CR 608.2m), so this asserts membership rather than the whole pile.
        expect(
            owner.graveyard.map((c) => (c.card as { id: string }).id)
        ).toContain(ORNITHOPTER);
        // …and the surveilled card really left the library.
        expect(
            owner.library.map((c) => (c.card as { id: string }).id)
        ).not.toContain(ORNITHOPTER);
    });
});

describe("determinize pins the OPEN peek (issue #2996)", () => {
    it("keeps the looked-at cards where the chooser can see them", () => {
        // Scry does not stamp `knownTo` until the choice is APPLIED, so before
        // this fix `determinize` re-dealt the very cards `candidateIds` names:
        // the search decided "keep this card on top" about a card that was no
        // longer there, and `SpellContext.orderTop`'s resume then threw
        // ("Card … not in kept top of library").
        const { state, choice } = stateWithOrderTop({
            top: [CRAW_WURM, ORNITHOPTER],
            rest: Array(20).fill(ISLAND),
            destination: "library-bottom",
        });
        const lookedAt = choice.candidateIds!;
        for (let seed = 0; seed < 8; seed++) {
            const world = determinize(state, "p1", makeRng(seed));
            const top = getPlayer(world, "p1")
                .library.slice(0, 2)
                .map((c) => c.id);
            expect(top).toEqual(lookedAt);
        }
    });
});
