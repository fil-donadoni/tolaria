// Destination-aware library-search pricing (issue #3041).
//
// THE BUG. Every `search-library` candidate was priced by one destination-blind
// worth function: a nonland by what it would do if CAST, a land by a fetch
// curve worth ~70 at a low land count. Nothing asked where the source effect
// PUTS the find — the destination is not on the `PendingChoice` at all, it is in
// the source's Effect Script, in the `moveZone` that consumes the choice's
// binding. So Entomb ("put that card into your graveyard") priced Breeding Pool
// above every reanimation target, and duly fetched it.
//
// Two halves are asserted here, because a prior-only fix cannot reach the
// second:
//   - ORDERING — the prior (`dslChoicePrior`) ranks a reachable graveyard
//     payoff above a land and above a graveyard-irrelevant card;
//   - ADMISSION — the candidate GENERATOR is self-pruning by the same worth
//     (top-K distinct identities), so a destination-blind ranking can drop the
//     graveyard-relevant find out of the emitted answer set entirely, where no
//     amount of reward can choose it.
//
// And the two invariants that keep the fix narrow: a hand/battlefield
// destination prices EXACTLY as before, and an underivable destination falls
// back to the same pricing rather than to a guess.
//
// CR 701.23 (search), CR 400.7 (zone change).
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup";
import {
    getPlayer,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type PendingChoice,
} from "../../state";
import { choiceCandidates, CHOICE_TOP_K } from "../choiceCandidates";
import { priorFor } from "../choicePriors";
import { libraryTargetWorth } from "../candidateValue";
import { searchFindDestination } from "../searchDestination";
import { entomb } from "../../../cards/sets/ody/black";
import { demonicTutor, sengirVampire } from "../../../cards/sets/lea/black";
import { reanimate } from "../../../cards/sets/tmp/black";
import { altarOfBone } from "../../../cards/sets/ice/multicolor";
import { firebolt } from "../../../cards/sets/ody/red";
import { forceOfNature } from "../../../cards/sets/lea/green";
import {
    bloodCrypt,
    breedingPool,
    hallowedFountain,
} from "../../../cards/sets/dis/colorless";
import {
    forest,
    island,
    mountain,
    plains,
    swamp,
} from "../../../cards/sets/lea";

const ME = "p1";
const OPP = "p2";

/** A position whose head pending choice is the LIVE `search-library` choice of
 *  `tutorId` — the engine's own choice, raised by really resolving the tutor
 *  through `resolveTopOfStack` (the same seam the card's own test uses), never
 *  hand-built. A hand-built `PendingChoice` would prove nothing here: the whole
 *  derivation reads the SOURCE stack item that only a real resolution puts up.
 *
 *  `library` names the cards the search can find; `hand` the cards that sit in
 *  hand beside the tutor — which is what does or does not give the searcher
 *  graveyard recursion access (`graveyardReach.ts` reach shape 2). */
function openSearchChoice(opts: {
    tutorId: string;
    library: string[];
    hand?: string[];
}): { state: GameState; choice: PendingChoice } {
    const state = makeState({
        players: [
            makePlayer(ME, {
                battlefield: [
                    makeInstance(swamp.id, { controllerId: ME, ownerId: ME }),
                    makeInstance(swamp.id, { controllerId: ME, ownerId: ME }),
                ],
                hand: (opts.hand ?? []).map((id) =>
                    makeInstance(id, {
                        controllerId: ME,
                        ownerId: ME,
                        zone: "hand",
                    })
                ),
                library: opts.library.map((id) =>
                    makeInstance(id, {
                        controllerId: ME,
                        ownerId: ME,
                        zone: "library",
                    })
                ),
            }),
            makePlayer(OPP),
        ],
    });
    pushSpell(state, opts.tutorId, ME);
    resolveTopOfStack(state);
    const choice = state.pendingChoices?.[0];
    if (!choice || choice.kind !== "search-library") {
        throw new Error(
            `expected a live search-library choice, got ${choice?.kind ?? "none"}`
        );
    }
    return { state, choice };
}

/** The library card of `cardId` in the open choice's zone. */
function findInLibrary(state: GameState, cardId: string): CardInstanceState {
    const card = getPlayer(state, ME).library.find(
        (c) => (c.card as { id?: string }).id === cardId
    );
    if (!card) throw new Error(`no ${cardId} in library`);
    return card;
}

/** The prior the live seam assigns to "find exactly this card". */
function priorForFinding(
    state: GameState,
    choice: PendingChoice,
    cardId: string
): number {
    const card = findInLibrary(state, cardId);
    return priorFor(state, choice, {
        key: `test:${cardId}`,
        move: {
            kind: "resolution-choice",
            stackItemId: choice.stackItemId,
            step: choice.step,
            choiceId: choice.choiceId,
            cardInstanceIds: [card.id],
        },
    });
}

/** The card ids the generator's emitted candidates would actually submit. */
function emittedFindIds(state: GameState, choice: PendingChoice): Set<string> {
    const out = new Set<string>();
    for (const candidate of choiceCandidates(state, choice)) {
        if (candidate.move.kind !== "resolution-choice") continue;
        for (const id of candidate.move.cardInstanceIds ?? []) {
            const card = getPlayer(state, ME).library.find((c) => c.id === id);
            const defId = card && (card.card as { id?: string }).id;
            if (defId) out.add(defId);
        }
    }
    return out;
}

describe("search-library destination derivation (issue #3041)", () => {
    it("reads the graveyard destination off Entomb's own Effect Script", () => {
        const { state, choice } = openSearchChoice({
            tutorId: entomb.id,
            library: [forceOfNature.id, breedingPool.id],
        });
        expect(searchFindDestination(state, choice)).toBe("graveyard");
    });

    it("reads the hand destination off Demonic Tutor's", () => {
        const { state, choice } = openSearchChoice({
            tutorId: demonicTutor.id,
            library: [forceOfNature.id, breedingPool.id],
        });
        expect(searchFindDestination(state, choice)).toBe("hand");
    });

    it("degrades to undefined — never a guess — when the choice names no source script", () => {
        const { state, choice } = openSearchChoice({
            tutorId: entomb.id,
            library: [forceOfNature.id, breedingPool.id],
        });
        // The stack item is gone (an imperative `resolve()` search's choice, a
        // choice read after its source left the stack): nothing to walk.
        expect(
            searchFindDestination(state, {
                ...choice,
                stackItemId: "no-such-stack-item",
            })
        ).toBeUndefined();
        // …and a choiceId the script does not name.
        expect(
            searchFindDestination(state, { ...choice, choiceId: "$nope" })
        ).toBeUndefined();
    });
});

describe("graveyard-bound search pricing (issue #3041, CR 701.23)", () => {
    it("ranks a reachable reanimation target above a land — the observed Entomb bug", () => {
        // THE POSITION HAS TO BE ONE THE OLD PRICING GETS WRONG, and the SIZE
        // of the target is what decides that. Destination-blind, a land at two
        // lands in play prices at `LAND_SEARCH_BASE - 2 * LAND_SEARCH_STEP` =
        // 50, and a creature prices at its body (`permanentWorth`, p² + t² +
        // 10). Sengir Vampire's 4/4 is 42 — UNDER the land — which is the class
        // the reported bug lives in. Written with an 8/8 instead, this
        // assertion passes with the fix REVERTED and proves nothing: observed
        // while writing it (Force of Nature's 138 clears the land blind too).
        const { state, choice } = openSearchChoice({
            tutorId: entomb.id,
            library: [sengirVampire.id, breedingPool.id],
            // Recursion the searcher actually holds (reach shape 2).
            hand: [reanimate.id],
        });
        expect(
            priorForFinding(state, choice, sengirVampire.id)
        ).toBeGreaterThan(priorForFinding(state, choice, breedingPool.id));
    });

    it("prices the land at/near the floor on a graveyard destination, unlike the fetch curve", () => {
        const { state } = openSearchChoice({
            tutorId: entomb.id,
            library: [sengirVampire.id, breedingPool.id],
            hand: [reanimate.id],
        });
        const land = findInLibrary(state, breedingPool.id);
        const buried = libraryTargetWorth(state, ME, land, undefined, {
            destination: "graveyard",
        });
        const fetched = libraryTargetWorth(state, ME, land, undefined, {
            destination: "battlefield",
        });
        // The fetch curve is what used to be applied to a graveyard-bound find.
        expect(fetched).toBeGreaterThan(40);
        expect(buried).toBeLessThan(10);
    });

    it("does not price by SIZE: with no recursion, the self-reachable card outranks the bigger body", () => {
        // Reach shape 1 — Firebolt has printed Flashback (CR 702.34), so it is
        // usable out of the graveyard on its own. Force of Nature is a far
        // larger card that, with no recursion in hand, is buried dead.
        const { state, choice } = openSearchChoice({
            tutorId: entomb.id,
            library: [forceOfNature.id, firebolt.id, breedingPool.id],
        });
        expect(priorForFinding(state, choice, firebolt.id)).toBeGreaterThan(
            priorForFinding(state, choice, forceOfNature.id)
        );
        expect(priorForFinding(state, choice, firebolt.id)).toBeGreaterThan(
            priorForFinding(state, choice, breedingPool.id)
        );
    });

    it("ADMITS the graveyard-relevant find — top-K pruning is destination-aware too", () => {
        // The pruning is by DISTINCT IDENTITY (`stableCardIdentity` — a Forest
        // is a Forest), so the crowd must be distinct NAMES: nine copies of one
        // land collapse to a single candidate and prune nothing (observed while
        // writing this — the copies version passed with the fix reverted).
        // Destination-blind each of these lands prices at 50 and Firebolt at
        // its rescaled script worth, so blind admission fills every
        // `CHOICE_TOP_K` slot with lands and the one card the search is
        // actually looking for is never emitted at all — which is the half a
        // prior cannot fix, since the candidate does not exist to be rewarded.
        const crowd = [
            breedingPool.id,
            hallowedFountain.id,
            bloodCrypt.id,
            plains.id,
            island.id,
            mountain.id,
            forest.id,
            swamp.id,
        ];
        expect(crowd.length).toBeGreaterThanOrEqual(CHOICE_TOP_K);
        const { state, choice } = openSearchChoice({
            tutorId: entomb.id,
            library: [...crowd, firebolt.id],
        });
        expect([...emittedFindIds(state, choice)]).toContain(firebolt.id);
    });

    it("orders the unreachable finds, it does not collapse them to one floor", () => {
        // THE THIRD LEG the issue asks for — "the prior deletes nothing" — and
        // the version that says something. Asserting `prior > 0` on a two-card
        // library cannot fail: `clampPrior`'s `PRIOR_MIN` guarantees the floor
        // and `CHOICE_TOP_K` (8) guarantees both identities are emitted, so it
        // passes with the whole graveyard pricing gutted (this was the third
        // vacuous green found in review of PR #3077).
        //
        // What the leg actually claims is that a find the search should not
        // prefer is still ORDERED rather than deleted — which is exactly why
        // `GRAVEYARD_UNREACHABLE_FRACTION` is 0.05 and not 0. With nothing
        // reachable, a large body and a land are both near the floor, but the
        // pool still ranks them by their own value, so the search can still
        // reach either on reward. At zero the two tie and top-K admission falls
        // back to alphabetical order.
        const { state, choice } = openSearchChoice({
            tutorId: entomb.id,
            library: [forceOfNature.id, breedingPool.id],
        });
        const emitted = [...emittedFindIds(state, choice)];
        expect(emitted).toContain(forceOfNature.id);
        expect(emitted).toContain(breedingPool.id);

        const bigBody = priorForFinding(state, choice, forceOfNature.id);
        const land = priorForFinding(state, choice, breedingPool.id);
        // Ordered among themselves …
        expect(bigBody).toBeGreaterThan(land);
        // … and neither pinned to the band floor, so reward can still pick
        // either. `PRIOR_MIN` is 0.05 (`choicePriors.ts`).
        expect(land).toBeGreaterThan(0.05);
        // … while both stay far below what a REACHABLE find scores, so "not
        // deleted" has not quietly become "not demoted" either.
        const reachable = openSearchChoice({
            tutorId: entomb.id,
            library: [forceOfNature.id, breedingPool.id],
            hand: [reanimate.id],
        });
        expect(
            priorForFinding(reachable.state, reachable.choice, forceOfNature.id)
        ).toBeGreaterThan(bigBody);
    });
});

describe("non-graveyard destinations are untouched (issue #3041)", () => {
    // BYTE-IDENTITY IS ASSERTED THROUGH THE LIVE SEAM, not by comparing a
    // function to itself. `destination` is an optional trailing parameter, so
    // `f(a, b, c, undefined, undefined)` and `f(a, b, c)` are the same call —
    // the shape `convex/CLAUDE.md` lists as proof-of-failure failure mode 2,
    // and what the first version of these two tests did (found in review of
    // PR #3077). Both tests below instead run `priorFor` and
    // `choiceCandidates` on real positions and pin the numbers.

    /** The priors a hand-bound tutor assigns, for the fixed two-card library
     *  every test in this block uses. Golden values: they are what "byte-
     *  identical to before issue #3041" MEANS, so a graveyard branch leaking
     *  into a non-graveyard destination moves them and reds. */
    const HAND_DESTINATION_PRIORS: Record<string, number> = {
        [forceOfNature.id]: 0.645,
        [breedingPool.id]: 0.425,
    };

    it("prices a hand tutor's finds at the pre-fix priors", () => {
        const { state, choice } = openSearchChoice({
            tutorId: demonicTutor.id,
            library: [forceOfNature.id, breedingPool.id],
            hand: [reanimate.id],
        });
        expect(searchFindDestination(state, choice)).toBe("hand");
        for (const [cardId, expected] of Object.entries(
            HAND_DESTINATION_PRIORS
        )) {
            expect(priorForFinding(state, choice, cardId)).toBeCloseTo(
                expected,
                6
            );
        }
    });

    it("prices an UNDERIVABLE destination identically to the hand tutor", () => {
        // Altar of Bone searches through an imperative `resolve()`
        // (`ice/multicolor.ts`), so there is no `choice` Op to walk and no
        // `moveZone` consuming a binding: `searchFindDestination` genuinely
        // cannot derive a destination here. Its finds must price exactly as the
        // DSL hand tutor's do — that is what "falls back to today's pricing
        // rather than to a guess" means, and it is a claim about two different
        // sources, not one call compared with itself.
        const { state, choice } = openSearchChoice({
            tutorId: altarOfBone.id,
            // Altar of Bone's own allow-list is creature cards only.
            library: [forceOfNature.id, sengirVampire.id],
            hand: [reanimate.id],
        });
        expect(searchFindDestination(state, choice)).toBeUndefined();
        expect(priorForFinding(state, choice, forceOfNature.id)).toBeCloseTo(
            HAND_DESTINATION_PRIORS[forceOfNature.id],
            6
        );
    });

    it("leaves the generator's materialGained hint unchanged off a graveyard", () => {
        // The hint is the OTHER half of the acceptance criterion ("priors and
        // `materialGained` hints byte-identical"), and it comes from the
        // generator rather than the prior — a separate call site that could
        // drift on its own.
        const { state, choice } = openSearchChoice({
            tutorId: demonicTutor.id,
            library: [forceOfNature.id, breedingPool.id],
            hand: [reanimate.id],
        });
        const hints = new Map<string, number>();
        for (const candidate of choiceCandidates(state, choice)) {
            if (candidate.move.kind !== "resolution-choice") continue;
            const [id] = candidate.move.cardInstanceIds ?? [];
            const card = getPlayer(state, ME).library.find((c) => c.id === id);
            const defId = card && (card.card as { id?: string }).id;
            if (defId) hints.set(defId, candidate.hint?.materialGained ?? 0);
        }
        // Force of Nature's 8/8 body (p² + t² + 10) and Breeding Pool on the
        // land fetch curve at two lands in play (70 - 2 × 10).
        expect(hints.get(forceOfNature.id)).toBe(138);
        expect(hints.get(breedingPool.id)).toBe(50);
    });
});
