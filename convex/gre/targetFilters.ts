/** Target-filter registry — the single compile-bound authority for target
 *  legality (ADR 0068, PRD #1407). **T1** (issue #1408) shipped the registry
 *  scaffold + the PERMANENT kind, folding in the existing
 *  `intrinsicPermanentTargetViolation` shared predicate. **T2** (issue
 *  #1409) added the SPELL kind: every filter previously validated
 *  inline, independently, by both `getLegalTargets`'s spell loop and
 *  `selectTarget`'s spell branch now routes through one `checks.spell` per
 *  descriptor. **T3** (issue #1410, this slice) adds the PLAYER kind
 *  (`controller` — seat relationship — and `playerAttackedThisTurn`, CR
 *  506.2) and the CARD kind (graveyard-card targets: `controller` — the
 *  graveyard's OWNER, not a card's own `controllerId`, which is not
 *  reliably reset off the battlefield — and `mvFilter`). Migrating the
 *  graveyard-card `controller` check also fixes a real latent divergence:
 *  `getLegalTargets`'s graveyard branch already honored `controller:
 *  "active"`, but `selectTarget`'s graveyard-card branch never implemented
 *  that case at all — exactly the Phelia bug class this registry exists to
 *  close, now closed for the last kind. **T4** (issue #1411, this slice) arms
 *  the compile-time forcing function: `REGISTRY` is now declared `satisfies
 *  Record<FilterKey, FilterDescriptor<unknown>>` where `FilterKey = keyof
 *  Omit<TargetRequirement, StructuralKey>` (see both types below). A new
 *  `TargetRequirement` field cannot be added without EITHER a `REGISTRY`
 *  entry (it's a filter) OR a `StructuralKey` addition with a one-line reason
 *  (it isn't) — `tsc` refuses to compile otherwise. The per-kind key lists
 *  (`PERMANENT_FILTER_KEYS`, `SPELL_FILTER_KEYS`, `PLAYER_FILTER_KEYS`,
 *  `CARD_FILTER_KEYS`) stay as explicit arrays — they encode CHECK ORDER
 *  (which filter's violation message wins when several fail), a property
 *  `keyof Omit<...>` cannot express since object-type key order is not part
 *  of TypeScript's type system.
 *
 *  **Lower once, check everywhere** (the whole point): `lower` resolves a
 *  `TargetRequirement` field to its `PendingTarget` carry value (X-resolution,
 *  `string | string[]` normalization) — that value IS the corresponding
 *  `PendingTarget` field. `getLegalTargets` lowers then runs `checks.permanent`
 *  / `checks.spell` per candidate; `selectTarget` (`game.ts`) runs the SAME
 *  check against the already-lowered `PendingTarget`. Offered set == accepted
 *  set by construction — there is no second implementation of any filter to
 *  drift (the Phelia bug class, `78c0279c`, and its spell-flavored twin
 *  closed by T2).
 *
 *  This module has NO dependency on `./rules` — `rules.ts` and `game.ts`
 *  import from here instead, so the dependency direction stays acyclic. The
 *  handful of low-level predicates the checks need (`hasColor`,
 *  `matchesMvFilter`, `resolveMvFilter`, `matchesBattlefieldController`,
 *  `mvOfStackItem`, `spellMatchesExcludeTypeFilter`,
 *  `spellMatchesCreaturePtFilter`, `spellWouldDestroyLandControlledBy`) moved
 *  here from `rules.ts`; `rules.ts` re-exports them for backward
 *  compatibility with existing callers/imports. */
import type { CardType, Color, TargetRequirement } from "../cards/types";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
    StackItem,
} from "./state";
import {
    STATIC_EFFECT_CTX,
    getEffectivePower,
    getEffectiveToughness,
} from "./layers";
import { hasSupertypeLive } from "./snow";
import { isLand, manaValue } from "./constants";
import { getInstanceManaCost, tryGetDefinition } from "../cards";

// ─── Shared low-level predicates (moved from rules.ts) ──────────────────────

/** True if the permanent/stack item has at least one of the given color in
 *  its mana cost (CR 202.2). Used by TargetRequirement.colorFilter. */
export function hasColor(card: CardInstanceState, color: Color): boolean {
    return STATIC_EFFECT_CTX.getColors(card).includes(color);
}

/** Resolves a TargetRequirement.mvFilter's `"X"` / `"sourcePower"`
 *  placeholders against the announced chosenX / source's live effective power
 *  so downstream code only sees numeric bounds. `sourcePower` (issue #1378)
 *  is the announcing trigger/ability source's CURRENT effective power (CR
 *  613 layer 7c) — see the field's doc comment on `TargetRequirement.mvFilter`
 *  (`cards/types.ts`) for the CR 603.3d snapshot-timing rationale. Used by
 *  getLegalTargets and selectTarget validation. */
export function resolveMvFilter(
    filter: TargetRequirement["mvFilter"] | undefined,
    chosenX: number | undefined,
    sourcePower?: number
): { min?: number; max?: number; equals?: number } | undefined {
    if (!filter) return undefined;
    const resolveOne = (
        v: number | "X" | "sourcePower" | undefined
    ): number | undefined => {
        if (v === undefined) return undefined;
        if (v === "X") return chosenX ?? 0;
        if (v === "sourcePower") return sourcePower ?? 0;
        return v;
    };
    return {
        ...(filter.min !== undefined ? { min: resolveOne(filter.min)! } : {}),
        ...(filter.max !== undefined ? { max: resolveOne(filter.max)! } : {}),
        ...(filter.equals !== undefined
            ? { equals: resolveOne(filter.equals)! }
            : {}),
    };
}

/** Computes mana value for a target lookup. For permanents on the
 *  battlefield, X-cost permanents currently report 0 for X (the chosen X
 *  is not persisted on the resulting permanent). */
function mvOfPermanent(card: CardInstanceState): number {
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    return manaValue(def?.manaCost);
}

/** Computes mana value for a graveyard (or hand) card target lookup (CR
 *  202.3, Sevinne's Reclamation's "mana value 3 or less"). Unlike
 *  `mvOfPermanent`, reads through `getInstanceManaCost` (embedded-override
 *  aware) rather than the definition directly — the exact computation
 *  `getLegalTargets`'s pre-T3 graveyard branch used, preserved verbatim
 *  (ADR 0068 / issue #1410, T3). */
function mvOfCard(card: CardInstanceState): number {
    return manaValue(getInstanceManaCost(card));
}

/** Tests a resolved mvFilter against a target's mana value. Empty filter
 *  always matches; otherwise all declared bounds (min/max/equals) must hold. */
export function matchesMvFilter(
    filter: { min?: number; max?: number; equals?: number } | undefined,
    mv: number
): boolean {
    if (!filter) return true;
    if (filter.equals !== undefined && mv !== filter.equals) return false;
    if (filter.min !== undefined && mv < filter.min) return false;
    if (filter.max !== undefined && mv > filter.max) return false;
    return true;
}

/** Computes mana value for a stack item (spell or ability), X-inclusive
 *  (CR 202.3b — once on the stack, X is the chosen value, not 0). Used by
 *  TargetRequirement.mvFilter for `type: "spell"` targets. Moved from
 *  `rules.ts` (ADR 0068 / issue #1409, T2) so the spell mv computation lives
 *  alongside every other spell-target predicate; `rules.ts` no longer needs
 *  its own copy. */
export function mvOfStackItem(item: {
    card: unknown;
    chosenX?: number;
}): number {
    const cardId = (item.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    return manaValue(def?.manaCost) + (item.chosenX ?? 0);
}

/** CR 114.1 — Spell Pierce's "target noncreature spell": true when `item` is
 *  a legal spell target under `excludeTypes` (an ability never qualifies; an
 *  actual spell must match NONE of the given card types). An
 *  undefined/empty filter always passes. Shared by `getLegalTargets`'s spell
 *  loop and `selectTarget`'s server-side validation (game.ts) — one
 *  predicate, two call sites (issue #683). Moved from `rules.ts` (ADR 0068 /
 *  issue #1409, T2) to become the `spellExcludeTypeFilter` registry check;
 *  `rules.ts` re-exports it for backward compatibility. */
export function spellMatchesExcludeTypeFilter(
    item: StackItem,
    excludeTypes: ReadonlyArray<CardType> | undefined
): boolean {
    if (!excludeTypes || excludeTypes.length === 0) return true;
    if (item.abilityId || item.triggeredAbilityId || item.delayedTriggerId) {
        return false;
    }
    return !excludeTypes.some((t) => item.types.includes(t));
}

/** CR 114.1 + 208.2 — Stern Scolding's "target creature spell with power or
 *  toughness N or less": true when `item` is a legal spell target under
 *  `filter` (an ability never qualifies; the spell must be a creature spell
 *  whose power OR toughness, as printed on the card, is at most the given
 *  number). An undefined filter always passes. Shared by `getLegalTargets`'s
 *  spell loop and `selectTarget`'s server-side validation (issue #683).
 *  Moved from `rules.ts` (ADR 0068 / issue #1409, T2) to become the
 *  `spellCreaturePtFilter` registry check; `rules.ts` re-exports it. */
export function spellMatchesCreaturePtFilter(
    item: StackItem,
    filter: { maxPowerOrToughness: number } | undefined
): boolean {
    if (!filter) return true;
    if (item.abilityId || item.triggeredAbilityId || item.delayedTriggerId) {
        return false;
    }
    if (!item.types.includes("Creature")) return false;
    const max = filter.maxPowerOrToughness;
    const powerOk = item.power !== undefined && item.power <= max;
    const toughnessOk = item.toughness !== undefined && item.toughness <= max;
    return powerOk || toughnessOk;
}

/** CR 114.1 + 701.7 — would the spell `item` on the stack destroy a land that
 *  `playerId` controls? Inspects the spell DECLARATIVELY (never runs its
 *  imperative `resolve()`): a single-target `effect: "destroy-target"` whose
 *  chosen permanent target is a land controlled by `playerId`, or a mass
 *  land-destruction spell flagged `destroysAllLands` while `playerId` controls
 *  at least one land. Abilities on the stack are not spells and never qualify.
 *  Reusable predicate (not Equinox-specific) — drives the
 *  `spellWouldDestroyLandYouControl` spell-target filter. Per the Legends
 *  rulings, only DIRECT destruction counts (damage-to-animated-land,
 *  sacrifice, and random/indirect destruction are excluded by construction —
 *  they aren't `destroy-target`/`destroysAllLands`). Moved from `rules.ts`
 *  (ADR 0068 / issue #1409, T2); `rules.ts` re-exports it for backward
 *  compatibility. */
export function spellWouldDestroyLandControlledBy(
    state: GameState,
    item: StackItem,
    playerId: string
): boolean {
    // An activated/triggered/delayed ability on the stack is not a spell.
    if (item.abilityId || item.triggeredAbilityId || item.delayedTriggerId) {
        return false;
    }
    const cardId = (item.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    if (!def) return false;

    const controlsALand = state.players
        .find((p) => p.id === playerId)
        ?.battlefield.some((c) => isLand(c) && c.controllerId === playerId);

    // Mass land destruction (Armageddon): destroys every land in play, so it
    // destroys the activator's land iff they control any land at all.
    if (def.destroysAllLands) return !!controlsALand;

    // Single-target "Destroy target land" (Stone Rain / Sinkhole / Ice Storm):
    // qualifies iff one of the chosen targets is a land this player controls.
    // Both declarative authoring modes qualify: the `effect: "destroy-target"`
    // shorthand and an Effect Script carrying a `destroy` Op (ADR 0045).
    if (
        def.effect === "destroy-target" ||
        def.effects?.some((op) => op.op === "destroy")
    ) {
        for (const t of item.targets ?? []) {
            if (t.type !== "permanent") continue;
            for (const p of state.players) {
                const perm = p.battlefield.find((c) => c.id === t.id);
                if (perm && isLand(perm) && perm.controllerId === playerId) {
                    return true;
                }
            }
        }
    }
    return false;
}

/** CR 109.3 / 102.1 — the single authority on a battlefield/permanent target's
 *  controller-relationship filter (`TargetRequirement.controller`). Both
 *  `getLegalTargets` (which permanents may be offered) and the `selectTarget`
 *  mutation's permanent branch (which permanents the server will accept —
 *  anti-spoof) route through this predicate so the two can never disagree.
 *
 *  - `"you"`      — the permanent's controller is the chooser (Simulacrum).
 *  - `"opponent"` — the controller is NOT the chooser (Nettling Imp). A missing
 *                   `chooserId` can never satisfy this.
 *  - `"active"`   — the controller is the active player regardless of who is
 *                   choosing (Arcum's Whistle).
 *  - `"any"` / undefined — no controller restriction. */
export function matchesBattlefieldController(
    controllerId: string,
    chooserId: string | undefined,
    activePlayerId: string,
    filter: TargetRequirement["controller"]
): boolean {
    switch (filter ?? "any") {
        case "you":
            return chooserId !== undefined && controllerId === chooserId;
        case "opponent":
            return chooserId !== undefined && controllerId !== chooserId;
        case "active":
            return controllerId === activePlayerId;
        case "any":
            return true;
    }
}

/** `T | T[] | undefined` → `T[] | undefined` normalization shared by every
 *  `lower()` that accepts the shorthand-single-value authoring convenience. */
function arr<T>(v: T | T[] | undefined): T[] | undefined {
    return v === undefined ? undefined : Array.isArray(v) ? v : [v];
}

// ─── Registry shape (ADR 0068) ──────────────────────────────────────────────

/** The four object kinds a `TargetRequirement` can resolve to. Only
 *  `"permanent"` has registry entries in T1 — spell/player/card land in
 *  T2/T3. */
export type TargetKind = "permanent" | "spell" | "player" | "card";

// ─── T4 keystone: the compile-time forcing function (ADR 0068, issue #1411) ─

/** The `TargetRequirement` fields that are NOT a per-candidate filter — they
 *  do not get a `REGISTRY` entry, and are excluded from `FilterKey` below by
 *  `Omit`. Every one of the six is here because it fails the same test: it
 *  is never passed to a `FilterDescriptor.checks` predicate against a
 *  candidate. Audited field-by-field against the CURRENT `TargetRequirement`
 *  (`cards/types.ts`) as part of this slice — this list intentionally
 *  corrects the illustrative one sketched in ADR 0068's Decision section
 *  before the audit happened: `"min" | "max" | "equals"` are not top-level
 *  `TargetRequirement` keys at all (they exist only NESTED inside
 *  `mvFilter`/`powerFilter`/`toughnessFilter`/`count`, already covered by
 *  their PARENT filter's own descriptor), and `"zone"` — a REAL top-level
 *  key the ADR sketch omitted — belongs here instead. Adding a field to
 *  `TargetRequirement` forces a conscious choice: give it a `REGISTRY` entry
 *  (a filter), or add it here with a one-line reason (structural). There is
 *  no third option. */
type StructuralKey =
    // Declares which `TargetKind` branch even runs (permanent / spell /
    // player / card) — routing, not a predicate evaluated against one
    // candidate.
    | "type"
    // Cardinality of the selection (how many targets to choose) — not a
    // legality predicate on any single candidate.
    | "count"
    // Selects WHICH candidate population is queried (battlefield vs.
    // graveyard) — like `type`, this routes to an entirely different
    // site-selection branch (`getLegalTargets`/`selectTarget`) rather than
    // filtering candidates within one already-selected population.
    | "zone"
    // Divide-as-you-choose damage/counter BUDGET bookkeeping (CR 601.2d) —
    // an amount-assignment concern, not a target-legality predicate.
    | "divideAsChosen"
    // A directive read by `raiseTriggerTargetSelection` (`rules.ts`) that
    // tells it to APPEND the trigger source's id into `excludeInstanceIds`
    // (the real, registered filter) — never itself checked against a
    // candidate.
    | "excludeSource"
    // A directive read by `raiseTriggerTargetSelection` that tells it to
    // dynamically POPULATE `spellTargetsInstanceIds` (the real, registered
    // filter) from the trigger source — never itself checked against a
    // candidate.
    | "spellTargetsSelfSource";

/** The forcing function itself: every requirement-declared filter field,
 *  derived by omission rather than a hand-maintained list. `REGISTRY`
 *  (below) is declared `satisfies Record<FilterKey, FilterDescriptor<unknown>>`
 *  — this only compiles when EVERY member of `FilterKey` has an entry, so a
 *  filter field newly added to `TargetRequirement` without a matching
 *  registry entry (or a `StructuralKey` classification) fails `tsc`. This is
 *  the "cannot recur" guarantee the original Phelia fix (`78c0279c`) lacked:
 *  offered-set/accepted-set drift is now a compile error, not a runtime bug
 *  caught by author discipline. */
export type FilterKey = keyof Omit<TargetRequirement, StructuralKey>;

/** Context threaded into every `check`. Source-dependent (chooser/active
 *  player/source characteristics) so a filter's check can read them without
 *  each descriptor re-deriving them. */
export interface TargetFilterCtx {
    state: GameState;
    sourceColors: readonly Color[];
    sourceTypes: readonly CardType[];
    sourceSubtypes: readonly string[];
    chooserId?: string;
    activePlayerId: string;
    sourceIsSpell?: boolean;
    /** CR 601.2c (issue #1104) — the live controllerId of an ALREADY-CHOSEN
     *  sibling target under a `sameController`-constrained requirement
     *  (Barrin's Spite), or undefined when no sibling has been picked yet /
     *  the requirement isn't `sameController`-constrained / the sibling has
     *  since left the battlefield. Computed by the caller via
     *  `siblingControllerIdFor`, THREADED IN rather than derived here — the
     *  registry's per-candidate `checks.permanent` has no access to
     *  `selected`/`alreadySelected`, only this ctx. */
    siblingControllerId?: string;
}

/** One filter's full contract: `lower` resolves the requirement field to its
 *  carried value (the `PendingTarget` field), `checks` maps a `TargetKind` to
 *  the legality predicate for candidates of that kind. Loop semantics
 *  (identical at every call site): a filter whose lowered value is
 *  `undefined` is skipped; a filter whose value is present but whose
 *  candidate kind is absent from `checks` excludes that candidate. */
export interface FilterDescriptor<V> {
    /** `sourcePower` (issue #1378) is the announcing trigger/ability source's
     *  live effective power, threaded through ONLY for `mvFilterDescriptor`'s
     *  `"sourcePower"` placeholder — every other descriptor ignores the extra
     *  argument (TS function-type compatibility permits a narrower-arity
     *  implementation). */
    lower(
        req: TargetRequirement,
        chosenX?: number,
        sourcePower?: number
    ): V | undefined;
    checks: Partial<{
        permanent: (
            candidate: CardInstanceState,
            value: V,
            ctx: TargetFilterCtx
        ) => string | null;
        spell: (
            candidate: StackItem,
            value: V,
            ctx: TargetFilterCtx
        ) => string | null;
        player: (
            candidate: PlayerState,
            value: V,
            ctx: TargetFilterCtx
        ) => string | null;
        // A "card" candidate is a graveyard/hand `CardInstanceState` — the
        // SAME shape a permanent uses, just living in a non-battlefield
        // zone (CR 109.2). `ownerId` (not `controllerId`, which is not
        // reliably reset once an object leaves the battlefield — CR 108.4 /
        // 110.2 controls the new-object rule) is what determines whose zone
        // array it sits in, and is what the `controller` check reads.
        card: (
            candidate: CardInstanceState,
            value: V,
            ctx: TargetFilterCtx
        ) => string | null;
    }>;
}

/** Identity helper that lets each descriptor be authored with its own
 *  strongly-typed `V` (inferred from the literal passed in) before being
 *  folded into the loosely-typed `REGISTRY` map below. */
function defineFilter<V>(d: FilterDescriptor<V>): FilterDescriptor<V> {
    return d;
}

// ─── T1 permanent-filter descriptors ────────────────────────────────────────
// One entry per filter currently covered by `intrinsicPermanentTargetViolation`
// (CR 109.1 / 115 / 202 / 205 / 613 / 701.20), plus `controller` (CR 109.3 /
// 102.1, via `matchesBattlefieldController`). Messages match the prior
// hand-written implementations verbatim — this is a behavior-preserving
// refactor, not a behavior change.

const controllerFilter = defineFilter<TargetRequirement["controller"]>({
    lower: (req) => req.controller,
    checks: {
        permanent: (card, value, ctx) => {
            if (
                matchesBattlefieldController(
                    card.controllerId,
                    ctx.chooserId,
                    ctx.activePlayerId,
                    value
                )
            ) {
                return null;
            }
            return value === "you"
                ? "Must target a permanent you control"
                : value === "opponent"
                  ? "Must target a permanent an opponent controls"
                  : "Must target a permanent the active player controls";
        },
        // CR 109.3 / 114.1 (Lutri, the Spellchaser — "target instant or
        // sorcery spell YOU CONTROL"): a stack item's "controller" is its
        // caster (`castById`). T2 (ADR 0068 / issue #1409) folds the spell
        // branch onto the SAME `matchesBattlefieldController` predicate the
        // permanent branch uses, so offered == accepted for spells too.
        spell: (item, value, ctx) => {
            if (
                matchesBattlefieldController(
                    item.castById,
                    ctx.chooserId,
                    ctx.activePlayerId,
                    value
                )
            ) {
                return null;
            }
            return value === "you"
                ? "Must target a spell you control"
                : value === "opponent"
                  ? "Must target a spell an opponent controls"
                  : "Must target a spell the active player controls";
        },
        // CR 115 (Word of Command's "target opponent") — a PLAYER candidate
        // IS the "controller" (there's no separate controller/owner split
        // for a player). T3 (ADR 0068 / issue #1410) folds the player branch
        // onto the SAME shared predicate.
        player: (player, value, ctx) => {
            if (
                matchesBattlefieldController(
                    player.id,
                    ctx.chooserId,
                    ctx.activePlayerId,
                    value
                )
            ) {
                return null;
            }
            return value === "you"
                ? "Must target yourself"
                : value === "opponent"
                  ? "Must target an opponent"
                  : "Must target the active player";
        },
        // CR 109.3 / 400.7 (Regrowth-style "target card in a graveyard"): a
        // graveyard card's controller-relationship filter is checked against
        // the GRAVEYARD'S OWNER (`ownerId` — whose zone array it sits in),
        // NOT the card's own `controllerId`, which is not reliably reset
        // once an object leaves the battlefield (CR 108.4 / 110.2 — only
        // battlefield/stack objects have a controller distinct from their
        // owner). T3 (ADR 0068 / issue #1410) folds the graveyard-card
        // branch onto the SAME shared predicate — this also fixes a real
        // latent divergence: `selectTarget`'s graveyard-card branch never
        // implemented `controller: "active"` at all, while `getLegalTargets`
        // already did.
        card: (card, value, ctx) => {
            if (
                matchesBattlefieldController(
                    card.ownerId,
                    ctx.chooserId,
                    ctx.activePlayerId,
                    value
                )
            ) {
                return null;
            }
            return value === "you"
                ? "Must target a card in your graveyard"
                : value === "opponent"
                  ? "Must target a card in opponent's graveyard"
                  : "Must target a card the active player owns";
        },
    },
});

// CR 205.3 — subtype filter ("target Mountains"): at least one present.
const subtypeFilterDescriptor = defineFilter<string[]>({
    lower: (req) => arr(req.subtypeFilter),
    checks: {
        permanent: (card, value) =>
            value.some((s) => card.subtypes.includes(s))
                ? null
                : `Target must be ${value.join(" or ")}`,
        // CR 205.3 / 400.7 (issue #1950 review, BLOCKER 2): a graveyard-zone
        // "target Zombie card" (Lord of the Undead) is a CARD-kind candidate,
        // not a permanent — before this the check simply didn't exist for
        // `card`, so `CARD_FILTER_KEYS` had no entry for `subtypeFilter` and
        // BOTH `getLegalTargets` (offered set) and `selectTarget` (accepted
        // set) silently ignored it, fail-open (`target_filter_single_authority`
        // rule — the offered and accepted sets must come from ONE registry
        // check, never a structural-only gate). Same predicate shape as the
        // `permanent` check above — `CardInstanceState.subtypes` is the same
        // field a graveyard card carries.
        card: (card, value) =>
            value.some((s) => card.subtypes.includes(s))
                ? null
                : `Target must be ${value.join(" or ")}`,
    },
});

// CR 205.4a — live supertype filter ("target snow lands"): ALL present.
const supertypeFilterDescriptor = defineFilter<string[]>({
    lower: (req) => arr(req.supertypeFilter),
    checks: {
        permanent: (card, value) =>
            value.every((s) => hasSupertypeLive(card, s))
                ? null
                : `Target must be ${value.join(" and ")}`,
    },
});

// CR 205.4a — negative supertype filter ("target nonbasic land").
const excludeSupertypesDescriptor = defineFilter<string[]>({
    lower: (req) => arr(req.excludeSupertypes),
    checks: {
        permanent: (card, value) =>
            value.some((s) => hasSupertypeLive(card, s))
                ? `Target must not be ${value.join(" or ")}`
                : null,
    },
});

// CR 109.1 — type-exclude filter ("nonland permanent", "nonartifact").
// Also checked for a CARD-kind (graveyard/hand) candidate (issue #1378, T3
// follow-up): a graveyard-zone `targetRequirement` has no negation on its own
// STRUCTURAL `type` field (a plain OR-membership test — CR 300.1's dual-typed
// permanents, e.g. a land Creature, would otherwise slip past a POSITIVE
// "Creature"/"Artifact"/... list even under a "nonland" restriction), so
// `excludeTypes: "Land"` needs the SAME registry gate here that it already has
// for `checks.permanent` — the Phelia "nonland permanent" idiom (Guardian
// Scalelord's graveyard reanimation target) only works catalogue-wide once a
// `card` candidate can be excluded by type too.
const excludeTypesDescriptor = defineFilter<CardType[]>({
    lower: (req) => arr(req.excludeTypes),
    checks: {
        permanent: (card, value) =>
            value.some((t) => card.types.includes(t))
                ? `Target must not be ${value.join(" or ")}`
                : null,
        card: (card, value) =>
            value.some((t) => card.types.includes(t))
                ? `Target must not be ${value.join(" or ")}`
                : null,
    },
});

// CR 111.5 — token-ness filter ("target nontoken creature", Dance of Many /
// Satya, Aetherflux Genius, issue #1195). Exact-match, mirroring
// `PermanentFilter.isToken` / `EffectCardFilter.isToken`'s own semantics:
// `true` keeps only tokens, `false` keeps only nontoken permanents.
const isTokenDescriptor = defineFilter<boolean>({
    lower: (req) => req.isToken,
    checks: {
        permanent: (card, value) =>
            (card.isToken === true) === value
                ? null
                : `Target must ${value ? "" : "not "}be a token`,
    },
});

// CR 202.2 — color-exclude filter (Terror's "nonblack").
const excludeColorsDescriptor = defineFilter<Color[]>({
    lower: (req) => arr(req.excludeColors),
    checks: {
        permanent: (card, value) =>
            value.some((c) => hasColor(card, c))
                ? `Target must not be ${value.join(" or ")}`
                : null,
    },
});

// CR 205.3 — subtype-exclude filter (Nettling Imp's "non-Wall").
const excludeSubtypesDescriptor = defineFilter<string[]>({
    lower: (req) => arr(req.excludeSubtypes),
    checks: {
        permanent: (card, value) =>
            value.some((s) => card.subtypes.includes(s))
                ? `Target must not be ${value.join(" or ")}`
                : null,
        // CR 205.3 / 400.7 (issue #1950 review, BLOCKER 2) — the CARD-kind
        // twin of the `permanent` check above, for a graveyard-zone
        // "target nonartifact card"-style negative subtype requirement.
        card: (card, value) =>
            value.some((s) => card.subtypes.includes(s))
                ? `Target must not be ${value.join(" or ")}`
                : null,
    },
});

// CR 202.2 — positive color filter (Circle of Protection).
const colorFilterDescriptor = defineFilter<Color>({
    lower: (req) => req.colorFilter,
    checks: {
        permanent: (card, value) =>
            hasColor(card, value) ? null : `Target must be ${value}`,
        // CR 202.2 — a spell/ability on the stack also has colors (its cast
        // colors, or a copy's colorOverride — CR 707.10); the same predicate
        // applies. T2 (ADR 0068 / issue #1409).
        spell: (item, value) =>
            hasColor(item, value) ? null : `Target must be ${value}`,
    },
});

// CR 202.2 — OR-over-colors filter ("a black or red source").
const colorFilterAnyDescriptor = defineFilter<ReadonlyArray<Color>>({
    lower: (req) => req.colorFilterAny,
    checks: {
        permanent: (card, value) =>
            value.some((c) => hasColor(card, c))
                ? null
                : `Target must be ${value.join(" or ")}`,
        // CR 202.2 — a spell/ability on the stack also has colors (its cast
        // colors, or a copy's colorOverride — CR 707.10); the same
        // OR-over-colors predicate applies. Fixup of T2 (ADR 0068 / issue
        // #1409): this `spell` check was dropped when the spell kind was
        // added, silently loosening Greater Realm of Preservation's "black
        // or red source" gate to accept a spell of any color.
        spell: (item, value) =>
            value.some((c) => hasColor(item, c))
                ? null
                : `Target must be ${value.join(" or ")}`,
    },
});

// CR 701.20 — tap-state filter ("target tapped/untapped ~").
const tappedFilterDescriptor = defineFilter<"tapped" | "untapped">({
    lower: (req) => req.tappedFilter,
    checks: {
        permanent: (card, value) => {
            if (value === "tapped" && !card.isTapped)
                return "Target must be tapped";
            if (value === "untapped" && card.isTapped)
                return "Target must be untapped";
            return null;
        },
    },
});

// CR 508.1 / 509.1 — combat-role filter ("target attacking/blocking ~").
// NOTE: unlike the other array-shorthand filters, `lower` intentionally does
// NOT normalize to an array — the `PendingTarget.combatRoleFilter` carry
// preserves the requirement's original scalar-or-array shape (matching the
// pre-refactor `pendingTargetFiltersFromRequirement`, which copied it through
// unchanged). Normalization to an array happens inside the `permanent` check
// instead, exactly where the original `intrinsicPermanentTargetViolation` did it.
const combatRoleFilterDescriptor = defineFilter<
    "attacking" | "blocking" | ("attacking" | "blocking")[]
>({
    lower: (req) => req.combatRoleFilter,
    checks: {
        permanent: (card, value) => {
            const roles = arr(value)!;
            const ok = roles.some(
                (r) =>
                    (r === "attacking" && card.isAttacking) ||
                    (r === "blocking" && card.isBlocking)
            );
            return ok ? null : `Target must be ${roles.join(" or ")}`;
        },
    },
});

// CR 702 — positive keyword filter ("target creature with flying").
const requireAbilityDescriptor = defineFilter<string>({
    lower: (req) => req.requireAbility,
    checks: {
        permanent: (card, value) =>
            card.staticAbilities.includes(value)
                ? null
                : `Target must have ${value}`,
    },
});

// CR 702 — disjunctive keyword filter ("target creature with trample or
// haste"). OR semantics across the listed keywords; orthogonal to the
// single-keyword `requireAbility` (a requirement sets one or the other, and
// both are ANDed by the loop when a card sets both anyway).
const requireAbilityAnyDescriptor = defineFilter<ReadonlyArray<string>>({
    lower: (req) =>
        req.requireAbilityAny && req.requireAbilityAny.length > 0
            ? [...req.requireAbilityAny]
            : undefined,
    checks: {
        permanent: (card, value) =>
            value.some((kw) => card.staticAbilities.includes(kw))
                ? null
                : `Target must have ${value.join(" or ")}`,
    },
});

// CR 702 — negative keyword filter ("target creature without flying").
const excludeAbilityDescriptor = defineFilter<string>({
    lower: (req) => req.excludeAbility,
    checks: {
        permanent: (card, value) =>
            card.staticAbilities.includes(value)
                ? `Target must not have ${value}`
                : null,
    },
});

// CR 601.2c — "other than ~" / reflexive self-exclude (Phelia, Sorceress
// Queen). Carries the source id resolved from `excludeSource` by the caller.
const excludeInstanceIdsDescriptor = defineFilter<ReadonlyArray<string>>({
    lower: (req) =>
        req.excludeInstanceIds && req.excludeInstanceIds.length > 0
            ? [...req.excludeInstanceIds]
            : undefined,
    checks: {
        permanent: (card, value) =>
            value.includes(card.id) ? "Can't target that permanent" : null,
    },
});

// CR 613 layer 7c — effective power bounds.
const powerFilterDescriptor = defineFilter<{ min?: number; max?: number }>({
    lower: (req) => req.powerFilter,
    checks: {
        permanent: (card, value, ctx) => {
            const power = getEffectivePower(ctx.state, card);
            if (value.min !== undefined && power < value.min)
                return `Target must have power ≥ ${value.min}`;
            if (value.max !== undefined && power > value.max)
                return `Target must have power ≤ ${value.max}`;
            return null;
        },
    },
});

// CR 613 layer 7c — effective toughness bounds.
const toughnessFilterDescriptor = defineFilter<{
    min?: number;
    max?: number;
}>({
    lower: (req) => req.toughnessFilter,
    checks: {
        permanent: (card, value, ctx) => {
            const toughness = getEffectiveToughness(ctx.state, card);
            if (value.min !== undefined && toughness < value.min)
                return `Target must have toughness ≥ ${value.min}`;
            if (value.max !== undefined && toughness > value.max)
                return `Target must have toughness ≤ ${value.max}`;
            return null;
        },
    },
});

// CR 601.2c (issue #1104) — cross-slot same-controller constraint spanning
// two-or-more announced target slots of ONE requirement ("choose two target
// creatures controlled by the same player", Barrin's Spite). Unlike every
// other descriptor in this file, its legality does NOT depend solely on
// `value` (the static per-requirement `sameController: true`) — it depends
// on a SIBLING pick, threaded in via `ctx.siblingControllerId`
// (`siblingControllerIdFor`, below). `undefined` sibling (the FIRST pick in
// the pair, or the sibling has since left the battlefield, CR 608.2b)
// imposes no constraint — a same-controller pair only becomes checkable
// once one half is chosen, exactly like every other "nothing to compare
// yet" default in this registry.
const sameControllerDescriptor = defineFilter<boolean>({
    lower: (req) => req.sameController,
    checks: {
        permanent: (card, value, ctx) => {
            if (!value) return null;
            if (ctx.siblingControllerId === undefined) return null;
            return card.controllerId === ctx.siblingControllerId
                ? null
                : "Must target a creature controlled by the same player as the other chosen target";
        },
    },
});

/** Resolves the LIVE controllerId a `sameController`-constrained
 *  requirement's NEXT pick must match (CR 601.2c, issue #1104), from
 *  whatever has already been chosen under the SAME requirement. Undefined
 *  when `sameController` isn't set, nothing has been picked yet (the first
 *  pick in the pair is unconstrained), or the first picked permanent has
 *  since left the battlefield (CR 608.2b — no constraint to enforce against
 *  a departed sibling). Shared by `getLegalTargets` (the offered set) and
 *  `selectTarget` (the accepted set, `game.ts`) so the two can never diverge
 *  (ADR 0068 "lower once, check everywhere"). */
export function siblingControllerIdFor(
    state: GameState,
    sameController: boolean | undefined,
    selected: ReadonlyArray<{ type: string; id: string }>
): string | undefined {
    if (!sameController) return undefined;
    const sibling = selected.find((t) => t.type === "permanent");
    if (!sibling) return undefined;
    for (const player of state.players) {
        const card = player.battlefield.find((c) => c.id === sibling.id);
        if (card) return card.controllerId;
    }
    return undefined;
}

// CR 202.3 — mana-value filter, X-resolved at `lower` time.
const mvFilterDescriptor = defineFilter<{
    min?: number;
    max?: number;
    equals?: number;
}>({
    lower: (req, chosenX, sourcePower) =>
        resolveMvFilter(req.mvFilter, chosenX, sourcePower),
    checks: {
        permanent: (card, value) =>
            matchesMvFilter(value, mvOfPermanent(card))
                ? null
                : "Target does not match the required mana value",
        // CR 202.3 — Spell Blast ("counter target spell with mana value X").
        // T2 (ADR 0068 / issue #1409): a stack item's mv is X-inclusive
        // (CR 202.3b), unlike a permanent's (X-cost permanents report 0).
        spell: (item, value) =>
            matchesMvFilter(value, mvOfStackItem(item))
                ? null
                : "Target does not match the required mana value",
        // CR 202.3 — Sevinne's Reclamation's "mana value 3 or less" applies
        // to graveyard-card targets too. T3 (ADR 0068 / issue #1410): reads
        // the instance-override-aware mana cost (`mvOfCard`), the exact
        // computation the pre-T3 graveyard branch used.
        card: (card, value) =>
            matchesMvFilter(value, mvOfCard(card))
                ? null
                : "Target does not match the required mana value",
    },
});

// CR 506.2 — "target player who attacked this turn" (Fire and Brimstone): the
// player must control a creature flagged as having attacked this turn.
const playerAttackedThisTurnDescriptor = defineFilter<boolean>({
    lower: (req) => (req.playerAttackedThisTurn ? true : undefined),
    checks: {
        player: (player) =>
            player.battlefield.some((c) => c.hasAttackedThisTurn)
                ? null
                : "Target player did not attack this turn",
    },
});

// ─── T2 spell-only filter descriptors (ADR 0068 / issue #1409) ─────────────
// One entry per filter previously validated inline, independently, by BOTH
// `getLegalTargets`'s spell loop AND `selectTarget`'s spell branch (game.ts)
// — the spell-flavored half of the Phelia bug class. `controller` /
// `colorFilter` / `colorFilterAny` / `mvFilter` above already grew a `spell`
// check (they're cross-kind); these are the remaining filters that only ever
// apply to `type: "spell"` targets.

// CR 113 / 114.1 — stack-object KIND filter ("target ability", Ward's
// "spell or ability" — CR 702.21a). The omitted default means SPELLS ONLY
// (CR 701.5a: a "target spell" never targets an ability), so `lower`
// resolves the omitted case to its explicit default `"spell"` — the filter
// stays ALWAYS ACTIVE (never `undefined`, never skipped by the registry's
// loop semantics), matching the pre-refactor implicit default exactly.
const spellStackKindDescriptor = defineFilter<
    "spell" | "activated-ability" | "ability" | "any"
>({
    lower: (req) => req.spellStackKind ?? "spell",
    checks: {
        spell: (item, value) => {
            const isAbilityItem =
                !!item.abilityId ||
                !!item.triggeredAbilityId ||
                !!item.delayedTriggerId;
            const acceptsSpell = value === "spell" || value === "any";
            const acceptsAbility =
                value === "activated-ability" ||
                value === "ability" ||
                value === "any";
            if (isAbilityItem) {
                if (!acceptsAbility) return "Target must be a spell";
                if (value === "activated-ability" && !item.abilityId) {
                    return "Target must be an activated ability";
                }
                return null;
            }
            return acceptsSpell ? null : "Target must be an ability";
        },
    },
});

// CR 113.7a — Brown Ouphe's "from an artifact source": the stack item's
// SOURCE card types must include at least one of these.
const stackSourceTypeFilterDescriptor = defineFilter<CardType[]>({
    lower: (req) => {
        const v = arr(req.stackSourceTypeFilter);
        return v && v.length > 0 ? v : undefined;
    },
    checks: {
        spell: (item, value) =>
            value.some((t) => item.types.includes(t))
                ? null
                : "Target's source is not of the required type",
    },
});

// CR 114.1 — Mistfolk's "targets this creature" / Ward's reflexive self-pin
// (`spellTargetsSelfSource`, resolved to this by `raiseTriggerTargetSelection`
// before the requirement reaches here): the object must target one of the
// given permanent instance ids. Kind eligibility (spell vs ability) is
// already governed by `spellStackKind` above, so this filter no longer
// excludes abilities itself (Ward's "any" kind + this filter must admit
// both) — matches `getLegalTargets`'s pre-T2 behavior.
const spellTargetsInstanceIdsDescriptor = defineFilter<ReadonlyArray<string>>({
    lower: (req) =>
        req.spellTargetsInstanceIds && req.spellTargetsInstanceIds.length > 0
            ? [...req.spellTargetsInstanceIds]
            : undefined,
    checks: {
        spell: (item, value) => {
            const tgts = item.targets ?? [];
            return tgts.some(
                (t) => t.type === "permanent" && value.includes(t.id)
            )
                ? null
                : "Target spell does not target the required permanent";
        },
    },
});

// CR 114.1 — Fork's "target instant or sorcery spell": an ability on the
// stack is never a spell, and an actual spell must match one of the given
// card types.
const spellTypeFilterDescriptor = defineFilter<CardType[]>({
    lower: (req) => arr(req.spellTypeFilter),
    checks: {
        spell: (item, value) => {
            const isAbility =
                !!item.abilityId ||
                !!item.triggeredAbilityId ||
                !!item.delayedTriggerId;
            if (isAbility || !value.some((t) => item.types.includes(t))) {
                return "Target is not a spell of the required type";
            }
            return null;
        },
    },
});

// CR 114.1 — Spell Pierce's "target noncreature spell". Reuses the shared
// predicate (issue #683).
const spellExcludeTypeFilterDescriptor = defineFilter<CardType[]>({
    lower: (req) => arr(req.spellExcludeTypeFilter),
    checks: {
        spell: (item, value) =>
            spellMatchesExcludeTypeFilter(item, value)
                ? null
                : "Target is not a spell of the required type",
    },
});

// CR 114.1 + 208.2 — Stern Scolding's "target creature spell with power or
// toughness N or less". Reuses the shared predicate (issue #683).
const spellCreaturePtFilterDescriptor = defineFilter<{
    maxPowerOrToughness: number;
}>({
    lower: (req) => req.spellCreaturePtFilter,
    checks: {
        spell: (item, value) =>
            spellMatchesCreaturePtFilter(item, value)
                ? null
                : "Target is not a spell of the required type",
    },
});

// CR 114.6 / 115.10 — Reflecting Mirror: the chosen spell must have EXACTLY
// ONE target, and that target must be the activating player (the chooser).
const spellSingleTargetingControllerDescriptor = defineFilter<boolean>({
    lower: (req) => (req.spellSingleTargetingController ? true : undefined),
    checks: {
        spell: (item, _value, ctx) => {
            const isAbility =
                !!item.abilityId ||
                !!item.triggeredAbilityId ||
                !!item.delayedTriggerId;
            const tgts = item.targets ?? [];
            const ok =
                !isAbility &&
                tgts.length === 1 &&
                tgts[0].type === "player" &&
                tgts[0].id === ctx.chooserId;
            return ok
                ? null
                : "Target spell must have a single target that is you";
        },
    },
});

// CR 114.1 + 701.7 — Equinox's granted counter ability: the chosen spell
// must be one that would destroy a land the activating player controls.
const spellWouldDestroyLandYouControlDescriptor = defineFilter<boolean>({
    lower: (req) => (req.spellWouldDestroyLandYouControl ? true : undefined),
    checks: {
        spell: (item, _value, ctx) =>
            ctx.chooserId !== undefined &&
            spellWouldDestroyLandControlledBy(ctx.state, item, ctx.chooserId)
                ? null
                : "Target spell would not destroy a land you control",
    },
});

/** The permanent-applicable filter keys T1 registers. `controller` is listed
 *  first so a controller violation surfaces before any intrinsic-filter
 *  violation, matching the prior hand-written check order at both call
 *  sites. NOT `keyof Omit<TargetRequirement, StructuralKey>` yet — that
 *  compile-time forcing function is T4's keystone (ADR 0068); this is an
 *  explicit list so T1 compiles standalone before every kind has coverage. */
export const PERMANENT_FILTER_KEYS = [
    "controller",
    "subtypeFilter",
    "supertypeFilter",
    "excludeSubtypes",
    "excludeSupertypes",
    "excludeTypes",
    "excludeColors",
    "colorFilter",
    "colorFilterAny",
    "tappedFilter",
    "combatRoleFilter",
    "requireAbility",
    "requireAbilityAny",
    "excludeAbility",
    "excludeInstanceIds",
    "powerFilter",
    "toughnessFilter",
    "mvFilter",
    "sameController",
    "isToken",
] as const;

export type PermanentFilterKey = (typeof PERMANENT_FILTER_KEYS)[number];

/** The spell-ONLY filter keys T2 adds (issue #1409) — `controller` /
 *  `colorFilter` / `colorFilterAny` / `mvFilter` are cross-kind and already
 *  registered above by `PERMANENT_FILTER_KEYS`; these are exclusively
 *  `type: "spell"` filters. */
export const SPELL_ONLY_FILTER_KEYS = [
    "spellStackKind",
    "stackSourceTypeFilter",
    "spellTargetsInstanceIds",
    "spellTypeFilter",
    "spellExcludeTypeFilter",
    "spellCreaturePtFilter",
    "spellSingleTargetingController",
    "spellWouldDestroyLandYouControl",
] as const;

export type SpellOnlyFilterKey = (typeof SPELL_ONLY_FILTER_KEYS)[number];

/** The player-ONLY filter key T3 adds (issue #1410) — `controller` is
 *  cross-kind and already registered above by `PERMANENT_FILTER_KEYS`; this
 *  is the sole filter exclusive to `type: "player"` targets. */
export const PLAYER_ONLY_FILTER_KEYS = ["playerAttackedThisTurn"] as const;

export type PlayerOnlyFilterKey = (typeof PLAYER_ONLY_FILTER_KEYS)[number];

/** The registry — one `FilterDescriptor` per requirement-declared filter.
 *  Each descriptor above is authored with its own precise `V` via
 *  `defineFilter`; the aggregate map relaxes to `FilterDescriptor<unknown>`
 *  per value so a heterogeneous-by-key map can exist (`V` differs per
 *  filter: `Color`, `string[]`, `{ min?: number; max?: number }`, …).
 *
 *  **T4 keystone (ADR 0068, issue #1411):** `satisfies Record<FilterKey,
 *  FilterDescriptor<unknown>>` — NOT a type annotation (`: Record<...>`) —
 *  is the forcing function. `satisfies` checks the object literal against
 *  the target shape (every `FilterKey` must be present, no key may be
 *  missing) while still inferring the literal's own precise key type, unlike
 *  an annotation which would just widen to `Record<FilterKey, ...>` and
 *  silently accept a missing key as a type error attributed to the wrong
 *  line. Removing any entry below — or adding a new filter field to
 *  `TargetRequirement` without a matching entry — fails `tsc` right here. */
export const REGISTRY = {
    controller: controllerFilter as FilterDescriptor<unknown>,
    subtypeFilter: subtypeFilterDescriptor as FilterDescriptor<unknown>,
    supertypeFilter: supertypeFilterDescriptor as FilterDescriptor<unknown>,
    excludeSubtypes: excludeSubtypesDescriptor as FilterDescriptor<unknown>,
    excludeSupertypes: excludeSupertypesDescriptor as FilterDescriptor<unknown>,
    excludeTypes: excludeTypesDescriptor as FilterDescriptor<unknown>,
    excludeColors: excludeColorsDescriptor as FilterDescriptor<unknown>,
    colorFilter: colorFilterDescriptor as FilterDescriptor<unknown>,
    colorFilterAny: colorFilterAnyDescriptor as FilterDescriptor<unknown>,
    tappedFilter: tappedFilterDescriptor as FilterDescriptor<unknown>,
    combatRoleFilter: combatRoleFilterDescriptor as FilterDescriptor<unknown>,
    requireAbility: requireAbilityDescriptor as FilterDescriptor<unknown>,
    requireAbilityAny: requireAbilityAnyDescriptor as FilterDescriptor<unknown>,
    excludeAbility: excludeAbilityDescriptor as FilterDescriptor<unknown>,
    excludeInstanceIds:
        excludeInstanceIdsDescriptor as FilterDescriptor<unknown>,
    powerFilter: powerFilterDescriptor as FilterDescriptor<unknown>,
    toughnessFilter: toughnessFilterDescriptor as FilterDescriptor<unknown>,
    mvFilter: mvFilterDescriptor as FilterDescriptor<unknown>,
    spellStackKind: spellStackKindDescriptor as FilterDescriptor<unknown>,
    stackSourceTypeFilter:
        stackSourceTypeFilterDescriptor as FilterDescriptor<unknown>,
    spellTargetsInstanceIds:
        spellTargetsInstanceIdsDescriptor as FilterDescriptor<unknown>,
    spellTypeFilter: spellTypeFilterDescriptor as FilterDescriptor<unknown>,
    spellExcludeTypeFilter:
        spellExcludeTypeFilterDescriptor as FilterDescriptor<unknown>,
    spellCreaturePtFilter:
        spellCreaturePtFilterDescriptor as FilterDescriptor<unknown>,
    spellSingleTargetingController:
        spellSingleTargetingControllerDescriptor as FilterDescriptor<unknown>,
    spellWouldDestroyLandYouControl:
        spellWouldDestroyLandYouControlDescriptor as FilterDescriptor<unknown>,
    playerAttackedThisTurn:
        playerAttackedThisTurnDescriptor as FilterDescriptor<unknown>,
    sameController: sameControllerDescriptor as FilterDescriptor<unknown>,
    isToken: isTokenDescriptor as FilterDescriptor<unknown>,
} satisfies Record<FilterKey, FilterDescriptor<unknown>>;

/** The requirement-derived filter VALUES for the permanent kind — the
 *  `lower()` output shape, and exactly what both `getLegalTargets` and
 *  `selectTarget` pass into `checkPermanentTargetFilters`. Structurally the
 *  same fields `intrinsicPermanentTargetViolation` used to take, plus
 *  `controller` (folded in by this slice). */
export type PermanentFilterValues = Partial<{
    controller: TargetRequirement["controller"];
    subtypeFilter: string[];
    supertypeFilter: string[];
    excludeSubtypes: string[];
    excludeSupertypes: string[];
    excludeTypes: CardType[];
    excludeColors: Color[];
    colorFilter: Color;
    colorFilterAny: ReadonlyArray<Color>;
    tappedFilter: "tapped" | "untapped";
    combatRoleFilter: "attacking" | "blocking" | ("attacking" | "blocking")[];
    requireAbility: string;
    requireAbilityAny: ReadonlyArray<string>;
    excludeAbility: string;
    excludeInstanceIds: ReadonlyArray<string>;
    powerFilter: { min?: number; max?: number };
    toughnessFilter: { min?: number; max?: number };
    mvFilter: { min?: number; max?: number; equals?: number };
    sameController: boolean;
    isToken: boolean;
}>;

/** Runs every SET filter in `values` against `candidate` through the
 *  registry's `permanent` check, in `PERMANENT_FILTER_KEYS` order. Returns
 *  the first violation message, or `null` when the candidate is legal. THE
 *  single authority both `getLegalTargets` (offered set) and `selectTarget`
 *  (accepted set, anti-spoof) call — the two can never diverge, since there
 *  is only one implementation to run. */
export function checkPermanentTargetFilters(
    ctx: TargetFilterCtx,
    candidate: CardInstanceState,
    values: PermanentFilterValues
): string | null {
    for (const key of PERMANENT_FILTER_KEYS) {
        const value = values[key];
        if (value === undefined) continue;
        const check = REGISTRY[key].checks.permanent;
        if (!check) {
            // Loop semantics (ADR 0068): a filter set but whose kind has no
            // check excludes the candidate. Unreachable in T1 — every
            // permanent-filter key above declares a `permanent` check — kept
            // for symmetry with the general registry contract.
            return "Target does not match the required filter";
        }
        const violation = check(candidate, value, ctx);
        if (violation) return violation;
    }
    return null;
}

/** Runs every permanent filter's `lower()` against `req`/`chosenX` and
 *  returns the subset with a defined value — the carry step
 *  (`pendingTargetFiltersFromRequirement`'s permanent-filter half). Each
 *  key's output IS the corresponding `PendingTarget` field, by construction. */
export function lowerPermanentFilters(
    req: TargetRequirement,
    chosenX: number | undefined,
    sourcePower?: number
): PermanentFilterValues {
    const out: Record<string, unknown> = {};
    for (const key of PERMANENT_FILTER_KEYS) {
        const value = REGISTRY[key].lower(req, chosenX, sourcePower);
        if (value !== undefined) out[key] = value;
    }
    return out as PermanentFilterValues;
}

// ─── T2 spell-kind gate (ADR 0068 / issue #1409) ────────────────────────────

/** The full ordered set of filter keys a `type: "spell"` candidate is
 *  checked against — `controller` / `colorFilter` / `colorFilterAny` /
 *  `mvFilter` (cross-kind, registered by `PERMANENT_FILTER_KEYS`) PLUS every
 *  spell-only key. Order
 *  matches the pre-refactor `getLegalTargets` spell loop exactly (kind gate
 *  first, then controller, then the rest) so first-violation messages stay
 *  stable. NOT `keyof Omit<TargetRequirement, StructuralKey>` yet — T4's
 *  keystone (ADR 0068). */
export const SPELL_FILTER_KEYS = [
    "spellStackKind",
    "controller",
    "stackSourceTypeFilter",
    "spellTargetsInstanceIds",
    "colorFilter",
    "colorFilterAny",
    "mvFilter",
    "spellTypeFilter",
    "spellExcludeTypeFilter",
    "spellCreaturePtFilter",
    "spellSingleTargetingController",
    "spellWouldDestroyLandYouControl",
] as const;

export type SpellFilterKey = (typeof SPELL_FILTER_KEYS)[number];

/** The requirement-derived filter VALUES for the spell kind — the `lower()`
 *  output shape, and exactly what both `getLegalTargets` and `selectTarget`
 *  pass into `checkSpellTargetFilters`. */
export type SpellFilterValues = Partial<{
    spellStackKind: "spell" | "activated-ability" | "ability" | "any";
    controller: TargetRequirement["controller"];
    stackSourceTypeFilter: CardType[];
    spellTargetsInstanceIds: ReadonlyArray<string>;
    colorFilter: Color;
    colorFilterAny: ReadonlyArray<Color>;
    mvFilter: { min?: number; max?: number; equals?: number };
    spellTypeFilter: CardType[];
    spellExcludeTypeFilter: CardType[];
    spellCreaturePtFilter: { maxPowerOrToughness: number };
    spellSingleTargetingController: boolean;
    spellWouldDestroyLandYouControl: boolean;
}>;

/** Runs every SET filter in `values` against `candidate` (a stack item)
 *  through the registry's `spell` check, in `SPELL_FILTER_KEYS` order.
 *  Returns the first violation message, or `null` when the candidate is
 *  legal. THE single authority both `getLegalTargets` (offered set) and
 *  `selectTarget` (accepted set, anti-spoof) call for `type: "spell"`
 *  targets — the two can never diverge (ADR 0068 / issue #1409, T2), closing
 *  the spell-flavored half of the Phelia bug class (stackSourceTypeFilter /
 *  spellTargetsInstanceIds / spellTypeFilter / spellExcludeTypeFilter /
 *  spellCreaturePtFilter / spellSingleTargetingController /
 *  spellWouldDestroyLandYouControl / spellStackKind were previously
 *  duplicated inline at both sites). */
export function checkSpellTargetFilters(
    ctx: TargetFilterCtx,
    candidate: StackItem,
    values: SpellFilterValues
): string | null {
    for (const key of SPELL_FILTER_KEYS) {
        const value = values[key];
        if (value === undefined) continue;
        const check = REGISTRY[key].checks.spell;
        if (!check) {
            // Loop semantics (ADR 0068): a filter set but whose kind has no
            // check excludes the candidate. Unreachable — every key in
            // SPELL_FILTER_KEYS declares a `spell` check — kept for symmetry
            // with the general registry contract.
            return "Target does not match the required filter";
        }
        const violation = check(candidate, value, ctx);
        if (violation) return violation;
    }
    return null;
}

/** Runs every spell filter's `lower()` against `req`/`chosenX` and returns
 *  the subset with a defined value — the carry step
 *  (`pendingTargetFiltersFromRequirement`'s spell-filter half). Each key's
 *  output IS the corresponding `PendingTarget` field, by construction. Note
 *  `spellStackKind` is NEVER `undefined` in the output — its `lower()`
 *  resolves the omitted case to the explicit default `"spell"` so the filter
 *  stays always-active (see the descriptor's doc comment). */
export function lowerSpellFilters(
    req: TargetRequirement,
    chosenX: number | undefined,
    sourcePower?: number
): SpellFilterValues {
    const out: Record<string, unknown> = {};
    for (const key of SPELL_FILTER_KEYS) {
        const value = REGISTRY[key].lower(req, chosenX, sourcePower);
        if (value !== undefined) out[key] = value;
    }
    return out as SpellFilterValues;
}

// ─── T3 player-kind gate (ADR 0068 / issue #1410) ───────────────────────────

/** The full ordered set of filter keys a `type: "player"` candidate is
 *  checked against — `controller` (cross-kind, registered by
 *  `PERMANENT_FILTER_KEYS`) PLUS the player-only key. `controller` first so
 *  a controller violation surfaces before `playerAttackedThisTurn`, matching
 *  the pre-refactor `getLegalTargets`/`selectTarget` check order. NOT
 *  `keyof Omit<TargetRequirement, StructuralKey>` yet — T4's keystone
 *  (ADR 0068). */
export const PLAYER_FILTER_KEYS = [
    "controller",
    "playerAttackedThisTurn",
] as const;

export type PlayerFilterKey = (typeof PLAYER_FILTER_KEYS)[number];

/** The requirement-derived filter VALUES for the player kind — the
 *  `lower()` output shape, and exactly what both `getLegalTargets` and
 *  `selectTarget` pass into `checkPlayerTargetFilters`. */
export type PlayerFilterValues = Partial<{
    controller: TargetRequirement["controller"];
    playerAttackedThisTurn: boolean;
}>;

/** Runs every SET filter in `values` against `candidate` (a player) through
 *  the registry's `player` check, in `PLAYER_FILTER_KEYS` order. Returns the
 *  first violation message, or `null` when the candidate is legal. THE
 *  single authority both `getLegalTargets` (offered set) and `selectTarget`
 *  (accepted set, anti-spoof) call for `type: "player"` targets — the two
 *  can never diverge (ADR 0068 / issue #1410, T3). Always-on gates
 *  (`playerHasShroud`) stay outside the registry (ADR 0068) — called
 *  separately at both sites, unchanged. */
export function checkPlayerTargetFilters(
    ctx: TargetFilterCtx,
    candidate: PlayerState,
    values: PlayerFilterValues
): string | null {
    for (const key of PLAYER_FILTER_KEYS) {
        const value = values[key];
        if (value === undefined) continue;
        const check = REGISTRY[key].checks.player;
        if (!check) {
            // Loop semantics (ADR 0068): a filter set but whose kind has no
            // check excludes the candidate. Unreachable — every key in
            // PLAYER_FILTER_KEYS declares a `player` check — kept for
            // symmetry with the general registry contract.
            return "Target does not match the required filter";
        }
        const violation = check(candidate, value, ctx);
        if (violation) return violation;
    }
    return null;
}

/** Runs every player filter's `lower()` against `req`/`chosenX` and returns
 *  the subset with a defined value — the carry step
 *  (`pendingTargetFiltersFromRequirement`'s player-filter half). Each key's
 *  output IS the corresponding `PendingTarget` field, by construction. */
export function lowerPlayerFilters(
    req: TargetRequirement,
    chosenX: number | undefined,
    sourcePower?: number
): PlayerFilterValues {
    const out: Record<string, unknown> = {};
    for (const key of PLAYER_FILTER_KEYS) {
        const value = REGISTRY[key].lower(req, chosenX, sourcePower);
        if (value !== undefined) out[key] = value;
    }
    return out as PlayerFilterValues;
}

// ─── T3 card-kind gate (ADR 0068 / issue #1410) ─────────────────────────────
// "card" candidates are graveyard (and, if a future card ever needs it, hand)
// targets (CR 109.2 / 400.7 — Regrowth-style recursion). `controller`,
// `mvFilter` and `excludeTypes` are cross-kind (issue #1378), already
// registered by `PERMANENT_FILTER_KEYS`. `subtypeFilter` / `excludeSubtypes`
// (issue #1950 review, BLOCKER 2 — Lord of the Undead's "target Zombie card")
// are the first CARD-kind subtype gate: before this, a `zone: "graveyard"`
// requirement's `subtypeFilter` was silently dropped by BOTH `getLegalTargets`
// and `selectTarget` (fail-open — the offered set was wider than the Oracle
// text and the accepted set matched it, so nothing ever caught the drift).
// The POSITIVE CardType filter graveyard targets use is the requirement's
// own STRUCTURAL `type` field, not a registry filter — see the ADR's
// `StructuralKey` list; `excludeTypes` is its NEGATIVE counterpart and,
// unlike `type`, DOES route through the registry.

/** The full ordered set of filter keys a `type: "card"`-zone (graveyard)
 *  candidate is checked against. `controller` first, matching the
 *  pre-refactor check order (owner-relationship, then mana value);
 *  `excludeTypes` (issue #1378) next — a purely additive check order change,
 *  so every pre-existing violation message still wins over it; `subtypeFilter`
 *  / `excludeSubtypes` (issue #1950) appended last, for the same reason. NOT
 *  `keyof Omit<TargetRequirement, StructuralKey>` yet — T4's keystone
 *  (ADR 0068). */
export const CARD_FILTER_KEYS = [
    "controller",
    "mvFilter",
    "excludeTypes",
    "subtypeFilter",
    "excludeSubtypes",
] as const;

export type CardFilterKey = (typeof CARD_FILTER_KEYS)[number];

/** The requirement-derived filter VALUES for the card kind — the `lower()`
 *  output shape, and exactly what both `getLegalTargets` and `selectTarget`
 *  pass into `checkCardTargetFilters`. */
export type CardFilterValues = Partial<{
    controller: TargetRequirement["controller"];
    mvFilter: { min?: number; max?: number; equals?: number };
    excludeTypes: CardType[];
    subtypeFilter: string[];
    excludeSubtypes: string[];
}>;

/** Runs every SET filter in `values` against `candidate` (a graveyard card)
 *  through the registry's `card` check, in `CARD_FILTER_KEYS` order. Returns
 *  the first violation message, or `null` when the candidate is legal. THE
 *  single authority both `getLegalTargets` (offered set) and `selectTarget`
 *  (accepted set, anti-spoof) call for graveyard-card targets — the two can
 *  never diverge (ADR 0068 / issue #1410, T3). This closes a real latent
 *  divergence: `selectTarget`'s pre-T3 graveyard-card branch never
 *  implemented `controller: "active"` at all, unlike `getLegalTargets` —
 *  now there is only one implementation to run at both sites. */
export function checkCardTargetFilters(
    ctx: TargetFilterCtx,
    candidate: CardInstanceState,
    values: CardFilterValues
): string | null {
    for (const key of CARD_FILTER_KEYS) {
        const value = values[key];
        if (value === undefined) continue;
        const check = REGISTRY[key].checks.card;
        if (!check) {
            // Loop semantics (ADR 0068): a filter set but whose kind has no
            // check excludes the candidate. Unreachable — every key in
            // CARD_FILTER_KEYS declares a `card` check — kept for symmetry
            // with the general registry contract.
            return "Target does not match the required filter";
        }
        const violation = check(candidate, value, ctx);
        if (violation) return violation;
    }
    return null;
}

/** Runs every card filter's `lower()` against `req`/`chosenX` and returns the
 *  subset with a defined value — the carry step
 *  (`pendingTargetFiltersFromRequirement`'s card-filter half). Each key's
 *  output IS the corresponding `PendingTarget` field, by construction. */
export function lowerCardFilters(
    req: TargetRequirement,
    chosenX: number | undefined,
    sourcePower?: number
): CardFilterValues {
    const out: Record<string, unknown> = {};
    for (const key of CARD_FILTER_KEYS) {
        const value = REGISTRY[key].lower(req, chosenX, sourcePower);
        if (value !== undefined) out[key] = value;
    }
    return out as CardFilterValues;
}
