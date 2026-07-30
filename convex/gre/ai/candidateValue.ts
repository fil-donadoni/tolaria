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
import type { OpValue, ValueTag } from "./featureBasis";
import type {
    EffectCardFilter,
    EffectCountSpec,
    EffectForEachSelector,
    EffectPlayerRef,
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

// --- Library-search target pricing (CR 701.19) ------------------------------

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

/** Rough latent worth of a card a library search could find (CR 701.19), used
 *  to RANK targets and to feed the `priorFor` seam — never legality. A LAND
 *  is priced against the SEARCHER's own mana development (real board state —
 *  genuinely context-aware), which is what makes a fetchland pick sensible
 *  early and near-irrelevant when flooded; every other card reuses
 *  `prospectiveCardWorth` (OP_VALUERS-driven for a noncreature, issue #1433).
 *  Shared by the `search-library` candidate generator's hint
 *  (`choiceCandidates.ts`, always context-free — a structural hint, not the
 *  final ordering score) AND the DSL `priorFor` provider (`choicePriors.ts`,
 *  which passes a real `contextAwareGrounding` — issue #1433 review finding
 *  2) so the two never drift apart on WHICH function they call, only on
 *  which `ctx` they ground it with. */
export function libraryTargetWorth(
    state: GameState,
    searcherId: string,
    card: CardInstanceState,
    ctx?: GroundingContext
): number {
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
 *  uses for those (documented "unresolvable pre-cast", not a wrong answer). */
function resolveForEachCountAgainstBoard(
    state: GameState,
    perspectivePlayerId: string,
    select: EffectForEachSelector
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
            return cards.filter((c) => matchesCountFilter(c, select.filter))
                .length;
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
 *  `kickerCount`/`kickerPaid`/`escaped`/`abilityResolutionCount` all need an announced
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
    // counters / kickerCount / kickerPaid — an object-scoped read with no bound
    // object or announced kicker pre-cast, same as `ref`/`manaValue`/`domain`
    // below. MUST mirror `contextFreeGrounding`'s floor (its
    // counters/kickerCount/kickerPaid branch falls through to
    // `CF_ASSUMED_REF`): a context-aware zero here priced a "damage equal to
    // charge counters" card at nothing in a tutor prior, strictly LESS informed
    // than the context-free floor it is supposed to refine (issue #1520).
    if ("counters" in v || "kickerCount" in v || "kickerPaid" in v)
        return CF_ASSUMED_REF_FALLBACK;
    if ("escaped" in v || "abilityResolutionCount" in v) return 1;
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
    // ref / manaValue / domain — object- or player-scoped reads with no
    // resolvable object/announcement pre-cast.
    return CF_ASSUMED_REF_FALLBACK;
}

/** The FIRST production caller of `contextAwareGrounding` (issue #1433
 *  review finding 2 — it shipped with zero callers). Grounds the `priorFor`
 *  seam's OP_VALUERS reads against the REAL `GameState` at a live choice
 *  node, from `perspectivePlayerId`'s point of view (the player who will
 *  end up with the card — the searcher at a `search-library` node, the
 *  discarder at a `may-pay` node). A `count`-scaled script ("damage equal to
 *  the number of creatures you control") now prices differently on an empty
 *  board vs. a crowded one, which `contextFreeGrounding`'s representative-1
 *  floor can never distinguish. */
export function contextAwareGroundingForChoice(
    state: GameState,
    perspectivePlayerId: string
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
            resolveForEachCountAgainstBoard(state, perspectivePlayerId, select),
    });
}
