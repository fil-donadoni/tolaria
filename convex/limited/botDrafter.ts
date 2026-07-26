// Bot Drafter Pick Heuristic (PRD #1107 stories 8, 9, 27, 29; ADR 0054, issue
// #1113) — recomposed onto ONE rating-point scale by PRD #1607 / ADR 0073
// (issue #1609). A bot Seat picks instantly whenever a pack reaches it,
// computed server-side in Convex with no dependency on any connected client —
// deliberately unlike the vs-AI gameplay Bot's client-side ISMCTS Brain
// (`src/lib/ai/brain.ts`). Mirrors `draftEngine.ts`/`eventLogic.ts`'s
// discipline: a plain, pure function of plain data, unit-testable without a
// convex-test harness.
//
// ── One scale: rating points (ADR 0073) ────────────────────────────────────
// Every term of the score is expressed in Pick Rating points (0–5, the unit an
// Admin already edits, `pickRatings.ts`), and the score is their SUM:
//
//   score = baseRating                      -- DB/seed Pick Rating, else
//                                              heuristicAsRating(quality)
//         + colourCommitment × contextScale -- colour fit vs the seat's Pool
//         + curveFit         × contextScale -- curve needs
//
// `PICK_RATING_DOMINANCE_WEIGHT` (the old ×1000 rating multiplier, issue
// #1117) is RETIRED: it made the rating the only input by construction, so no
// contextual term — present or future (Archetype, Capability; ADR 0072) —
// could ever change a pick. Ratings remain the ANCHOR of the score (a 1-point
// rating gap can never be overturned by context, see the cap below) without
// being the only input.
//
// `heuristicAsRating` maps the pre-existing quality heuristic (`cardValueById`
// × rarity) onto the same 0–5 scale, so an UNRATED card is directly comparable
// with a rated one. Without it a mixed Pool would compare different units and
// unrated cards would be either invisible or dominant depending on the sign.
//
// ── The contextual cap grows with the pick number (ADR 0073) ───────────────
// The SUM of every non-base term is bounded by `contextCapForPick`, which
// grows from ~0.3 rating points at pick 1 to ~2.0 by the end of the draft. An
// uncapped sum would let a handful of contextual matches outrank a genuine
// bomb; a CONSTANT cap would have to answer "how much may context overturn
// raw power" once, when the honest answer differs by an order of magnitude
// between the first pick (no deck to respect yet) and the last (a deck that
// very much exists). The growing cap is the "raw power early, fit late" rule
// every drafter applies, expressed as the one parameter it actually is.
//
// ── The breakdown is the primary result (ADR 0073) ─────────────────────────
// `scoreCandidate` returns a `PickCandidateTrace`: every term with its value
// AND its provenance (the specific Pool cards that produced it). The score is
// DERIVED by summing the breakdown (`sumTraceTerms`), so there is exactly one
// arithmetic path. A separate explanation path is rejected outright: a shadow
// narrator eventually diverges from the scorer it describes, and a debugging
// instrument that confidently reports arithmetic no longer deciding anything
// is worse than no instrument.
//
// PURE and DETERMINISTIC: no `Math.random`, no `ctx`. Every trace is a
// function of (candidate, already-picked pool, rating) alone; ties are broken
// by pack position (first wins) — the pack itself is already seeded
// (`draftEngine.ts`'s `generateRoundPacks`), so "first in this seeded pack" is
// itself a reproducible, non-arbitrary tiebreak. This satisfies PRD #1107
// acceptance "picks are deterministic given the event seed" with no extra RNG
// plumbing on this path.
import type { Color, Rarity } from "../cards/types";
import { cardValueById } from "../gre/cardValue";
import type { DraftPackCard, LimitedPoolCard } from "./eventTypes";
import { PICK_RATING_MAX, PICK_RATING_MIN } from "./pickRatings";

/** The subset of a card's printed characteristics the Pick Heuristic needs
 *  beyond `cardValueById`'s own id-keyed lookup — injected (like
 *  `eventLogic.ts`'s `GetBoosterConfig`/`ResolveCardMeta`) so this module
 *  never touches the card registry directly. */
export interface CardEvalMeta {
    /** Canonical `CardDefinition.id` — the id `cardValueById` scores. */
    cardId: string;
    /** Mana-cost-derived colors (CR 202.2). Empty for a colorless card
     *  (artifact, most lands) — such a card is neutral to color commitment. */
    colors: Color[];
    /** Printed mana value (0 for a card with no mana cost, e.g. a land). */
    manaValue: number;
    /** Printed rarity of THIS printing (CR 206). */
    rarity: Rarity;
}

/** Resolves a drawn card's Scryfall id to its `CardEvalMeta`, or `null` when
 *  the registry can't resolve it (should not happen for a Draftable Set's own
 *  sheets — the draftability gate guarantees every sheet card resolves — but
 *  never assumed away; `chooseBotPick` treats an unresolvable candidate as
 *  the worst possible pick rather than crashing the draft). */
export type GetCardEvalMeta = (scryfallId: string) => CardEvalMeta | null;

/** Resolves a candidate's canonical `cardId` (`CardEvalMeta.cardId`) to its
 *  Pick Rating (`pickRatings.ts`'s `PICK_RATING_MIN..PICK_RATING_MAX` scale),
 *  or `null` when nothing rates this card (no DB row, and no checked-in seed
 *  entry — see `cardRatings.ts`'s `resolveEventPickRating`). A `null` falls
 *  back to `heuristicAsRating` for the base term, on the SAME scale. Injected
 *  — like `GetCardEvalMeta` — so this module never touches the ratings
 *  registry or the `cardRatings` table directly. */
export type GetPickRating = (cardId: string) => number | null;

/** Rarity multiplier on top of raw card quality (PRD #1107 story 29: "card
 *  quality... adjusted by Rarity"). A higher rarity nudges an otherwise close
 *  decision toward the rarer card — real Limited bombs cluster at rare/mythic
 *  — without letting rarity alone override a genuinely much better common
 *  (the multiplier is small relative to `cardValueById`'s spread). Exported
 *  (issue #1115) so `autoBuild.ts`'s deck-construction quality scoring shares
 *  the SAME rarity weighting as the Pick Heuristic — one card-quality
 *  authority for both draft-time and build-time decisions. */
export const RARITY_WEIGHT: Record<Rarity, number> = {
    common: 1.0,
    uncommon: 1.12,
    rare: 1.3,
    mythic: 1.45,
};

/** Raw quality (`cardValueById` × rarity) that maps to the MIDPOINT of the
 *  rating scale (2.5). Calibrated against the real catalogue's distribution:
 *  `cardValueById` runs from 8 (a bare land / cheap artifact) through a
 *  ~74 median and a ~200 90th percentile up to ~930 (Worldspine Wurm), so a
 *  half-value of 100 puts a median card just above 2, a strong common near 3
 *  and a genuine fatty above 4 — the same shape a human rater produces. */
const HEURISTIC_RATING_HALF_VALUE = 100;

/** Maps the quality heuristic onto the Pick Rating scale (ADR 0073), so an
 *  unrated card's base term is comparable with a rated card's.
 *
 *  `PICK_RATING_MAX × q / (q + HALF)` — strictly increasing in `q` (so every
 *  quality ordering the heuristic produced survives verbatim: a bigger body
 *  still outranks a smaller one, a rarer printing still outranks its common
 *  twin) and asymptotically bounded by `PICK_RATING_MAX` (so no card, however
 *  enormous, can escape the scale the way the old unbounded quality term
 *  did). `q ≤ 0` maps to `PICK_RATING_MIN`. */
export function heuristicAsRating(quality: number): number {
    if (quality <= 0) return PICK_RATING_MIN;
    return (
        (PICK_RATING_MAX * quality) / (quality + HEURISTIC_RATING_HALF_VALUE)
    );
}

/** Raw, pre-rating card quality: the shared latent `cardValueById` (ADR 0018)
 *  — the SAME primitive the vs-AI Brain's Hand term uses, so draft-time and
 *  gameplay card quality never drift apart — scaled by printed rarity. */
export function candidateQuality(candidate: CardEvalMeta): number {
    return cardValueById(candidate.cardId) * RARITY_WEIGHT[candidate.rarity];
}

/** Rating points contributed per already-picked Pool card sharing the
 *  candidate's colour. Deliberately small: ten committed on-colour cards are
 *  worth ~0.6 rating points BEFORE the contextual cap, i.e. colour fit refines
 *  the rating anchor rather than replacing it. */
const COLOUR_COMMIT_RATING_PER_CARD = 0.06;

/** Picks before the off-colour penalty kicks in at all — the seat is still
 *  "reading signals" / establishing colours for its first few picks, so an
 *  early off-colour card is never punished (PRD #1107 story 29: "as
 *  commitment grows" implies no penalty when there is no commitment yet). */
const OFF_COLOUR_GRACE_PICKS = 3;

/** Rating points subtracted per pick beyond the grace window for a candidate
 *  that shares NO colour with anything already in the Pool — grows linearly
 *  with picks made, so the deeper into the draft, the more a wrong-colour card
 *  is punished (and the growing contextual cap lets that punishment actually
 *  land late, while keeping it a nudge early). */
const OFF_COLOUR_PENALTY_RATING_PER_PICK = 0.04;

/** Curve buckets the heuristic tracks (mana value 1 through 6+, CR 202.3);
 *  0-cost/land cards don't participate in curve scoring. Target counts are a
 *  generic Limited curve shape (a 23-spell deck skewing toward the cheap end)
 *  — not per-set tuned, just enough to reward "I have no 2-drops yet" over
 *  "I have five 5-drops already". Exported (issue #1115) so `autoBuild.ts`'s
 *  Auto-Build deck construction reuses the SAME curve shape the Pick
 *  Heuristic already uses at draft time — one curve authority, not two. */
export const CURVE_TARGET: Record<number, number> = {
    1: 2,
    2: 5,
    3: 5,
    4: 4,
    5: 3,
    6: 2,
};
export const CURVE_MAX_BUCKET = 6;

/** Rating points a totally empty curve bucket is worth; a partially filled
 *  bucket earns a proportional fraction of it. */
const CURVE_FIT_MAX_RATING = 0.5;

/** Cap on the SUM of every non-base term at the FIRST pick — the pick that
 *  genuinely has no deck to respect, so context may only break near-ties. */
export const CONTEXT_CAP_FIRST_PICK = 0.3;

/** Cap on the SUM of every non-base term at the LAST pick — a deck that very
 *  much exists by then, so context may overturn up to two rating points (but
 *  never a full 1-in-5 rating gap plus change: raw power still anchors). */
export const CONTEXT_CAP_LAST_PICK = 2.0;

/** Picks in a standard Draft (3 packs × 15 cards) — the horizon the context
 *  cap ramps over when the caller doesn't say otherwise. A Pool larger than
 *  this simply sits at `CONTEXT_CAP_LAST_PICK` (the ramp clamps). */
export const DEFAULT_DRAFT_PICKS = 45;

/** The contextual cap at `pickNumber` (1-based) of a `totalPicks`-pick draft
 *  (ADR 0073): monotonically non-decreasing, bounded, `CONTEXT_CAP_FIRST_PICK`
 *  at pick 1 and `CONTEXT_CAP_LAST_PICK` at the last pick.
 *
 *  The ramp is CONCAVE (`√progress`) rather than linear: a seat has a deck to
 *  respect well before it is halfway through, so a linear ramp would leave
 *  context almost inert through the whole first pack — exactly the window in
 *  which a coherent colour pair is supposed to form. `√` reaches ~60% of the
 *  span by the end of pack one and still lands on the same bounded endpoint.
 *  The SHAPE (monotone, bounded) is the decision; these two endpoints and the
 *  exponent are tuning, safe to move — no Pick Invariant encodes them. */
export function contextCapForPick(
    pickNumber: number,
    totalPicks: number = DEFAULT_DRAFT_PICKS
): number {
    const span = Math.max(1, totalPicks - 1);
    const progress = Math.min(1, Math.max(0, (pickNumber - 1) / span));
    return (
        CONTEXT_CAP_FIRST_PICK +
        (CONTEXT_CAP_LAST_PICK - CONTEXT_CAP_FIRST_PICK) * Math.sqrt(progress)
    );
}

/** Every term the scorer can emit. `baseRating` is the anchor (never capped);
 *  every other key is a CONTEXTUAL term, and their sum is bounded by
 *  `contextCapForPick`. New terms (Archetype, Capability, Castability, Fixing
 *  Value — ADR 0072/0073) join this union and are contextual by construction:
 *  `isContextualTerm` is derived from the base key, not a second list. */
export type PickTermKey = "baseRating" | "colourCommitment" | "curveFit";

/** One Pool card that contributed to a term — the term's PROVENANCE (ADR
 *  0073: "the specific Pool cards that produced it"). */
export interface PickTermSource {
    /** Canonical `cardId` of the contributing Pool card. */
    cardId: string;
    /** Why it contributed, e.g. `shares {G}` / `occupies the MV-2 bucket`. */
    reason: string;
}

/** One term of a candidate's score, in rating points. */
export interface PickTerm {
    term: PickTermKey;
    /** FINAL contribution — the trace's `score` is exactly the sum of these
     *  (`sumTraceTerms`), so the breakdown is the arithmetic, not a report of
     *  it. For a contextual term this is `rawValue × contextScale`. */
    value: number;
    /** Contribution BEFORE the contextual cap scaled it. Equal to `value` for
     *  `baseRating` (never capped) and for any contextual term at a pick where
     *  the cap did not bind. */
    rawValue: number;
    /** The specific Pool cards that produced this term (empty when the term
     *  is a property of the candidate alone, e.g. `baseRating`). */
    sources: PickTermSource[];
    /** One-line human-readable account of how the value came about. */
    note: string;
}

/** A candidate's full score breakdown — the PRIMARY result of scoring (ADR
 *  0073). `score` is derived by summing `terms`, so there is no second
 *  arithmetic path that can drift from the one that decides picks. */
export interface PickCandidateTrace {
    /** Canonical `cardId` of the candidate. */
    cardId: string;
    /** 1-based pick number this trace was computed for (Pool size + 1). */
    pickNumber: number;
    /** Ordered breakdown: `baseRating` first, then every contextual term. */
    terms: PickTerm[];
    /** The cap on the SUM of every contextual term at `pickNumber`. */
    contextCap: number;
    /** Uniform factor applied to every contextual term's `rawValue` — 1 when
     *  the cap did not bind, `contextCap / |raw sum|` when it did. */
    contextScale: number;
    /** Derived: the sum of `terms[].value`. */
    score: number;
}

/** True for every term that lives UNDER the contextual cap — i.e. everything
 *  that is not the rating anchor. Derived from the base key so a future term
 *  is capped by construction rather than by remembering to list it. */
export function isContextualTerm(term: PickTermKey): boolean {
    return term !== "baseRating";
}

/** Sums a trace's breakdown — the ONE definition of a candidate's score. */
export function sumTraceTerms(terms: readonly PickTerm[]): number {
    return terms.reduce((sum, t) => sum + t.value, 0);
}

/** Exported (issue #1115) so `autoBuild.ts` reuses the SAME curve-bucket
 *  authority the Pick Heuristic uses at draft time. */
export function curveBucket(mv: number): number {
    return Math.max(1, Math.min(CURVE_MAX_BUCKET, Math.round(mv)));
}

/** Per-color count of already-picked Pool cards sharing that color — the
 *  color-commitment signal (PRD #1107 story 29). */
function colorWeights(
    poolMeta: readonly CardEvalMeta[]
): Partial<Record<Color, number>> {
    const weights: Partial<Record<Color, number>> = {};
    for (const meta of poolMeta) {
        for (const c of meta.colors) {
            weights[c] = (weights[c] ?? 0) + 1;
        }
    }
    return weights;
}

/** Per-curve-bucket count of already-picked NON-land Pool cards — the curve
 *  signal (PRD #1107 story 29: "fills curve gaps"). A 0-mana-value card
 *  (basic land) never contributes: the curve models the spell base, not the
 *  land base. */
function curveCounts(
    poolMeta: readonly CardEvalMeta[]
): Partial<Record<number, number>> {
    const counts: Partial<Record<number, number>> = {};
    for (const meta of poolMeta) {
        if (meta.manaValue <= 0) continue;
        const bucket = curveBucket(meta.manaValue);
        counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    return counts;
}

/** Distinct contributing Pool cards, in Pool order, deduped by `cardId` — a
 *  term's provenance names each responsible card once, not once per copy. */
function distinctSources(
    poolMeta: readonly CardEvalMeta[],
    predicate: (meta: CardEvalMeta) => string | null
): PickTermSource[] {
    const seen = new Set<string>();
    const sources: PickTermSource[] = [];
    for (const meta of poolMeta) {
        const reason = predicate(meta);
        if (reason === null || seen.has(meta.cardId)) continue;
        seen.add(meta.cardId);
        sources.push({ cardId: meta.cardId, reason });
    }
    return sources;
}

/** The base term: the rating ANCHOR (ADR 0073). A DB/seed Pick Rating when one
 *  exists, otherwise the quality heuristic mapped onto the same 0–5 scale, so
 *  a rated and an unrated candidate are compared in one unit. */
function baseRatingTerm(
    candidate: CardEvalMeta,
    rating: number | null
): PickTerm {
    if (rating !== null) {
        return {
            term: "baseRating",
            value: rating,
            rawValue: rating,
            sources: [],
            note: `Pick Rating ${rating.toFixed(2)}`,
        };
    }
    const quality = candidateQuality(candidate);
    const value = heuristicAsRating(quality);
    return {
        term: "baseRating",
        value,
        rawValue: value,
        sources: [],
        note: `unrated — quality ${quality.toFixed(1)} → rating ${value.toFixed(2)}`,
    };
}

/** Colour commitment (PRD #1107 story 29): rewards a candidate sharing a
 *  colour the Pool is already invested in, and — once past the grace window —
 *  penalizes one sharing no colour with the Pool at all. */
function colourCommitmentTerm(
    candidate: CardEvalMeta,
    poolMeta: readonly CardEvalMeta[]
): PickTerm {
    if (candidate.colors.length === 0) {
        return {
            term: "colourCommitment",
            value: 0,
            rawValue: 0,
            sources: [],
            note: "colourless — neutral to colour commitment",
        };
    }
    const weights = colorWeights(poolMeta);
    let bestColour: Color | null = null;
    let bestAffinity = 0;
    for (const c of candidate.colors) {
        const affinity = weights[c] ?? 0;
        if (affinity > bestAffinity) {
            bestAffinity = affinity;
            bestColour = c;
        }
    }

    let raw = bestAffinity * COLOUR_COMMIT_RATING_PER_CARD;
    let note =
        bestColour !== null
            ? `${bestAffinity} Pool card(s) already on {${bestColour}}`
            : "no Pool card on any of this card's colours";
    let sources = distinctSources(poolMeta, (meta) => {
        const shared = meta.colors.filter((c) => candidate.colors.includes(c));
        return shared.length === 0
            ? null
            : `shares ${shared.map((c) => `{${c}}`).join("")}`;
    });

    const totalPicks = poolMeta.length;
    if (bestAffinity === 0 && totalPicks > OFF_COLOUR_GRACE_PICKS) {
        const committedPicks = totalPicks - OFF_COLOUR_GRACE_PICKS;
        raw -= committedPicks * OFF_COLOUR_PENALTY_RATING_PER_PICK;
        note = `off-colour against ${totalPicks} Pool card(s) (${committedPicks} past the ${OFF_COLOUR_GRACE_PICKS}-pick grace window)`;
        sources = distinctSources(poolMeta, (meta) =>
            meta.colors.length === 0
                ? null
                : `commits the seat to ${meta.colors.map((c) => `{${c}}`).join("")}`
        );
    }

    return {
        term: "colourCommitment",
        value: raw,
        rawValue: raw,
        sources,
        note,
    };
}

/** Curve fit (PRD #1107 story 29: "fills curve gaps"): rewards a candidate
 *  landing in a mana-value bucket the Pool has not filled yet. */
function curveFitTerm(
    candidate: CardEvalMeta,
    poolMeta: readonly CardEvalMeta[]
): PickTerm {
    if (candidate.manaValue <= 0) {
        return {
            term: "curveFit",
            value: 0,
            rawValue: 0,
            sources: [],
            note: "mana value 0 (land / free spell) — outside the curve model",
        };
    }
    const bucket = curveBucket(candidate.manaValue);
    const target = CURVE_TARGET[bucket] ?? 2;
    const have = curveCounts(poolMeta)[bucket] ?? 0;
    const raw =
        have < target ? (CURVE_FIT_MAX_RATING * (target - have)) / target : 0;
    return {
        term: "curveFit",
        value: raw,
        rawValue: raw,
        sources: distinctSources(poolMeta, (meta) =>
            meta.manaValue > 0 && curveBucket(meta.manaValue) === bucket
                ? `occupies the MV-${bucket} bucket`
                : null
        ),
        note: `MV-${bucket} bucket ${have}/${target} filled`,
    };
}

/** Optional knobs on a single candidate's scoring. */
export interface ScoreCandidateOptions {
    /** Total picks in this draft — the horizon the context cap ramps over
     *  (`contextCapForPick`). Defaults to `DEFAULT_DRAFT_PICKS`. */
    totalPicks?: number;
}

/** Scores one candidate card against a seat's already-accumulated Pool,
 *  returning the full breakdown (ADR 0073) — the trace IS the result, and
 *  `trace.score` is derived by summing `trace.terms`.
 *
 *  `rating` is the candidate's DB/seed Pick Rating on the 0–5 scale, or `null`
 *  when nothing rates it — in which case the base term falls back to
 *  `heuristicAsRating(quality)` on the SAME scale (so a mixed Pool never
 *  compares different units). Note the deliberate consequence of ADR 0073's
 *  fallback CHAIN: two candidates sharing a rating now share a base term, and
 *  the contextual terms — not raw quality — separate them.
 *
 *  The pick number is DERIVED from the Pool (`poolMeta.length + 1`): the
 *  contextual cap is a function of how much deck the seat already has, which
 *  is exactly what the Pool measures. */
export function scoreCandidate(
    candidate: CardEvalMeta,
    poolMeta: readonly CardEvalMeta[],
    rating: number | null = null,
    options: ScoreCandidateOptions = {}
): PickCandidateTrace {
    const pickNumber = poolMeta.length + 1;
    const contextCap = contextCapForPick(pickNumber, options.totalPicks);

    const base = baseRatingTerm(candidate, rating);
    const contextual: PickTerm[] = [
        colourCommitmentTerm(candidate, poolMeta),
        curveFitTerm(candidate, poolMeta),
    ];

    // One uniform scale over every contextual term, so the CAP binds the SUM
    // (ADR 0073) rather than each term separately — and so the scaled sum is
    // `clamp(rawSum, -cap, +cap)`, which is monotone in every raw term. That
    // monotonicity is what the Pick Invariants rest on: a term that should
    // push a candidate up can never push it down through the cap.
    const rawSum = contextual.reduce((sum, t) => sum + t.rawValue, 0);
    const contextScale =
        rawSum === 0 ? 1 : Math.min(1, contextCap / Math.abs(rawSum));
    for (const term of contextual) {
        term.value = term.rawValue * contextScale;
    }

    const terms = [base, ...contextual];
    return {
        cardId: candidate.cardId,
        pickNumber,
        terms,
        contextCap,
        contextScale,
        score: sumTraceTerms(terms),
    };
}

/** Every pack a bot seat has been shown, oldest first — the pack it is picking
 *  from is the LAST entry (ADR 0073). UNREAD by the scorer today: Draft Signal
 *  reading (what the packs coming back tell the seat about its neighbours) is
 *  a later slice of PRD #1607. The parameter is wired through every call site
 *  NOW because doing it with the reader would mean touching them all twice. */
export type PacksSeen = readonly (readonly DraftPackCard[])[];

/** Inputs to a bot pick beyond the pack and Pool themselves. Required (not an
 *  optional tail) so `packsSeen` is threaded by the COMPILER at every call
 *  site rather than by remembering to. */
export interface BotPickOptions {
    /** See `PacksSeen` — supplied, not yet read. */
    packsSeen: PacksSeen;
    /** Layered Pick Rating lookup (`cardRatings.ts`'s
     *  `resolveEventPickRating`). Omit for "nothing is rated", in which case
     *  every candidate's base term comes from `heuristicAsRating`. */
    getPickRating?: GetPickRating;
    /** Total picks in this draft — see `ScoreCandidateOptions.totalPicks`. */
    totalPicks?: number;
}

/** Scores every candidate in `pack` against `poolMeta`, in pack order (ADR
 *  0073's breakdown-primary scoring, applied to a whole pack). A candidate
 *  `getCardEvalMeta` cannot resolve yields `null` — ranked below every real
 *  candidate by `chooseBotPick` rather than crashing the draft. Exported so a
 *  debugging surface (Draft Lab) reads the SAME traces the pick is made from,
 *  never a re-derivation of them. */
export function scorePack(
    pack: readonly DraftPackCard[],
    poolMeta: readonly CardEvalMeta[],
    getCardEvalMeta: GetCardEvalMeta,
    options: BotPickOptions
): (PickCandidateTrace | null)[] {
    return pack.map((card) => {
        const meta = getCardEvalMeta(card.scryfallId);
        if (!meta) return null;
        const rating = options.getPickRating
            ? options.getPickRating(meta.cardId)
            : null;
        return scoreCandidate(meta, poolMeta, rating, {
            totalPicks: options.totalPicks,
        });
    });
}

/** Picks one card from `pack` for a Bot Drafter seat (PRD #1107 stories 8, 9,
 *  27, 29; ADR 0054; one-scale recomposition: PRD #1607, ADR 0073). Scores
 *  every candidate via `scorePack` against the seat's already-accumulated
 *  `pool` and returns the `pickId` of the highest scorer. Ties break by pack
 *  position (first wins). Deterministic: a pure function of
 *  `(pack, pool, options)` — the caller (`convex/limitedEvents.ts`) never
 *  threads an RNG stream through this path, so it is trivially reproducible
 *  given the event's seed (which already seeds the pack contents via
 *  `generateRoundPacks`).
 *
 *  `options.getPickRating` is optional and defaults to "nothing is rated" —
 *  every candidate then scores off `heuristicAsRating`, on the same scale a
 *  rated card uses. `options.packsSeen` is required but unread (see
 *  `PacksSeen`).
 *
 *  Throws only when `pack` is empty — the same contract as `applyPick`, which
 *  already guards against calling this with no pack to pick from. */
export function chooseBotPick(
    pack: readonly DraftPackCard[],
    pool: readonly LimitedPoolCard[],
    getCardEvalMeta: GetCardEvalMeta,
    options: BotPickOptions
): string {
    if (pack.length === 0) {
        throw new Error("chooseBotPick: pack is empty");
    }
    const poolMeta = pool
        .map((c) => getCardEvalMeta(c.scryfallId))
        .filter((m): m is CardEvalMeta => m !== null);

    const traces = scorePack(pack, poolMeta, getCardEvalMeta, options);
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < traces.length; i++) {
        const score = traces[i]?.score ?? -Infinity;
        if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
        }
    }
    return pack[bestIndex].pickId;
}
