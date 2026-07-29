import type {
    ActivatedAbility,
    CardDefinition,
    CardSupertype,
    Color,
    ManaCost,
    PermanentView,
    TriggerStateView,
} from "../cards/types";
import type { ManaRestriction } from "./types";
import { getDefinition, tryGetDefinition } from "../cards";
// CR 611.1b / 613.1f (issue #1880) — the POST-LAYER activated-ability set
// (native + granted, minus a "loses all abilities" suppression). Every mana
// probe below reads it instead of `cardDef.activatedAbilities` so a GRANTED
// `{T}: Add …` (Urza's Saga chapter I) is visible to the auto-tap solver and
// the castability probe exactly like a printed one.
import { getEffectiveActivatedAbilities } from "./activatedAbilities";
import type { CardInstanceState, GameState } from "./state";
import { applySubstitution } from "./textChanges";
import { getEffectivePower, getEffectiveToughness } from "./layers";
import type { LayerStateView } from "./layers";
import {
    MANA_COLORS,
    LAND_SUBTYPE_MANA,
    hybridCostKey,
    parseHybridCostKey,
    normalizedHybridPips,
    assignHybridPips,
} from "./manaColors";

/** Sentinel card id for opaque library placeholders the vs-AI Bot's search
 *  world is rehydrated with (issue #136). The wire projects a library as a
 *  count only; the adapter rebuilds it with placeholder instances carrying this
 *  id so simulated draws have cards to take without tripping the deck-out SBA.
 *  The id resolves to no `CardDefinition` and `getLegalActions` suppresses all
 *  actions on it, so a drawn placeholder never surfaces as a legal move. */
export const PLACEHOLDER_CARD_ID = "placeholder:hidden-library";

/** Intrinsic mana abilities for basic land subtypes (CR 305.6). Canonical
 *  definition lives in the dependency-free `gre/manaColors.ts` leaf (issue
 *  #927 — breaks the `constants → layers → cards/colors → constants` cycle
 *  `getEffectivePower`/`getEffectiveToughness` would otherwise create);
 *  re-exported here so every existing `from "../gre/constants"` import site
 *  is unaffected. */
export { LAND_SUBTYPE_MANA };

/** Landwalk keywords mapped to the land subtype they reference (CR 702.13c-g). */
export const LANDWALK_KEYWORDS: Record<string, string> = {
    plainswalk: "Plains",
    islandwalk: "Island",
    swampwalk: "Swamp",
    mountainwalk: "Mountain",
    forestwalk: "Forest",
    desertwalk: "Desert",
};

/** Landwalk keywords keyed on a land *supertype* (CR 205.4 / 702.13) rather
 *  than a subtype. "Legendary landwalk" (Livonya Silone, LEG) is the only
 *  printed instance — the attacker can't be blocked while the defending player
 *  controls a land with the named supertype. Kept separate from
 *  `LANDWALK_KEYWORDS` because the match reads `supertypes`, which lives on the
 *  card definition (CR 205.4 — not a text-changeable, instance-mutable field),
 *  whereas subtype landwalk reads the instance's substitution-rewritten
 *  `subtypes`. */
export const LANDWALK_SUPERTYPE_KEYWORDS: Record<string, CardSupertype> = {
    "legendary landwalk": "Legendary",
};

/** Snow landwalk keywords (CR 702.13 / 205.4a) keyed on the basic land
 *  *subtype* the snow land must also have — the attacker can't be blocked
 *  while the defending player controls a SNOW land of that subtype (Legions
 *  of Lim-Dûl's "snow swampwalk", Rime Dryad's "snow forestwalk"). Kept
 *  separate from `LANDWALK_KEYWORDS` because the match additionally requires
 *  the live Snow supertype (`hasSnowSupertype`), not just the subtype.
 *  Barbarian Guides grants a chosen-subtype snow landwalk at runtime via the
 *  same keyword strings. */
export const LANDWALK_SNOW_SUBTYPE_KEYWORDS: Record<string, string> = {
    "snow plainswalk": "Plains",
    "snow islandwalk": "Island",
    "snow swampwalk": "Swamp",
    "snow mountainwalk": "Mountain",
    "snow forestwalk": "Forest",
};

/** Card types a resolving STACK ITEM can become on resolution (CR 608.3 →
 *  the object enters the battlefield as a permanent). Deliberately EXCLUDES
 *  Land: lands are never cast (CR 305.1), so a land never resolves off the
 *  stack. For the full CR 300.1 permanent-type set (incl. Land) — the correct
 *  set for "target permanent" and "permanent card" checks — use the canonical
 *  `PERMANENT_TYPES` re-exported just below. */
export const CASTABLE_PERMANENT_TYPES = [
    "Creature",
    "Artifact",
    "Enchantment",
    "Planeswalker",
    "Battle",
] as const;

/** The complete CR 300.1 permanent card types (incl. Land). Canonical
 *  definition in the leaf `cards/types` module (avoids a registry import
 *  cycle); re-exported here for engine-side consumers. */
export { PERMANENT_TYPES } from "../cards/types";

/**
 * Permanent types that can be dealt damage (CR 120.3). Damage to any other
 * permanent (artifact, enchantment, land) is a no-op. This is also the set
 * of permanent types matched by a `"any target"` spell (CR 115.4).
 *
 * The canonical definition lives in the leaf `cards/types` module (so card
 * sets can import it without a registry import cycle); re-exported here for
 * the engine-side consumers that already import it from `gre/constants`.
 */
export { DAMAGEABLE_PERMANENT_TYPES } from "../cards/types";
import { DAMAGEABLE_PERMANENT_TYPES } from "../cards/types";

export function isDamageablePermanent(card: CardInstanceState): boolean {
    return DAMAGEABLE_PERMANENT_TYPES.some((t) => card.types.includes(t));
}

/** CR 306 — true iff this permanent is a planeswalker. Damage to a planeswalker
 *  removes loyalty counters instead of being marked (CR 120.3 / 704.5i), and
 *  the 0-loyalty SBA (CR 704.5i) scans on it. */
export function isPlaneswalker(card: CardInstanceState): boolean {
    return card.types.includes("Planeswalker");
}

/** All six mana colors in canonical order. Canonical definition lives in the
 *  dependency-free `gre/manaColors.ts` leaf (see the re-export note above);
 *  re-exported here so every existing `from "../gre/constants"` import site
 *  is unaffected. */
export { MANA_COLORS };

/** Guild-hybrid pip helpers for a NORMALIZED cost (CR 202.1a, issue #1738).
 *  Canonical definitions live in the same dependency-free leaf; re-exported
 *  here so call sites keep importing mana helpers from one module. */
export {
    hybridCostKey,
    parseHybridCostKey,
    normalizedHybridPips,
    assignHybridPips,
};

/** Default number of lands a player may play per turn (CR 305.2). Cards
 *  granting additional drops (Exploration, Azusa) would mutate the per-turn
 *  budget — out of scope for the current rule set. */
export const LAND_DROPS_PER_TURN = 1;

/** Default maximum hand size (CR 402.2). Enforced by the cleanup-step discard
 *  (CR 514.1) — the active player discards down to this number unless their
 *  `PlayerState.maxHandSizeOverride` says otherwise (Library of Leng sets it
 *  to "unlimited"). */
export const MAX_HAND_SIZE = 7;

/** Mana value of a cost (CR 202.3). Numeric `X` counts as its value; string `X` counts as 0 (unpaid). */
export function manaValue(cost?: ManaCost): number {
    if (!cost) return 0;
    let total = 0;
    for (const key of ["X", "W", "U", "B", "R", "G", "C", "generic"] as const) {
        const v = cost[key];
        if (typeof v === "number") total += v;
    }
    // CR 202.3f — each Phyrexian pip `{C/P}` is valued as its colour without the
    // `/P` (i.e. 1), so Dismember `{1}{B/P}{B/P}` has mana value 3.
    if (cost.phyrexian) {
        for (const n of Object.values(cost.phyrexian)) {
            if (typeof n === "number") total += n;
        }
    }
    // CR 202.3f — each guild-hybrid pip `{B/G}` is valued as 1 (issue #1338),
    // so Hogaak `{5}{B/G}{B/G}` has mana value 7.
    if (cost.hybrid) total += cost.hybrid.length;
    return total;
}

/** Exact STRUCTURAL comparison of two printed mana costs (CR 202, issue
 *  #1881, ADR 0078 decision 8) — `EffectCardFilter.manaCostEquals`'s reader.
 *  Distinct from `manaValue` right above, which collapses a cost to one
 *  number and therefore can't tell `{X}` (mana value 0) from `{0}`, or `{W}`
 *  (mana value 1) from `{1}`.
 *
 *  A VARIABLE `{X}` cost (`X: "X"`) never equals a FIXED one (CR 202.3b):
 *  Chalice of the Void's `{X}` and Engineered Explosives' `{X}{X}` both have
 *  mana value 0 but match neither `{0}` (`{}`) nor `{1}` (`{X: 1}` /
 *  `{generic: 1}`); `{X}` != `{X}{X}` either (different `xFactor`).
 *
 *  A numeric `X` and `generic` are the SAME characteristic — the fixed
 *  portion of the cost, split only to coexist with a variable `{X}` in the
 *  same cost (Soul Burn's `{X}{2}{B}`, see `ManaCost.generic`'s own doc
 *  comment) — so they're folded into one total before comparing: `{X: 1}`
 *  and `{generic: 1}` both mean the printed cost `{1}` and compare equal.
 *
 *  `phyrexian`/`hybrid` pips (CR 107.4f / 202.1a) are compared as per-colour
 *  / per-pair-shape MULTISETS — pip order never matters (CR 202.2) — reusing
 *  `hybridCostKey` so `{B/G}{B/G}` and `{G/B}{B/G}` (two spellings of the
 *  same pair) compare equal. */
export function manaCostsEqual(a: ManaCost, b: ManaCost): boolean {
    for (const color of MANA_COLORS) {
        if ((a[color] ?? 0) !== (b[color] ?? 0)) return false;
    }
    const aVariable = a.X === "X";
    const bVariable = b.X === "X";
    if (aVariable !== bVariable) return false;
    // A numeric `X` doubles as the generic slot (see doc comment above) — fold
    // both fields into one fixed-generic total before comparing. This runs on
    // BOTH branches (issue #1881 review finding 1): `generic` can coexist with
    // a variable `{X}` marker too (Soul Burn `{X}{2}{B}` = `{X:"X", generic:2,
    // B:1}`), so folding it only in the `else` let `{X}{R}` wrongly equal
    // `{X}{2}{R}` (a fixed `generic` was compared against nothing on the
    // variable path).
    const aGeneric = (typeof a.X === "number" ? a.X : 0) + (a.generic ?? 0);
    const bGeneric = (typeof b.X === "number" ? b.X : 0) + (b.generic ?? 0);
    if (aGeneric !== bGeneric) return false;
    if (aVariable) {
        // CR 107.3 — {X}{X}-style multiplier; defaults to 1 ({X} alone).
        if ((a.xFactor ?? 1) !== (b.xFactor ?? 1)) return false;
    }
    for (const color of MANA_COLORS) {
        if ((a.phyrexian?.[color] ?? 0) !== (b.phyrexian?.[color] ?? 0)) {
            return false;
        }
    }
    if (!hybridPipsEqual(a.hybrid, b.hybrid)) return false;
    return true;
}

/** Per-pair-shape multiset equality of two `ManaCost.hybrid` pip arrays
 *  (issue #1881) — reuses `hybridCostKey` (`gre/manaColors.ts`) so pip order
 *  within a pair, and pip ORDER within the array, never matter, only how
 *  many of EACH pair shape are present (Hogaak's two `{B/G}` pips). */
function hybridPipsEqual(
    a: Array<[Color, Color]> | undefined,
    b: Array<[Color, Color]> | undefined
): boolean {
    const countsOf = (pips: Array<[Color, Color]> | undefined) => {
        const counts = new Map<string, number>();
        for (const [x, y] of pips ?? []) {
            const key = hybridCostKey(x, y);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return counts;
    };
    const aCounts = countsOf(a);
    const bCounts = countsOf(b);
    if (aCounts.size !== bCounts.size) return false;
    for (const [key, count] of aCounts) {
        if (bCounts.get(key) !== count) return false;
    }
    return true;
}

/** Returns the mana color a land produces via basic land subtype, or null.
 *  Reads the text-change-rewritten subtypes (CR 612 / CR 305.6) so a land
 *  whose type was changed (Magical Hack) taps for the new color. */
export function getBasicLandMana(card: CardInstanceState): Color | null {
    const { subtypes } = applySubstitution(card);
    for (const subtype of subtypes) {
        const color = LAND_SUBTYPE_MANA[subtype];
        if (color) return color;
    }
    return null;
}

export function isCreature(card: CardInstanceState): boolean {
    return card.types.includes("Creature");
}

/** CR 302.1 — a creature's activated ability with the tap or untap symbol in
 *  its activation cost can't be activated unless the creature has been under
 *  its controller's control continuously since the start of that controller's
 *  most recent turn. Applies to mana abilities and stack abilities alike
 *  (Birds of Paradise, Llanowar Elves, Prodigal Sorcerer). Non-creature
 *  permanents (Mox, Sol Ring, lands) ignore summoning sickness.
 *
 *  CR 702.10b — haste lifts the restriction entirely: a hasty creature may pay
 *  {T}/{Q} the turn it arrives. Reads `staticAbilities` directly so
 *  `grantAbility`-granted haste counts too, mirroring the attacker check in
 *  `combat.ts`. */
export function isTapLockedBySummoningSickness(
    card: CardInstanceState
): boolean {
    if (!card.isSummoningSick || !isCreature(card)) return false;
    return !card.staticAbilities.includes("haste");
}

export function isLand(card: CardInstanceState): boolean {
    return card.types.includes("Land");
}

/** Definition-level sibling of {@link isLand} (CR 305.1) — for callers that
 *  only hold a `CardDefinition` (deckbuilder surfaces: the Column Layout
 *  engine, pool columns, deck grouping) and never an in-game instance. Lives
 *  here so those surfaces stop keeping private copies of
 *  `def.types.includes("Land")`. */
export function isLandDefinition(def: CardDefinition): boolean {
    return def.types.includes("Land");
}

/** CR 205.3i — the complete land type list: the five basic land types plus
 *  the eleven nonbasic ones (Cave, Desert, Gate, Lair, Locus, Mine,
 *  Power-Plant, Sphere, Tower, Town, Urza's). An effect that sets a land's
 *  subtype to one or more of these ("Nonbasic lands are Mountains" — Blood
 *  Moon; "target land becomes a Swamp" — Orcish Farmer) is a CR 305.7
 *  land-type change: it replaces only the land's OLD LAND TYPES, never a
 *  subtype belonging to a different card type (Saga, CR 205.3h; Aura, CR
 *  205.3g) that happens to ride along on a multi-type land
 *  (`Enchantment Land — Urza's Saga`). See {@link applyLandTypeReplacement},
 *  the shared narrowing every "becomes a land type" effect site routes
 *  through (issue #1883).
 *
 *  Every member here is a SINGLE Scryfall/CR subtype token — a card whose
 *  printed subtype is itself a two-word land type ("Urza's Mine", "Urza's
 *  Power-Plant", "Urza's Tower") stores it as TWO tokens
 *  (`["Urza's", "Mine"]`, CR 205.3i lists "Urza's" and "Mine"/"Power-Plant"/
 *  "Tower" as separate types), never one compound string — a compound string
 *  can never match a member of this set and silently escapes CR 305.7
 *  narrowing (issue #1883 regression: the ATQ Urza-land trio and, before it
 *  was even a CardDefinition, Urza's Saga). Enforced catalogue-wide by
 *  `convex/cards/__tests__/landTypeCoverage.test.ts`. */
export const LAND_TYPES: ReadonlySet<string> = new Set([
    "Cave",
    "Desert",
    "Forest",
    "Gate",
    "Island",
    "Lair",
    "Locus",
    "Mine",
    "Mountain",
    "Plains",
    "Power-Plant",
    "Sphere",
    "Swamp",
    "Tower",
    "Town",
    "Urza's",
]);

/** CR 305.7 — composes the subtypes a LAND keeps after an effect sets its
 *  land type(s) to `newLandTypes`: every subtype outside {@link LAND_TYPES}
 *  (Saga, Aura, …) survives from `currentSubtypes`; every subtype IN
 *  `LAND_TYPES` is dropped and replaced by `newLandTypes`.
 *
 *  Callers gate the narrowing itself — CR 305.7 governs LANDS only. A
 *  `subtype-set`-shaped effect on a non-land permanent (Figure of Destiny's
 *  "becomes a Kithkin Spirit", a creature-type change with no CR 305.7
 *  analogue) must keep full wholesale replacement and must NOT call this
 *  helper; check `types.includes("Land")` first. */
export function applyLandTypeReplacement(
    currentSubtypes: readonly string[],
    newLandTypes: readonly string[]
): string[] {
    return [
        ...currentSubtypes.filter((s) => !LAND_TYPES.has(s)),
        ...newLandTypes,
    ];
}

/** Whether a card can be cast at **instant speed** (CR 601.3a / 702.8) — an
 *  Instant, or any card with the Flash keyword. Sorcery-speed-only cards
 *  (creatures, sorceries, and non-flash permanents) return false: they may be
 *  cast only when the player could cast a sorcery (CR 307.1, 601.3a). Canonical
 *  predicate reused by the auto-tap timing filter (issue #475) and the search
 *  heuristics (`evaluate`, `heldInteraction`). */
export function hasInstantSpeed(card: CardInstanceState): boolean {
    return (
        card.types.includes("Instant") || card.staticAbilities.includes("flash")
    );
}

/** True if the card has the "Aura" subtype (CR 303.4). Auras ETB attached
 *  to an object via `attachedTo` and are subject to SBA 704.5m. */
export function isAura(card: {
    types: readonly string[];
    subtypes: readonly string[];
}): boolean {
    return card.types.includes("Enchantment") && card.subtypes.includes("Aura");
}

/** CR 613.1f — true while the permanent has lost all abilities (Titania's
 *  Song, Blood Moon). Its PRINTED activated mana abilities don't function while
 *  suppressed. Note this does NOT suppress intrinsic basic-land subtype mana
 *  (CR 305.6): that ability is granted by the land's type (set in layer 4),
 *  not a printed ability, so `getBasicLandMana` is intentionally not gated by
 *  this — a nonbasic land turned into a Mountain by Blood Moon still taps for
 *  {R}. */
export function abilitiesSuppressed(card: CardInstanceState): boolean {
    return (card.abilitiesSuppressedBy?.length ?? 0) > 0;
}

/** Returns the mana color produced by a tap mana ability (e.g. Mox), or null.
 *
 *  CR 113.1 / 611.1b (issue #1880) — reads the POST-LAYER effective set, so a
 *  GRANTED `{T}: Add …` (Urza's Saga chapter I on a land with no printed mana
 *  ability) actually PRODUCES mana. This is the production half of the seam:
 *  the discovery probes (`hasManaAbility`, `getManaTapOptionsDetailed`) already
 *  read the effective set, so leaving this on the printed list let the planner
 *  commit to a source `tapSourceIntoPayment` then rejected with "Card does not
 *  produce mana" — and made `tapUntap` tap the permanent for ZERO mana. */
export function getActivatedManaColor(card: CardInstanceState): Color | null {
    if (abilitiesSuppressed(card)) return null;
    const ability = getEffectiveActivatedAbilities(card).find(
        ({ ability: a }) => a.cost.tap && !a.useStack && a.manaProduced
    )?.ability;
    if (!ability?.manaProduced) return null;
    const colors = Object.entries(ability.manaProduced)
        .filter(([k, v]) => k !== "X" && typeof v === "number" && v > 0)
        .map(([k]) => k as Color);
    return colors.length === 1 ? colors[0] : null;
}

/** Returns the mana produced by a tap mana ability, or null. Supports
 *  multi-color (e.g. Signet). CR 113.1 / 611.1b (issue #1880) — POST-LAYER
 *  effective set, so a GRANTED tap mana ability's output is real. */
export function getActivatedManaProduced(
    card: CardInstanceState
): ManaCost | null {
    if (abilitiesSuppressed(card)) return null;
    const ability = getEffectiveActivatedAbilities(card).find(
        ({ ability: a }) => a.cost.tap && !a.useStack && a.manaProduced
    )?.ability;
    return ability?.manaProduced ?? null;
}

/** Amount of a single color produced by a card's fixed (non-choice) tap mana
 *  ability. Basic lands and abilities without an explicit count default to 1;
 *  abilities like Sol Ring ({T}: Add {C}{C}) return 2.
 *
 *  CR 106.1 / 605.1a — when the ability declares a board-conditional
 *  `manaAmount` (the Urza land trio) and `controllerBattlefield` is supplied,
 *  the output is recomputed from the current board; otherwise the static
 *  `manaProduced` is used as the representative / fallback amount. */
export function getFixedManaAmount(
    card: CardInstanceState,
    color: Color,
    controllerBattlefield?: readonly CardInstanceState[]
): number {
    if (controllerBattlefield) {
        const dynamic = getDynamicManaProduced(card, controllerBattlefield);
        if (dynamic) return dynamic[color] ?? 0;
    }
    const produced = getActivatedManaProduced(card);
    return produced?.[color] ?? 1;
}

/** Builds a minimal CR 611/613 `LayerStateView` from whatever battlefield data
 *  a mana-ability call site has on hand, so `manaAmount` / `getManaChoices`
 *  hooks can read the source's CURRENT effective power/toughness (CR 613.4)
 *  rather than its base printed stats (issue #927 — Vivi Ornitier's mana
 *  ability scales with her own +1/+1 counters). Graveyards aren't tracked by
 *  these battlefields-only call sites, so a source whose OWN power is itself a
 *  graveyard-counting CDA (layer 7a) wouldn't resolve correctly through this
 *  path — no shipped mana ability needs that combination today; a future one
 *  would need a real `GameState` threaded to this call site instead. */
function manaLayerView(
    battlefields: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>
): LayerStateView {
    return {
        players: battlefields.map((b) => ({
            id: b.playerId,
            battlefield: b.battlefield as unknown as readonly PermanentView[],
            graveyard: [],
            // Not tracked by this battlefields-only view: `hand` is OPTIONAL
            // on `StaticEffectStateView` precisely for call sites like this
            // one (issue #1379 review finding) that have no real hand data.
            // `{ length: 0 }` used to be fabricated here, which is NOT inert
            // like the empty `graveyard` above — 0 is the TRUE answer to "≤ N
            // cards in hand" for any N ≥ 0, so a hand-size `condition` would
            // read as silently SATISFIED at this mana-ability call site
            // rather than "unknown". Omitting the field lets every
            // `condition` closure see `undefined` and resolve conservatively
            // (false) instead. A future mana ability whose scaling genuinely
            // depends on hand size would need a real `GameState` threaded to
            // this call site instead of this battlefields-only shortcut.
        })),
    };
}

/** Returns `card`'s `PermanentView` with `power`/`toughness` overridden to
 *  their CURRENT effective values (CR 613.4 layer pipeline) computed against
 *  `layerView`, instead of the raw base stats. A `manaAmount` / `getManaChoices`
 *  hook that reads `source.power` / `source.toughness` therefore sees the
 *  layered value (+1/+1 counters, anthems, CDAs visible on `layerView`)
 *  automatically — no signature change needed on either hook (issue #927). */
function withEffectivePT(
    card: CardInstanceState,
    layerView: LayerStateView
): PermanentView {
    const view = card as unknown as PermanentView;
    return {
        ...view,
        power: getEffectivePower(layerView, view),
        toughness: getEffectiveToughness(layerView, view),
    };
}

/** Board-conditional mana output for a card's fixed tap mana ability (CR 106.1),
 *  computed against the controller's battlefield, or null when the ability has
 *  no `manaAmount` hook. The Urza land trio uses this to scale colorless output
 *  with the assembled set. The raw `CardInstanceState`s are structurally valid
 *  `PermanentView`s (the engine passes instances as views everywhere).
 *
 *  CR 613.4 / 605.1a (issue #927) — the `source` passed to `manaAmount` carries
 *  the source's CURRENT effective power/toughness (post-layers), computed from
 *  the controller's own battlefield (the only board data this hook receives —
 *  see `manaLayerView`), not its raw base stats.
 *
 *  CR 113.1 / 611.1b (issue #1880) — POST-LAYER effective set, so a GRANTED
 *  board-conditional tap mana ability scales like a printed one. */
export function getDynamicManaProduced(
    card: CardInstanceState,
    controllerBattlefield: readonly CardInstanceState[]
): ManaCost | null {
    if (abilitiesSuppressed(card)) return null;
    const ability = getEffectiveActivatedAbilities(card).find(
        ({ ability: a }) => a.cost.tap && !a.useStack && a.manaAmount
    )?.ability;
    if (!ability?.manaAmount) return null;
    const layerView = manaLayerView([
        { playerId: card.controllerId, battlefield: controllerBattlefield },
    ]);
    return ability.manaAmount(
        withEffectivePT(card, layerView),
        controllerBattlefield as unknown as readonly PermanentView[]
    );
}

/** Colours a set of activated abilities COULD produce (CR 106.4 — "could
 *  produce"), unioning every non-stack ability's fixed `manaProduced` and
 *  `manaChoices` chooser options. Colourless ({C}) is excluded — {C} is not a
 *  colour (CR 202.2, 106.1b). Shared leaf between the definition-level and
 *  instance-level "could produce" functions below so the two can't drift
 *  apart (issue #1619): this is the part of CR 106.4 that reads only
 *  `CardDefinition.activatedAbilities`, with no instance-only concern
 *  (ability suppression, text-changed subtypes) folded in. */
function producibleColorsFromAbilities(
    abilities: readonly ActivatedAbility[] | undefined
): Set<Color> {
    const colors = new Set<Color>();
    for (const ability of abilities ?? []) {
        if (ability.useStack) continue;
        if (ability.manaProduced) {
            for (const c of MANA_COLORS) {
                if (c !== "C" && (ability.manaProduced[c] ?? 0) > 0)
                    colors.add(c);
            }
        }
        if (ability.manaChoices) {
            for (const choice of ability.manaChoices) {
                for (const c of MANA_COLORS) {
                    if (c !== "C" && (choice[c] ?? 0) > 0) colors.add(c);
                }
            }
        }
    }
    return colors;
}

/** Definition-level twin of `getProducibleColors` (CR 106.4 — "could
 *  produce"), for a `CardDefinition` that is NOT on a battlefield — deck/pool
 *  analysis and mana-source classification with no game in progress (issue
 *  #1619, PRD #1617). Unions the same two sources as the instance-level
 *  function, minus the instance-only concerns that don't apply off a
 *  battlefield: basic-land subtypes straight off `CardDefinition.subtypes`
 *  (CR 305.6 — no text-change substitution to apply, there is no instance to
 *  rewrite) and `activatedAbilities` via the shared
 *  `producibleColorsFromAbilities` leaf (no suppression effect can be in
 *  play off a battlefield either). Colourless ({C}) excluded (CR 202.2,
 *  106.1b). `getProducibleColors` is expressed in terms of this function —
 *  keep them in sync by construction, not by convention. Used by
 *  `convex/limited/botDrafter.ts`'s Castability / Fixing Value colour terms
 *  (ADR 0073, issue #1610): today `CardEvalMeta`'s `colors` (CR 202.2,
 *  mana-cost-derived) reads `[]` for a dual land, a Mox, a Signet — this is
 *  the fix, read from what the card PRODUCES instead of what it costs. */
export function getDefinitionProducibleColors(
    cardDef: CardDefinition
): Set<Color> {
    const colors = new Set<Color>();
    // CR 305.6 — intrinsic basic-land subtype abilities, definition subtypes
    // (no text-change substitution — that's an instance-only rewrite).
    for (const subtype of cardDef.subtypes ?? []) {
        const color = LAND_SUBTYPE_MANA[subtype];
        if (color && color !== "C") colors.add(color);
    }
    for (const c of producibleColorsFromAbilities(cardDef.activatedAbilities))
        colors.add(c);
    return colors;
}

/** Colors of mana a single permanent COULD produce when tapped (CR 106.4 —
 *  "could produce"). Unions every source of mana the card knows about:
 *  basic-land subtypes (CR 305.6), fixed `manaProduced` abilities, and
 *  `manaChoices` abilities (dual lands / Talisman-style choosers). Colorless
 *  ({C}) is excluded — "a land an opponent controls could produce" (Fellwar
 *  Stone) cares only about coloured mana, and {C} is not a colour (CR 202.2,
 *  106.1b). Abilities lost to a suppression effect (Titania's Song) don't
 *  function, so they contribute nothing. Used by Fellwar Stone's
 *  `getManaChoices` to read opponents' mana bases. Expressed in terms of
 *  `getDefinitionProducibleColors` for the ability-list union, with the two
 *  instance-only concerns layered on top: ability suppression (short-circuits
 *  to empty) and text-change-aware basic-land mana (`getBasicLandMana`,
 *  which reads the substitution-rewritten `subtypes`, not the definition's
 *  printed ones) — issue #1619.
 *
 *  CR 113.1 / 611.1b (issue #1880) — the ability union is the POST-LAYER
 *  effective set, the third instance-only concern: a GRANTED mana ability
 *  (Urza's Saga chapter I) is a real "could produce" source, so a land holding
 *  only a granted `{T}: Add {G}` reads as a green source to Fellwar Stone and
 *  to mana-source classification, exactly as every sibling probe already sees
 *  it. `getDefinitionProducibleColors` (definition-level, no instance, no
 *  battlefield) necessarily stays printed-only — a grant lives on an instance. */
export function getProducibleColors(card: CardInstanceState): Set<Color> {
    const colors = new Set<Color>();
    if (abilitiesSuppressed(card)) return colors;
    // CR 305.6 — intrinsic basic-land subtype abilities (text-change aware).
    const intrinsic = getBasicLandMana(card);
    if (intrinsic && intrinsic !== "C") colors.add(intrinsic);
    for (const c of producibleColorsFromAbilities(
        getEffectiveActivatedAbilities(card).map(({ ability }) => ability)
    ))
        colors.add(c);
    return colors;
}

/** Board-conditional mana CHOICES for a card's tap mana ability (CR 106.1 /
 *  605.1a) — the choice analog of `getDynamicManaProduced`. Returns the list of
 *  mana options the activator may pick from, computed from every player's
 *  battlefield, or null when the ability has no `getManaChoices` hook. The
 *  raw `CardInstanceState`s are structurally valid `PermanentView`s. Used by
 *  Fellwar Stone (colours derived from opponents' lands). The same resolver is
 *  re-exported to the client (`src/lib/card-utils`) so the picker the player
 *  sees and the index the server validates reference one list.
 *
 *  CR 613.4 / 605.1a (issue #927) — the `source` passed to `getManaChoices`
 *  carries the source's CURRENT effective power/toughness (post-layers),
 *  computed from every player's battlefield (this hook already receives the
 *  full board — see `manaLayerView`), not its raw base stats. Vivi Ornitier's
 *  "{U}/{R} split totalling X, where X is this creature's power" reads it. */
export function getDynamicManaChoices(
    card: CardInstanceState,
    controllerId: string,
    battlefields: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>
): ManaCost[] | null {
    if (abilitiesSuppressed(card)) return null;
    const ability = getEffectiveActivatedAbilities(card).find(
        ({ ability: a }) => !a.useStack && a.getManaChoices
    )?.ability;
    if (!ability?.getManaChoices) return null;
    const layerView = manaLayerView(battlefields);
    // Precompute each permanent's producible colours via the shared helper so
    // the card definition (Fellwar Stone) reads board mana without importing the
    // engine's mana machinery (CR 106.4).
    return ability.getManaChoices(
        withEffectivePT(card, layerView),
        controllerId,
        battlefields.map((b) => ({
            playerId: b.playerId,
            permanents: b.battlefield.map((p) => ({
                permanent: p as unknown as PermanentView,
                producibleColors: [...getProducibleColors(p)],
            })),
        }))
    );
}

/** Resolves the effective mana-choices list for a card's tap mana ability:
 *  the board-conditional `getManaChoices` result when present, else the static
 *  `manaChoices`, else null. Single source of truth for every server consumer
 *  (rules affordability, autoTap planner, the three tap mutations) so a
 *  dynamic chooser never desyncs the index across sites. */
export function getEffectiveManaChoices(
    card: CardInstanceState,
    controllerId: string,
    battlefields: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>
): ManaCost[] | null {
    const dynamic = getDynamicManaChoices(card, controllerId, battlefields);
    if (dynamic) return dynamic;
    // CR 602.5b (issue #947) — gate on the ability's own `canActivate` using
    // the battlefields already available here (Chrome Mox's imprint gate
    // needs no more than `source.counters`, see `minimalManaGateView`).
    const ability = getActivatedManaAbility(
        card,
        minimalManaGateView(battlefields)
    );
    return ability?.manaChoices ?? null;
}

/** Provenance of a single mana-tap option (CR 605.1a): which mana ability it
 *  comes from. `"activated"` carries the source ability's id (and, for a
 *  `manaChoices` ability, the index into THAT ability's own choice list — the
 *  Mana Battery counter-removal count reads this local index, not the unified
 *  index); `"basic"` is an intrinsic basic-land-subtype ability (CR 305.6),
 *  which has no riders (self-damage, depletion, life/discard cost). */
export type ManaTapOptionSource =
    | { kind: "activated"; abilityId: string; choiceIndex?: number }
    | { kind: "basic"; subtype: string };

/** One selectable mana-tap option: the `ManaCost` produced by activating one of
 *  a permanent's mana abilities once, plus its provenance. */
export type ManaTapOption = { mana: ManaCost; source: ManaTapOptionSource };

/** Canonical dedup key for a `ManaCost` (sorted colour:amount pairs). */
function manaCostKey(mana: ManaCost): string {
    return MANA_COLORS.map((c) => `${c}:${mana[c] ?? 0}`).join("|");
}

/** CR 605.1a / 305.6 — the full set of mana-tap options a permanent exposes:
 *  every printed/granted activated tap mana ability (its fixed `manaProduced`,
 *  its static/board-conditional choices) AND one intrinsic option per DISTINCT
 *  basic land subtype it currently has. A single {T} activates exactly ONE of
 *  these, so the player chooses when 2+ survive. This is the single authority
 *  the tap mutations, the affordability planner and the client picker all read,
 *  so the index they submit references one list (CR 106.1).
 *
 *  Ordering is stable: activated-ability options first (preserving the indices
 *  existing `manaChoices` cards already use — including a storage land's
 *  "remove N counters" list where the index IS the counter count, so the
 *  zero-output "remove 0" entry is kept), then basic-subtype options in subtype
 *  order. Duplicate outputs (a dual land whose basic subtypes reproduce its own
 *  choice colours) are dropped, keeping the first occurrence's provenance — so
 *  `getManaTapOptions` for a plain dual land is byte-identical to its old
 *  `manaChoices`.
 *
 *  A SACRIFICE-cost mana ability (ADR 0039 — the FEM sac-land "Sacrifice this:
 *  Add {X}{X}", Basal Thrull, Lotus Petal) is a deliberate destructive
 *  activation, NOT folded into the routine tap-for-mana picker: it is offered
 *  only when the source has no non-destructive tap option, so a land with both
 *  a plain tap and a sacrifice ability taps plainly while a sacrifice-only
 *  source (Lotus Petal) still surfaces its colours.
 *
 *  Suppression (Blood Moon / Titania's Song, CR 613.1f) removes only PRINTED
 *  activated abilities; the intrinsic basic-subtype options survive (CR 305.6),
 *  matching `getBasicLandMana`. `battlefields` is required only to resolve
 *  board-conditional outputs (Fellwar Stone's `getManaChoices`, the Urza land
 *  trio's `manaAmount`); omit it (static resolution) where the board isn't
 *  available — the planner's one-source model, as before, does not resolve
 *  dynamic choosers. */
/** CR 602.5b / 605.1a — the single, shared "both-players battlefield" view a
 *  board-dependent mana ability's `canActivate` (Mox Opal's Metalcraft,
 *  Fanatic of Rhonas's Ferocious) or `getManaChoices` (Fellwar Stone scanning
 *  every OTHER player's battlefield) is evaluated against. Issue #1754 made
 *  this exact shape — `state.players.map((p) => ({ playerId: p.id,
 *  battlefield: p.battlefield }))` — the thing that must stay identical
 *  across every mana-gate call site or the human castability gate
 *  (`coloredCostLeftover`, rules.ts) and the bot's payment planner
 *  (`planManaPayment`, moves.ts) silently diverge again (issue #1751 finding
 *  4). Three independent inline `.map`s used to build it (rules.ts,
 *  `manaTapBattlefields` in game.ts, moves.ts); this is now the one place
 *  that does, called from all three so the invariant is enforced by
 *  construction instead of by convention. */
export function manaGateBattlefields(state: GameState): ReadonlyArray<{
    playerId: string;
    battlefield: readonly CardInstanceState[];
}> {
    return state.players.map((p) => ({
        playerId: p.id,
        battlefield: p.battlefield,
    }));
}

/** Minimal `TriggerStateView` built from whatever board data a mana-tap
 *  resolution site has on hand, so an ability's own `canActivate` gate (CR
 *  602.5b, issue #947) can be evaluated at every site that enumerates
 *  mana-tap options — including the snapshot-free affordability / auto-tap
 *  planner (`getProducibleManaOptions`), which never threads a full
 *  `GameState`. `battlefields` (when supplied) becomes the view's per-player
 *  permanent list; `life`/`hand` aren't tracked by any battlefields-only
 *  caller so they're zeroed out. Safe today because the only mana ability
 *  declaring `canActivate` (Chrome Mox's imprint gate) reads only
 *  `source.counters`, ignoring `state` entirely — a future mana ability whose
 *  gate genuinely needs life/hand would need real `GameState` threaded to its
 *  call site instead of leaning on this fallback. */
function minimalManaGateView(
    battlefields?: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>
): TriggerStateView {
    if (!battlefields) return { players: [] };
    return {
        players: battlefields.map((b) => ({
            id: b.playerId,
            life: 0,
            hand: { length: 0 },
            battlefield: b.battlefield.map((c) => ({
                id: c.id,
                controllerId: c.controllerId,
                ownerId: c.ownerId,
                types: c.types ?? [],
                subtypes: c.subtypes ?? [],
                staticAbilities: c.staticAbilities ?? [],
                power: c.power,
                toughness: c.toughness,
                isTapped: c.isTapped === true,
            })),
        })),
    };
}

export function getManaTapOptionsDetailed(
    card: CardInstanceState,
    controllerId?: string,
    battlefields?: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>,
    opts?: { requireTap?: boolean }
): ManaTapOption[] {
    const nonSacrifice: ManaTapOption[] = [];
    const sacrifice: ManaTapOption[] = [];
    const requireTap = opts?.requireTap ?? false;

    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    const controllerBattlefield =
        controllerId && battlefields
            ? battlefields.find((b) => b.playerId === controllerId)?.battlefield
            : undefined;

    // CR 113.1 / 611.1b (issue #1880) — the POST-LAYER set: printed abilities
    // PLUS every one granted to this permanent (Urza's Saga chapter I's
    // "{T}: Add {C}"), so a granted mana ability is a real tap option for the
    // auto-tap planner and the tap mutations, not merely a client-side menu
    // entry. `def` is still consulted for its EXISTENCE (a slim client
    // instance with no definition exposes no activated options).
    if (def && !abilitiesSuppressed(card)) {
        for (const { ability } of getEffectiveActivatedAbilities(card)) {
            if (ability.useStack) continue;
            // A one-shot mana ability activated by tapping AND/OR sacrificing the
            // source (ADR 0039 — Lion's Eye Diamond sacrifices without tapping).
            // A pure mana-COST ability (Farrelite Priest "{1}: Add {W}") is
            // repeatable and routed through `activateManaAbility`, not a tap
            // option. The affordability/auto-tap planner passes `requireTap` so
            // it never auto-commits a sacrifice-only source (discarding the hand
            // to LED is a strategic choice, never an auto-payment).
            if (requireTap) {
                if (!ability.cost.tap) continue;
            } else if (!ability.cost.tap && !ability.cost.sacrifice) {
                continue;
            }
            // CR 602.5b (issue #947) — an ability whose own `canActivate`
            // precondition is false is not a usable mana-tap option at all
            // (an un-imprinted Chrome Mox has no active mana ability, not
            // merely one with an empty choice list).
            if (
                ability.canActivate &&
                !ability.canActivate(
                    card as unknown as PermanentView,
                    minimalManaGateView(battlefields)
                )
            ) {
                continue;
            }
            const target = ability.cost.sacrifice ? sacrifice : nonSacrifice;
            // A choice ability (dual land, Talisman, Fellwar Stone, storage
            // land): each option is one entry, tagged with its ability-local
            // choice index so the counter-removal rider (Mana Battery / storage
            // land) reads the right count.
            const choices =
                ability.getManaChoices && controllerId && battlefields
                    ? getDynamicManaChoices(card, controllerId, battlefields)
                    : (ability.manaChoices ?? null);
            if (choices) {
                choices.forEach((choice, index) => {
                    // CR 605.1a (issue #1889) — an option that would add NO
                    // mana is not a payment source. The ability-local `index`
                    // is preserved on the options that DO survive, so the
                    // counter-removal rider (Mana Battery / storage land)
                    // still reads the right choice.
                    if (totalManaCount(choice) === 0) return;
                    target.push({
                        mana: choice,
                        source: {
                            kind: "activated",
                            abilityId: ability.id,
                            choiceIndex: index,
                        },
                    });
                });
                continue;
            }
            if (ability.manaProduced) {
                // CR 106.1 — resolve a board-conditional amount (Urza trio) when
                // the board is available; else the static output is the snapshot.
                const dynamic = controllerBattlefield
                    ? getDynamicManaProduced(card, controllerBattlefield)
                    : null;
                const mana = dynamic ?? ability.manaProduced;
                // CR 605.1a (issue #1889) — a mana ability whose CURRENT output
                // is zero (Everflowing Chalice with no charge counters, an empty
                // Gaea's Cradle, the Urza trio one piece short) is not a source
                // that can pay for anything: offering it made the auto-tap
                // solver tap it, gain nothing, and leave the cost unpaid — then
                // abandon the cast. The ability itself stays legal to activate
                // (CR 605.1a does not forbid a pointless activation); it is only
                // removed from the payment / affordability option list, which is
                // what every consumer of this function is asking about.
                if (totalManaCount(mana) === 0) continue;
                target.push({
                    mana,
                    source: { kind: "activated", abilityId: ability.id },
                });
            }
        }
    }

    // CR 305.6 — one intrinsic {T}: Add {C} option per DISTINCT basic land
    // subtype (text-change aware, like `getBasicLandMana`). Always a
    // non-destructive alternative. `?? []` tolerates a slim client
    // `CardInstance` whose `subtypes` may be absent; the server always has it.
    const { subtypes } = applySubstitution(card);
    for (const subtype of subtypes ?? []) {
        const color = LAND_SUBTYPE_MANA[subtype];
        if (color) {
            nonSacrifice.push({
                mana: { [color]: 1 } as ManaCost,
                source: { kind: "basic", subtype },
            });
        }
    }

    // Prefer non-destructive options; fall back to sacrifice abilities only when
    // there is no other way to tap this source for mana (Lotus Petal).
    const combined = nonSacrifice.length > 0 ? nonSacrifice : sacrifice;

    // Dedup by produced `ManaCost`, keeping the first occurrence's provenance.
    const out: ManaTapOption[] = [];
    const seen = new Set<string>();
    for (const opt of combined) {
        const key = manaCostKey(opt.mana);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(opt);
    }
    return out;
}

/** The mana-cost list a player picks from when tapping a source for mana —
 *  `getManaTapOptionsDetailed` without provenance. The index into this list is
 *  the `manaChoiceIndex` the tap mutations expect. */
export function getManaTapOptions(
    card: CardInstanceState,
    controllerId?: string,
    battlefields?: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>
): ManaCost[] {
    return getManaTapOptionsDetailed(card, controllerId, battlefields).map(
        (o) => o.mana
    );
}

/** Total mana count across all colours in a `ManaCost` (ignoring `X`). */
export function totalManaCount(produced: ManaCost): number {
    let total = 0;
    for (const c of MANA_COLORS) total += produced[c] ?? 0;
    return total;
}

/** Scans every battlefield for an active continuous land-mana substitution
 *  (CR 614 — Infernal Darkness / Naked Singularity) and returns the override
 *  colour for `card`, or null when no source applies. A `byBasicSubtype`
 *  source maps the FIRST of `card`'s basic land subtypes it covers; a `color`
 *  source overrides any land unconditionally. The substitution is global —
 *  every player's lands are affected — so all battlefields are scanned. First
 *  applicable source wins (the in-scope cards never overlap on a legal board,
 *  so battlefield order is sufficient — CR 614.1 fine-grained replacement
 *  layering is not needed here). */
function getContinuousLandManaOverride(
    state: GameState,
    card: CardInstanceState
): Color | null {
    if (!isLand(card)) return null;
    for (const player of state.players) {
        for (const source of player.battlefield) {
            const def = getDefinition(source.card.id as string);
            const sub = def.landManaSubstitution;
            if (!sub) continue;
            if ("color" in sub) return sub.color;
            for (const subtype of card.subtypes) {
                const mapped = sub.byBasicSubtype[subtype];
                if (mapped) return mapped;
            }
        }
    }
    return null;
}

/** Applies the active land-mana colour substitutions (CR 614) to the mana a
 *  source is about to add to a pool. Three families compose, in order:
 *
 *  1. Continuous battlefield substitution (Infernal Darkness — all lands →
 *     {B}; Naked Singularity — per-basic-subtype permutation). Rewrites a
 *     LAND's whole output to the same TOTAL quantity of the override colour.
 *  2. Per-turn override (Deep Water — controller's lands → {U} until end of
 *     turn). Same all-or-nothing type rewrite, scoped to the controller.
 *  3. Per-turn riders (FEM High Tide — Island +{U}; Chaos Moon — Mountain +{R}
 *     additional, or Mountain → {C} override). Keyed to a land subtype, global.
 *
 *  Non-land sources (mana rocks, Birds) and lands with no active effect are
 *  returned unchanged. Pure — the single funnel every tap path routes its
 *  produced mana through so the rewrite can't desync across sites. */
export function applyLandManaReplacement(
    state: GameState,
    controllerId: string,
    card: CardInstanceState,
    produced: ManaCost
): ManaCost {
    let result = produced;
    // (1) Continuous battlefield substitution (Infernal Darkness / Naked
    // Singularity) — replaces the land's whole output with the override colour.
    const override = getContinuousLandManaOverride(state, card);
    if (override) {
        const total = totalManaCount(result);
        if (total > 0) result = { [override]: total };
    }
    // (2) Deep Water's per-turn "lands produce {U} instead" override.
    if (
        state.landManaReplacedToBlueThisTurn?.includes(controllerId) &&
        isLand(card)
    ) {
        const total = totalManaCount(result);
        if (total > 0) result = { U: total };
    }
    // (3a) Turn-scoped parametrized riders (Chaos Moon's Mountain rider). An
    // "override" rider rewrites the land's whole output to that colour; an
    // "additional" rider adds one more of that colour per matching arm. Keyed to
    // a land subtype, global. Overrides run before additionals so the override
    // colour is what the additional then increments.
    const riders = state.landManaRidersThisTurn ?? [];
    if (riders.length > 0 && isLand(card)) {
        for (const rider of riders) {
            if (!card.subtypes.includes(rider.subtype)) continue;
            if (rider.mode === "override") {
                const total = totalManaCount(result);
                if (total > 0) result = { [rider.color]: total };
            }
        }
        for (const rider of riders) {
            if (!card.subtypes.includes(rider.subtype)) continue;
            if (rider.mode === "additional") {
                result = {
                    ...result,
                    [rider.color]: (result[rider.color] ?? 0) + 1,
                };
            }
        }
    }
    // (3b) FEM High Tide (CR 614-style additive rider): "Until end of turn,
    // whenever a player taps an Island for mana, that player adds an additional
    // {U}." Global (every player who taps an Island benefits), so the count is
    // the number of active High Tides. Folded into the single mana funnel so
    // every tap path adds the bonus consistently, keyed to Island (CR 305.6).
    if (card.subtypes.includes("Island")) {
        const highTides = state.highTideThisTurn?.length ?? 0;
        if (highTides > 0) {
            result = { ...result, U: (result.U ?? 0) + highTides };
        }
    }
    return result;
}

/** Spend restriction (CR 106.6) carried by a card's fixed tap mana ability, or
 *  null when the produced mana is unrestricted. Mishra's Workshop returns
 *  `"artifact-spell"`; basic lands and ordinary mana rocks return null. Reads
 *  the POST-LAYER set (issue #1880) so a GRANTED restricted mana ability is
 *  not silently spent as unrestricted mana. */
export function getActivatedManaRestriction(
    card: CardInstanceState
): ManaRestriction | null {
    if (abilitiesSuppressed(card)) return null;
    const ability = getEffectiveActivatedAbilities(card).find(
        ({ ability: a }) => a.cost.tap && !a.useStack && a.manaProduced
    )?.ability;
    return ability?.manaRestriction ?? null;
}

/** Returns the activated mana ability definition for a card, or null.
 *
 *  CR 602.5b (issue #947) — when the found ability declares its own
 *  `canActivate` precondition and a state snapshot is supplied, the ability
 *  is gated: an un-imprinted Chrome Mox has NO usable mana ability at all
 *  (not merely one whose `manaChoices` happens to resolve empty), so it must
 *  not be offered as a tappable mana source or reach the tap-for-mana
 *  pipeline. `state` is optional so shape-only callers (definition
 *  introspection with no board snapshot) keep compiling; every real
 *  tap-decision site (the three tap mutations, `hasManaAbility`) passes one.
 *
 *  CR 113.1 / 611.1b (issue #1880) — the search runs over the POST-LAYER
 *  effective set (`getEffectiveActivatedAbilities`), not
 *  `cardDef.activatedAbilities` alone: a permanent GRANTED a `{T}: Add …`
 *  (Urza's Saga chapter I) has a real mana ability, and reading only the
 *  printed list left it invisible to the auto-tap solver and the castability
 *  probe while the client menu still offered it — clickable but contributing
 *  nothing. A permanent under a "loses all abilities" suppression (CR 613.1f,
 *  Titania's Song) still has NO mana ability at all: the early return above
 *  drops the granted ones too, matching every other tap-decision site. */
export function getActivatedManaAbility(
    card: CardInstanceState,
    state?: TriggerStateView
) {
    if (abilitiesSuppressed(card)) return null;
    const ability =
        getEffectiveActivatedAbilities(card).find(
            ({ ability: a }) => !a.useStack && (a.manaProduced || a.manaChoices)
        )?.ability ?? null;
    if (!ability) return null;
    if (ability.canActivate && state && !ability.canActivate(card, state)) {
        return null;
    }
    return ability;
}

/** Returns true if a card has a tap mana ability (basic land subtype or
 *  activated), consulting the activated ability's own `canActivate` gate
 *  when `state` is supplied (CR 602.5b, issue #947).
 *
 *  CR 106.1 / 605.1a (issue #1889) — when `controllerBattlefield` is supplied
 *  AND the ability declares a board-conditional `manaAmount` hook, the CURRENT
 *  output is resolved and a source that would add ZERO mana right now
 *  (Everflowing Chalice with no charge counters, an empty Gaea's Cradle, the
 *  Urza trio one piece short) does NOT count. Without that argument the
 *  predicate is unchanged, so the delta versus the pre-#1889 behaviour is
 *  EXACTLY ZERO for every source with no `manaAmount` hook — the same narrow
 *  support discipline #1499 used for the fetchland fix.
 *
 *  A `getManaChoices` chooser (Fellwar Stone) is deliberately NOT gated here:
 *  it reads EVERY player's battlefield (the opponents' lands), which this
 *  controller-battlefield-only argument cannot supply — evaluating it against a
 *  partial board would wrongly erase a real source. That shape is handled one
 *  level down, in `getManaTapOptionsDetailed`, which does receive every
 *  battlefield and is what the payment / auto-tap paths actually read. */
export function hasManaAbility(
    card: CardInstanceState,
    state?: TriggerStateView,
    controllerBattlefield?: readonly CardInstanceState[]
): boolean {
    if (getBasicLandMana(card) !== null) return true;
    const ability = getActivatedManaAbility(card, state);
    if (!ability) return false;
    if (controllerBattlefield && ability.manaAmount) {
        const dynamic = getDynamicManaProduced(card, controllerBattlefield);
        if (dynamic && totalManaCount(dynamic) === 0) return false;
    }
    return true;
}

/** Whether a permanent counts as ONE available untapped mana source for the
 *  bot's coarse, color-blind mana proxy (the `evaluate` mana / flexibility
 *  terms, `hasCastableInstant`, and the held-interaction predictor). A source
 *  counts only if it is UNTAPPED and can ACTUALLY produce mana (CR 605.1a): a
 *  basic-land subtype (`getBasicLandMana`) or an activated mana ability
 *  (`!useStack && manaProduced|manaChoices`). A land with NO mana ability does
 *  NOT count even though `isLand` is true — a fetchland (CR 305.6: its only
 *  ability is "search your library", never a mana ability) or a Maze of Ith.
 *
 *  Fixes the pre-#1499 predicate `isLand(perm) || hasManaAbility(perm)`, which
 *  counted every untapped land as a source: a fetchland's controller was
 *  over-valued by one `W_MANA`, so cracking the fetchland read as a pure life
 *  loss with no mana gain (the phantom source it sacrificed was already
 *  counted, and the real source it fetched merely replaced that phantom). That
 *  mis-valued the entire fetch subtree — the bot converged AWAY from a forced
 *  crack as search deepened (issue #1499). The delta versus the old predicate
 *  is EXACTLY ZERO for any position whose untapped lands all have a mana
 *  ability (every ordinary board), and non-zero only when a non-mana land is
 *  present — the narrow support ADR 0070 §5 asks for. Pure.
 *
 *  CR 106.1 / 605.1a (issue #1889) — `controllerBattlefield`, when supplied,
 *  is forwarded to `hasManaAbility` so a board-conditional source whose CURRENT
 *  output is zero (Everflowing Chalice with no charge counters) stops counting
 *  as one available mana. Same narrow-support discipline as above: the delta is
 *  EXACTLY ZERO for every source without a `manaAmount` hook. */
export function isUntappedManaSource(
    card: CardInstanceState,
    controllerBattlefield?: readonly CardInstanceState[]
): boolean {
    return (
        !card.isTapped && hasManaAbility(card, undefined, controllerBattlefield)
    );
}

/** Returns true if a card carries an activated ability that is NOT a mana
 *  ability (CR 605.1a) — i.e. a "dual-purpose" source that can do something
 *  beyond tapping for mana: a manland's animate (`{1}: becomes a 2/2`, on the
 *  stack), a firebreathing pump, a Factory's Assembly-Worker buff. Used by the
 *  bot's static Evaluation (issue #794) to value leaving such a source untapped
 *  when auto-tapping. A mana ability is `!useStack && (manaProduced ||
 *  manaChoices)` (CR 605.3a); anything else (a stack ability, or an activated
 *  ability with no mana output) makes the permanent dual-purpose. Suppressed
 *  permanents expose no abilities (CR 613.1f). POST-LAYER set (CR 113.1 /
 *  611.1b, issue #1880) — a GRANTED non-mana ability makes its holder
 *  dual-purpose exactly like a printed one. */
export function hasNonManaActivatedAbility(card: CardInstanceState): boolean {
    if (abilitiesSuppressed(card)) return false;
    return getEffectiveActivatedAbilities(card).some(
        ({ ability: a }) =>
            a.useStack === true || !(a.manaProduced || a.manaChoices)
    );
}
