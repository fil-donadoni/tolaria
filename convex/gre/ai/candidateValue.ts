// Shared "worth of a card" reads for the choice-node seam (PRD #1423, issue
// #1425). Both the per-kind candidate generator's structural hints
// (`choiceCandidates.ts`) and the DSL `priorFor` provider (`choicePriors.ts`,
// issue #1433) score a card through the SAME functions here, so a
// candidate's `hint` (what the prior seam is told) and the prior itself never
// drift apart — one source, read by both.
//
// A creature — on the battlefield OR still prospective in hand/library — is
// scored by `permanentWorth`: live EFFECTIVE P/T (CR 613, the layer system),
// genuinely context-aware by construction. A noncreature is scored through
// OP_VALUERS' per-Op value model (PRD #1423, issue #1426): a card WITH a real
// `effects[]`/`aiEffects` script is valued by what it actually DOES (a burn
// spell outranks a cantrip outranks a do-nothing enchantment) — issue #1433's
// fix for the bug class "every noncreature priced flat at 30" (a tutor used
// to rank a 3/3 body above a real removal/ramp spell). A card with NEITHER a
// real nor a shadow script floors at the v1 flat prior — the documented
// fallback for "no Op maps" (issue #1433's acceptance criterion), covering
// pre-DSL `resolve()` / `effect`-shorthand cards the migration hasn't reached
// (e.g. Black Lotus's mana ability, an `effect:` shorthand).

import type { CardInstanceState, GameState } from "../state";
import { getOpponentId, getPlayer } from "../state";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { tryGetDefinition } from "../../cards";
import {
    dslLatentAbilityScriptOpValue,
    dslSpellScriptOpValue,
} from "./cardScriptValue";
import { contextAwareGrounding, type GroundingContext } from "./grounding";
import {
    hasGraveyardRecursionAccess,
    isSelfReachableInGraveyard,
    latentGraveyardValue,
} from "./graveyardReach";
import type { SearchFindDestination } from "./searchDestination";
import type { OpValue, ValueTag } from "./featureBasis";
import type {
    EffectCardFilter,
    EffectCountSpec,
    EffectForEachSelector,
    EffectPlayerRef,
    EffectScaledOperand,
    EffectValue,
} from "../../cards/types";

/** Rough board worth of a permanent — used to order sacrifice/discard
 *  victims AND search-library leads. Deliberately local/cheap (P/T based)
 *  rather than the full `evaluate.ts` currency: `gre/ai` must not depend on
 *  `evaluate.ts` (which already depends on this module's siblings). */
export function permanentWorth(
    state: GameState,
    card: CardInstanceState
): number {
    const p = Math.max(0, getEffectivePower(state, card));
    const t = Math.max(0, getEffectiveToughness(state, card));
    return card.types.includes("Creature") ? p * p + t * t + 10 : 20;
}

/** No-script flat floor — the v1 heuristic's flat noncreature prior (issue
 *  #1425), preserved as the honest fallback for a card the DSL layer has NO
 *  opinion on (issue #1433: "heuristics may remain as fallback where no Op
 *  maps"). Issue #1513: this floor must NEVER be applied to a card that DOES
 *  carry a real/shadow script — doing so flattened every sub-90-Forge-point
 *  script (a cantrip, a scry spell) to the same worth as a do-nothing card,
 *  silently reintroducing the "every noncreature priced flat" bug class
 *  #1433 was built to remove. A scripted card is ordered by its OWN value,
 *  full stop — see `noncreatureCardWorth` below. */
const NONCREATURE_FLOOR = 30;

/** Rescales OP_VALUERS' Forge-scale points (`opValuers.ts`'s currency — a
 *  representative burn spell ≈ 66-110, `DESTROY_VALUE` = 160) onto this
 *  module's smaller "board-worth" currency (`permanentWorth`'s scale — a 2/2
 *  ≈ 18, a 6/4 ≈ 62), so a mixed creature/noncreature candidate pool ranks on
 *  ONE consistent scale rather than two incompatible ones (issue #1433). */
const NONCREATURE_SCRIPT_SCALE = 1 / 3;

/** Merges two `OpValue`s: points summed, tags unioned (dedup) — the local
 *  sibling of `cardScriptValue.ts`'s private helper of the same shape,
 *  needed here to combine a NONCREATURE's spell script with its ability
 *  scripts (two different sites `cardScriptValue.ts` never itself merges). */
function mergeOpValue(a: OpValue, b: OpValue): OpValue {
    const tags = new Set<ValueTag>([...a.tags, ...b.tags]);
    return { points: a.points + b.points, tags: [...tags] };
}

/** The registry-derived Op-valued script (`{ points, tags }`) of a card
 *  instance's DEFINITION, under a given grounding context — `undefined` for
 *  an unregistered id or a card with no script ANYWHERE on it. Merges the
 *  card's SPELL script (`dslSpellScriptOpValue`) with its (latent-discounted)
 *  ABILITY scripts (`dslLatentAbilityScriptOpValue`) — issue #1433 review
 *  finding 1: an ability-only noncreature (Nevinyrral's Disk, Icy
 *  Manipulator, Royal Assassin) carries no `effects[]` of its own, only an
 *  activated/triggered ability's, so reading the spell site alone silently
 *  floors it at the v1 flat prior and hides its `boardRemoval`/`targeted`
 *  tags from a context-aware reader (`contextAwareRemovalBonus`,
 *  `choicePriors.ts`). Reads the definition off the card's registry id,
 *  never the (wire-strippable) fat `card.card` blob. Exposed so a
 *  context-aware caller (the `priorFor` seam) can read the TAGS without
 *  re-deriving them. */
export function scriptOpValueOf(
    card: CardInstanceState,
    ctx?: GroundingContext
): OpValue | undefined {
    const defId = (card.card as { id?: string }).id;
    if (!defId) return undefined;
    const def = tryGetDefinition(defId);
    if (!def) return undefined;
    const spell = dslSpellScriptOpValue(def, ctx);
    const ability = dslLatentAbilityScriptOpValue(def, ctx);
    if (!spell) return ability;
    if (!ability) return spell;
    return mergeOpValue(spell, ability);
}

/** Latent worth of a NONCREATURE hand/library card (issue #1433's fix for the
 *  "every noncreature priced flat at 30" bug class): the OP_VALUERS
 *  spell-script PLUS ability-script value (context-free by default — the
 *  card's worth before it's cast; a context-aware caller passes its own
 *  `GroundingContext`) when the card has a real/shadow script anywhere on
 *  it, rescaled onto this module's currency. Issue #1513: the floor is the
 *  NO-SCRIPT fallback ONLY — a scripted card is never clamped up to it, so a
 *  66-Forge-point burn spell, a 45-point cantrip and a 10-point scry-only
 *  spell stay strictly ordered by their OWN value instead of all collapsing
 *  to the same worth as an unscripted card the moment their rescaled value
 *  dips below the floor (every real script here was previously
 *  indistinguishable from a do-nothing card below the 90-Forge-point line —
 *  `NONCREATURE_FLOOR / NONCREATURE_SCRIPT_SCALE`). */
export function noncreatureCardWorth(
    card: CardInstanceState,
    ctx?: GroundingContext
): number {
    const scripted = scriptOpValueOf(card, ctx);
    if (!scripted) return NONCREATURE_FLOOR;
    return scripted.points * NONCREATURE_SCRIPT_SCALE;
}

/** Latent worth of a prospective card (hand/library — not yet in play):
 *  creatures reuse `permanentWorth` (off the battlefield, `getEffectivePower`
 *  degrades to the definition's base stats); noncreatures reuse
 *  `noncreatureCardWorth`. `ctx` (issue #1433 review finding 2), when passed,
 *  threads a CONTEXT-AWARE grounding through to the noncreature's script
 *  read — ignored for a creature (`permanentWorth` is already genuinely
 *  context-aware by construction, live effective P/T). */
export function prospectiveCardWorth(
    state: GameState,
    card: CardInstanceState,
    ctx?: GroundingContext
): number {
    return card.types.includes("Creature")
        ? permanentWorth(state, card)
        : noncreatureCardWorth(card, ctx);
}

// --- Library-search target pricing (CR 701.23) ------------------------------

/** Lands in play at which searching up ANOTHER land stops being development
 *  and starts being flood (a rough Forge-style curve point). Below it a
 *  fetched land outranks a small creature; at or above it, it is nearly
 *  worthless. */
const LAND_SEARCH_SATURATION = 5;

/** Worth of a fetched LAND at zero lands in play, decaying `LAND_SEARCH_STEP`
 *  per land already on the battlefield until `LAND_SEARCH_SATURATION`. */
const LAND_SEARCH_BASE = 70;
const LAND_SEARCH_STEP = 10;
const LAND_SEARCH_FLOODED = 20;

// --- Graveyard-bound finds (issue #3041) -----------------------------------
//
// A find is worth what it is worth IN THE ZONE THE EFFECT PUTS IT, and for
// every destination but one that is the same question this module already
// answered: a card going to hand or the battlefield is about to be cast or is
// about to be a permanent, so its prospective/fetch-curve worth IS its worth.
// A card going to a GRAVEYARD is a different question entirely, and pricing it
// with the hand answer is what made Entomb fetch a dual land: the land's
// fetch-curve worth (~70 at a low land count) beat every reanimation target's
// prospective worth, and the generator's top-K admission — which ranks by this
// same function — could drop the reanimation target out of the answer set
// altogether, so no amount of reward could correct it.
//
// The worth of a card in a graveyard is `graveyardReach.ts`'s question, already
// answered there for the leaf evaluator's `graveyardReach` term (issue #3042)
// and reused verbatim here rather than re-derived: a graveyard is a DEAD ZONE
// by default, and a card in it earns credit only to the extent its owner can
// actually reach it — recursion they hold or control, or the card being usable
// out of the graveyard on its own. No card names, no archetype classifier
// (ADR 0102).

/** Rescales `latentGraveyardValue`'s Forge-scale points (`cardValueById`'s
 *  currency — the same scale `OP_VALUERS` uses) onto this module's smaller
 *  board-worth currency, exactly as {@link NONCREATURE_SCRIPT_SCALE} does for a
 *  noncreature's script value, so a graveyard-bound candidate pool ranks on the
 *  SAME scale as every other candidate pool. */
const GRAVEYARD_FIND_SCALE = NONCREATURE_SCRIPT_SCALE;

/** How much of a reachable card's latent worth survives the trip through a
 *  graveyard. Strictly less than 1: getting it back costs the recursion card
 *  and the mana to run it, neither of which this pricing models.
 *
 *  Together with its unreachable twin below, this pair is the ORDERING
 *  mechanism, not a uniform scale factor: `isSelfReachableInGraveyard` is a
 *  PER-CARD predicate, so two finds in one node can sit on different sides of
 *  the 0.6-vs-0.05 split. That is exactly what makes a self-reachable card
 *  outrank a much larger one that nothing can return. */
const GRAVEYARD_REACHABLE_FRACTION = 0.6;

/** …and how little survives when nothing can reach the card in a graveyard.
 *  Near-floor rather than exactly zero on purpose: at zero every unreachable
 *  find ties, and the generator's top-K admission would then keep whichever
 *  identities sort first alphabetically. Burying into a graveyard nobody can
 *  spend genuinely is low-value — the ranking should say so — but it should
 *  still say WHICH low-value card it would bury, so the ordering among them
 *  stays their own. */
const GRAVEYARD_UNREACHABLE_FRACTION = 0.05;

/** Worth of a find that the source effect puts into a graveyard.
 *
 *  WHOSE graveyard is CR 400.7's question, not the searcher's: a card put into
 *  a graveyard goes to its OWNER's. So reachability is read against
 *  `card.ownerId`, which for every shipped search is the searcher anyway
 *  (all 51 are `player: "controller"`) but is the correct player by rule rather
 *  than by coincidence — reading the searcher would, on a "search target
 *  opponent's library and bury it" card, scan the BOT's hand for recursion that
 *  would serve the opponent. What that card would additionally need is a
 *  SIGN flip (a reachable card in the opponent's graveyard is bad for the bot),
 *  and no such card exists to calibrate one against; the four cross-player
 *  searches in the catalogue all move to exile, never a graveyard.
 *
 *  Both reach shapes come from `graveyardReach.ts`, the single authority:
 *  `hasGraveyardRecursionAccess` (the player holds/controls something that pulls
 *  a card back out) and `isSelfReachableInGraveyard` (the card is castable or
 *  activatable from there on its own). The latter's precondition is normally
 *  "the card is in `player.graveyard`" — here it is asked HYPOTHETICALLY, of a
 *  card still in the library, which is exactly the question the pricing needs
 *  ("if I bury this, can I use it?") and which the predicate answers off the
 *  same printed-mechanism + battlefield-permission reads either way.
 *
 *  `recursionAccess`, when supplied, is the caller's already-computed
 *  `hasGraveyardRecursionAccess` for this node. That predicate is PLAYER-level
 *  and node-invariant while the per-card `isSelfReachableInGraveyard` is not, so
 *  recomputing it per pool card made a graveyard-bound node 3.6x the cost of a
 *  hand-bound one (measured on a 56-card library in review of PR #3077:
 *  0.575 ms vs 0.160 ms per `choiceCandidates` call). Omitted, it is computed
 *  here — the answer is identical either way.
 *
 *  A land needs no carve-out and gets none: its latent worth is
 *  `NONCREATURE_BASE` (8 Forge points — `cardValue.ts`), so it prices at the
 *  floor by VALUE, while a fat reanimation target prices far above it. That is
 *  the fix — the land fetch curve simply never applies to a zone where a land
 *  produces no mana. */
function graveyardFindWorth(
    state: GameState,
    card: CardInstanceState,
    recursionAccess?: { playerId: string; hasAccess: boolean }
): number {
    // CR 400.7 — the card lands in its OWNER's graveyard.
    const owner = getPlayer(state, card.ownerId);
    const recursion =
        recursionAccess && recursionAccess.playerId === owner.id
            ? recursionAccess.hasAccess
            : hasGraveyardRecursionAccess(owner);
    const reachable =
        recursion || isSelfReachableInGraveyard(state, owner, card);
    const fraction = reachable
        ? GRAVEYARD_REACHABLE_FRACTION
        : GRAVEYARD_UNREACHABLE_FRACTION;
    return latentGraveyardValue(card) * GRAVEYARD_FIND_SCALE * fraction;
}

/** The player-level half of {@link graveyardFindWorth}'s reachability gate,
 *  hoisted so a caller pricing a whole pool pays it ONCE (see that function's
 *  `recursionAccess` note). Exported rather than inlined at each call site so
 *  the hoisted read and the fallback inside the pricing can never be two
 *  different predicates. Cheap no-op for a non-graveyard destination — the
 *  caller skips it, and the pricing never asks. */
export function graveyardRecursionAccessFor(
    state: GameState,
    playerId: string
): { playerId: string; hasAccess: boolean } {
    return {
        playerId,
        hasAccess: hasGraveyardRecursionAccess(getPlayer(state, playerId)),
    };
}

/** What the caller has already worked out about THIS search node, shared by
 *  both consumers so they can never price the same node differently. Both
 *  fields are node-invariant — one derivation per node, not one per pool card
 *  (see {@link graveyardFindWorth}'s `recursionAccess` note for the measured
 *  reason the second field exists). An absent `pricing`, or an absent
 *  `destination` inside it, is the documented "cannot derive" fallback and
 *  prices exactly as this function did before issue #3041. */
export type SearchPricing = {
    /** Zone the source effect moves the find to (`searchFindDestination`). */
    destination?: SearchFindDestination;
    /** A `hasGraveyardRecursionAccess` answer the caller already computed,
     *  CARRYING THE PLAYER IT IS ABOUT. The player is not decoration: the
     *  hoisted value is the LIBRARY's owner while the reach question is about
     *  the found card's OWNER (CR 400.7), and those two coincide for every
     *  shipped search but are not the same thing. Pricing uses the hint only
     *  when the ids match and recomputes otherwise, so the optimisation can
     *  never change an answer. */
    recursionAccess?: { playerId: string; hasAccess: boolean };
};

/** Rough latent worth of a card a library search could find (CR 701.23), used
 *  to RANK targets and to feed the `priorFor` seam — never legality. Priced
 *  against the zone the source effect actually PUTS the find in (issue #3041),
 *  derived generically from that source's own Effect Script by
 *  `searchFindDestination` and passed in by the caller:
 *
 *  - `"graveyard"` — {@link graveyardFindWorth}, gated on reachability.
 *  - every other destination, AND an undeterminable one (`undefined` — an
 *    imperative `resolve()` tutor, an unusual script shape) — unchanged: a LAND
 *    is priced against the SEARCHER's own mana development (real board state —
 *    genuinely context-aware), which is what makes a fetchland pick sensible
 *    early and near-irrelevant when flooded; every other card reuses
 *    `prospectiveCardWorth` (OP_VALUERS-driven for a noncreature, issue #1433).
 *
 *  Shared by the `search-library` candidate generator's hint
 *  (`choiceCandidates.ts`, always context-free — a structural hint, not the
 *  final ordering score) AND the DSL `priorFor` provider (`choicePriors.ts`,
 *  which passes a real `contextAwareGrounding` — issue #1433 review finding
 *  2) so the two never drift apart on WHICH function they call, only on
 *  which `ctx` they ground it with. Both pass the SAME derived destination, so
 *  fixing the pricing here fixes the generator's top-K ADMISSION and the
 *  prior's ORDERING by construction — the admission half is the one a
 *  prior-only fix cannot reach (a graveyard-relevant find in a 50-card library
 *  can be pruned out of the answer set entirely, and then no reward corrects
 *  it). */
export function libraryTargetWorth(
    state: GameState,
    searcherId: string,
    card: CardInstanceState,
    ctx?: GroundingContext,
    pricing?: SearchPricing
): number {
    if (pricing?.destination === "graveyard")
        return graveyardFindWorth(state, card, pricing.recursionAccess);
    if (!card.types.includes("Land"))
        return prospectiveCardWorth(state, card, ctx);
    const lands = getPlayer(state, searcherId).battlefield.filter((c) =>
        c.types.includes("Land")
    ).length;
    return lands >= LAND_SEARCH_SATURATION
        ? LAND_SEARCH_FLOODED
        : LAND_SEARCH_BASE - LAND_SEARCH_STEP * lands;
}

// --- Context-aware grounding for a live choice node (issue #1433 review) ---
//
// `grounding.ts` ships TWO grounding modes but, before this fix, only
// `contextFreeGrounding` had a production caller — `contextAwareGrounding`
// existed with zero callers anywhere in `gre/`. This section is that first
// caller: it wires `ContextAwareResolvers` to the REAL `GameState` at a
// choice node, so a script whose magnitude depends on live board state (a
// `count`-scaled amount — "damage equal to the number of creatures you
// control") ranks correctly against the ACTUAL board instead of the
// context-free representative-1 floor. Deliberately narrow, not a full
// `matchesCardFilter` port: only the reads that are genuinely resolvable for
// a card that HASN'T been cast yet (no announced target, no bound object, no
// chosen X) are grounded against real state; everything else falls back to
// the same representative magnitude `contextFreeGrounding` already uses —
// documented per-branch below.

/** Representative fallbacks for a `forEach`/value read that genuinely cannot
 *  be resolved against real state at a choice node (a `bound` list, the
 *  announced-`targets` set, an unresolvable `X`/`ref` — none exist before
 *  the card is cast). Mirror `grounding.ts`'s `CF_ASSUMED_*` constants; not
 *  imported directly to keep this module's dependency on `grounding.ts`
 *  limited to the `GroundingContext`/`contextAwareGrounding` surface it
 *  actually calls. */
const CF_ASSUMED_COUNT_FALLBACK = 1;
const CF_ASSUMED_X_FALLBACK = 2;
const CF_ASSUMED_REF_FALLBACK = 2;

/** Resolves a fixed `EffectPlayerRef` ("controller" / "opponent") from
 *  `perspectivePlayerId`'s point of view. Every other ref shape
 *  ({target}/{controllerOf}/ref) needs an announced target or a bound
 *  object neither of which exists for a card that hasn't been cast —
 *  `undefined` signals "unresolvable", not "no player". */
function resolveFixedPlayerRef(
    state: GameState,
    perspectivePlayerId: string,
    ref: EffectPlayerRef
): string | undefined {
    if (ref === "controller") return perspectivePlayerId;
    if (ref === "opponent") return getOpponentId(state, perspectivePlayerId);
    return undefined;
}

/** Minimal card-filter match for a live board/graveyard count (issue #1433
 *  review finding 2) — type / excludeType / subtype ANDed, mirroring
 *  `EffectCardFilter`'s AND-of-fields / OR-within-field semantics
 *  (`interpreter.ts`'s `matchesCardFilter`). Deliberately narrower than the
 *  interpreter's full matcher: `name` (needs a `nameCard` binding),
 *  `manaValueAtMost`/`manaValueEquals` with a DYNAMIC `{ X: true }` (needs a
 *  chosen X), and `hasCounter` on a hand/library-adjacent shape are not
 *  resolvable pre-cast either way — this is a best-effort ORDERING read for
 *  the choice-node prior, never a legality check, so failing a dimension it
 *  can't evaluate closed (no match) is an acceptable, documented narrowing
 *  rather than a silent wrong answer. */
function matchesCountFilter(
    card: { types: readonly string[]; subtypes: readonly string[] },
    filter: EffectCardFilter | undefined
): boolean {
    if (!filter) return true;
    if (filter.any) {
        return filter.any.some((clause) => matchesCountFilter(card, clause));
    }
    const asArray = <T>(v: T | T[] | undefined): T[] | undefined =>
        v === undefined ? undefined : Array.isArray(v) ? v : [v];
    const types = asArray(filter.type);
    if (types && !types.some((t) => card.types.includes(t))) return false;
    const excludeTypes = asArray(filter.excludeType);
    if (excludeTypes && excludeTypes.some((t) => card.types.includes(t)))
        return false;
    const subtypes = asArray(filter.subtype);
    if (subtypes && !subtypes.some((s) => card.subtypes.includes(s)))
        return false;
    // manaValueAtMost/manaValueEquals/supertype/color/hasCounter/name: not
    // evaluated here (see doc comment) — a filter naming ONLY these fields
    // still matches on type/subtype alone, matching this reader's "best
    // effort" scope rather than failing closed on a dimension it never
    // claimed to support.
    return true;
}

/** The cards `spec.zone` names in ONE player's zone — EXHAUSTIVE over
 *  `EffectCountSpec["zone"]`, and the `never` default is the whole point. The
 *  permissive ternary this replaces (`zone === "battlefield" ? battlefield :
 *  graveyard`) FAILED OPEN on every zone member added after it was written:
 *  `zone: "library"` (issue #783) silently read the GRAVEYARD, i.e. a wrong
 *  bot valuation with nothing to catch it. A future zone member must now break
 *  the BUILD here instead. */
function countZoneCardsFor(
    state: GameState,
    playerId: string,
    zone: EffectCountSpec["zone"]
): readonly CardInstanceState[] {
    const player = getPlayer(state, playerId);
    switch (zone) {
        case "battlefield":
            return player.battlefield;
        case "graveyard":
            return player.graveyard;
        // CR 401 (issue #783) — a library count is a pure CARDINALITY read (the
        // validator rejects a `filter` there), so the pile size IS the count.
        case "library":
            return player.library;
        // CR 402 (issue #2006) — the hand is the library's twin here: hidden
        // zone, public SIZE, validator rejects a `filter`, so the pile size IS
        // the count. Dark Suspicions' "the number of cards in that player's
        // hand".
        //
        // What this reads is the pile's CARDINALITY, not real identities, and
        // that distinction is the whole reason it leaks nothing. Server-side
        // the pile happens to hold the real cards; in a CLIENT-side engine run
        // (the vs-AI Brain, ADR 0074) it is the rehydrated wire view, where a
        // non-viewer's hand is a run of opaque placeholders padded to the wire
        // length by `projectedToGameState` (`src/lib/ai/state-adapter.ts`).
        // Both give the same COUNT — which is exactly what a hand-size read is
        // entitled to (CR 402.2) and all it may ever use. That padding is load-
        // bearing: before it existed the adapter dropped the nulled hand
        // entirely and every client-side hand-size read returned 0.
        case "hand":
            return player.hand;
        default: {
            const exhaustive: never = zone;
            return exhaustive;
        }
    }
}

/** One player's `spec` count (CR 122), before the `times` multiplier. Shared by
 *  every scope branch of `resolveCountSpecAgainstBoard` so they can never
 *  disagree about what "the count" means. */
function countSpecForPlayer(
    state: GameState,
    playerId: string,
    spec: EffectCountSpec
): number {
    const matching = countZoneCardsFor(state, playerId, spec.zone).filter((c) =>
        matchesCountFilter(c, spec.filter)
    );
    // Delirium (CR 205) — distinct card TYPES among graveyard cards, not cards.
    return spec.zone === "graveyard" && spec.countTypes
        ? new Set(matching.flatMap((c) => c.types)).size
        : matching.length;
}

/** Real cardinality of `spec` (CR 122 counting, `EffectCount`'s `{ count }`
 *  construct) against the LIVE board — the genuinely context-aware read
 *  `contextFreeGrounding` can only approximate at a representative 1.
 *
 *  Every scope member of `EffectCountSpec` is threaded explicitly: an
 *  unhandled one used to fall through to the single-player branch and read the
 *  PERSPECTIVE player's zone, which answers a DIFFERENT question rather than
 *  admitting it can't answer this one. */
function resolveCountSpecAgainstBoard(
    state: GameState,
    perspectivePlayerId: string,
    spec: EffectCountSpec
): number {
    const times = spec.times ?? 1;
    // CR 122 — "in all graveyards" (Accumulated Knowledge, issue #985): SUM
    // every player's count. The graveyard+countTypes shape unions the TYPES
    // across players instead (four types split over two graveyards is four,
    // not eight).
    if (spec.acrossAllPlayers) {
        if (spec.zone === "graveyard" && spec.countTypes) {
            const types = new Set<string>();
            for (const p of state.players) {
                for (const c of countZoneCardsFor(state, p.id, spec.zone)) {
                    if (matchesCountFilter(c, spec.filter))
                        for (const t of c.types) types.add(t);
                }
            }
            return times * types.size;
        }
        return (
            times *
            state.players.reduce(
                (sum, p) => sum + countSpecForPlayer(state, p.id, spec),
                0
            )
        );
    }
    // CR 122 (issue #783) — the SMALLEST per-player count: `acrossAllPlayers`'
    // MIN sibling, and exactly "SOME player's zone has N or fewer cards"
    // (Shelldock Isle's "if a library has twenty or fewer cards in it").
    // Mirrors `countSet`'s branch in the interpreter (`gre/effects/
    // interpreter.ts`) — `controller` is absent in this mode, so falling
    // through below silently priced the perspective player's own zone.
    if (spec.smallestAcrossPlayers) {
        const sizes = state.players.map((p) =>
            countSpecForPlayer(state, p.id, spec)
        );
        return times * (sizes.length > 0 ? Math.min(...sizes) : 0);
    }
    const pid = spec.controller
        ? (resolveFixedPlayerRef(state, perspectivePlayerId, spec.controller) ??
          perspectivePlayerId)
        : perspectivePlayerId;
    return times * countSpecForPlayer(state, pid, spec);
}

/** Real member count of `select` (`EffectForEachSelector`) against the LIVE
 *  board. `bound`/`targets` selectors need a resolution-time binding or an
 *  announced target that doesn't exist for a card that hasn't been cast —
 *  falls back to the SAME representative-1 magnitude `contextFreeGrounding`
 *  uses for those (documented "unresolvable pre-cast", not a wrong answer).
 *  `sourceId`, when given, honours `select.excludeSource` (issue #1957) the
 *  same way the interpreter's forEach-permanents branch does
 *  (`interpreter.ts`): applied AFTER `filter`/`controller` narrow the
 *  candidate set, a no-op when the source isn't itself among the matches —
 *  which is always true for the current caller (a pre-cast library/hand
 *  candidate is never on the battlefield yet), so leaving it `undefined`
 *  reproduces today's count exactly. */
function resolveForEachCountAgainstBoard(
    state: GameState,
    perspectivePlayerId: string,
    select: EffectForEachSelector,
    sourceId?: string
): number {
    switch (select.set) {
        case "players":
            return state.players.length;
        case "permanents": {
            const pid = select.controller
                ? resolveFixedPlayerRef(
                      state,
                      perspectivePlayerId,
                      select.controller
                  )
                : undefined;
            const cards = pid
                ? getPlayer(state, pid).battlefield
                : state.players.flatMap((p) => p.battlefield);
            const matched = cards.filter((c) =>
                matchesCountFilter(c, select.filter)
            );
            return select.excludeSource && sourceId
                ? matched.filter((c) => c.id !== sourceId).length
                : matched.length;
        }
        case "graveyard": {
            const pid = select.controller
                ? resolveFixedPlayerRef(
                      state,
                      perspectivePlayerId,
                      select.controller
                  )
                : undefined;
            const cards = pid
                ? getPlayer(state, pid).graveyard
                : state.players.flatMap((p) => p.graveyard);
            return cards.filter((c) => matchesCountFilter(c, select.filter))
                .length;
        }
        case "bound":
        case "targets":
            return CF_ASSUMED_COUNT_FALLBACK;
    }
}

/** Real magnitude of `v` (`EffectValue`) against the LIVE board where that is
 *  genuinely resolvable pre-cast (`count` — CR 122 counting), representative
 *  fallback everywhere else (an `X`/`ref`/`counters`/`manaValue`/`domain`/
 *  `kickerCount`/`additionalCostPaid`/`escaped`/`abilityResolutionCount` all need an announced
 *  cast, a bound object, or a resolving stack item — none exist for a card
 *  still in a hidden zone at a choice node). */
function resolveValueAgainstBoard(
    state: GameState,
    perspectivePlayerId: string,
    v: EffectValue
): number {
    if (typeof v === "number") return v;
    if ("count" in v)
        return resolveCountSpecAgainstBoard(
            state,
            perspectivePlayerId,
            v.count
        );
    if ("X" in v) return CF_ASSUMED_X_FALLBACK;
    // counters / kickerCount / additionalCostPaid — an object-scoped read with no bound
    // object or announced kicker pre-cast, same as `ref`/`manaValue`/`domain`
    // below. MUST mirror `contextFreeGrounding`'s floor (its
    // counters/kickerCount/additionalCostPaid branch falls through to
    // `CF_ASSUMED_REF`): a context-aware zero here priced a "damage equal to
    // charge counters" card at nothing in a tutor prior, strictly LESS informed
    // than the context-free floor it is supposed to refine (issue #1520).
    if ("counters" in v || "kickerCount" in v || "additionalCostPaid" in v)
        return CF_ASSUMED_REF_FALLBACK;
    if ("escaped" in v || "abilityResolutionCount" in v) return 1;
    // sacrificed (issue #2375) — the cost-sacrificed permanent's mana value /
    // power (CR 601.2f / 608.2h). No such permanent exists at a pre-cast
    // choice node, so the READ takes the same floor as the object-scoped reads
    // above; the `plus` LITERAL is static and is added on top. MUST mirror
    // `contextFreeGrounding`'s own `sacrificed` branch — a floor here that
    // dropped `plus` would be strictly LESS informed than the context-free
    // estimate it is supposed to refine (issue #1520).
    if ("sacrificed" in v) {
        return CF_ASSUMED_REF_FALLBACK + (v.sacrificed.plus ?? 0);
    }
    // lifeGainedThisTurn (CR 119.3, issue #1457) — a per-turn tally genuinely
    // resolvable off the live board, unlike the object-scoped reads below.
    // Only the `"controller"` selector is resolvable pre-cast (the caster IS
    // the perspective player); an `opponent` / announced-slot / ref selector
    // needs an announcement that doesn't exist yet at a choice node.
    if ("lifeGainedThisTurn" in v) {
        return v.lifeGainedThisTurn.of === "controller"
            ? (state.lifeGainedThisTurn?.[perspectivePlayerId] ?? 0)
            : CF_ASSUMED_REF_FALLBACK;
    }
    // difference (issue #2006) — both operands are terminals (a literal or a
    // `count`), and a `count` is exactly the member this function already
    // resolves genuinely against the live board, so the whole difference is
    // resolvable pre-cast. CR 107.1b: the result may be negative, and it is
    // returned SIGNED — the consuming Op's own clamp is what turns "the
    // opponent holds fewer cards than me" into a zero-value effect, and a
    // clamp here would instead price Dark Suspicions as if it always did
    // something.
    if ("difference" in v) {
        const operand = (o: number | { count: EffectCountSpec }): number =>
            typeof o === "number"
                ? o
                : resolveCountSpecAgainstBoard(
                      state,
                      perspectivePlayerId,
                      o.count
                  );
        return operand(v.difference.from) - operand(v.difference.minus);
    }
    // scaled (issue #2366) — a fixed multiplier times a terminal (X, a
    // literal, or a count), all genuinely resolvable pre-cast: `count` is the
    // same board-read `difference` already uses, and X falls back to the same
    // representative `CF_ASSUMED_X_FALLBACK` the bare `X` branch above uses
    // (MUST mirror it, not the generic `CF_ASSUMED_REF_FALLBACK` floor below —
    // the same wrong-magnitude concern `contextFreeGrounding` documents,
    // issue #1520).
    if ("scaled" in v) {
        return (
            resolveScaledOperandAgainstBoard(
                state,
                perspectivePlayerId,
                v.scaled.value
            ) * v.scaled.times
        );
    }
    // divide (issue #2385) — a terminal divided by a fixed divisor, rounded
    // per `rounding`. Both operand shapes (a literal or a `count`) are
    // genuinely resolvable pre-cast, the same board-read `difference`/
    // `scaled` already use.
    if ("divide" in v) {
        const operand = (o: number | { count: EffectCountSpec }): number =>
            typeof o === "number"
                ? o
                : resolveCountSpecAgainstBoard(
                      state,
                      perspectivePlayerId,
                      o.count
                  );
        const quotient = operand(v.divide.value) / v.divide.by;
        return v.divide.rounding === "up"
            ? Math.ceil(quotient)
            : Math.floor(quotient);
    }
    // ref / manaValue / domain — object- or player-scoped reads with no
    // resolvable object/announcement pre-cast.
    return CF_ASSUMED_REF_FALLBACK;
}

/** One operand of a `scaled` value (issue #2366) resolved against the LIVE
 *  board where possible: a literal reads back verbatim, a `count` resolves
 *  genuinely (the same `resolveCountSpecAgainstBoard` `difference` uses), and
 *  `X` falls back to the representative `CF_ASSUMED_X_FALLBACK` — no
 *  announced cast exists yet at a choice node (mirrors the bare-`X` branch of
 *  `resolveValueAgainstBoard`). */
function resolveScaledOperandAgainstBoard(
    state: GameState,
    perspectivePlayerId: string,
    operand: EffectScaledOperand
): number {
    if (typeof operand === "number") return operand;
    if ("X" in operand) return CF_ASSUMED_X_FALLBACK;
    return resolveCountSpecAgainstBoard(
        state,
        perspectivePlayerId,
        operand.count
    );
}

/** The FIRST production caller of `contextAwareGrounding` (issue #1433
 *  review finding 2 — it shipped with zero callers). Grounds the `priorFor`
 *  seam's OP_VALUERS reads against the REAL `GameState` at a live choice
 *  node, from `perspectivePlayerId`'s point of view (the player who will
 *  end up with the card — the searcher at a `search-library` node, the
 *  discarder at a `may-pay` node). A `count`-scaled script ("damage equal to
 *  the number of creatures you control") now prices differently on an empty
 *  board vs. a crowded one, which `contextFreeGrounding`'s representative-1
 *  floor can never distinguish. `sourceId` — the instance id of the card
 *  whose script is being scored — is forwarded to `resolveForEachCount` so a
 *  `permanents` selector's `excludeSource` (issue #1957) is honoured when the
 *  scored card IS a battlefield member (an ability script); omitted by
 *  every current caller, all of which score a pre-cast candidate. */
export function contextAwareGroundingForChoice(
    state: GameState,
    perspectivePlayerId: string,
    sourceId?: string
): GroundingContext {
    return contextAwareGrounding({
        resolveValue: (v) =>
            resolveValueAgainstBoard(state, perspectivePlayerId, v),
        resolveIsSelf: (ref) => {
            if (ref === "controller") return true;
            if (ref === "opponent") return false;
            // {target}/{controllerOf}/ref — no announced target/bound object
            // pre-cast; a card's own effect is, by construction, something
            // its future caster wants to happen (mirrors
            // `contextFreeGrounding`'s "self" default).
            return true;
        },
        resolveForEachCount: (select) =>
            resolveForEachCountAgainstBoard(
                state,
                perspectivePlayerId,
                select,
                sourceId
            ),
    });
}
