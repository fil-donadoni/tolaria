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
//         + archetypeFit     × contextScale -- the Pool's accumulated plan
//         + capabilityFit    × contextScale -- provides/requires matching
//         + comboEdge        × contextScale -- authored two-card loops
//         + colourCommitment × contextScale -- pip-weighted colour fit (below)
//         + castability      × contextScale -- can the Pool's sources pay it
//         + fixingValue      × contextScale -- deficit-driven mana-fixing worth
//         + curveFit         × contextScale -- curve needs
//
// ── Synergy: three layers, coarse to fine (ADR 0072, issue #1611) ──────────
// The three synergy terms all read ONE injected seam — `GetCardProfile`
// (`cardProfiles.ts`, the layered DB-over-seed lookup `resolveEventCardProfile`
// builds) — and every one of them contributes exactly ZERO for a scope with no
// Card Profiles at all, which is ADR 0072's own "set and block environments
// keep working with no profiles authored" consequence, and the reason wiring
// this slice moves no already-measured draft-coherence number.
//
//   - Archetype Fit: COARSE. The Pool's accumulated commitment to a named
//     strategy (`reanimator`, `artifacts`) biases a candidate sharing it, the
//     same "best shared axis × accumulated units" shape Colour Commitment
//     already uses for colours. Deliberately too coarse to express the
//     Wurm/Animate Dead distinction — that is the Capability layer's job.
//   - Capability Fit: PRECISE, and the reason the model exists. Matches the
//     candidate's `provides` against every Pool card's `requires` AND its
//     `requires` against their `provides` (ADR 0072: "and vice versa"). The
//     ABSENCE of a match is the veto, expressed as no bonus rather than as a
//     subtraction — Animate Dead requires `reanimatable`, Worldspine Wurm
//     does not provide it (it shuffles itself out of the graveyard), so that
//     pair earns 0 and the Wurm is not preferred one point above a card the
//     Pool genuinely cannot use. Flash requires `value-on-death`, which the
//     Wurm DOES provide, so that pair earns. No negative edge is authored,
//     and none has to be remembered.
//   - Combo Edge: the ESCAPE HATCH — explicit, signed, directed pairs, capped
//     in COUNT (`COMBO_EDGE_MAX_PAIRS`), reserved for the closed two-card loop
//     no vocabulary can express (Painter's Servant + Grindstone).
//
// SIGNED edges under a NON-NEGATIVE clamp. An edge's weight may be negative
// (authored anti-synergy), but the contextual clamp is `clamp(Σ, 0, cap)`, so
// a term that can only ever be negative is dead code (see the clamp note
// below). The resolution: negative edges NET against positive ones INSIDE the
// Combo Edge term, and the term itself is floored at 0. A negative edge can
// therefore cancel a positive edge that would otherwise be earned — the only
// thing an authored anti-synergy has to do — but can never drag a candidate
// below a candidate with no profile at all, which would re-introduce exactly
// the "context penalises" asymmetry ADR 0073's refinement removed.
//
// UNREVIEWED profiles count HALF (ADR 0072: "an unreviewed row's Capability
// and Archetype contribution is applied at half the contextual cap"). Applied
// as a per-ROW multiplicative weight (`profileWeight`), so a pair of rows
// contributes the PRODUCT of their weights: each row's evidence is discounted
// independently of who it is paired with, and the discount survives the shared
// clamp (halving a term's raw value halves what it can claim of the contextual
// budget). Zero weight was rejected — the bot would be unchanged for as long
// as the review backlog lasts and the LLM's mistakes would never surface;
// full weight was rejected — the bot would draft confidently on data that is
// wrong in exactly the subtle cases the feature exists for.
//
// ── Colour splits into three derived questions (ADR 0073, issue #1610) ─────
// `CardEvalMeta.colors` (`getCardColorIdentity`) reads `colors: []` for a
// MOX or a SIGNET — a printed, colourless mana cost, so the cost-derived
// branch (CR 202.2) sees no coloured symbol — even though the card plainly
// produces coloured mana. It is NOT blind to a dual land's mana base the
// same way: with no printed mana cost at all, `getCardColorIdentity` falls
// back to the land's subtypes, so a Volcanic Island already reads
// `colors: ["U","R"]`. Either way, this scorer used to read colour
// PRODUCTION nowhere at all — only pip demand — so a mana source's identity
// was effectively invisible to it regardless of shape. `pips` (coloured pip
// COUNT, `cards/colors.ts#getPipCountsFromCost`) and `producedColors` (what a
// card actually PRODUCES, `gre/constants.ts#getDefinitionProducibleColors`)
// fix that, and back three distinct terms:
//
//   - Colour Commitment: `{U}{U}` commits twice as hard as `{4}{U}` — driven
//     by PIPS, not card count. A Pool SPELL contributes its pip count; a Pool
//     MANA SOURCE contributes at a strictly LOWER weight per colour it
//     produces, so a strong dual land taken early FOLLOWS commitment rather
//     than CREATING it — the classic way these bots derail on a good land.
//   - Castability: the candidate's own pip requirement against the Pool's
//     already-held sources for those colours. A colourless candidate (no
//     pips at all) trivially maxes it — this is what restores the
//     colourless-vs-off-colour distinction the non-negative clamp collapsed
//     (see below): an off-colour card has pips the Pool has no sources for,
//     so it scores near 0 here even though colour commitment alone can't
//     tell the two apart.
//   - Fixing Value: DEFICIT-driven, not commitment-driven —
//     `Σ_colour produces[c] × max(0, pipDemand[c] − sources[c])`. A Temur
//     Pool heavy in `{R}` pips but down to one red source values Volcanic
//     Island over Tropical Island though both are on-colour duals: Volcanic
//     PRODUCES red, and red is the colour actually short. Rewarding the
//     colour already well served (commitment-driven fixing) was considered
//     and rejected — it compounds early commitment into a self-reinforcing
//     loop instead of steering toward what the Pool is actually missing.
//
// `PICK_RATING_DOMINANCE_WEIGHT` (the old ×1000 rating multiplier, issue
// #1117) is RETIRED: it made the rating the only input by construction, so no
// contextual term — present or future (Archetype, Capability; ADR 0072) —
// could ever change a pick. Ratings remain the ANCHOR of the score — a rating
// gap WIDER THAN THE PICK'S CONTEXTUAL CAP can never be overturned by context,
// see the cap below — without being the only input.
//
// `heuristicAsRating` maps the pre-existing quality heuristic (`cardValueById`
// × rarity) onto the same 0–5 scale, so an UNRATED card is directly comparable
// with a rated one. Without it a mixed Pool would compare different units and
// unrated cards would be either invisible or dominant depending on the sign.
//
// ── The contextual cap grows with the pick number (ADR 0073) ───────────────
// The SUM of every non-base term is clamped to `[0, contextCapForPick]`, which
// grows from ~0.3 rating points at pick 1 to ~2.0 by the end of the draft. An
// uncapped sum would let a handful of contextual matches outrank a genuine
// bomb; a CONSTANT cap would have to answer "how much may context overturn
// raw power" once, when the honest answer differs by an order of magnitude
// between the first pick (no deck to respect yet) and the last (a deck that
// very much exists). The growing cap is the "raw power early, fit late" rule
// every drafter applies, expressed as the one parameter it actually is.
//
// The clamp is NON-NEGATIVE, and that is load-bearing. FIT IS A BONUS: a
// candidate that fits nothing earns nothing, it is never PENALISED. Because
// every candidate's contextual sum then lives in `[0, cap]`, the widest gap
// two candidates can open on context alone is exactly `cap` — so the cap IS
// the answer to "how much may context overturn power", which is the question
// ADR 0073 says it exists to answer. A symmetric `clamp(rawSum, ±cap)` bounds
// each candidate's sum but lets the DIFFERENCE reach `2 × cap`, i.e. a cap of
// 1.9 silently licensing a 3.8-point overturn — the defect this shape fixes.
// Consequence: any term that could only ever express itself as a penalty is
// dead under this clamp, so a penalty must be re-expressed as the bonus its
// COMPLEMENT earns (see `colourCommitmentTerm`).
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
// TYPE-ONLY (erased at compile): the Card Profile seam is injected as a
// closure, so this module never touches the `cardProfiles` table, its Convex
// query shell, or the card registry behind it — the same discipline
// `GetCardEvalMeta`/`GetPickRating` already follow.
import type { CardProfile, GetCardProfile } from "./cardProfiles";
import type { DraftPackCard, LimitedPoolCard } from "./eventTypes";
import { PICK_RATING_MAX, PICK_RATING_MIN } from "./pickRatings";

/** The subset of a card's printed characteristics the Pick Heuristic needs
 *  beyond `cardValueById`'s own id-keyed lookup — injected (like
 *  `eventLogic.ts`'s `GetBoosterConfig`/`ResolveCardMeta`) so this module
 *  never touches the card registry directly. */
export interface CardEvalMeta {
    /** Canonical `CardDefinition.id` — the id `cardValueById` scores. */
    cardId: string;
    /** Mana-cost-derived colour IDENTITY (CR 202.2, `getCardColorIdentity`).
     *  Empty for a colorless card (artifact, most lands). Not read by the
     *  colour terms below (`colourCommitmentTerm`, `castabilityTerm`,
     *  `fixingValueTerm` — ADR 0073, issue #1610) — they read `pips` /
     *  `producedColors` instead, which is precisely the fix: `colors` is
     *  blind to a dual land's, a Mox's, a Signet's mana base. Kept for
     *  future non-colour terms (Archetype/Capability, issue #1611). */
    colors: Color[];
    /** Printed mana value (0 for a card with no mana cost, e.g. a land). */
    manaValue: number;
    /** Printed rarity of THIS printing (CR 206). */
    rarity: Rarity;
    /** Coloured pip COUNTS from the printed mana cost
     *  (`cards/colors.ts#getPipCountsFromCost`, ADR 0073) — `{U}{U}` is
     *  `{ U: 2 }`, `{4}{U}` is `{ U: 1 }`. Empty for a card with no coloured
     *  pips (a land, most artifacts). Colour Commitment and Castability read
     *  this, never `colors`: pip COUNT, not colour presence, is the signal
     *  ADR 0073 asks for. */
    pips: Partial<Record<Color, number>>;
    /** Colours of mana this card could produce as a source
     *  (`gre/constants.ts#getDefinitionProducibleColors`, CR 106.4) — the
     *  canonical "is this a mana source" signal Castability and Fixing Value
     *  read, DISTINCT from `colors` for a different reason per card shape.
     *  A Mox or a Signet (a printed, colourless mana COST) has `colors: []`
     *  yet a non-empty `producedColors`, so `colors` alone would miss it
     *  entirely. A dual land (no printed mana cost at all) already gets a
     *  non-empty `colors` from `getCardColorIdentity`'s land-subtype
     *  fallback — a Volcanic Island reads `colors: ["U","R"]`, not `[]` —
     *  but the colour terms below still read `producedColors` for it too, so
     *  one signal serves both card shapes uniformly instead of branching on
     *  which kind of source a card is. A card with no mana ability yields
     *  `[]`. */
    producedColors: Color[];
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

/** Rating points contributed per weighted "unit" of colour affinity a Pool
 *  card has already built up in the candidate's colour (`colourAffinityWeight`
 *  below) — one unit is one coloured PIP on an already-picked Pool SPELL.
 *  Deliberately small, mirroring the old per-card weight it replaces: ten
 *  pip-units of affinity are worth ~0.6 rating points BEFORE the contextual
 *  cap, i.e. colour fit refines the rating anchor rather than replacing it. */
const COLOUR_COMMIT_RATING_PER_UNIT = 0.06;

/** A Pool MANA SOURCE's contribution, in affinity UNITS, per colour it can
 *  produce (`producedColors`) — strictly LESS than the one full unit a single
 *  coloured pip is worth. This is the load-bearing half of "a dual land
 *  FOLLOWS commitment, it does not CREATE it" (ADR 0073, PRD #1607): taking a
 *  strong land early must not marry the seat to a colour the way an actual
 *  double-pipped spell of that colour would. */
const COLOUR_COMMIT_SOURCE_UNIT_WEIGHT = 0.4;

/** Affinity UNITS before the seat counts as genuinely COMMITTED to a colour —
 *  it is still "reading signals" / establishing colours for its first few
 *  picks (PRD #1107 story 29: "as commitment grows" implies nothing to
 *  respect when there is no commitment yet). Same magnitude as the old
 *  card-count grace window (3), now read in pip-equivalent units. */
const COLOUR_COMMIT_GRACE_UNITS = 3;

/** EXTRA rating points per affinity unit beyond the grace window, on top of
 *  `COLOUR_COMMIT_RATING_PER_UNIT`. This is the old off-colour PENALTY,
 *  re-expressed as the bonus its complement earns: the deeper the seat is
 *  committed, the more a card that fits that commitment is worth relative to
 *  one that fits nothing. Stating it as a penalty instead would make it dead
 *  weight under the non-negative contextual clamp (a term that is structurally
 *  ≤ 0 can never survive `clamp(rawSum, 0, cap)`), and would put the bound on
 *  each candidate's sum rather than on the gap between two candidates. */
const COLOUR_COMMIT_RATING_PER_COMMITTED_UNIT = 0.04;

/** Rating points a candidate with NO coloured pip requirement (colourless, or
 *  every required colour fully served) is worth on Castability — the ceiling
 *  the term scales toward as the Pool's sources cover the candidate's pips.
 *  Restores the colourless-vs-off-colour distinction the non-negative clamp
 *  collapsed (ADR 0073's refinement note): a colourless card trivially maxes
 *  this by having nothing to pay for, while an off-colour card's pips the
 *  Pool cannot pay for score near 0. */
const CASTABILITY_MAX_RATING = 0.4;

/** Rating points per DEFICIT pip a candidate's produced colour(s) relieve
 *  (`fixingValueTerm`) — small and self-scaling: one white card in the Pool
 *  yields a white deficit of one, worth a nudge, not a summons; a Pool nine
 *  pips deep in red and down to one red source yields a deficit of eight,
 *  worth a real bonus to a card that produces red. */
const FIXING_VALUE_RATING_PER_DEFICIT_PIP = 0.05;

/** Cap on a single candidate's raw Fixing Value, applied BEFORE the shared
 *  contextual clamp — a very large deficit (a Pool desperate for a colour it
 *  has almost no sources of) must still not let one term alone eat the
 *  entire contextual budget away from Colour Commitment / Castability /
 *  Curve Fit on the very candidate that is finally fixing it. The shared
 *  non-negative clamp (`scoreCandidate`) still bounds the TOTAL. */
const FIXING_VALUE_RAW_CAP = 1.2;

/** Multiplier on an UNREVIEWED (`reviewed: false`) Card Profile row's
 *  contribution to every synergy term (ADR 0072: "an unreviewed row's
 *  Capability and Archetype contribution is applied at half the contextual
 *  cap"). Per ROW, so a candidate/Pool-card PAIR contributes the product of
 *  the two rows' weights — each row's evidence is discounted on its own
 *  merits, independently of what it happens to be paired with. */
const UNREVIEWED_PROFILE_WEIGHT = 0.5;

/** Rating points per unit of Archetype commitment the Pool has already
 *  accumulated in the candidate's best shared archetype — one unit is one
 *  already-picked Pool card declaring that archetype (halved for an
 *  unreviewed row). Small: the Archetype layer STEERS (colours and plan),
 *  it does not decide. */
const ARCHETYPE_RATING_PER_UNIT = 0.05;

/** Cap on a single candidate's raw Archetype Fit, applied BEFORE the shared
 *  contextual clamp — a deep Pool all-in on one archetype must not let the
 *  COARSEST of the three synergy layers eat the whole contextual budget away
 *  from the precise one (Capability Fit) on the same candidate. */
const ARCHETYPE_FIT_RAW_CAP = 0.6;

/** Rating points per matched Capability — one distinct Capability name
 *  matched between the candidate and one distinct Pool card, in either
 *  direction (candidate `provides` ↔ Pool `requires`, or the reverse).
 *  Deliberately ~3× the Archetype per-unit weight: this is the layer that
 *  knows Worldspine Wurm is a Flash payoff and not an Animate Dead one, so a
 *  single true Capability match should outweigh several cards' worth of
 *  coarse archetype overlap. */
const CAPABILITY_RATING_PER_MATCH = 0.15;

/** Cap on a single candidate's raw Capability Fit, before the shared
 *  contextual clamp — same role `FIXING_VALUE_RAW_CAP` plays for fixing: a
 *  hyper-connected card in a fully-censused Pool must not zero out every
 *  other contextual term through the shared `contextScale`. */
const CAPABILITY_FIT_RAW_CAP = 0.9;

/** How many authored Combo Edge PAIRS may contribute to one candidate's score
 *  (ADR 0072: "explicit, signed, directed pair, capped in number"). The edge
 *  is the escape hatch for the closed two-card loop (Painter's Servant +
 *  Grindstone), so a candidate should be earning it from one or two specific
 *  partners; a card accumulating edges to a dozen Pool cards is a miscensused
 *  Capability, and the count cap is what stops that authoring mistake from
 *  quietly becoming the strongest term in the scorer. Pairs are selected by
 *  descending |net weight| (ties by `cardId`, so the selection is a pure
 *  function of the data, never of Pool order). */
export const COMBO_EDGE_MAX_PAIRS = 2;

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
 *  `contextCapForPick`. The synergy terms (Archetype, Capability, Combo Edge
 *  — ADR 0072, issue #1611) are contextual by construction:
 *  `isContextualTerm` is derived from the base key, not a second list. */
export type PickTermKey =
    | "baseRating"
    | "archetypeFit"
    | "capabilityFit"
    | "comboEdge"
    | "colourCommitment"
    | "castability"
    | "fixingValue"
    | "curveFit";

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
    /** The cap on the SUM of every contextual term at `pickNumber`. The sum is
     *  clamped to `[0, contextCap]`, so this is also the widest gap context
     *  alone can open between two candidates at this pick (ADR 0073). */
    contextCap: number;
    /** Uniform factor applied to every contextual term's `rawValue` — 1 when
     *  the cap did not bind, `contextCap / rawSum` when it did. Together with
     *  each term's `rawValue` it makes the clamp READABLE off the breakdown:
     *  `Σ value = clamp(Σ rawValue, 0, contextCap)`, and every scaled term's
     *  `note` says so in words. (0 in the degenerate case of a negative raw
     *  sum — no term produces one today, fit is a bonus.) */
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

/** Per-colour coloured PIP DEMAND already built up by already-picked Pool
 *  SPELLS (ADR 0073, issue #1610) — the counting half of "`{U}{U}` commits
 *  twice as hard as `{4}{U}`". Reads `pips`, not `colors`: a card contributes
 *  its actual pip count, not a flat 1 per shared colour. Shared by Colour
 *  Commitment (as the "how invested is the Pool" half) and Fixing Value (as
 *  the deficit's demand half, `pipDemand[c] − sources[c]`). */
function pipDemandByColor(
    poolMeta: readonly CardEvalMeta[]
): Partial<Record<Color, number>> {
    const demand: Partial<Record<Color, number>> = {};
    for (const meta of poolMeta) {
        for (const [c, pip] of Object.entries(meta.pips) as [Color, number][]) {
            if (pip > 0) demand[c] = (demand[c] ?? 0) + pip;
        }
    }
    return demand;
}

/** Per-colour count of already-picked Pool cards that can PRODUCE that
 *  colour of mana (`producedColors`, `gre/constants.ts#getDefinitionProducibleColors`)
 *  — the Pool's actual mana-SOURCE count, distinct from `pipDemandByColor`'s
 *  spell-side pip demand. Shared by Castability (sources available to pay a
 *  candidate's pips) and Fixing Value (the deficit's supply half). */
function sourceCountsByColor(
    poolMeta: readonly CardEvalMeta[]
): Partial<Record<Color, number>> {
    const counts: Partial<Record<Color, number>> = {};
    for (const meta of poolMeta) {
        for (const c of meta.producedColors) {
            counts[c] = (counts[c] ?? 0) + 1;
        }
    }
    return counts;
}

/** Per-colour colour-COMMITMENT affinity (ADR 0073, issue #1610): a Pool
 *  SPELL's coloured pips count at full weight (`pipDemandByColor`); a Pool
 *  MANA SOURCE's produced colours count at `COLOUR_COMMIT_SOURCE_UNIT_WEIGHT`
 *  — strictly less than one pip's worth, so a source FOLLOWS commitment
 *  rather than CREATING it (a strong dual land taken early must not marry
 *  the seat to a colour the way an actual double-pipped spell would). */
function colourAffinityWeights(
    poolMeta: readonly CardEvalMeta[]
): Partial<Record<Color, number>> {
    const weights = pipDemandByColor(poolMeta);
    for (const meta of poolMeta) {
        for (const c of meta.producedColors) {
            weights[c] = (weights[c] ?? 0) + COLOUR_COMMIT_SOURCE_UNIT_WEIGHT;
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

/** Colour commitment (PRD #1107 story 29; pip-weighted, ADR 0073 issue
 *  #1610): rewards a candidate whose coloured PIPS match a colour the Pool
 *  is already invested in, at a slope that STEEPENS once the seat is
 *  genuinely committed to that colour. Reads `candidate.pips` (its OWN
 *  coloured mana cost), never `candidate.colors` — a candidate's commitment
 *  fit is about what it costs to CAST, not its colour identity.
 *
 *  Non-negative by construction (ADR 0073's non-negative contextual clamp): a
 *  candidate sharing no colour with the Pool scores 0 — it earns no bonus, it
 *  is not punished. What was an off-colour penalty growing with the draft is
 *  now `COLOUR_COMMIT_RATING_PER_COMMITTED_UNIT`, the same growth expressed on
 *  the FITTING side, so the on-colour/off-colour GAP still widens as the seat
 *  commits (which is the behaviour PRD #1107 story 29 asks for) while the
 *  score's contextual half stays a pure bonus.
 *
 *  A candidate with NO coloured pips (a land, most artifacts) also scores 0:
 *  it has no colour requirement to fit, so it earns no colour bonus. Taking
 *  Volcanic Island — `pips: {}` even though it PRODUCES {U}/{R} — must never
 *  marry the seat to a colour by this term; telling "castable regardless of
 *  colour" apart from "actively off-colour" belongs to Castability below,
 *  not to a negative colour term. */
function colourCommitmentTerm(
    candidate: CardEvalMeta,
    poolMeta: readonly CardEvalMeta[]
): PickTerm {
    const candidateColours = Object.keys(candidate.pips) as Color[];
    if (candidateColours.length === 0) {
        return {
            term: "colourCommitment",
            value: 0,
            rawValue: 0,
            sources: [],
            note: "no coloured pips — no colour to fit, so no colour bonus (and never a penalty)",
        };
    }
    const weights = colourAffinityWeights(poolMeta);
    let bestColour: Color | null = null;
    let bestAffinity = 0;
    for (const c of candidateColours) {
        const affinity = weights[c] ?? 0;
        if (affinity > bestAffinity) {
            bestAffinity = affinity;
            bestColour = c;
        }
    }

    if (bestColour === null) {
        return {
            term: "colourCommitment",
            value: 0,
            rawValue: 0,
            sources: [],
            note: `shares no colour with ${poolMeta.length} Pool card(s) — no colour bonus (and never a penalty)`,
        };
    }

    const colour: Color = bestColour;
    const committed = Math.max(0, bestAffinity - COLOUR_COMMIT_GRACE_UNITS);
    const raw =
        bestAffinity * COLOUR_COMMIT_RATING_PER_UNIT +
        committed * COLOUR_COMMIT_RATING_PER_COMMITTED_UNIT;
    const note =
        committed > 0
            ? `${bestAffinity.toFixed(1)} affinity unit(s) already on {${colour}} (${committed.toFixed(1)} past the ${COLOUR_COMMIT_GRACE_UNITS}-unit grace window)`
            : `${bestAffinity.toFixed(1)} affinity unit(s) already on {${colour}}`;

    return {
        term: "colourCommitment",
        value: raw,
        rawValue: raw,
        sources: distinctSources(poolMeta, (meta) => {
            const pip = meta.pips[colour] ?? 0;
            if (pip > 0) return `${pip} pip(s) of {${colour}}`;
            if (meta.producedColors.includes(colour))
                return `produces {${colour}}`;
            return null;
        }),
        note,
    };
}

/** Castability (ADR 0073, issue #1610): the candidate's own coloured pip
 *  requirement against the mana sources the Pool ALREADY holds for those
 *  colours — stops the bot hoarding `{B}{B}{B}` bombs on three swamps. A
 *  candidate is only as castable as its WORST-served required colour (a
 *  spell needing `{U}{R}` with plenty of blue sources and zero red ones is
 *  not meaningfully castable), so the term takes the minimum coverage ratio
 *  across every colour the candidate needs, not an average.
 *
 *  A candidate with NO coloured pips (colourless, or a land) has nothing to
 *  pay for, so it trivially maxes this term — this is the fix for ADR 0073's
 *  refinement note: the non-negative contextual clamp made `colourCommitment`
 *  alone unable to tell a colourless card apart from an actively off-colour
 *  one (both score 0 there), and Castability is where that distinction now
 *  lives — an off-colour candidate has pips the Pool has no sources for, so
 *  its coverage ratio (and this term) sits near 0 instead. */
function castabilityTerm(
    candidate: CardEvalMeta,
    poolMeta: readonly CardEvalMeta[]
): PickTerm {
    const requiredColours = Object.entries(candidate.pips).filter(
        ([, pip]) => (pip ?? 0) > 0
    ) as [Color, number][];
    if (requiredColours.length === 0) {
        return {
            term: "castability",
            value: CASTABILITY_MAX_RATING,
            rawValue: CASTABILITY_MAX_RATING,
            // Deliberately empty, not a provenance gap: this bonus is a
            // property of the CANDIDATE alone (it has no coloured pip to pay
            // for), never of any specific Pool card, so there is no Pool
            // card to name — unlike every other non-zero contextual term,
            // which always points at the Pool cards that earned it.
            sources: [],
            note: "no coloured pip requirement — trivially castable (a property of the candidate alone, not any Pool card, so no provenance to name)",
        };
    }

    const sources = sourceCountsByColor(poolMeta);
    let worstColour: Color = requiredColours[0][0];
    let worstRatio = Infinity;
    for (const [c, pip] of requiredColours) {
        const have = sources[c] ?? 0;
        const ratio = Math.min(1, have / pip);
        if (ratio < worstRatio) {
            worstRatio = ratio;
            worstColour = c;
        }
    }

    const raw = CASTABILITY_MAX_RATING * worstRatio;
    const have = sources[worstColour] ?? 0;
    const need = candidate.pips[worstColour] ?? 0;
    return {
        term: "castability",
        value: raw,
        rawValue: raw,
        sources: distinctSources(poolMeta, (meta) =>
            meta.producedColors.includes(worstColour)
                ? `produces {${worstColour}}`
                : null
        ),
        note:
            worstRatio >= 1
                ? `every required colour fully sourced (worst: {${worstColour}} ${have}/${need})`
                : `bottlenecked on {${worstColour}}: ${have} source(s) for ${need} pip(s)`,
    };
}

/** Fixing Value (ADR 0073, issue #1610): DEFICIT-driven, not
 *  commitment-driven — `Σ_colour produces[c] × max(0, pipDemand[c] −
 *  sources[c])`. A candidate that produces no mana (`producedColors` empty)
 *  scores 0. Otherwise, for every colour the candidate CAN produce, it earns
 *  credit for however much the Pool's existing pip demand in that colour
 *  outstrips the sources already held — a Temur Pool heavy in `{R}` pips and
 *  down to one red source values Volcanic Island (produces {U}/{R}) above
 *  Tropical Island (produces {U}/{G}) though both are on-colour duals,
 *  because Volcanic relieves the colour that is actually short.
 *
 *  Commitment-driven fixing (reward scaling with how committed the seat
 *  already is, rather than the deficit) was considered and rejected — it
 *  rewards the colour already well served, exactly backwards, and compounds
 *  early commitment into a self-reinforcing loop (ADR 0073). */
function fixingValueTerm(
    candidate: CardEvalMeta,
    poolMeta: readonly CardEvalMeta[]
): PickTerm {
    if (candidate.producedColors.length === 0) {
        return {
            term: "fixingValue",
            value: 0,
            rawValue: 0,
            sources: [],
            note: "produces no mana — no fixing to offer",
        };
    }

    const demand = pipDemandByColor(poolMeta);
    const sources = sourceCountsByColor(poolMeta);
    let rawTotal = 0;
    const reliefByColour: Partial<Record<Color, number>> = {};
    for (const c of candidate.producedColors) {
        const deficit = Math.max(0, (demand[c] ?? 0) - (sources[c] ?? 0));
        if (deficit <= 0) continue;
        reliefByColour[c] = deficit;
        rawTotal += deficit * FIXING_VALUE_RATING_PER_DEFICIT_PIP;
    }
    const raw = Math.min(FIXING_VALUE_RAW_CAP, rawTotal);

    const reliefColours = Object.keys(reliefByColour) as Color[];
    if (reliefColours.length === 0) {
        return {
            term: "fixingValue",
            value: 0,
            rawValue: 0,
            sources: [],
            note: `produces ${candidate.producedColors.map((c) => `{${c}}`).join("")} — no colour the Pool is short on`,
        };
    }

    return {
        term: "fixingValue",
        value: raw,
        rawValue: raw,
        sources: distinctSources(poolMeta, (meta) => {
            const contributes = reliefColours.filter(
                (c) => (meta.pips[c] ?? 0) > 0
            );
            return contributes.length === 0
                ? null
                : `demands ${contributes.map((c) => `{${c}}`).join("")}, relieved by this source`;
        }),
        note: `relieves a deficit of ${reliefColours
            .map((c) => `${reliefByColour[c]} {${c}}`)
            .join(", ")} pip(s) the Pool already has demand for`,
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

// ── Synergy terms (ADR 0072, issue #1611) ──────────────────────────────────

/** A Pool card paired with the Card Profile that was found for it — the unit
 *  every synergy term iterates. Built ONCE per candidate scoring
 *  (`poolProfiles`) and shared by all three terms, so a `GetCardProfile`
 *  closure that hits a Map (the production shape) is consulted once per
 *  distinct Pool card rather than three times. */
interface PoolProfileEntry {
    meta: CardEvalMeta;
    profile: CardProfile;
    /** How many copies of this card the Pool holds — Archetype commitment
     *  ACCUMULATES over copies (three reanimation targets commit harder than
     *  one), while Capability/Combo matching does NOT (a relationship between
     *  two cards is not twice as true because the Pool holds two copies of
     *  one end of it). */
    copies: number;
}

/** A profile row's weight (ADR 0072's half-weight rule for unreviewed rows). */
function profileWeight(profile: CardProfile): number {
    return profile.reviewed ? 1 : UNREVIEWED_PROFILE_WEIGHT;
}

/** Distinct profiled Pool cards, in Pool order (so provenance and any
 *  order-dependent note read in the order the seat actually drafted). A Pool
 *  card with no profile is absent entirely — ADR 0072's "a missing profile and
 *  a deliberately empty one are indistinguishable to the scorer". */
function poolProfiles(
    poolMeta: readonly CardEvalMeta[],
    getCardProfile: GetCardProfile | undefined
): PoolProfileEntry[] {
    if (!getCardProfile) return [];
    const byCardId = new Map<string, PoolProfileEntry>();
    for (const meta of poolMeta) {
        const existing = byCardId.get(meta.cardId);
        if (existing) {
            existing.copies += 1;
            continue;
        }
        const profile = getCardProfile(meta.cardId);
        if (!profile) continue;
        byCardId.set(meta.cardId, { meta, profile, copies: 1 });
    }
    return [...byCardId.values()];
}

/** An empty synergy term — the overwhelmingly common case (no profile for the
 *  candidate, or no profiled Pool card), factored out so all three terms
 *  report "computed, contributed nothing" identically rather than each
 *  inventing its own zero. */
function emptySynergyTerm(term: PickTermKey, note: string): PickTerm {
    return { term, value: 0, rawValue: 0, sources: [], note };
}

/** Archetype Fit (ADR 0072 layer 1, issue #1611): the Pool's ACCUMULATED
 *  commitment to a named strategy biases a candidate that shares it — the same
 *  "best shared axis × accumulated units" shape `colourCommitmentTerm` uses
 *  for colours, and for the same reason: a seat drafts ONE plan, so the
 *  archetype the Pool is deepest in is the one worth respecting, not the sum
 *  over every archetype the candidate happens to be tagged with.
 *
 *  Deliberately COARSE. It cannot express (and must not be extended to
 *  express) the Animate Dead / Worldspine Wurm distinction: all four cards of
 *  ADR 0072's motivating example share a "cheat a fatty into play" archetype,
 *  which is exactly why the Capability layer below exists. Non-negative: a
 *  candidate sharing no archetype with the Pool earns nothing and is never
 *  penalised. */
function archetypeFitTerm(
    profile: CardProfile | null,
    profiled: readonly PoolProfileEntry[]
): PickTerm {
    if (!profile || profile.archetypes.length === 0) {
        return emptySynergyTerm(
            "archetypeFit",
            profile
                ? "profiled, but declares no archetype — nothing to steer toward"
                : "no Card Profile for this card — no archetype signal"
        );
    }
    if (profiled.length === 0) {
        return emptySynergyTerm(
            "archetypeFit",
            "no profiled card in the Pool yet — no accumulated plan to fit"
        );
    }

    const commitment = new Map<string, number>();
    for (const entry of profiled) {
        const weight = profileWeight(entry.profile) * entry.copies;
        for (const archetype of entry.profile.archetypes) {
            commitment.set(
                archetype,
                (commitment.get(archetype) ?? 0) + weight
            );
        }
    }

    // Candidate-declared order, strict `>` — the winner is a pure function of
    // the profile data, never of Map iteration order.
    let bestArchetype: string | null = null;
    let bestUnits = 0;
    for (const archetype of profile.archetypes) {
        const units = commitment.get(archetype) ?? 0;
        if (units > bestUnits) {
            bestUnits = units;
            bestArchetype = archetype;
        }
    }
    if (bestArchetype === null) {
        return emptySynergyTerm(
            "archetypeFit",
            `declares ${profile.archetypes.map((a) => `"${a}"`).join(", ")} — no Pool card shares any of them`
        );
    }

    const archetype = bestArchetype;
    const raw = Math.min(
        ARCHETYPE_FIT_RAW_CAP,
        bestUnits * ARCHETYPE_RATING_PER_UNIT * profileWeight(profile)
    );
    return {
        term: "archetypeFit",
        value: raw,
        rawValue: raw,
        sources: profiled
            .filter((entry) => entry.profile.archetypes.includes(archetype))
            .map((entry) => ({
                cardId: entry.meta.cardId,
                reason: entry.profile.reviewed
                    ? `also "${archetype}"`
                    : `also "${archetype}" (unreviewed — half weight)`,
            })),
        note:
            `${bestUnits.toFixed(1)} Pool card(s) already committed to "${archetype}"` +
            (profile.reviewed
                ? ""
                : " — this card's profile is unreviewed, half weight"),
    };
}

/** One matched Capability between the candidate and one Pool card. */
interface CapabilityMatch {
    cardId: string;
    capability: string;
    /** `provides` = the CANDIDATE provides what the Pool card requires;
     *  `requires` = the candidate requires what the Pool card provides. Both
     *  directions count (ADR 0072: "matching one card's `requires` against
     *  another's `provides`" — the relation is symmetric in value, and a bot
     *  must be able to draft the payoff after the enabler AND the enabler
     *  after the payoff). */
    direction: "provides" | "requires";
    weight: number;
}

/** Capability Fit (ADR 0072 layer 2, issue #1611) — the layer the whole design
 *  exists for. Matches the candidate's `provides` against every profiled Pool
 *  card's `requires`, and its `requires` against their `provides`.
 *
 *  ABSENCE OF A MATCH IS THE VETO, and on ADR 0073's non-negative scale that
 *  veto is spelled "no bonus", never "a subtraction": Animate Dead requires
 *  `reanimatable`; Worldspine Wurm's profile does not list it (the Wurm
 *  shuffles itself out of the graveyard, so it can never be reanimated), so
 *  the pair contributes exactly 0 and the Wurm is simply not advantaged by a
 *  reanimation spell sitting in the Pool. Flash requires `value-on-death`,
 *  which the Wurm DOES provide, so that pair contributes. No negative edge is
 *  authored for the bad pair, and no one has to remember to author one.
 *
 *  Counted per DISTINCT (Pool card, Capability, direction): a Pool holding two
 *  copies of the same enabler does not double the relationship. */
function capabilityFitTerm(
    candidate: CardEvalMeta,
    profile: CardProfile | null,
    profiled: readonly PoolProfileEntry[]
): PickTerm {
    if (!profile) {
        return emptySynergyTerm(
            "capabilityFit",
            "no Card Profile for this card — no Capability to match"
        );
    }
    if (profile.provides.length === 0 && profile.requires.length === 0) {
        return emptySynergyTerm(
            "capabilityFit",
            "profiled, but provides and requires nothing — no Capability to match"
        );
    }

    const candidateWeight = profileWeight(profile);
    // Dedupe the candidate's OWN declared capabilities before iterating: the
    // doc comment above promises counting is per DISTINCT (Pool card,
    // Capability, direction), but iterating a `provides`/`requires` array
    // containing the same capability twice pushed a second `CapabilityMatch`
    // for the same pair — a duplicated entry in an LLM-seeded profile row
    // (issue #1614) would silently double that pair's contribution. `.includes`
    // on the OTHER side's array already collapses duplicates there (a boolean
    // membership check), so only this side needs deduping.
    const provides = [...new Set(profile.provides)];
    const requires = [...new Set(profile.requires)];
    const matches: CapabilityMatch[] = [];
    for (const entry of profiled) {
        if (entry.meta.cardId === candidate.cardId) continue;
        const pairWeight = candidateWeight * profileWeight(entry.profile);
        for (const capability of provides) {
            if (entry.profile.requires.includes(capability)) {
                matches.push({
                    cardId: entry.meta.cardId,
                    capability,
                    direction: "provides",
                    weight: pairWeight,
                });
            }
        }
        for (const capability of requires) {
            if (entry.profile.provides.includes(capability)) {
                matches.push({
                    cardId: entry.meta.cardId,
                    capability,
                    direction: "requires",
                    weight: pairWeight,
                });
            }
        }
    }

    if (matches.length === 0) {
        return emptySynergyTerm(
            "capabilityFit",
            `no Pool card requires what this card provides (${profile.provides.join(", ") || "nothing"}) or provides what it requires (${profile.requires.join(", ") || "nothing"}) — the pair scores nothing, which IS the veto (ADR 0072)`
        );
    }

    const raw = Math.min(
        CAPABILITY_FIT_RAW_CAP,
        matches.reduce(
            (sum, m) => sum + m.weight * CAPABILITY_RATING_PER_MATCH,
            0
        )
    );

    const reasonsByCard = new Map<string, string[]>();
    for (const match of matches) {
        const reason =
            match.direction === "provides"
                ? `requires ${match.capability}, which this card provides`
                : `provides ${match.capability}, which this card requires`;
        const existing = reasonsByCard.get(match.cardId);
        if (existing) existing.push(reason);
        else reasonsByCard.set(match.cardId, [reason]);
    }

    return {
        term: "capabilityFit",
        value: raw,
        rawValue: raw,
        sources: [...reasonsByCard.entries()].map(([cardId, reasons]) => ({
            cardId,
            reason: reasons.join("; "),
        })),
        note: `${matches.length} Capability match(es) with ${reasonsByCard.size} Pool card(s)${profile.reviewed ? "" : " — this card's profile is unreviewed, half weight"}`,
    };
}

/** Combo Edge (ADR 0072 layer 3, issue #1611) — the ESCAPE HATCH, not the
 *  model: explicit, signed, directed pairs for the closed two-card loop no
 *  Capability vocabulary can express (Painter's Servant + Grindstone).
 *  Anything expressible as a Capability must be a Capability.
 *
 *  Edges are read in BOTH directions — the candidate's own edges pointing at
 *  Pool cards, and profiled Pool cards' edges pointing at the candidate — so
 *  a loop only has to be authored once, from whichever end its author found
 *  natural. Weights are in RATING POINTS (ADR 0073's one scale), scaled only
 *  by the authoring row's review weight. Edges to the same partner net
 *  together; the strongest `COMBO_EDGE_MAX_PAIRS` partners by |net weight|
 *  contribute, the rest are dropped.
 *
 *  SIGNED, yet compatible with the non-negative contextual clamp: a negative
 *  edge nets against positive edges INSIDE this term, and the term is floored
 *  at 0. So an authored anti-synergy can cancel a bonus the candidate would
 *  otherwise earn — the one thing it must be able to do — while a candidate
 *  can never be dragged BELOW an unprofiled one, which is what a term with a
 *  structurally-negative reach would do under `clamp(Σ, 0, cap)`: it would be
 *  dead weight on most candidates and a hidden asymmetric penalty on the
 *  rest. */
function comboEdgeTerm(
    candidate: CardEvalMeta,
    profile: CardProfile | null,
    profiled: readonly PoolProfileEntry[]
): PickTerm {
    const netByPartner = new Map<string, number>();
    const addEdge = (partnerCardId: string, weight: number) => {
        netByPartner.set(
            partnerCardId,
            (netByPartner.get(partnerCardId) ?? 0) + weight
        );
    };

    const poolByCardId = new Map(profiled.map((e) => [e.meta.cardId, e]));
    if (profile?.comboEdges) {
        const weight = profileWeight(profile);
        for (const edge of profile.comboEdges) {
            if (!poolByCardId.has(edge.cardId)) continue;
            // Guard against an authored edge weight that is NaN/Infinity
            // (issue #1614 ships the Admin write surface that will let one
            // in — `validateCardProfileFile` today only checks capabilities/
            // cardIds, not this number). The sibling Pick Rating seam
            // (`pickRatings.ts`'s `isValidRating`) rejects a non-finite
            // rating at the SAME layer; a non-finite edge here has no write
            // gate yet, so the READ path must not let it through — an
            // unfiltered NaN/Infinity would propagate into `score` and
            // poison every candidate comparison in `chooseBotPick`.
            if (!Number.isFinite(edge.weight)) continue;
            addEdge(edge.cardId, edge.weight * weight);
        }
    }
    for (const entry of profiled) {
        if (entry.meta.cardId === candidate.cardId) continue;
        const weight = profileWeight(entry.profile);
        for (const edge of entry.profile.comboEdges ?? []) {
            if (edge.cardId !== candidate.cardId) continue;
            if (!Number.isFinite(edge.weight)) continue;
            addEdge(entry.meta.cardId, edge.weight * weight);
        }
    }

    if (netByPartner.size === 0) {
        return emptySynergyTerm(
            "comboEdge",
            "no authored Combo Edge between this card and the Pool"
        );
    }

    // Deterministic selection: strongest |net| first, ties by cardId — never
    // by Map insertion / Pool order, so the same data always picks the same
    // pairs.
    const selected = [...netByPartner.entries()]
        .sort(
            (a, b) =>
                Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0])
        )
        .slice(0, COMBO_EDGE_MAX_PAIRS);
    const net = selected.reduce((sum, [, weight]) => sum + weight, 0);
    const raw = Math.max(0, net);

    return {
        term: "comboEdge",
        value: raw,
        rawValue: raw,
        sources: selected.map(([cardId, weight]) => ({
            cardId,
            reason: `authored Combo Edge ${weight >= 0 ? "+" : ""}${weight.toFixed(2)}`,
        })),
        note:
            `${selected.length} of ${netByPartner.size} authored edge(s) counted (cap ${COMBO_EDGE_MAX_PAIRS}), netting ${net.toFixed(2)}` +
            (net < 0
                ? " — floored at 0: a signed edge may cancel a bonus, never impose a penalty"
                : ""),
    };
}

/** Optional knobs on a single candidate's scoring. */
export interface ScoreCandidateOptions {
    /** Total picks in this draft — the horizon the context cap ramps over
     *  (`contextCapForPick`). Defaults to `DEFAULT_DRAFT_PICKS`. */
    totalPicks?: number;
    /** The seat's TRUE 1-based pick number, when the caller knows it. Defaults
     *  to `poolMeta.length + 1`, which is right whenever the Pool the scorer
     *  sees IS the whole Pool. `chooseBotPick` supplies it explicitly because
     *  it DROPS Pool entries the card registry can't resolve: an unresolvable
     *  card is still a pick the seat made, so deriving the pick number from
     *  the filtered Pool would under-count it and hand the seat an earlier
     *  pick's (smaller) contextual cap. */
    pickNumber?: number;
    /** Layered Card Profile lookup (`cardProfiles.ts`'s
     *  `resolveEventCardProfile`, ADR 0072) — the seam the three synergy terms
     *  read. Omit for "nothing is profiled", in which case Archetype Fit,
     *  Capability Fit and Combo Edge all contribute exactly 0 and the score is
     *  identical to the pre-#1611 scorer's. That is not a degenerate fallback
     *  but the NORMAL case for a set/block environment (ADR 0072: "a scope
     *  with no `cardProfiles` rows and no seed file contributes exactly zero
     *  from these terms"). */
    getCardProfile?: GetCardProfile;
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
 *  The pick number is DERIVED from the Pool (`poolMeta.length + 1`) unless
 *  `options.pickNumber` says otherwise: the contextual cap is a function of
 *  how much deck the seat already has, which is exactly what the Pool
 *  measures. */
export function scoreCandidate(
    candidate: CardEvalMeta,
    poolMeta: readonly CardEvalMeta[],
    rating: number | null = null,
    options: ScoreCandidateOptions = {}
): PickCandidateTrace {
    const pickNumber = options.pickNumber ?? poolMeta.length + 1;
    const contextCap = contextCapForPick(pickNumber, options.totalPicks);

    const base = baseRatingTerm(candidate, rating);
    // One Card Profile lookup per distinct Pool card, shared by all three
    // synergy terms (ADR 0072) — and one for the candidate itself.
    const profiled = poolProfiles(poolMeta, options.getCardProfile);
    const candidateProfile = options.getCardProfile?.(candidate.cardId) ?? null;
    const contextual: PickTerm[] = [
        archetypeFitTerm(candidateProfile, profiled),
        capabilityFitTerm(candidate, candidateProfile, profiled),
        comboEdgeTerm(candidate, candidateProfile, profiled),
        colourCommitmentTerm(candidate, poolMeta),
        castabilityTerm(candidate, poolMeta),
        fixingValueTerm(candidate, poolMeta),
        curveFitTerm(candidate, poolMeta),
    ];

    // One uniform scale over every contextual term, so the CAP binds the SUM
    // (ADR 0073) rather than each term separately — and so the scaled sum is
    // exactly `clamp(rawSum, 0, cap)`, monotone in every raw term. That
    // monotonicity is what the Pick Invariants rest on: a term that should
    // push a candidate up can never push it down through the cap.
    //
    // The clamp's floor is 0, not `-cap`: contextual fit is a BONUS, so the
    // whole contextual half of every candidate's score lives in `[0, cap]` and
    // the gap context can open between two candidates is therefore `cap`
    // itself — the bound ADR 0073 means by "how much may context overturn
    // power". A ±cap clamp bounds each candidate but licenses a `2 × cap`
    // differential. The `rawSum < 0` branch cannot be reached by today's terms
    // (each is non-negative by construction); it is a total definition of the
    // clamp, not a live path — the Pick Invariants assert the floor holds.
    const rawSum = contextual.reduce((sum, t) => sum + t.rawValue, 0);
    const contextScale =
        rawSum > 0 ? Math.min(1, contextCap / rawSum) : rawSum === 0 ? 1 : 0;
    for (const term of contextual) {
        term.value = term.rawValue * contextScale;
        if (contextScale !== 1) {
            // The clamp must be legible off the BREAKDOWN, not just off the
            // trace's summary fields — a reader has to be able to reconstruct
            // the score, cap included, from the terms in front of them.
            term.note += ` — scaled ×${contextScale.toFixed(3)}: the pick-${pickNumber} context cap (${contextCap.toFixed(2)}) clamped a raw contextual sum of ${rawSum.toFixed(2)}`;
        }
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
export interface BotPickOptions extends ScoreCandidateOptions {
    /** See `PacksSeen` — supplied, not yet read. */
    packsSeen: PacksSeen;
    /** Layered Pick Rating lookup (`cardRatings.ts`'s
     *  `resolveEventPickRating`). Omit for "nothing is rated", in which case
     *  every candidate's base term comes from `heuristicAsRating`. */
    getPickRating?: GetPickRating;
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
            pickNumber: options.pickNumber,
            getCardProfile: options.getCardProfile,
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

    // The pick number comes from the UNFILTERED Pool: a Pool card the registry
    // can't resolve contributes nothing to the contextual TERMS (it is dropped
    // above) but it is still a pick the seat made, so it must still advance the
    // contextual cap. Deriving the pick number from `poolMeta` instead would
    // let the filter and the derivation disagree.
    const traces = scorePack(pack, poolMeta, getCardEvalMeta, {
        ...options,
        pickNumber: options.pickNumber ?? pool.length + 1,
    });
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
