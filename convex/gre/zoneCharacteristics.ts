// Off-battlefield characteristics (CR 113.6c) — the single authority on what a
// card's types / subtypes / power / toughness ARE while it sits in a zone other
// than the battlefield.
//
// WHY THIS MODULE EXISTS. The engine has no zone-agnostic characteristics
// accessor: every reader takes whatever it holds and reads `.types` /
// `.subtypes` off it. Those readers split into exactly two families, and a
// zone-conditional ability has to be honoured by both.
//
//   FAMILY A — readers that consult the card REGISTRY for a hidden-zone card,
//   so the printed definition wins over anything on the instance. All of them
//   call `resolveZoneCharacteristics` below:
//     • the five hidden-zone snapshots + the exiled-with scan
//       (`state.ts` `getHandCards` / `getLibraryCards` / `getGraveyardCards` /
//       `getExileCards` / `getCardsExiledWith`) — these feed EVERY Effect
//       Script read of a hidden zone: `matchesCardFilter`
//       (`effects/interpreter.ts`), the `count` construct's graveyard branch,
//       every `choice` candidate list, `moveZone`'s bulk `fromZones` sweep.
//     • `state.ts` `discardAtRandom`'s "a creature card at random" type gate.
//     • `state.ts` `millCards` — the `types` payload on the `CARD_MILLED`
//       event, which is what "if a creature card was milled" triggers read.
//     • `alternativeCost.ts` `handCardMatchesFilter`, the deliberately separate
//       hand-card matcher behind every discard/reveal COST leg (13 call sites
//       across `game.ts`, `moves.ts`, `paymentPicks.ts`, `card-utils.ts`).
//     • `state.ts` `SpellContext.getCharacteristics` and its sibling
//       `SpellContext.isPermanentCard` (issue #3278), reached through the local
//       `typesInZone` helper — the per-target-shape readers of an object's live
//       types/subtypes/name. These back EVERY `bind` snapshot
//       (`effects/interpreter.ts` `bindSnapshot`: SNAP_TYPES / SNAP_SUBTYPES /
//       SNAP_NAME / SNAP_IS_PERMANENT_CARD), so a `boundMatchesFilter` gate
//       reading "was it a creature card" of a card exiled FROM a graveyard
//       (Agatha's Soul Cauldron) resolves here rather than off the printed type
//       line. Their `permanent` shape is deliberately NOT routed: it reads the
//       instance, where the ability is off and the layer system owns `types`.
//
//   FAMILY B — readers that read the INSTANCE's own mutable `types` /
//   `subtypes`. These are covered by `applyZoneCharacteristics`, which
//   materialises the ability onto the instance, so none of them needs to know
//   this module exists: `isCreature` / `isLand` (`gre/constants.ts`) at ~20
//   hidden-zone call sites (`search.ts`, `evaluate.ts`, `ai/candidateValue.ts`,
//   `escape.ts`, `heldInteraction.ts`, `moves.ts`, `activationCostPicks.ts`,
//   `paymentPicks.ts`, `state.ts`'s graveyard-cast and land-play paths), the
//   graveyard branch of `rules.ts` `getLegalTargets` and its `game.ts`
//   `selectTarget` twin, the card-kind checks in `targetFilters.ts`, and — via
//   `projectPublicState`, which passes `types`/`subtypes` through verbatim —
//   the client mirrors `src/lib/graveyard-targets.ts` and
//   `src/lib/card-utils.ts`.
//
// DELIBERATELY EXCLUDED, with reasons:
//   • `cardValue.ts` `cardValueById` — a bot latent-worth heuristic keyed on a
//     bare registry id with no instance and no zone to consult. Nothing to
//     resolve against; a mis-valuation is not a rules error.
//   • `companion.ts` — reads a DECK LIST before the game exists. CR 113.6c does
//     extend outside the game, but the only characteristic it reads is
//     `isLand`, which no shipped zone-conditional ability touches.
//   • `pendingChoiceSubmit.ts`'s name-restriction gate — resolves a chosen NAME
//     to a definition, with no card instance and therefore no zone.
//   • the battlefield itself — by construction. On the battlefield the printed
//     characteristics stand and the layer system (`layers.ts`, `state.ts`'s
//     layer-4 `type-add`) owns them; `applyZoneCharacteristics` never writes to
//     a battlefield card.
//
// NOT A CDA. CR 604.3a(5) excludes an ability that sets characteristics "only
// if certain conditions are met", and a zone is such a condition — so this is
// an ordinary static ability that happens to function outside the battlefield
// under CR 113.6c, NOT a characteristic-defining ability under CR 604.3. The
// difference is behavioural: a CDA would apply on the battlefield too.

import type { CardDefinition, CardType } from "../cards/types";
import {
    declaresOffBattlefieldCharacteristics,
    tryGetDefinition,
} from "../cards/registry";
import type { CardInstanceState, GameState } from "./state";
import type { Zone } from "./types";

/** The characteristics a card has in `zone`, or `null` when its definition
 *  declares no zone-conditional ability (the overwhelmingly common case — the
 *  caller then keeps whatever it already had). Returns `null` on the
 *  battlefield too: CR 113.6c switches the ability OFF there. */
export function resolveZoneCharacteristics(
    def: CardDefinition | null | undefined,
    zone: Zone
): {
    types: CardType[];
    subtypes: string[];
    power: number | undefined;
    toughness: number | undefined;
} | null {
    const spec = def?.offBattlefieldCharacteristics;
    if (!def || !spec || zone === "battlefield") return null;
    // CR 205.1b — "in addition to its other types": additive, and never a
    // duplicate entry (a card already printed as a Creature stays one type).
    const types = [...def.types];
    for (const t of spec.addTypes ?? []) {
        if (!types.includes(t)) types.push(t);
    }
    const subtypes = [...(def.subtypes ?? [])];
    for (const s of spec.addSubtypes ?? []) {
        if (!subtypes.includes(s)) subtypes.push(s);
    }
    return {
        types,
        subtypes,
        power: spec.power ?? def.power,
        toughness: spec.toughness ?? def.toughness,
    };
}

/** Materialises `card`'s zone-conditional characteristics onto the instance so
 *  every FAMILY B reader (see the header) sees them without knowing about this
 *  module. Idempotent and total: it recomputes from the printed definition
 *  every time rather than toggling a previous state, so a card that moves
 *  graveyard → battlefield → graveyard is correct at each step and a call from
 *  a code path added later cannot double-apply.
 *
 *  A no-op for the ~100% of cards with no such ability, for tokens (no
 *  registry definition), and for battlefield permanents — where the printed
 *  characteristics stand and the layer system owns the instance's `types`
 *  (writing here would clobber a layer-4 `type-add`).
 *
 *  Always ASSIGNS fresh arrays rather than mutating in place: several instance
 *  factories (`gre/setup.ts`, `game.ts`, `gre/scenarioBuilder.ts`,
 *  `cards/__tests__/setup.ts`) alias `types` straight to the shared
 *  `CardDefinition.types` array, so an in-place edit would corrupt the
 *  registry catalogue-wide.
 *
 *  HOT: the sweep {@link refreshOffBattlefieldCharacteristics} below calls this
 *  for every card in every hidden zone of both players on every
 *  `checkStateBasedActions` entry, and the bot's search makes ~13k of those
 *  per decision. The `declaresOffBattlefieldCharacteristics` precheck answers
 *  the ~100% "no" case from a string `Set`, before the definition lookup and
 *  its `expandDefinition` memo. It is a pure fast path: the id it reads is the
 *  same one `tryGetDefinition` would take, and the index is written by the
 *  registry's own write funnel, so it can only be stale in the fail-slow
 *  direction (see `cards/registry.ts`). */
export function applyZoneCharacteristics(card: CardInstanceState): void {
    if (card.zone === "battlefield") return;
    const cardId = (card.card as { id?: string }).id;
    if (!cardId || !declaresOffBattlefieldCharacteristics(cardId)) return;
    const resolved = resolveZoneCharacteristics(
        tryGetDefinition(cardId),
        card.zone
    );
    if (!resolved) return;
    card.types = resolved.types;
    card.subtypes = resolved.subtypes;
    card.power = resolved.power;
    card.toughness = resolved.toughness;
}

/** The battlefield-entry twin of {@link applyZoneCharacteristics}: strips the
 *  off-battlefield characteristics back to the printed ones, because CR 113.6c
 *  switches the ability off on the battlefield (Grist resolves as a
 *  planeswalker and stops being a 1/1 Insect creature the instant it arrives).
 *
 *  Kept SEPARATE from `applyZoneCharacteristics` rather than folded in as a
 *  battlefield branch of it: it must run BEFORE the layer-4 `type-add` grants
 *  of the entry path (`applyExistingGrantsTo` / `beginApplyingStaticEffects`),
 *  and an automatic battlefield branch on the general applier could be reached
 *  AFTER those grants by some other path and silently erase them. The two are
 *  paired EXPLICITLY at each call site instead, which is what lets every
 *  battlefield-entry path be covered without the ordering hazard.
 *
 *  Called from every path that puts an existing card instance onto the
 *  battlefield, each immediately after the `zone = "battlefield"` write and
 *  before that path's grants:
 *    • `state.ts` `finalizeSpellResolution` — a permanent spell resolving.
 *    • `state.ts` `stageReanimatedOnBattlefield` — every put-onto-battlefield
 *      effect (reanimation, tutor-to-play, blink return).
 *    • `state.ts` `moveCard`'s `to === "battlefield"` branch — the general
 *      zone-mover, which is how the four land-play paths in `playLand.ts`
 *      enter (`applyPlayLand`, `applyPlayLandFromExile`,
 *      `playLandFromGraveyard`, `playLandFromLibrary`).
 *    • `playLand.ts` `moveCardAcrossPlayers` — the one cross-player
 *      exile → battlefield play (issue #1156), which cannot use `moveCard`
 *      because that primitive stays within one player's own zones.
 *  A token created directly on the battlefield never needs it: its instance is
 *  built from the printed definition, with no off-battlefield state to strip.
 *
 *  A no-op for every card declaring no such ability, so it cannot disturb the
 *  ordinary entry path. */
export function clearZoneCharacteristics(card: CardInstanceState): void {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId || !declaresOffBattlefieldCharacteristics(cardId)) return;
    const def = tryGetDefinition(cardId);
    if (!def?.offBattlefieldCharacteristics) return;
    card.types = [...def.types];
    card.subtypes = [...(def.subtypes ?? [])];
    card.power = def.power;
    card.toughness = def.toughness;
}

/** CR 113.6c (issue #2391) — re-derives the off-battlefield characteristics of
 *  every card in a non-battlefield zone. A no-op for every card whose
 *  definition declares none (`applyZoneCharacteristics` returns immediately),
 *  which today is all but one card in the catalogue.
 *
 *  This is the SAFETY NET, not the primary hook: the two zone funnels
 *  (`moveCard` and `removePermanentTo`, `gre/state.ts`) apply it at the moment
 *  a card changes zones, so a mid-resolution read is already correct. What
 *  this sweep adds is TOTALITY — it re-derives from the printed definition
 *  rather than reacting to a transition, so the paths that bypass both funnels
 *  (the opening library built by `gre/setup.ts` / `game.ts`,
 *  `stageReanimatedOnBattlefield`'s direct `zone` writes) are covered without
 *  each of them having to know, and a zone path added later cannot silently
 *  fail open. Idempotent, so it does not gate the CR 704.4 fixpoint.
 *
 *  A SWEEP IS NOT ALWAYS DOWNSTREAM (issue #3278). It lives here rather than
 *  in `gre/sba.ts` because `checkStateBasedActions` is not the only caller:
 *  `gre/scenarioBuilder.ts` builds a state that is PERSISTED as-is by
 *  `debugSetupScenario` with no action in between, so a scenario-placed
 *  zone-conditional card has to be materialised by the builder itself —
 *  waiting for the next SBA entry means the SAVED state is wrong, and a
 *  graveyard-target legality read taken as the first action after setup
 *  (Animate Dead offering a scenario-placed Grist) misses it.
 *
 *  TOTALITY IS NOT FREE, so the per-card cost is kept at a `Set.has` on the
 *  card id: `applyZoneCharacteristics` prechecks
 *  `declaresOffBattlefieldCharacteristics` (`cards/registry.ts`) before any
 *  definition lookup. This loop runs over both players' hand + library +
 *  graveyard + exile on EVERY `checkStateBasedActions` entry, and one
 *  400-iteration `search()` makes ~13k of those per bot decision against a
 *  ~1.5s budget. Measured at 140 distinct hidden-zone cards over 20k calls
 *  (median of 3): 1.74µs/call with no sweep at all, 4.39µs/call resolving a
 *  definition per card, 2.47µs/call with the precheck — ~72% of the added
 *  cost removed, ~35ms → ~10ms per search. Do NOT reintroduce a per-card
 *  `getDefinition` here. */
export function refreshOffBattlefieldCharacteristics(state: GameState): void {
    for (const player of state.players) {
        for (const card of player.hand) applyZoneCharacteristics(card);
        for (const card of player.library) applyZoneCharacteristics(card);
        for (const card of player.graveyard) applyZoneCharacteristics(card);
        for (const card of player.exile) applyZoneCharacteristics(card);
    }
}
