// Choice-node candidate generation (PRD #1423, issue #1425) — the contract every
// choice kind plugs into when a live `PendingChoice` becomes an in-tree ISMCTS
// decision node.
//
// The contract, per choice kind:
//
//   candidates(state, choice) -> ChoiceCandidate[]
//
// three properties, all load-bearing:
//
//  1. SELF-PRUNING. The generator never enumerates a combinatorial answer space.
//     A `may-pay` whose sacrifice leg is a THRESHOLD (`{ minTotalPower }`,
//     CR 118 — Phyrexian Dreadnought) has an exponential number of satisfying
//     subsets; the generator emits a handful of policy-derived victim sets, not
//     all of them. This is the crux lesson of the #1258 spike.
//  2. STABLE IDENTITY KEYS. A candidate's `key` is derived from card DEFINITION
//     identity and choice semantics — never from a per-world instance id. ISMCTS
//     re-determinizes the hidden world every iteration, so an instance-id key
//     would split one decision's statistics across worlds and the node would
//     never accumulate. The search always applies the CURRENT world's move for
//     the selected key, so the id inside the move is always fresh — on descent
//     (`iterate`) AND at the final root pick (`rootMoveFor`/`selectRootMove`),
//     which re-resolves the winning key against the ROOT world before returning
//     it. Both are in `search.ts`.
//  3. BOUNDED OPENING. `choiceCandidates` returns the TOP-K by prior. There is
//     NO progressive widening (it barely fires at 400–1200 iterations, PRD
//     #1423); a pruned top-K is the containment mechanism.
//
// Ships the YES/NO family as the first generator: `may-pay` (CR 117.3a / 118.4),
// `land-entry-tapped` (CR 614.12 / ADR 0051) and `draw-replacement`
// (CR 614 / ADR 0061), then the modal `option-pick` (issue #1428) and
// `search-library` (CR 701.23 fetchlands / tutors, issue #1429). Later tranches
// register here against this same contract.

import type {
    CardInstanceState,
    GameState,
    PendingChoice,
    PlayerState,
} from "../state";
import {
    canPayMayPayCost,
    getMayPayDiscardCandidateIds,
    getMayPaySacrificeCandidateIds,
    getPendingChoiceMax,
    getPendingChoiceMin,
    getPlayer,
    mayPayDiscardChoiceRequired,
    mayPayHandAutoSelection,
    mayPayHandLegCount,
    mayPaySacrificeChoiceRequired,
    mayPaySacrificeThreshold,
    normalizeMayPayCost,
} from "../state";
import { getEffectivePower } from "../layers";
import { tryGetDefinition } from "../../cards";
import type { PendingChoiceKind } from "../types";
// VALUE import from `moves.ts`, which imports `choiceCandidates` back (issue
// #2983). The cycle is deliberate and safe: both bindings are hoisted function
// DECLARATIONS referenced only at call time — neither module body touches the
// other's exports while it initialises — and it buys the property that matters
// far more than an acyclic graph here, namely that a madness / rebound cast
// candidate is built by the SAME enumerator (and therefore the same
// `castRawManaCost` authority) every other cast in the tree comes from. The
// alternative was a THIRD hand-rolled reimplementation of "build a cast from a
// zone", and the codebase already carries two (issue #2473).
import { enumerateCastMoves, type Move } from "../moves";
import { exileCastPermission } from "../castCost";
import { getLegalActions } from "../rules";
import { targetKey } from "../state";
import type { Color } from "../../cards/types";
import {
    getChoicePriorGeneration,
    priorFor,
    type ChoiceCandidateHint,
} from "./choicePriors";
import {
    graveyardRecursionAccessFor,
    libraryTargetWorth,
    permanentWorth,
    prospectiveCardWorth,
} from "./candidateValue";
import { searchFindDestination } from "./searchDestination";

/** One opened branch of a choice node. */
export type ChoiceCandidate = {
    /** Stable identity of the DECISION this candidate represents — the tree key.
     *  Identical across determinizations for the same semantic answer. */
    key: string;
    /** The move that plays this answer IN THE CURRENT WORLD (instance ids are
     *  world-local and must be re-read every iteration). */
    move: Move;
    /** Ordering score from the `priorFor` seam. Bias only, never legality. */
    prior: number;
    /** Structural facts the prior seam reads (what the candidate gives up). */
    hint?: ChoiceCandidateHint;
};

/** A per-kind generator. Emits candidates WITHOUT priors (the registry attaches
 *  them) and must be self-pruning: the returned list is already the small,
 *  policy-derived answer set for the kind. Pure. */
export type ChoiceCandidateGenerator = (
    state: GameState,
    choice: PendingChoice
) => Omit<ChoiceCandidate, "prior">[];

/** Maximum branches a choice node opens. Bounded opening replaces progressive
 *  widening (PRD #1423): with a self-pruning generator the realistic candidate
 *  count is 2–4, so K is a safety ceiling, not the usual binding constraint. */
export const CHOICE_TOP_K = 8;

/** Enumeration ceiling for a MULTI-pick `option-pick` (issue #2467). A choice
 *  taking `n` of `N` options has `C(N, n)` legal answers; the tree only ever
 *  opens `CHOICE_TOP_K` of them, so enumerating the whole lattice before
 *  scoring is pure waste. Set to 4x `CHOICE_TOP_K` so the prior seam still has
 *  a real field to rank (Illusionary Terrain's C(5, 2) = 10 fits entirely). */
export const OPTION_PICK_COMBO_CAP = CHOICE_TOP_K * 4;

// ---------------------------------------------------------------------------
// Stable identity
// ---------------------------------------------------------------------------

/** Stable identity of a card instance: its DEFINITION id (equivalently its card
 *  name — one per definition), never the per-world instance id. Falls back to an
 *  inlined fixture name, then to a constant so a key is always well-formed. */
export function stableCardIdentity(card: CardInstanceState): string {
    const defId = (card.card as { id?: string }).id;
    if (defId) return tryGetDefinition(defId)?.name ?? defId;
    return (card.card as { name?: string }).name ?? "unknown-card";
}

/** Stable identity of a SET of instances: a sorted multiset of card identities
 *  ("Grizzly Bears x2 | Mox Ruby"). Order-independent and copy-count aware, so
 *  two determinizations that pick the same cards produce the same key. */
export function stableSetIdentity(cards: CardInstanceState[]): string {
    const counts = new Map<string, number>();
    for (const c of cards) {
        const id = stableCardIdentity(c);
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([id, n]) => (n > 1 ? `${id} x${n}` : id))
        .join(" | ");
}

// ---------------------------------------------------------------------------
// Yes/no family
// ---------------------------------------------------------------------------

function instancesById(
    cards: CardInstanceState[],
    ids: string[]
): CardInstanceState[] {
    const wanted = new Set(ids);
    return cards.filter((c) => wanted.has(c.id));
}

/** Greedily take permanents until their summed EFFECTIVE power reaches
 *  `threshold` (CR 118). `order` decides the policy: `"fewest-bodies"` takes the
 *  highest-power first (mirrors `brain.ts`'s `thresholdSacrifice`);
 *  `"cheapest"` takes the least valuable first (keeps the best creature at the
 *  cost of more bodies). Returns null when the set never reaches the threshold. */
function thresholdPick(
    state: GameState,
    candidates: CardInstanceState[],
    threshold: number,
    order: "fewest-bodies" | "cheapest"
): CardInstanceState[] | null {
    const sorted = [...candidates].sort((a, b) =>
        order === "fewest-bodies"
            ? getEffectivePower(state, b) - getEffectivePower(state, a)
            : permanentWorth(state, a) - permanentWorth(state, b)
    );
    const picked: CardInstanceState[] = [];
    let total = 0;
    for (const c of sorted) {
        if (total >= threshold) break;
        picked.push(c);
        total += getEffectivePower(state, c);
    }
    return total >= threshold && picked.length > 0 ? picked : null;
}

/** `may-pay` (CR 117.3a / 118.4): decline, plus the accept variants the cost's
 *  legs admit. Self-pruning — an unaffordable cost yields the decline only, and
 *  a threshold sacrifice leg yields at most two policy picks (fewest bodies /
 *  cheapest material), never the subset lattice. */
const mayPayCandidates: ChoiceCandidateGenerator = (state, choice) => {
    const out: Omit<ChoiceCandidate, "prior">[] = [
        { key: "may-pay:no", move: { kind: "may-pay", accept: false } },
    ];
    const playerId = choice.playerId;
    const cost = choice.cost;

    // A cost-less "you may …" (CR 117.3a) — accepting costs nothing.
    if (!cost) {
        out.push({
            key: "may-pay:yes",
            move: { kind: "may-pay", accept: true },
            hint: {},
        });
        return out;
    }
    if (!canPayMayPayCost(state, playerId, cost, choice.manaRestriction)) {
        return out;
    }

    const norm = normalizeMayPayCost(cost);
    const lifePaid = norm.life ?? 0;
    const player = getPlayer(state, playerId);

    // CR 701.21a / 400.7 — the PERMANENT leg, when it admits a real choice
    // (a `"return"` leg always does — ADR 0079).
    const sacrificeSets: CardInstanceState[][] = [];
    if (mayPaySacrificeChoiceRequired(state, playerId, cost)) {
        const victims = instancesById(
            player.battlefield,
            getMayPaySacrificeCandidateIds(state, playerId, cost)
        );
        const threshold = mayPaySacrificeThreshold(cost);
        if (threshold !== undefined) {
            // CR 118 threshold mode (Phyrexian Dreadnought): two policy picks.
            for (const order of ["fewest-bodies", "cheapest"] as const) {
                const pick = thresholdPick(state, victims, threshold, order);
                if (pick) sacrificeSets.push(pick);
            }
        } else {
            // Fixed cardinal: give up the least valuable permanents (brain.ts
            // picks worst-first for the same reason).
            const count = norm.permanent!.count as number;
            const worstFirst = [...victims].sort(
                (a, b) => permanentWorth(state, a) - permanentWorth(state, b)
            );
            if (worstFirst.length >= count) {
                sacrificeSets.push(worstFirst.slice(0, count));
            }
        }
        // No legal victim set → the accept leg cannot be paid; decline only.
        if (sacrificeSets.length === 0) return out;
    }

    // CR 701.9 / 118.3 (issue #899) — the discard leg, when it admits a choice.
    let discardSet: CardInstanceState[] | null = null;
    if (mayPayDiscardChoiceRequired(state, playerId, cost)) {
        const cards = instancesById(
            player.hand,
            getMayPayDiscardCandidateIds(state, playerId, cost)
        );
        const count = mayPayHandLegCount(cost);
        const worstFirst = [...cards].sort(
            (a, b) =>
                prospectiveCardWorth(state, a) - prospectiveCardWorth(state, b)
        );
        if (worstFirst.length < count) return out;
        // CR 118.9 — worst-first is a PREFERENCE, not the pick: the leg's
        // per-requirement filters decide what is legal, so route the ordering
        // through the shared assignment the submit boundary validates against.
        const chosenIds = mayPayHandAutoSelection(
            state,
            playerId,
            cost,
            worstFirst.map((c) => c.id)
        );
        if (chosenIds.length < count) return out;
        discardSet = instancesById(player.hand, chosenIds);
    }

    const discardIds = discardSet?.map((c) => c.id);
    const discardKey = discardSet
        ? `|discard=${stableSetIdentity(discardSet)}`
        : "";
    const discardWorth = (discardSet ?? []).reduce(
        (s, c) => s + prospectiveCardWorth(state, c),
        0
    );

    if (sacrificeSets.length === 0) {
        out.push({
            key: `may-pay:yes${discardKey}`,
            move: {
                kind: "may-pay",
                accept: true,
                ...(discardIds ? { discardIds } : {}),
            },
            hint: { materialGivenUp: discardWorth, lifePaid },
        });
        return out;
    }

    const seen = new Set<string>();
    for (const set of sacrificeSets) {
        const key = `may-pay:yes|sac=${stableSetIdentity(set)}${discardKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            key,
            move: {
                kind: "may-pay",
                accept: true,
                sacrificeIds: set.map((c) => c.id),
                ...(discardIds ? { discardIds } : {}),
            },
            hint: {
                materialGivenUp:
                    set.reduce((s, c) => s + permanentWorth(state, c), 0) +
                    discardWorth,
                lifePaid,
            },
        });
    }
    return out;
};

/** `land-entry-tapped` (CR 614.12 / ADR 0051, shock lands): pay to enter
 *  untapped, or decline and enter tapped. Both answers are always legal; the
 *  accept is pruned when the cost is unaffordable. */
const landEntryCandidates: ChoiceCandidateGenerator = (state, choice) => {
    const out: Omit<ChoiceCandidate, "prior">[] = [
        { key: "land-entry:no", move: { kind: "land-entry", accept: false } },
    ];
    if (
        choice.cost &&
        canPayMayPayCost(state, choice.playerId, choice.cost, undefined)
    ) {
        out.push({
            key: "land-entry:yes",
            move: { kind: "land-entry", accept: true },
            hint: { lifePaid: normalizeMayPayCost(choice.cost).life ?? 0 },
        });
    }
    return out;
};

/** `draw-replacement` (CR 614 / ADR 0061, Zur's Weirding): pay the life to bin
 *  the revealed card, or decline and let them draw it. */
const drawReplacementCandidates: ChoiceCandidateGenerator = (state, choice) => {
    const out: Omit<ChoiceCandidate, "prior">[] = [
        {
            key: "draw-replacement:no",
            move: { kind: "draw-replacement", accept: false },
        },
    ];
    if (
        choice.cost &&
        canPayMayPayCost(state, choice.playerId, choice.cost, undefined)
    ) {
        out.push({
            key: "draw-replacement:yes",
            move: { kind: "draw-replacement", accept: true },
            hint: { lifePaid: normalizeMayPayCost(choice.cost).life ?? 0 },
        });
    }
    return out;
};

// ---------------------------------------------------------------------------
// Random reveal (coin flip / future dice) — degenerate acknowledge
// ---------------------------------------------------------------------------

/** `random-reveal` (CR 705.2, ADR 0023): a coin-flip/dice-roll reveal is a
 *  DEGENERATE single-candidate choice node — the outcome was already drawn
 *  from the seeded PRNG and persisted on the choice when it was raised
 *  (`requestCoinFlip`); the chooser makes NO real decision, only
 *  acknowledges so resolution resumes past the animated reveal. Before this
 *  generator existed the kind had NO registry entry, so `decidingPlayer`
 *  returned null on a pending random-reveal and every playout crossing a
 *  coin-flip/reveal line halted and leaf-scored mid-resolution (issue
 *  #1511, the exact pathology PRD #1423 exists to remove). Registering the
 *  degenerate ack here lets the search descend past the reveal with the
 *  already-determinized outcome, exactly like every other choice kind. */
const randomRevealAckCandidates: ChoiceCandidateGenerator = (
    _state,
    choice
) => [
    {
        key: "random-reveal:ack",
        move: {
            kind: "random-reveal-ack",
            stackItemId: choice.stackItemId,
            choiceId: choice.choiceId,
        },
    },
];

// ---------------------------------------------------------------------------
// Modal "choose one" (option-pick)
// ---------------------------------------------------------------------------

/** `option-pick` (CR 700.2 / 601.2b modal spells, CR 614.12 / 701.x "as it
 *  enters, choose …" body picks): one candidate per author-supplied option.
 *  Unlike the yes/no family this generator does no legality pruning of its
 *  own — every option on `choice.options` was already validated legal when
 *  `requestOptionChoice` (the `optionChoice` Op, issue #849) built the list,
 *  and the submit-time allow-list check
 *  (`applyPendingChoiceSubmit`/`pendingChoiceSubmit.ts`) is the single source
 *  of truth for that. Each option's `id` is the mode's author-supplied
 *  semantic id (or, when omitted, its position as a string) — fixed by the
 *  card's DEFINITION, so it is already a STABLE key across determinizations
 *  with no extra derivation needed (unlike `may-pay`'s victim sets, which must
 *  be re-keyed off card identity because the raw ids are per-world instances).
 *
 *  CARDINALITY (issue #2467). The generator emits SUBMITTABLE answers, so it
 *  reads `count` rather than assuming 1: `applyPendingChoiceSubmit` rejects
 *  anything shorter than `getPendingChoiceMin` outright. Illusionary Terrain's
 *  as-enters `{ kind: "subtypes", count: 2 }` is the first `option-pick` in the
 *  engine with min > 1, and one-id-per-option made EVERY move the search
 *  enumerated at that node illegal — `applyMoveInSearch` throws uncaught in
 *  both rollout and tree descent. For min ≤ 1 (every modal spell, every
 *  as-enters `body`/`mode`/`payLife`) the emitted set is unchanged: one
 *  candidate per option.
 *
 *  BOUNDING. A modal spell's natural mode count (2–5) sits under
 *  `CHOICE_TOP_K`, but an as-enters `payLife` offers `life + 1` options (21 at
 *  20 life) and a min-2 pick over N options is C(N, 2) — so the claim that
 *  bounding here is a no-op is no longer true. `choiceCandidates` truncates to
 *  `CHOICE_TOP_K` after scoring, which keeps the TREE bounded; this generator
 *  additionally caps its own combination ENUMERATION at
 *  {@link OPTION_PICK_COMBO_CAP} so the multi-pick branch can never blow up
 *  the pre-scoring pass on a wide option list. */
const optionPickCandidates: ChoiceCandidateGenerator = (_state, choice) => {
    const options = choice.options ?? [];
    if (options.length === 0) return [];
    const min = Math.max(0, getPendingChoiceMin(choice.count));
    const max = Math.min(getPendingChoiceMax(choice.count), options.length);
    if (max < 1) return [];
    // The SMALLEST legal answer: picking beyond `min` is never forced, and the
    // subset lattice above it is exactly the explosion `search-library` avoids.
    const pick = Math.min(Math.max(min, 1), max);
    // issue #2306 (review finding 1) — a PROTECTION-colour-mode option
    // (`option.protectionColor`, set by the `optionChoice` interpreter Op only
    // when the mode structurally grants "protection from <colour>" —
    // `gre/effects/interpreter.ts`'s `modeProtectionColor`) is the structural
    // hint the prior seam needs to score the pick against the opponent's
    // observed colours. Deliberately NOT `option.color`: that field is a UI
    // RENDERING tag set by BOTH `protectionColorModes` (dodge a colour) AND
    // `colorChoiceModes`/`COLOR_OPTIONS` ("become a colour" — a different,
    // sometimes opposite, intent that issue #2306 explicitly puts out of
    // scope) — keying on the bare tag steered the latter family backwards
    // (measured: it picked the opponent's BEST-shown colour for a
    // dodge-a-colour effect, worse than the arbitrary pick it replaced).
    // Meaningful only for a SINGLE-option candidate: a multi-pick combo has no
    // one colour to report, and no shipped colour choice has `min > 1` today.
    const colorModeOf = (ids: string[]): Color | undefined =>
        ids.length === 1
            ? options.find((o) => o.id === ids[0])?.protectionColor
            : undefined;
    const toCandidate = (ids: string[]) => {
        const colorMode = colorModeOf(ids);
        return {
            // Keyed by KIND as well as option id (issue #2461) — the same
            // generator now serves the announce-time `trigger-mode` choice
            // (CR 603.3c), and two kinds sharing an option id must not
            // collide on one key.
            key: `${choice.kind}:${ids.join("+")}`,
            move: {
                kind: "resolution-choice" as const,
                stackItemId: choice.stackItemId,
                step: choice.step,
                choiceId: choice.choiceId,
                cardInstanceIds: ids,
            },
            ...(colorMode !== undefined ? { hint: { colorMode } } : {}),
        };
    };
    if (pick === 1) return options.map((option) => toCandidate([option.id]));
    const out: ReturnType<typeof toCandidate>[] = [];
    const walk = (start: number, acc: string[]): void => {
        if (out.length >= OPTION_PICK_COMBO_CAP) return;
        if (acc.length === pick) {
            out.push(toCandidate([...acc]));
            return;
        }
        for (let i = start; i < options.length; i++) {
            acc.push(options[i].id);
            walk(i + 1, acc);
            acc.pop();
            if (out.length >= OPTION_PICK_COMBO_CAP) return;
        }
    };
    walk(0, []);
    return out;
};

// ---------------------------------------------------------------------------
// Library search (search-library) — fetchlands / tutors
// ---------------------------------------------------------------------------
//
// Target pricing (`libraryTargetWorth`) now lives in `./candidateValue` — the
// same function feeds this generator's `materialGained` hint AND the DSL
// `priorFor` provider (`choicePriors.ts`, issue #1433), so the two never
// drift apart.

/** `search-library` (CR 701.23 — fetchlands, tutors): the hardest tranche-1
 *  kind, and the reason the contract's three properties exist at all.
 *
 *  SELF-PRUNING (property 1). The raw answer space is every subset of the
 *  matching library — a 50-card library with an unfiltered tutor already has 50
 *  single-card answers, and a "search for up to two" has 1275. The generator
 *  never enumerates it: it collapses the pool to DISTINCT CARD IDENTITIES (a
 *  Forest is a Forest — picking either copy is the same decision), ranks them by
 *  `libraryTargetWorth`, and emits at most `CHOICE_TOP_K` policy leads. When the
 *  choice takes more than one card, the remaining slots are filled greedily by
 *  the same ranking, so a candidate stays "the best set LED BY this card"
 *  instead of a subset lattice.
 *
 *  STABLE IDENTITY KEYS (property 2). This is the clairvoyance-critical kind:
 *  ISMCTS reshuffles the searcher's library every iteration (`determinize`), so
 *  the "best" card sits at a different position — and, for an OPPONENT's search,
 *  may not even be in the library — in each world. Keying by the picked cards'
 *  NAMES (`stableSetIdentity`) means "fetch a Forest" accumulates statistics
 *  across every determinization, while the instance ids inside the move are
 *  re-read from the CURRENT world every iteration (`search.ts` applies this
 *  world's move for the selected key). No extra anti-clairvoyance machinery is
 *  needed: the reshuffle plus `edge.avail` already carry the hidden-information
 *  discipline (PRD #1423).
 *
 *  CR 701.23b — a player may FAIL TO FIND. Modelled whenever the choice's count
 *  admits an empty pick (`{ min: 0, … }`, the "you may search" shape): an empty
 *  submission is a real, sometimes-correct answer (keeping the library
 *  unshuffled, declining the life payment's downside), so it is always offered
 *  as its own branch rather than assumed away. A fixed-count choice
 *  (`count: 1`) has no legal empty answer and gets none. */
const searchLibraryCandidates: ChoiceCandidateGenerator = (state, choice) => {
    const searcherId = choice.playerId;
    const zoneOwner = getPlayer(state, choice.zoneOwnerId ?? searcherId);

    // The eligible pool, recomputed against the CURRENT world (the allow-list
    // was precomputed when the choice was raised; a determinization may have
    // moved one of those cards out of the library — see `determinize`).
    const allow = choice.candidateIds ? new Set(choice.candidateIds) : null;
    const pool = allow
        ? zoneOwner.library.filter((c) => allow.has(c.id))
        : zoneOwner.library;

    const submit = (cards: CardInstanceState[]): Move => ({
        kind: "resolution-choice",
        stackItemId: choice.stackItemId,
        step: choice.step,
        choiceId: choice.choiceId,
        cardInstanceIds: cards.map((c) => c.id),
    });

    const out: Omit<ChoiceCandidate, "prior">[] = [];

    // CR 701.23b — "fail to find" (only when the count admits an empty pick).
    if (getPendingChoiceMin(choice.count) <= 0) {
        out.push({
            key: "search-library:none",
            move: submit([]),
            hint: { materialGained: 0 },
        });
    }

    const take = Math.min(getPendingChoiceMax(choice.count), pool.length);
    if (take <= 0) return out;
    // The pool can be SMALLER than the choice's minimum in a determinized world:
    // `determinize` re-deals the opponent's hidden zones, so an opponent-zone
    // search ("search target opponent's library for two cards") may see fewer
    // than `min` eligible cards in THIS world. A short pick is an illegal
    // submission — `applyPendingChoiceSubmit` throws ("Select at least N cards")
    // — and the throw would escape the search. Emit no pick at all instead (the
    // "fail to find" branch above already stands when CR 701.23b admits it).
    if (take < getPendingChoiceMin(choice.count)) return out;

    // Rank by worth, breaking ties on stable identity so the ordering — and
    // therefore the emitted candidate set — is world-order independent.
    //
    // The worth is DESTINATION-AWARE (issue #3041), and it has to be here and
    // not only in the prior: this ranking is also the top-K ADMISSION gate, so
    // a destination-blind worth can prune every graveyard-relevant find out of
    // the answer set of a graveyard-bound search, and a candidate that was
    // never emitted is one no amount of reward can choose. Derived once per
    // node — it is a read over the SOURCE's script, identical for every card in
    // the pool.
    const destination = searchFindDestination(state, choice);
    // Node-invariant, so it is derived ONCE for the whole pool rather than per
    // card: the recursion half of the graveyard reach gate is a PLAYER-level
    // predicate that scans a hand and a battlefield, and paying it per pool
    // card made a graveyard-bound node 3.6x the cost of a hand-bound one
    // (measured in review of PR #3077). Skipped entirely for every other
    // destination — the pricing never asks.
    const pricing = {
        destination,
        ...(destination === "graveyard"
            ? // CR 400.7 — the find lands in its OWNER's graveyard, which for
              // every shipped search is the searcher's own.
              {
                  recursionAccess: graveyardRecursionAccessFor(
                      state,
                      zoneOwner.id
                  ),
              }
            : {}),
    };
    const ranked = pool
        .map((card) => ({
            card,
            identity: stableCardIdentity(card),
            worth: libraryTargetWorth(
                state,
                searcherId,
                card,
                undefined,
                pricing
            ),
        }))
        .sort(
            (a, b) =>
                b.worth - a.worth ||
                (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0)
        );

    const seenIdentities = new Set<string>();
    const seenKeys = new Set<string>();
    for (const lead of ranked) {
        if (out.length >= CHOICE_TOP_K) break;
        if (seenIdentities.has(lead.identity)) continue;
        seenIdentities.add(lead.identity);
        // "The best set LED BY this card": the lead, then the next-best cards.
        const picked = [lead];
        for (const other of ranked) {
            if (picked.length >= take) break;
            if (other.card.id === lead.card.id) continue;
            picked.push(other);
        }
        const cards = picked.map((p) => p.card);
        const key = `search-library:${stableSetIdentity(cards)}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        out.push({
            key,
            move: submit(cards),
            hint: {
                materialGained: picked.reduce((s, p) => s + p.worth, 0),
            },
        });
    }
    return out;
};

/** The applicability gate `handPickCandidates` declines on — hoisted out so the
 *  gate and the generator are ONE predicate, never two that can drift (PR #1914
 *  review finding 2). Registered in {@link CHOICE_GENERATOR_APPLIES}, which is
 *  what `isSearchableChoiceNode` consults. */
function handPickIsSearchable(choice: PendingChoice): boolean {
    return (
        getPendingChoiceMin(choice.count) === 0 &&
        getPendingChoiceMax(choice.count) > 0
    );
}

/** `choose-hand-card` (CR 608.2b), OPTIONAL picks only — issue #1888.
 *
 *  Scoped deliberately to `min === 0`: the "you MAY exile a card" shape, whose
 *  degenerate answer ("pick nothing") is a real branch that has to be weighed
 *  rather than assumed. That is the shape that was silently broken — the
 *  client-side minimal-legal policy (`brain.ts`, ADR 0016) answers every
 *  `choose-hand-card` with `candidates.slice(0, min)`, which for `min: 0` is
 *  the EMPTY submission, so Chrome Mox resolved its imprint trigger imprinting
 *  nothing and stayed a Mox that taps for no mana, every game, deterministically.
 *
 *  A MANDATORY hand pick (`min > 0`) gets no candidates and therefore stays off
 *  the tree exactly as before: those are costs already priced elsewhere
 *  (Brainstorm's two-card putback, an upkeep discard) and turning them into
 *  search nodes is a separate, much wider change. Returning `[]` is the
 *  registry's own "not a decision node" signal (`decidingPlayer`, `search.ts`),
 *  so the fallback path is untouched.
 *
 *  Self-pruning (property 1): one branch per distinct card IDENTITY, top-K by
 *  prior, plus the empty branch — never the 2^n subset space. `max > 1` picks
 *  the best-worth prefix rather than enumerating combinations, the same
 *  "best set led by this card" containment `searchLibraryCandidates` uses. */
const handPickCandidates: ChoiceCandidateGenerator = (state, choice) => {
    if (!handPickIsSearchable(choice)) return [];
    const max = getPendingChoiceMax(choice.count);

    const owner = getPlayer(state, choice.zoneOwnerId ?? choice.playerId);
    const allow = choice.candidateIds ? new Set(choice.candidateIds) : null;
    const pool = allow ? owner.hand.filter((c) => allow.has(c.id)) : owner.hand;

    const submit = (cards: CardInstanceState[]): Move => ({
        kind: "resolution-choice",
        stackItemId: choice.stackItemId,
        step: choice.step,
        choiceId: choice.choiceId,
        cardInstanceIds: cards.map((c) => c.id),
    });

    // The degenerate branch is always offered — declining an optional pick can
    // be right (the card is worth more in hand than the payoff). It just stops
    // being the DEFAULT: `dslChoicePrior` proves it a no-op and floors its
    // prior, so it opens last.
    const out: Omit<ChoiceCandidate, "prior">[] = [
        {
            key: "hand-pick:none",
            move: submit([]),
            hint: { materialGivenUp: 0 },
        },
    ];

    const ranked = pool
        .map((card) => ({
            card,
            identity: stableCardIdentity(card),
            worth: prospectiveCardWorth(state, card),
        }))
        .sort(
            (a, b) =>
                a.worth - b.worth ||
                (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0)
        );

    const seen = new Set<string>();
    for (const lead of ranked) {
        if (out.length >= CHOICE_TOP_K) break;
        if (seen.has(lead.identity)) continue;
        seen.add(lead.identity);
        const picked = [lead];
        for (const other of ranked) {
            if (picked.length >= max) break;
            if (other.card.id === lead.card.id) continue;
            picked.push(other);
        }
        const cards = picked.map((p) => p.card);
        out.push({
            key: `hand-pick:${stableSetIdentity(cards)}`,
            move: submit(cards),
            hint: {
                materialGivenUp: picked.reduce((s, p) => s + p.worth, 0),
            },
        });
    }
    return out;
};

// ---------------------------------------------------------------------------
// Reflexive CAST WINDOWS — Madness (CR 702.35a) and Rebound (CR 702.88a)
// ---------------------------------------------------------------------------

/** Stable identity of ONE cast variant of the same card: every announce-time
 *  axis `enumerateCastMoves` enumerates a separate Move for.
 *
 *  Targets go in by their RAW id, deliberately. Property 2 of this file's
 *  contract bans a per-world instance id from a tree key, but its rationale is
 *  hidden zones: `determinize` re-deals what the searcher cannot see, so the
 *  "same" library or opponent-hand card is a different object each iteration.
 *  A cast window's targets are not that — they are public objects (battlefield
 *  permanents, players, stack items) whose ids `determinize` never touches, so
 *  the raw id IS stable across worlds. `priorityMoveKey` (search.ts) makes the
 *  same call for the bot's own moves, and for the same reason.
 *
 *  This key previously collapsed each target to its CARD NAME, on the claim
 *  that two permanents sharing a name are interchangeable targets. They are
 *  not — they differ in controller, damage marked, tapped state, counters and
 *  attached Auras — and the collapse was not merely a shared statistics key:
 *  the caller's `seen` set DROPS a colliding candidate outright, so with two
 *  Grizzly Bears on the board exactly one Ephemerate cast survived and the Bot
 *  was structurally unable to blink the other (PR #2995 review finding 1). An
 *  over-collapsed key here deletes decisions; an under-collapsed one at worst
 *  splits statistics, so raw ids are the fail-safe direction. */
function castVariantIdentity(move: Move): string {
    if (move.kind !== "cast-spell") return "";
    return [
        move.chosenModeId ?? "",
        move.alternativeCostId ?? "",
        move.chosenX === undefined ? "" : `X${move.chosenX}`,
        // CR 601.2b / 702.33 / 702.27 (PR #2995 review finding 3) — the three
        // axes this key omitted. `enumerateCastMoves` emits one Move PER
        // additional-cost leg ("discard a card or pay 3 life"), per Kicker
        // payment and per Buyback choice, and without them here the second of
        // any such pair collides and is dropped by the caller's `seen` set.
        // Unreachable today (no shipped madness/rebound card has one) — which
        // is exactly why it must go in now rather than be found by the card
        // that first does.
        move.additionalCostLegId ?? "",
        move.kickerPayments ? JSON.stringify(move.kickerPayments) : "",
        move.buybackPaid ? "buyback" : "",
        move.targets.map((t) => targetKey(t)).join(","),
    ].join("/");
}

/** Shared generator for the two REFLEXIVE CAST WINDOWS (issue #2983) — the
 *  Madness window (CR 702.35a: "cast it for its madness cost or put it into
 *  your graveyard") and the Rebound window (CR 702.88a: "you may cast this card
 *  from exile without paying its mana cost"). One helper, not two, because the
 *  two choices are structurally the same decision and differ only in which
 *  decline Move ends them (`.claude/rules` § extract-after-the-second).
 *
 *  Both were answered by a HARDCODED decline before this (`brain.ts`, ADR 0016
 *  minimal-legal policy), and because neither kind had a generator the head
 *  choice was not a decision node at all: `enumerateMoves` returned an empty
 *  list while it was open, so the playout simply stopped. The observable result
 *  was that a Madness card the Bot discarded was a card it threw away, and a
 *  Rebound spell was a spell it cast exactly once — and the exile-cast candidate
 *  set issue #2971 added was unreachable for a madness-exiled card, since the
 *  enumerator never ran while the blocking choice was open.
 *
 *  FAIL CLOSED (the issue's own rule): the decline is emitted ALWAYS and FIRST,
 *  and a cast branch is emitted only when the production enumerator itself
 *  offers one. An unaffordable madness cost and a rebound recast with no legal
 *  target both yield `[]` from `enumerateCastMoves`, so this returns the decline
 *  alone — never a cast the executor could not complete.
 *
 *  Self-pruning (property 1): the answer space here is not combinatorial to
 *  begin with — it is one specific card's own cast variants (modes, `{X}`,
 *  target groups), which `enumerateCastMoves` already bounds by
 *  `MAX_COMBINATIONS`, and `CHOICE_TOP_K` caps what actually opens. */
function castWindowCandidates(
    state: GameState,
    choice: PendingChoice,
    declineMove: Move
): Omit<ChoiceCandidate, "prior">[] {
    // The decline leads: it is the branch that is legal unconditionally, so a
    // node always has at least one answer and the search can never stall on
    // this window however the cast half resolves.
    const out: Omit<ChoiceCandidate, "prior">[] = [
        { key: `${choice.kind}:decline`, move: declineMove },
    ];

    const cardInstanceId = choice.cardInstanceId;
    if (!cardInstanceId) return out;
    const caster = state.players.find((p) => p.id === choice.playerId);
    if (!caster) return out;

    // CR 400.7 — the card sits in its OWNER's exile, which for both mechanisms
    // is the chooser's own; scanning every player's pile anyway costs nothing
    // and mirrors the enumerator's own cross-player exile scan (issue #2971).
    let zoneOwner: PlayerState | undefined;
    let card: CardInstanceState | undefined;
    for (const p of state.players) {
        const found = p.exile.find((c) => c.id === cardInstanceId);
        if (found) {
            zoneOwner = p;
            card = found;
            break;
        }
    }
    if (!card || !zoneOwner) return out;

    // The SAME two gates the enumerator's exile branch applies (`moves.ts`), in
    // the same order — this is not a second legality opinion, it is the one the
    // server would apply to the `announceCast` the executor is about to fire.
    if (!exileCastPermission(card, caster.id)) return out;
    if (
        !getLegalActions(state, zoneOwner, card, false, caster.id).includes(
            "cast"
        )
    ) {
        return out;
    }

    const seen = new Set<string>();
    for (const move of enumerateCastMoves(state, caster, card, {
        castFromZone: "exile",
    })) {
        // Self-pruning (contract property 1), and here it is also what KEEPS
        // the decline (PR #2995 review finding 2). `choiceCandidates` slices
        // the node to `CHOICE_TOP_K` by prior, and every cast variant carries
        // the same prior — strictly above the decline's. So with 8 or more
        // variants the decline sorted last and was cut, and the tree held no
        // branch in which the Bot declined at all: for a targeted madness card
        // with many legal "any target" choices (Fiery Temper), putting the card
        // in the graveyard — the very decision this issue exists to give it —
        // became unreachable. Stopping one short of K, with the decline already
        // in `out`, makes the emitted set survive the slice intact. Same
        // `out.length >= CHOICE_TOP_K` idiom `handPickCandidates` uses above.
        if (out.length >= CHOICE_TOP_K) break;
        const key = `${choice.kind}:cast:${stableCardIdentity(card)}:${castVariantIdentity(move)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, move });
    }
    return out;
}

/** CR 702.35a — the Madness cast window. Declining bins the card
 *  (`declineMadness`, gre/madness.ts), so the decline is a REAL cost here:
 *  the card is gone either way, the only question is whether it is gone to the
 *  graveyard or onto the stack. */
const madnessCastCandidates: ChoiceCandidateGenerator = (state, choice) =>
    castWindowCandidates(state, choice, { kind: "madness-decline" });

/** CR 702.88a — the Rebound cast window. Declining leaves the card exiled
 *  (CR 702.88c) with its markers cleared, so the recast is lost for good; the
 *  cast half costs nothing but the targets it must legally name. */
const reboundCastCandidates: ChoiceCandidateGenerator = (state, choice) =>
    castWindowCandidates(state, choice, { kind: "rebound-decline" });

/** The registry: choice kind → candidate generator. A kind with NO generator is
 *  not yet an in-tree decision node — the search treats it exactly as before
 *  (no decider, playout stops there), so adding a tranche is purely additive. */
export const CHOICE_CANDIDATE_GENERATORS: Partial<
    Record<PendingChoiceKind, ChoiceCandidateGenerator>
> = {
    "may-pay": mayPayCandidates,
    "land-entry-tapped": landEntryCandidates,
    "draw-replacement": drawReplacementCandidates,
    "option-pick": optionPickCandidates,
    // CR 603.3c (issue #2461) — announcing a modal trigger's mode IS a real
    // decision (which half of Deceiver Exarch's "untap yours / tap theirs" the
    // trigger becomes), so it is an in-tree search node, not a minimal-legal
    // default. Same `options`-shaped submission as `option-pick`, so the same
    // generator serves it.
    "trigger-mode": optionPickCandidates,
    "search-library": searchLibraryCandidates,
    "random-reveal": randomRevealAckCandidates,
    "choose-hand-card": handPickCandidates,
    // CR 702.35a / 702.88a (issue #2983) — the two reflexive CAST WINDOWS.
    // Neither needs a `CHOICE_GENERATOR_APPLIES` row: the generator emits the
    // decline unconditionally, so it never returns `[]` and the kind is always
    // a real decision node. What varies is whether the CAST half is offered,
    // and that is the generator's own output — the one authority, never a
    // state-free restatement that could disagree with it.
    "madness-cast": madnessCastCandidates,
    "rebound-cast": reboundCastCandidates,
};

/** Per-kind APPLICABILITY predicate, read from the `PendingChoice` alone.
 *
 *  Registry membership answers "is this KIND ever an in-tree node?"; a
 *  registered generator may still legitimately decline a PARTICULAR choice —
 *  `handPickCandidates` returns `[]` for a MANDATORY (`min > 0`) hand pick. The
 *  authority on "will this generator emit anything" is the generator's output
 *  (`decidingPlayer` / `keyedMovesFor` have always used it), but the CLIENT-side
 *  `searchable` gate (`src/lib/ai/bot-view.ts`) only ever holds the projected
 *  wire state and so cannot run a generator. This table is the state-free
 *  restatement it can run — and it is not a second copy of the rule: the
 *  generator itself calls the SAME predicate, so the two cannot disagree
 *  (PR #1914 review finding 2).
 *
 *  A kind with no entry applies unconditionally, which is the historical
 *  behavior of every pre-#1888 tranche. */
const CHOICE_GENERATOR_APPLIES: Partial<
    Record<PendingChoiceKind, (choice: PendingChoice) => boolean>
> = {
    "choose-hand-card": handPickIsSearchable,
};

/** Whether `kind` is an in-tree choice node (has a registered generator).
 *  Membership only — see {@link isSearchableChoiceNode} for the per-choice
 *  test the `searchable` gate must use. */
export function hasChoiceCandidateGenerator(kind: PendingChoiceKind): boolean {
    return CHOICE_CANDIDATE_GENERATORS[kind] !== undefined;
}

/** Whether THIS choice is an in-tree decision node the ISMCTS search must
 *  answer: a registered generator that also applies to it. The single authority
 *  for the client-side `searchable` gate (`buildOwedChoice`,
 *  `src/lib/ai/bot-view.ts`) — gating on bare registry membership instead sent
 *  every mandatory hand pick (a Brainstorm putback, a discard cost) on a Worker
 *  round-trip that enumerates nothing and lands on the driver's emergency
 *  fallback (PR #1914 review finding 2). */
export function isSearchableChoiceNode(choice: PendingChoice): boolean {
    if (CHOICE_CANDIDATE_GENERATORS[choice.kind] === undefined) return false;
    const applies = CHOICE_GENERATOR_APPLIES[choice.kind];
    return applies ? applies(choice) : true;
}

/** Stable-sort by prior, highest first, then take the top K. Ties keep
 *  generator order, so the whole pipeline stays deterministic. */
export function topKByPrior(
    candidates: ChoiceCandidate[],
    k: number = CHOICE_TOP_K
): ChoiceCandidate[] {
    return [...candidates]
        .map((c, i) => ({ c, i }))
        .sort((a, b) => b.c.prior - a.c.prior || a.i - b.i)
        .slice(0, k)
        .map(({ c }) => c);
}

/** One-slot memo (issue #1520): `decidingPlayer` (`search.ts`) computes a head
 *  choice's candidates to check non-emptiness, then the caller independently
 *  recomputes the IDENTICAL candidates a moment later (`keyedMovesFor` /
 *  `enumerateMoves`) to actually use them — 2x the generator + `priorFor`
 *  (board-scan) cost at every choice ply, in both tree descent and rollout.
 *  `choiceCandidates` is documented pure IN A SINGLE-GENERATION window — safe
 *  to cache on the call's own inputs PROVIDED the two calls bracket no state
 *  mutation and no `setChoicePriorFn` swap. True of every real call site:
 *  `decidingPlayer`/`keyedMovesFor`/`enumerateMoves` are always invoked
 *  back-to-back on the same (unmutated) state within one node visit, and the
 *  installed provider never changes mid-search. Reference equality (not deep
 *  equality) is the cheap, correct proxy for "same inputs" under that
 *  invariant — a fresh determinization or a requeued choice is a distinct
 *  object and misses the cache, recomputing correctly; `getChoicePriorGeneration`
 *  additionally guards the test-only pluggability seam (`setChoicePriorFn`),
 *  so a test that swaps providers between two calls over the same
 *  `(state, choice)` still observes a fresh computation. */
let lastCandidatesState: GameState | null = null;
let lastCandidatesChoice: PendingChoice | null = null;
let lastCandidatesK: number | null = null;
let lastCandidatesGeneration: number | null = null;
let lastCandidatesResult: ChoiceCandidate[] | null = null;

/** The choice node's opened branches: the registered generator's self-pruned
 *  set, scored through the `priorFor` seam and truncated to the top K. Returns
 *  `[]` for a kind with no generator (not an in-tree node). Pure — and memoized
 *  on its own inputs (see the note above `lastCandidatesState`) so a node visit
 *  never pays for the generator + prior pass twice. */
export function choiceCandidates(
    state: GameState,
    choice: PendingChoice,
    k: number = CHOICE_TOP_K
): ChoiceCandidate[] {
    const generation = getChoicePriorGeneration();
    if (
        lastCandidatesResult &&
        lastCandidatesState === state &&
        lastCandidatesChoice === choice &&
        lastCandidatesK === k &&
        lastCandidatesGeneration === generation
    ) {
        return lastCandidatesResult;
    }
    const generate = CHOICE_CANDIDATE_GENERATORS[choice.kind];
    const result = generate
        ? topKByPrior(
              generate(state, choice).map((c) => ({
                  ...c,
                  prior: priorFor(state, choice, c),
              })),
              k
          )
        : [];
    lastCandidatesState = state;
    lastCandidatesChoice = choice;
    lastCandidatesK = k;
    lastCandidatesGeneration = generation;
    lastCandidatesResult = result;
    return result;
}

/** FIRST-PLAY URGENCY: which not-yet-opened candidate the node opens next.
 *  An unopened branch has no statistics, so its prior IS its value estimate —
 *  the node opens branches in descending prior order rather than uniformly at
 *  random. `rand` breaks ties (and drives the whole pick when no candidate
 *  carries a prior, e.g. an ordinary priority node) so existing search
 *  determinism is preserved. Returns null when everything is already open. */
export function selectOpeningCandidate<T extends { prior: number }>(
    unopened: T[],
    rand: () => number
): T | null {
    if (unopened.length === 0) return null;
    const best = unopened.reduce((m, c) => (c.prior > m.prior ? c : m));
    if (best.prior <= 0) return unopened[Math.floor(rand() * unopened.length)];
    const tied = unopened.filter((c) => c.prior === best.prior);
    return tied[Math.floor(rand() * tied.length)];
}
