import type {
    ActivatedAbility,
    BoardManaColorSource,
    CardDefinition,
    CardSupertype,
    Color,
    ManaCost,
    PermanentView,
    TriggerStateView,
} from "../cards/types";
// CR 605.1a — the DECLARATIVE board-derived mana-colour descriptor
// (`ActivatedAbility.manaColorSource`) is evaluated with the engine's SINGLE
// permanent-filter matcher, not a mana-local copy of one. Both modules are
// cycle-free leaves (`cards/filters` imports only `cards/types`;
// `cards/snowReads` is the dependency-free supertype leaf `gre/snow`
// re-exports), so this adds no import cycle.
import { matchesPermanentFilter } from "../cards/filters";
import type { MatchablePermanent } from "../cards/filters";
import { liveSupertypesOf } from "../cards/snowReads";
import { LANDWALK_KEYWORD_BY_BASIC_TYPE } from "../cards/types";
import type { ManaRestriction } from "./types";
import { getDefinition, tryGetDefinition } from "../cards";
// CR 611.2a / 613.1f (issue #1880) — the POST-LAYER activated-ability set
// (native + granted, minus a "loses all abilities" suppression). Every mana
// probe below reads it instead of `cardDef.activatedAbilities` so a GRANTED
// `{T}: Add …` (Urza's Saga chapter I) is visible to the auto-tap solver and
// the castability probe exactly like a printed one.
import { getEffectiveActivatedAbilities } from "./activatedAbilities";
import type { CardInstanceState, GameState, PendingTarget } from "./state";
import { applySubstitution } from "./textChanges";
import {
    STATIC_EFFECT_CTX,
    getEffectivePower,
    getEffectiveToughness,
} from "./layers";
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

// Landwalk keywords mapped to the land subtype they reference (CR 702.14c-g).
// The five-basic-type leg is DERIVED from `LANDWALK_KEYWORD_BY_BASIC_TYPE`
// (`cards/types.ts` — inverted here), not a hand-authored parallel table, so
// the two can't drift; only the non-basic `desertwalk` entry is added on top.
// `LANDWALK_KEYWORD_BY_BASIC_TYPE` itself lives in `cards/types.ts` rather
// than here because this module imports the card registry (`../cards`,
// below) — a `cards/sets/**` card file importing FROM this module re-opens
// the set↔registry eval-time cycle documented at `arn/white.ts` /
// `inv/red.ts` (confirmed by trial: `LANDWALK_KEYWORD_BY_BASIC_TYPE` read as
// `undefined` mid-evaluation when defined here and imported by two set
// files loaded together through the registry). `cards/types.ts` is a
// dependency-free leaf, so cross-set card files (Magnigoth Treefolk
// `pls/green.ts`, Traveler's Cloak `inv/blue.ts`) import the basic-type table
// from there instead.
export const LANDWALK_KEYWORDS: Record<string, string> = {
    ...Object.fromEntries(
        Object.entries(LANDWALK_KEYWORD_BY_BASIC_TYPE).map(
            ([subtype, keyword]) => [keyword, subtype]
        )
    ),
    desertwalk: "Desert",
};

/** Landwalk keywords keyed on a land *supertype* (CR 205.4 / 702.14) rather
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

/** Snow landwalk keywords (CR 702.14 / 205.4a) keyed on the basic land
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

/** CR 613 layer-4 composition (issue #1715) — recompute a target's live
 *  `subtypes[]` by replaying its WHOLE materialized layer-4 record in
 *  timestamp order (CR 613.7).
 *
 *  `grantedSubtypes` (subtype-SET, "is a Mountain") and `grantedSubtypesAdd`
 *  (subtype-ADD, "is a Forest in addition to its other land types", CR 305.7)
 *  are two storage shapes for ONE ordered sequence of layer-4 effects, so both
 *  are merged onto a single `seq` axis and replayed together: a set wipes
 *  whatever earlier entries produced, an add appends to it. Replaying the adds
 *  unconditionally on top of the newest set makes an earlier add outlive a
 *  later set, which is exactly the pass-count-dependent answer issue #1715 is
 *  about.
 *
 *  Ties (equal `seq`, and legacy records persisted before the timestamp
 *  existed, which read as 0) keep sets-before-adds, the pre-#1715 order.
 *
 *  Read `target.grantedSubtypes` / `grantedSubtypesAdd` AFTER they have been
 *  updated: this composes the record, it does not mutate it. Callers that
 *  clear `printedSubtypes` must do so after calling.
 *
 *  Lives here rather than in `state.ts` so the identity-swap replay
 *  (`gre/identitySwap.ts`, issue #1705) can reuse the ONE composer without an
 *  import cycle — `state.ts` imports `copy.ts`, which imports `identitySwap`. */
export function composeMaterializedSubtypes(
    target: CardInstanceState
): string[] {
    const sets = target.grantedSubtypes ?? [];
    const adds = target.grantedSubtypesAdd ?? [];
    if (sets.length === 0 && adds.length === 0) {
        return [...(target.printedSubtypes ?? target.subtypes)];
    }
    // CR 305.7 (issue #1883) — a `subtype-set` "set" entry on a LAND replaces
    // only the land's old LAND TYPES; a subtype belonging to a different card
    // type (Saga on `Enchantment Land — Urza's Saga`) survives. A non-land
    // target (Figure of Destiny's "becomes a Kithkin Spirit") has no CR 305.7
    // analogue and keeps the prior full wholesale replace.
    const isLandTarget = target.types.includes("Land");
    type Layer4Entry =
        | { seq: number; set: string[] }
        | { seq: number; add: string };
    const entries: Layer4Entry[] = [
        ...sets.map((g) => ({ seq: g.seq ?? 0, set: g.subtypes })),
        ...adds.map((a) => ({ seq: a.seq ?? 0, add: a.subtype })),
    ];
    // Stable sort: `Array.prototype.sort` is stable per spec, so equal-seq
    // entries keep the sets-then-adds construction order above.
    entries.sort((a, b) => a.seq - b.seq);
    let composed = [...(target.printedSubtypes ?? target.subtypes)];
    for (const entry of entries) {
        if ("set" in entry) {
            composed = isLandTarget
                ? applyLandTypeReplacement(composed, entry.set)
                : [...entry.set];
        } else if (!composed.includes(entry.add)) {
            composed.push(entry.add);
        }
    }
    return composed;
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

/** CR 614.12a — true when the card declares its modal pick as an AS-ENTERS
 *  choice (`entersWith.asEnters` carrying `{ kind: "mode" }`, ADR 0100 D3).
 *
 *  THE boundary between the two things `chosenModeId` means. The field has
 *  several writers and only one of them is an entry choice:
 *   - a CR 700.2c modal SPELL locks its mode at announcement (`castSpell`,
 *     `convex/game.ts`) and the mode drives targeting and resolution;
 *   - a modal ACTIVATED ability (`resolveActivationMode`) and a modal
 *     TRIGGERED ability (CR 603.3c, `raiseTriggerModeAnnouncement`) each carry
 *     their own, on their own stack item;
 *   - `SpellContext.setChosenMode` REWRITES it on a permanent already on the
 *     battlefield (Chromatic Armor, the Prismatic Ward shield) — a re-choice,
 *     not an entry choice;
 *   - and this one: "As this permanent enters, choose a colour" (CR 614.1c),
 *     which is a REPLACEMENT effect and must therefore be answered on EVERY
 *     entry path — cast, reanimation, put-onto-battlefield, blink from exile,
 *     token copy (CR 614.12's own worked example is a token copy of Voice of
 *     All) — not only when the permanent happens to have been cast.
 *
 *  Only the last one returns true here, and only the last one is retired from
 *  the announcement-time pick: every cast-announcement producer of
 *  `chosenModeId` gates on this predicate so the choice is raised exactly once,
 *  at the CR 614 chokepoint (issue #2019). */
export function declaresAsEntersMode(
    def: Pick<CardDefinition, "entersWith"> | undefined
): boolean {
    return def?.entersWith?.asEnters?.some((c) => c.kind === "mode") === true;
}

/** True if the card has the "Aura" subtype (CR 303.4). Auras ETB attached
 *  to an object via `attachedTo` and are subject to SBA 704.5m. */
export function isAura(card: {
    types: readonly string[];
    subtypes: readonly string[];
}): boolean {
    return card.types.includes("Enchantment") && card.subtypes.includes("Aura");
}

/** CR 112.1 / 113.3 — true when a STACK OBJECT is a spell (a card or copy put
 *  onto the stack), false when it is an activated or triggered ability.
 *
 *  THE single discriminator for that distinction — every site that asks it
 *  now calls this. An ability's stack item is cloned from its source permanent,
 *  so it is indistinguishable from a permanent (and from a permanent spell) by
 *  types/colours alone; the only reliable tell is which ability-id the engine
 *  stamped on it when it went on the stack. The three-field test used to be
 *  open-coded at seven sites — `resolveTopOfStack`, the CR 702.16e damage gate
 *  in `dealDamage` (the site this was extracted for), the three `targetFilters`
 *  spell-filter descriptors, and the client's `getStackModeLines`
 *  (`src/lib/card-utils.ts`) — an eighth guessing a fourth field, or forgetting
 *  `delayedTriggerId`, would call a delayed trigger a spell.
 *
 *  Two nearby predicates deliberately stay open-coded because they are NOT
 *  this test: `gre/state.ts`'s and `gre/triggers.ts`'s are supersets that
 *  additionally exclude other stack shapes.
 *
 *  Structurally typed so the CLIENT's `StackItem` (`src/types/game.ts`, which
 *  carries the same three optional ids) satisfies it too. */
export function isSpellStackItem(item: {
    abilityId?: string;
    triggeredAbilityId?: string;
    delayedTriggerId?: string;
}): boolean {
    return (
        !item.abilityId && !item.triggeredAbilityId && !item.delayedTriggerId
    );
}

/** The kind of target selection in progress, with the ABSENT case resolved.
 *  `PendingTarget.kind` is optional and the spell-cast builder (`announceCast`,
 *  `game.ts`) omits it, so `undefined` means `"cast"` — the engine-wide default
 *  already applied by `finalizeTargetSelection`, `targetActions`,
 *  `pendingTargetOrigin` and the Move enumerator.
 *
 *  THE single place that default lives. It used to be a hand-written
 *  `pt.kind ?? "cast"` at every server site while the CLIENT's gate mapped
 *  `undefined` to "not a spell" — so for the dominant production shape (any
 *  ordinary cast, whose `kind` is absent) the client offered a target the
 *  server then rejected. That is the ADR 0068 offered-vs-accepted divergence,
 *  and a shared default is what makes it unreachable (issue #2296 review). */
export function resolvePendingTargetKind(
    kind: PendingTarget["kind"]
): NonNullable<PendingTarget["kind"]> {
    return kind ?? "cast";
}

/** CR 112.1 / 113.3 — is the source of a pending target selection a SPELL?
 *  A cast or a (copy-)retargeted spell is; an activated OR triggered ability
 *  is not, even though its stack item is a clone of its coloured source
 *  permanent (so no card object can answer this — only the `kind` can).
 *
 *  THE single derivation, read by the server (`pendingTargetingSource`,
 *  `gre/rules.ts` — hence `getLegalTargets` and `selectTarget`) and by the
 *  client's two targeting gates (`src/lib/targeting.ts`: the CR 611
 *  `cantBeTargeted` guard and the CR 702.16a spell-restricted protection
 *  quality). Two independent derivations of the same fact is how the client's
 *  offered set drifts from the server's accepted set one gate at a time. */
export function pendingSourceIsSpell(kind: PendingTarget["kind"]): boolean {
    const resolved = resolvePendingTargetKind(kind);
    return resolved !== "ability" && resolved !== "trigger";
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
 *  CR 113.1 / 611.2a (issue #1880) — reads the POST-LAYER effective set, so a
 *  GRANTED `{T}: Add …` (Urza's Saga chapter I on a land with no printed mana
 *  ability) actually PRODUCES mana. This is the production half of the seam:
 *  the discovery probes (`hasManaAbility`, `getManaTapOptionsDetailed`) already
 *  read the effective set, so leaving this on the printed list let the planner
 *  commit to a source `tapSourceIntoPayment` then rejected with "Card does not
 *  produce mana" — and made `tapUntap` tap the permanent for ZERO mana. */
export function getActivatedManaColor(card: CardInstanceState): Color | null {
    if (abilitiesSuppressed(card)) return null;
    const ability = getEffectiveActivatedAbilities(card).find(
        // ADR 0039 / CR 605.1a — a one-shot mana ability is paid by TAPPING
        // and/or SACRIFICING its source, and the sacrifice-ONLY shape (Eldrazi
        // Spawn's "Sacrifice this token: Add {C}.") is a fixed-output mana
        // ability exactly like a {T} one. Requiring `cost.tap` here made
        // `tapSourceIntoPayment` reject it with "Card does not produce mana"
        // even though `getManaTapOptionsDetailed` had offered it.
        ({ ability: a }) =>
            (a.cost.tap || a.cost.sacrifice) && !a.useStack && a.manaProduced
    )?.ability;
    if (!ability?.manaProduced) return null;
    const colors = Object.entries(ability.manaProduced)
        .filter(([k, v]) => k !== "X" && typeof v === "number" && v > 0)
        .map(([k]) => k as Color);
    return colors.length === 1 ? colors[0] : null;
}

/** Returns the mana produced by a tap mana ability, or null. Supports
 *  multi-color (e.g. Signet). CR 113.1 / 611.2a (issue #1880) — POST-LAYER
 *  effective set, so a GRANTED tap mana ability's output is real. */
export function getActivatedManaProduced(
    card: CardInstanceState
): ManaCost | null {
    if (abilitiesSuppressed(card)) return null;
    const ability = getEffectiveActivatedAbilities(card).find(
        // ADR 0039 — tap and/or sacrifice, same as `getActivatedManaColor`
        // above: the sacrifice-ONLY fixed-output shape must resolve its amount
        // here or `getFixedManaAmount` falls back to a bare 1.
        ({ ability: a }) =>
            (a.cost.tap || a.cost.sacrifice) && !a.useStack && a.manaProduced
    )?.ability;
    return ability?.manaProduced ?? null;
}

/** The card's FIXED-output mana ability whose cost is "Sacrifice this" with NO
 *  {T} component (CR 605.1a, issue #2021), or null.
 *
 *  Deliberately a SEPARATE probe from {@link getActivatedManaColor} /
 *  {@link getActivatedManaProduced} above rather than a loosening of their
 *  `a.cost.tap &&` filter: those two answer "what does TAPPING this source
 *  produce", and every one of their callers (the board's tap-for-mana colour
 *  cue, the tap/untap refund arithmetic, the auto-tap planner's fixed branch)
 *  is built around a tap that can be reversed. A sacrifice-only activation has
 *  no tap to reverse and no untap branch — widening those probes would have
 *  made every one of those callers answer for a source they cannot model.
 *
 *  Tinder Wall ("Sacrifice this creature: Add {R}{R}."), Gaea's Touch, Coal
 *  Golem and the five Invasion Attendants ("{1}, Sacrifice this creature: Add
 *  {U}{B}{R}.") are this shape, as is the Eldrazi Spawn token. A `manaChoices`
 *  sacrifice ability (Lion's Eye Diamond) is NOT: it resolves through the
 *  unified choice branch, which already handles a tap-less cost.
 *
 *  CR 113.1 / 611.2a — POST-LAYER effective set, like every other mana probe. */
export function getFixedSacrificeManaAbility(
    card: CardInstanceState
): ActivatedAbility | null {
    if (abilitiesSuppressed(card)) return null;
    return (
        getEffectiveActivatedAbilities(card).find(
            ({ ability: a }) =>
                !a.useStack &&
                a.cost.sacrifice === true &&
                a.cost.tap !== true &&
                !!a.manaProduced &&
                !a.manaChoices &&
                !a.getManaChoices &&
                !a.manaColorSource
        )?.ability ?? null
    );
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
 *  CR 113.1 / 611.2a (issue #1880) — POST-LAYER effective set, so a GRANTED
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

/** Resolves a {@link BoardManaColorSource} descriptor to the colours it
 *  currently offers. Supplied only by callers that HAVE a board snapshot;
 *  omitting it is the honest "no board, no answer" case (issue #1941). */
type ManaColorSourceResolver = (
    source: BoardManaColorSource
) => Iterable<Color>;

/** Colours a set of activated abilities COULD produce (CR 106.4 — "could
 *  produce"), unioning every non-stack ability's fixed `manaProduced` and
 *  `manaChoices` chooser options. Colourless ({C}) is excluded — {C} is not a
 *  colour (CR 202.2, 106.1b). Shared leaf between the definition-level and
 *  instance-level "could produce" functions below so the two can't drift
 *  apart (issue #1619): this is the part of CR 106.4 that reads only
 *  `CardDefinition.activatedAbilities`, with no instance-only concern
 *  (ability suppression, text-changed subtypes) folded in. */
function producibleColorsFromAbilities(
    abilities: readonly ActivatedAbility[] | undefined,
    resolveManaColorSource?: ManaColorSourceResolver
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
        // CR 605.1a / 106.4 (issue #1941) — a DESCRIPTOR ability's colour set
        // is BOARD-derived, so its static `manaChoices` is a no-board fallback
        // list ("any single colour"), NOT a claim about what the source could
        // produce. Unioning that fallback made every `manaColorSource`
        // permanent read as a WUBRG source to every CR 106.4 consumer — the
        // castability gate, the auto-tap solver, Fellwar Stone / Quirion
        // Explorer reading it as a contributing land, the drafter's Fixing
        // Value term, `evaluate`'s colour-breadth term — even when the
        // descriptor currently resolves to NOTHING. The honest answer needs
        // the board: with a resolver the descriptor is evaluated against it,
        // without one (definition-level analysis, no battlefield) the ability
        // contributes nothing rather than five phantom colours.
        if (ability.manaColorSource) {
            if (resolveManaColorSource) {
                for (const c of resolveManaColorSource(ability.manaColorSource))
                    colors.add(c);
            }
            continue;
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
 *  CR 113.1 / 611.2a (issue #1880) — the ability union is the POST-LAYER
 *  effective set, the third instance-only concern: a GRANTED mana ability
 *  (Urza's Saga chapter I) is a real "could produce" source, so a land holding
 *  only a granted `{T}: Add {G}` reads as a green source to Fellwar Stone and
 *  to mana-source classification, exactly as every sibling probe already sees
 *  it. `getDefinitionProducibleColors` (definition-level, no instance, no
 *  battlefield) necessarily stays printed-only — a grant lives on an instance. */
export function getProducibleColors(
    card: CardInstanceState,
    resolveManaColorSource?: ManaColorSourceResolver
): Set<Color> {
    const colors = new Set<Color>();
    if (abilitiesSuppressed(card)) return colors;
    // CR 305.6 — intrinsic basic-land subtype abilities (text-change aware).
    const intrinsic = getBasicLandMana(card);
    if (intrinsic && intrinsic !== "C") colors.add(intrinsic);
    for (const c of producibleColorsFromAbilities(
        getEffectiveActivatedAbilities(card).map(({ ability }) => ability),
        resolveManaColorSource
    ))
        colors.add(c);
    return colors;
}

/** How many levels of `manaColorSource` descriptor nesting the CR 106.4
 *  "could produce" read follows before it stops (issue #1941).
 *
 *  A descriptor read against the board can meet ANOTHER descriptor permanent
 *  — Quirion Explorer reads an opponent's Meteor Crater, whose own descriptor
 *  reads that opponent's permanents, one of which may be a Fellwar Stone that
 *  reads back… The relation is not acyclic (two Meteor Craters facing each
 *  other cycle in one step), so the termination argument cannot come from the
 *  data: it is this hard depth bound. `1` = the activating ability's own
 *  descriptor (depth 0) is evaluated against the board, and each contributing
 *  permanent's descriptor is evaluated once more (depth 1); at that level
 *  nested descriptors contribute nothing. That covers every real board — the
 *  CR-correct "Meteor Crater could produce {G} because its controller has a
 *  green creature, therefore Quirion Explorer could produce {G}" chain — while
 *  making non-termination structurally impossible rather than merely unlikely.
 *  The divergence past depth 1 is conservative: a deeper chain UNDER-reports
 *  (offers no colour) instead of inflating, so it can never authorize illegal
 *  mana (CR 605.1a). */
const MAX_NESTED_MANA_COLOR_SOURCE_DEPTH = 1;

/** Board-aware twin of {@link getProducibleColors} (CR 106.4): identical in
 *  every respect except that a `manaColorSource` DESCRIPTOR ability is
 *  evaluated against the supplied board instead of contributing nothing.
 *  Every consumer that has a board snapshot should read this one — a lone
 *  Meteor Crater produces no colour, the same Crater beside a green creature
 *  produces {G} (issue #1941). */
export function getProducibleColorsOnBoard(
    card: CardInstanceState,
    battlefields: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>,
    depth = 0
): Set<Color> {
    return getProducibleColors(
        card,
        depth < MAX_NESTED_MANA_COLOR_SOURCE_DEPTH
            ? (source) =>
                  boardDerivedManaColors(
                      source,
                      card,
                      card.controllerId,
                      battlefields,
                      depth + 1
                  )
            : undefined
    );
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
/** Evaluates a {@link BoardManaColorSource} against the live board and returns
 *  the mana options it offers: ONE mana of each colour the described permanents
 *  contribute, in canonical WUBRG order (CR 605.1a).
 *
 *  Both derivations are honest reads of the CURRENT board, recomputed at every
 *  activation — a land entering or leaving, a Blood Moon rewriting a dual, a
 *  colour-changing effect all move the offered set immediately:
 *  - `"produces"` unions `getProducibleColors` (CR 106.4 "could produce" —
 *    basic-land subtypes, fixed and choice mana abilities, post-layer granted
 *    ones, minus suppressed ones). {C} is excluded there already (CR 202.2).
 *  - `"isColor"` unions the permanent's own post-layer-5 colours (CR 105.2).
 *
 *  An EMPTY result is a real answer, not "unknown": it means the scope
 *  currently contributes no colour, so the ability offers nothing and every
 *  consumer of `getDynamicManaChoices` — the castability probe, the auto-tap
 *  solver, the tap-option enumerator, the client picker — correctly drops the
 *  source instead of showing a false affordance. That is why this returns
 *  `[]` rather than `null`: `null` would fall through to the ability's static
 *  `manaChoices` fallback and re-inflate the offer.
 *
 *  The permanents are matched against a LAYER-AWARE view: live colours
 *  (`STATIC_EFFECT_CTX.getColors`), live supertypes (`liveSupertypesOf`, so
 *  `supertypes: "Basic"` sees a Blood-Moon'd / snow-mutated board correctly)
 *  and live effective P/T, through the engine's single
 *  `matchesPermanentFilter` authority — no second matcher. */
export function boardDerivedManaChoices(
    source: BoardManaColorSource,
    self: CardInstanceState,
    controllerId: string,
    battlefields: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>
): ManaCost[] {
    const colors = boardDerivedManaColors(
        source,
        self,
        controllerId,
        battlefields,
        0
    );
    return MANA_COLORS.filter((c) => c !== "C" && colors.has(c)).map(
        (c) => ({ [c]: 1 }) as ManaCost
    );
}

/** Colour-set core of {@link boardDerivedManaChoices}. `depth` is the descriptor
 *  nesting level, bounded by {@link MAX_NESTED_MANA_COLOR_SOURCE_DEPTH}. */
function boardDerivedManaColors(
    source: BoardManaColorSource,
    self: CardInstanceState,
    controllerId: string,
    battlefields: ReadonlyArray<{
        playerId: string;
        battlefield: readonly CardInstanceState[];
    }>,
    depth: number
): Set<Color> {
    const layerView = manaLayerView(battlefields);
    const ctx = {
        selfInstanceId: self.id,
        // CR 109.5 — "you" on an ability is its CONTROLLER, which is what
        // `controllerRelation: "you" | "opponents"` resolves against.
        selfControllerId: controllerId,
        supertypesOf: liveSupertypesOf,
    };
    const colors = new Set<Color>();
    for (const { battlefield } of battlefields) {
        for (const permanent of battlefield) {
            // CR 105 / 202.2 / 613.1d — live colours, so a `colors` filter and
            // the `"isColor"` derivation below agree with the board.
            const liveColors = STATIC_EFFECT_CTX.getColors(permanent);
            const pt = withEffectivePT(permanent, layerView);
            const view: MatchablePermanent = {
                ...permanent,
                staticAbilities: permanent.staticAbilities ?? [],
                colors: liveColors,
                power: pt.power,
                toughness: pt.toughness,
            };
            if (!matchesPermanentFilter(view, source.filter, ctx)) continue;
            if (source.colors === "produces") {
                // CR 106.4 (issue #1941) — DESCRIPTOR-aware: a contributing
                // permanent whose own colour set is board-derived is evaluated
                // against THIS same board (bounded by
                // `MAX_NESTED_MANA_COLOR_SOURCE_DEPTH`), never off its static
                // no-board `manaChoices` fallback, which would make every such
                // permanent a phantom WUBRG source.
                for (const c of getProducibleColorsOnBoard(
                    permanent,
                    battlefields,
                    depth
                ))
                    colors.add(c);
            } else {
                for (const c of liveColors) colors.add(c);
            }
        }
    }
    return colors;
}

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
        ({ ability: a }) =>
            !a.useStack && (a.manaColorSource || a.getManaChoices)
    )?.ability;
    if (!ability) return null;
    // CR 605.1a — the DECLARATIVE board-derived colour set wins over a closure
    // when a card carries both (see `ActivatedAbility.manaColorSource`).
    if (ability.manaColorSource) {
        return boardDerivedManaChoices(
            ability.manaColorSource,
            card,
            controllerId,
            battlefields
        );
    }
    if (!ability.getManaChoices) return null;
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
                // CR 106.4 (issue #1941) — board-aware, so a contributing
                // permanent with its own board-derived colour set reports what
                // it CURRENTLY could produce, not its five-colour fallback.
                producibleColors: [
                    ...getProducibleColorsOnBoard(p, battlefields),
                ],
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
 *  CR 605.1a (issue #1889) — a FIXED-output ability whose CURRENT output totals
 *  zero (a `manaAmount` hook resolving to 0: Everflowing Chalice with no charge
 *  counters, an empty Gaea's Cradle, the Urza trio one piece short) is omitted:
 *  it cannot pay for anything, and offering it made the auto-tap solver tap it,
 *  gain nothing and abandon the cast. That drop is scoped to the fixed branch
 *  ONLY. A CHOICE list keeps every entry, zero-output included, precisely
 *  because its index is load-bearing (see the storage-land note above) and
 *  because `getEffectiveManaChoices` — the other authority on that same list —
 *  keeps it too: the two must stay index-identical or one tap has two index
 *  spaces.
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

    // CR 113.1 / 611.2a (issue #1880) — the POST-LAYER set: printed abilities
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
                (ability.getManaChoices || ability.manaColorSource) &&
                controllerId &&
                battlefields
                    ? getDynamicManaChoices(card, controllerId, battlefields)
                    : (ability.manaChoices ?? null);
            if (choices) {
                // CR 605.1a (issue #1889) — the zero-output drop below is
                // deliberately NOT applied to a CHOICE list. A storage land's
                // choices ARE its "remove N counters" ladder, and the index IS
                // the counter count, so dropping the index-0 "remove 0" entry
                // would shift every later index by one: `tapSourceIntoPayment`
                // would remove N+1 counters for the player's pick of N, and the
                // unified list would stop agreeing with `getEffectiveManaChoices`
                // (which keeps the entry) — two index spaces for one tap.
                // A chooser's zero entry is a legal, deliberate pick, not a dead
                // payment source; the zero-output problem #1889 fixes is the
                // FIXED-output branch (a `manaAmount` hook resolving to 0).
                choices.forEach((choice, index) => {
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

/** Spend restriction (CR 106.6) carried by the SPECIFIC ability that offers a
 *  `getManaTapOptionsDetailed` option (`ManaTapOption.source`), or null when
 *  that particular option is unrestricted. Unlike `getActivatedManaRestriction`
 *  above (which inspects only the FIRST tap mana ability on the card — correct
 *  for a single-ability source like Mishra's Workshop, but blind to a SECOND,
 *  distinct ability), this resolves the EXACT ability behind `source` so a
 *  card mixing a free ability with a restricted one reports restriction
 *  per-OPTION, not per-card (Delighted Halfling, issue #1559 review: "{T}: Add
 *  {C}." is unrestricted, the separate "{T}: Add one mana of any color. Spend
 *  this mana only to cast a legendary spell..." is). A `"basic"` intrinsic
 *  basic-land-subtype pick (CR 305.6) carries no restriction. Used by the
 *  auto-tap solver (`autoTap.ts`) to exclude only the actually-restricted
 *  options from its candidate set, instead of the whole source. */
export function getManaTapOptionRestriction(
    card: CardInstanceState,
    source: ManaTapOptionSource
): ManaRestriction | null {
    if (source.kind !== "activated") return null;
    const cardId = (card.card as { id?: string }).id;
    const cardDef = cardId ? tryGetDefinition(cardId) : undefined;
    const ability = cardDef?.activatedAbilities?.find(
        (a) => a.id === source.abilityId
    );
    return ability?.manaRestriction ?? null;
}

/** Counter cost (CR 122.6) carried by the SPECIFIC option a `getManaChoices`
 *  index resolves to — a Mana Battery / storage land whose ability declares
 *  `manaChoiceRemovesCounters`: choosing index N removes N counters of that
 *  type as part of paying the ability's cost (`game.ts`'s
 *  `manaChoiceRemovesCounters` handling). Null for any option that removes no
 *  counters, including index 0 — the storage land's "remove 0 counters, add
 *  the base amount" pick is a free (non-destructive) option, exactly like an
 *  ordinary `{T}: Add` ability. Used by the auto-tap solver (`autoTap.ts`,
 *  issue #2240 regression) to exclude only the counter-BURNING options from
 *  its candidate set — the same per-OPTION-not-per-source shape as
 *  `getManaTapOptionRestriction` above — so a battery stays auto-tappable for
 *  its free base mana without the solver ever spending the player's stored
 *  counters on their behalf. */
export function getManaChoiceCounterCost(
    card: CardInstanceState,
    source: ManaTapOptionSource
): { counterType: string; count: number } | null {
    if (source.kind !== "activated" || !source.choiceIndex) return null;
    const cardId = (card.card as { id?: string }).id;
    const cardDef = cardId ? tryGetDefinition(cardId) : undefined;
    const ability = cardDef?.activatedAbilities?.find(
        (a) => a.id === source.abilityId
    );
    if (!ability?.manaChoiceRemovesCounters) return null;
    return {
        counterType: ability.manaChoiceRemovesCounters,
        count: source.choiceIndex,
    };
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
 *  CR 113.1 / 611.2a (issue #1880) — the search runs over the POST-LAYER
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
            ({ ability: a }) =>
                !a.useStack &&
                // CR 605.1a (issue #1941) — a DESCRIPTOR (`manaColorSource`)
                // is a mana-output declaration in its own right, exactly like
                // `manaProduced` / `manaChoices`. Every shipped descriptor card
                // also carries a static `manaChoices` fallback, so this is
                // inert today — but a descriptor-ONLY ability would otherwise
                // read as having NO mana ability here (and as "dual-purpose"
                // in `hasNonManaActivatedAbility`), which is precisely the
                // single-authority claim this predicate is supposed to hold.
                (a.manaProduced || a.manaChoices || a.manaColorSource)
        )?.ability ?? null;
    if (!ability) return null;
    if (ability.canActivate && state && !ability.canActivate(card, state)) {
        return null;
    }
    return ability;
}

/** CR 302.6 — true when this permanent's mana ability is paid PURELY by
 *  sacrificing the source: no {T} leg, and no intrinsic basic-land mana that
 *  would be tapped for instead (Eldrazi Spawn's "Sacrifice this token: Add
 *  {C}.", Lion's Eye Diamond's "Discard your hand, Sacrifice this artifact:
 *  …").
 *
 *  Such an ability is reachable in two states the two standard tap gates
 *  otherwise refuse:
 *    • SUMMONING SICK — CR 302.6 restricts an activated ability only when its
 *      cost contains {T} or {Q}, so a freshly-created Eldrazi Spawn may be
 *      sacrificed for mana the turn it arrives.
 *    • ALREADY TAPPED — "already tapped" is a statement about paying {T};
 *      sacrificing a tapped permanent is legal.
 *
 *  A {T}+sacrifice ability (Basal Thrull) is deliberately NOT included: it has
 *  a tap leg, so both gates keep applying to it exactly as before.
 *
 *  Scope note — this exception belongs to the EXPLICIT payment path
 *  (`tapSourceIntoPayment`, `convex/game.ts`), where the player picked this
 *  source. It is deliberately NOT wired into the castability mana census
 *  (`getProducibleManaOptions` / `getProducibleManaUnits`, `gre/rules.ts`):
 *  those pass `requireTap: true` so the AUTO-tap planner can never commit a
 *  sacrifice-only source on the player's behalf — auto-sacrificing a token, or
 *  discarding a hand to Lion's Eye Diamond, is a decision the planner has no
 *  standing to make. */
export function manaAbilityPaidWithoutTapping(
    card: CardInstanceState,
    state?: TriggerStateView
): boolean {
    const ability = getActivatedManaAbility(card, state);
    return (
        ability?.cost.sacrifice === true &&
        ability.cost.tap !== true &&
        getBasicLandMana(card) === null
    );
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
 *  (`!useStack && manaProduced|manaChoices|manaColorSource`). A land with NO mana ability does
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
 *  manaChoices || manaColorSource)` (CR 605.3a, issue #1941); anything else
 *  (a stack ability, or an activated
 *  ability with no mana output) makes the permanent dual-purpose. Suppressed
 *  permanents expose no abilities (CR 613.1f). POST-LAYER set (CR 113.1 /
 *  611.2a, issue #1880) — a GRANTED non-mana ability makes its holder
 *  dual-purpose exactly like a printed one. */
export function hasNonManaActivatedAbility(card: CardInstanceState): boolean {
    if (abilitiesSuppressed(card)) return false;
    return getEffectiveActivatedAbilities(card).some(
        ({ ability: a }) =>
            a.useStack === true ||
            // CR 605.1a (issue #1941) — a `manaColorSource` descriptor makes
            // the ability a mana ability, so it must NOT read as the
            // "something beyond tapping for mana" that marks a source
            // dual-purpose.
            !(a.manaProduced || a.manaChoices || a.manaColorSource)
    );
}
