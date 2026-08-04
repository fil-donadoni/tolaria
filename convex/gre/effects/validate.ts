// Effect Script static validator (ADR 0045 / ADR 0046, issues #800 / #802).
// Validates a card's `effects[]` WITHOUT executing it:
//
//   1. shape / schema — every entry is a plain object with a string `op`
//      and exactly the fields that Op's schema requires (unknown extra keys
//      are rejected: the grammar is frozen, ADR 0045);
//   2. vocabulary — every `op` name must be registered in the Mechanics
//      Registry's `EFFECT_OP_REGISTRY` (the single name authority);
//   3. mutual exclusivity — `effects[]` may not coexist with `resolve`,
//      `resolveSteps`, `effect` or `modes` on the same effect site;
//   4. JSON purity — the script must survive a `JSON.stringify` round-trip
//      unchanged (ADR 0046: every DSL-only card is a DB row waiting to
//      happen), which rules out functions, RegExp, undefined, NaN, etc.;
//   5. static ref-check (#802) — every `{ ref: "$x.prop" }` must name a
//      binding declared by an EARLIER Op's `bind`, and `prop` must be a
//      supported property path for its position (numeric contexts read
//      power/toughness; player contexts read controller). A dangling binding
//      or an unknown property path fails the catalogue sweep before any test
//      runs — the same class of guard as `serialize.test.ts` drift.
//
// The catalogue-wide sweep test (`convex/cards/__tests__/effectScripts.test.ts`)
// runs this over every registered CardDefinition, so a schema violation, an
// invented Op name or a dangling ref fails CI before any game ever loads the
// card.

import type { CardDefinition, EffectChoiceKind } from "../../cards/types";
import { PERMANENT_TYPES } from "../../cards/types";
import {
    getEventFieldRow,
    isRegisteredEffectOp,
} from "../../cards/mechanicsRegistry";
import { isReservedTargetBinding, parseTargetNameRef } from "./targetRef";

/** The slice of CardDefinition the validator reads — kept narrow so tests
 *  can validate synthetic shapes without building a full definition.
 *  `aiEffects` (PRD #1423, issue #1431) is included so `validateAiEffectsScript`
 *  below can read it from the same host shape (issue #1514). */
export type EffectScriptHost = Pick<
    CardDefinition,
    | "id"
    | "name"
    | "effects"
    | "resolve"
    | "resolveSteps"
    | "effect"
    | "modes"
    | "aiEffects"
> &
    // CR 300.1 permanent types (issue #1097) — read ONLY by the
    // exileSelf/shuffleSelfIntoLibrary permanent-spell gate below; every
    // other check in this module is type-agnostic. Optional (unlike
    // `CardDefinition.types` itself, which is required) so synthetic test
    // hosts (`host()` in `validate.test.ts`) that omit it are unaffected — an
    // absent `types` simply skips that one gate.
    Partial<Pick<CardDefinition, "types">>;

/** Field schema for one Op: required fields (each must be present and valid)
 *  plus optional fields (validated only when present). Any field NOT listed
 *  in either set (besides `op`) is rejected as unknown — the grammar is
 *  frozen (ADR 0045). */
interface OpSchema {
    required: Record<string, (value: unknown) => boolean>;
    optional?: Record<string, (value: unknown) => boolean>;
    /** Cross-field rules that a per-field checker cannot express (e.g. the
     *  choice Op's `filter` is only valid with `zone: "battlefield"`). Runs
     *  after the per-field pass; returns human-readable error suffixes. */
    check?: (entry: Record<string, unknown>) => string[];
}

/** CR 107.1 — amounts/counts written as literals are positive integers. */
function isPositiveInt(value: unknown): boolean {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** A `dealDamageDividedAsChosen` Op's `total` (CR 601.2d / 120.4): the exact
 *  `TargetRequirement.divideAsChosen.total` vocabulary — a positive-int literal,
 *  the announced {X} (`"X"`, Fire Covenant), or X+1 (`"X+1"`, Meteor Shower). */
function isDivideTotal(value: unknown): boolean {
    return isPositiveInt(value) || value === "X" || value === "X+1";
}

/** A base P/T value for the `animate` Op (issue #1317) — unlike CR 107.1's
 *  positive-int-literal rule for `EffectValue` AMOUNTS, a creature's base
 *  power/toughness is a plain characteristic and 0 is legal (Earthbend N's
 *  "becomes a 0/0 creature"). Still a non-negative integer — no card in scope
 *  animates to a negative base P/T. */
function isNonNegativeInt(value: unknown): boolean {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** A `choice` Op's `count` (issue #677): a plain positive-int literal (an
 *  EXACT pick count) or a `{ min, max }` range (an OPTIONAL pick count — "you
 *  may search…", "up to two…"). `min` is a non-negative int, `max` a
 *  positive int, `min <= max` — mirrors `PendingChoice.count`'s existing
 *  fixed-N / range union (`getPendingChoiceMin` / `getPendingChoiceMax`). */
function isChoiceCount(value: unknown): boolean {
    if (isPositiveInt(value)) return true;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const keys = Object.keys(value);
    if (keys.length !== 2 || !keys.includes("min") || !keys.includes("max")) {
        return false;
    }
    const { min, max } = value as { min: unknown; max: unknown };
    return (
        typeof min === "number" &&
        Number.isInteger(min) &&
        min >= 0 &&
        typeof max === "number" &&
        Number.isInteger(max) &&
        max > 0 &&
        min <= max
    );
}

/** `{ target: n }` — an announced-target slot index (CR 601.2c order). */
function isTargetRef(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "target") return false;
    const n = (value as { target: unknown }).target;
    return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/** A LIST-valued capture source (ADR 0049, issue #866): exactly
 *  `{ select: { set: "combatPartners", of: { target: n } } }`. The only set is
 *  `combatPartners` (v1); `of` is an announced target slot. Restricted to the
 *  capture-source position — never a general forEach selector — so the shape is
 *  frozen here rather than in `isForEachSelector`. */
function isListCaptureSource(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "select") return false;
    const select = (value as { select: unknown }).select;
    if (typeof select !== "object" || select === null) return false;
    const s = select as Record<string, unknown>;
    return (
        Object.keys(s).length === 2 &&
        s.set === "combatPartners" &&
        isTargetRef(s.of)
    );
}

/** A `bind` name (ADR 0045) — a `$`-prefixed identifier. Property-path
 *  validity of the refs that read it is checked in the ordered ref pass.
 *
 *  A RESERVED target-slot name (`$target0`, issue #2065) is rejected: the
 *  interpreter resolves those from the announced `targets` array and never
 *  consults the binding store, so a bind under that name would be written and
 *  then silently ignored by every reader — a shadowing bug with no symptom.
 *  Rejecting it statically is the fail-closed half of reserving the name. */
function isBindingName(value: unknown): boolean {
    return (
        typeof value === "string" &&
        /^\$[A-Za-z][A-Za-z0-9]*$/.test(value) &&
        !isReservedTargetBinding(value)
    );
}

/** `{ ref: "$target<N>.name" }` — SHAPE only (issue #2065). The reserved
 *  announced-target ref, the one property-path ref legal in a `name` filter
 *  position. `$target<N>` with any OTHER property, and a bare `$target<N>`,
 *  both fail here (see `parseTargetNameRef`). */
function isTargetNameRef(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    return (
        keys.length === 1 &&
        keys[0] === "ref" &&
        typeof (value as { ref: unknown }).ref === "string" &&
        parseTargetNameRef((value as { ref: string }).ref) !== null
    );
}

/** `{ ref: "$binding.property" }` — SHAPE only (single `ref` key holding a
 *  `$binding.property` string). Whether the binding exists and the property
 *  is legal is decided by the ordered ref pass (`checkRefUses`). */
function isRefValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    return (
        keys.length === 1 &&
        keys[0] === "ref" &&
        typeof (value as { ref: unknown }).ref === "string" &&
        /^\$[A-Za-z][A-Za-z0-9]*\.[A-Za-z]+$/.test(
            (value as { ref: string }).ref
        )
    );
}

/** A value or a non-empty array of values, each satisfying `check` — the
 *  shared OR-within-a-field shape `EffectCardFilter.type` / `.subtype` /
 *  `.color` use (issue #677, mirrors `PermanentFilter`'s own array fields). */
function isValueOrArray(
    value: unknown,
    check: (v: unknown) => boolean
): boolean {
    if (Array.isArray(value)) return value.length > 0 && value.every(check);
    return check(value);
}

/** `{ type?, excludeType?, subtype?, supertype?, color?, excludeColor?,
 *  manaValueAtMost?, isToken?, enteredThisTurn?, name? }` — the minimal card filter for a
 *  `count` set or a `choice` Op's
 *  zone-restricted candidates (issue #677). `type`/`excludeType`/`subtype`/
 *  `color`/`excludeColor` accept a single value OR a non-empty array (OR
 *  within the field — a fetchland's "a Forest or Island card"). `excludeType`
 *  (issue #682) is the negative of `type` — Thoughtseize's "nonland card",
 *  Duress's "noncreature, nonland card". `supertype` is the "search for a
 *  BASIC land card" restriction (CR 205.4a) and its value must be a real
 *  printed supertype (reuses `TOKEN_SUPERTYPES`). `color` reuses
 *  `TOKEN_COLORS`; `excludeColor` (issue #1287) is its negative — Krovikan
 *  Sorcerer's "a NONBLACK card". `manaValueAtMost` is a mana-value ceiling: a
 *  non-negative integer literal (Spellseeker's "mana value 2 or less") OR the
 *  dynamic chosen-cost `{ X: true }` (issue #898, Green Sun's Zenith's "mana
 *  value X or less", resolved via `ctx.getX()` at resolution — the same shape
 *  every other `EffectXValue` site uses). */
function isCardFilter(
    value: unknown,
    opts?: {
        allowHasAbility?: boolean;
        allowIsAttacking?: boolean;
        allowControlledSinceTurnStart?: boolean;
        rejectManaCostEquals?: boolean;
    }
): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const allowHasAbility = opts?.allowHasAbility ?? false;
    const allowIsAttacking = opts?.allowIsAttacking ?? false;
    const allowControlledSinceTurnStart =
        opts?.allowControlledSinceTurnStart ?? false;
    // issue #1898 finding 3 — `manaCostEquals` is honest ONLY on a hidden-zone
    // card shape (`matchesCardFilter`'s `card.cost`, read from the registry by
    // `getHandCards`/`getLibraryCards`/`getGraveyardCards`/`getExileCards`).
    // `toPermanentFilter` (`gre/effects/interpreter.ts`) does NOT map this
    // field onto `PermanentFilter` — so a battlefield-guaranteed selector
    // (`choice`/`count`/`forEach`/`divideIntoPiles` with `zone:
    // "battlefield"`, or `objectMatchesFilter`'s live-permanent read) would
    // validate cleanly and then silently match EVERY permanent at runtime
    // (fail OPEN), inverted from `hasAbility`/`isAttacking`'s opt-IN gate:
    // this field opt-OUTs at exactly those same battlefield-guaranteed sites.
    const rejectManaCostEquals = opts?.rejectManaCostEquals ?? false;
    const entries = Object.entries(value);
    return entries.every(([k, v]) => {
        if (k === "type" || k === "subtype" || k === "excludeType") {
            return isValueOrArray(
                v,
                (m) => typeof m === "string" && m.length > 0
            );
        }
        if (k === "supertype") {
            return typeof v === "string" && TOKEN_SUPERTYPES.has(v);
        }
        if (k === "excludeSupertype") {
            // issue #999 — negative of `supertype` ("nonbasic land"), a real
            // printed supertype or non-empty array of them.
            return isValueOrArray(
                v,
                (m) => typeof m === "string" && TOKEN_SUPERTYPES.has(m)
            );
        }
        if (k === "color") {
            return isValueOrArray(
                v,
                (m) => typeof m === "string" && TOKEN_COLORS.has(m)
            );
        }
        // issue #1287 — negative of `color` (Krovikan Sorcerer's "a NONBLACK
        // card"), same shape as `excludeType`/`excludeSupertype`.
        if (k === "excludeColor") {
            return isValueOrArray(
                v,
                (m) => typeof m === "string" && TOKEN_COLORS.has(m)
            );
        }
        if (k === "manaValueAtMost") {
            return (
                (typeof v === "number" && Number.isInteger(v) && v >= 0) ||
                isXValue(v)
            );
        }
        // issue #1083 — exact mana-value match, `manaValueAtMost`'s sibling.
        if (k === "manaValueEquals") {
            return (
                (typeof v === "number" && Number.isInteger(v) && v >= 0) ||
                isXValue(v)
            );
        }
        // issue #1881 (ADR 0078 decision 8) — exact structural MANA-COST
        // match (CR 202), distinct from `manaValueEquals` above. A single
        // `ManaCost` value or a non-empty array of them (OR, mirroring
        // `type`/`subtype`/`color`'s own array semantics). Honest on a
        // hidden-zone card shape (`matchesCardFilter` fails CLOSED for a card
        // shape with no `cost` slot) but NOT on a live battlefield permanent
        // (`toPermanentFilter` has no mapping for it, issue #1898 finding 3)
        // — `rejectManaCostEquals` opts a battlefield-guaranteed site OUT,
        // the inverse of `hasAbility`/`isAttacking`'s opt-IN gate above.
        if (k === "manaCostEquals") {
            if (rejectManaCostEquals) return false;
            return isValueOrArray(v, isManaCostFilterValue);
        }
        if (k === "isToken") {
            return typeof v === "boolean";
        }
        // CR 400.7 (issue #1458) — "entered the battlefield this turn", read
        // off the `enteredOnTurn` entry stamp the engine writes on every
        // battlefield entry (`markEnteredThisTurn`). Shape mirrors `isToken`
        // exactly: a plain boolean.
        if (k === "enteredThisTurn") {
            return typeof v === "boolean";
        }
        // issue #1085 — a FIXED literal name, or a bare `{ ref: "$binding" }`
        // naming a `nameCard` Op's chosen-name binding (Desperate Research's
        // "put all of them with THAT name into your hand"). The ref's
        // binding existence / family is checked by the ordered ref pass, not
        // here (shape-only, mirrors every other field in this function).
        // issue #2065 — OR the reserved `{ ref: "$target<N>.name" }`, the
        // announced target's own live name (Winnow). Shape-only here too: it
        // is the ONLY property-path ref a `name` position accepts, and the
        // ordered ref pass re-checks that (a `$target0.power` in this position
        // is a static error, not a runtime `undefined`).
        if (k === "name") {
            return (
                (typeof v === "string" && v.length > 0) ||
                isBareRef(v) ||
                isTargetNameRef(v)
            );
        }
        // CR 122.6 (issue #1156) — "with a <type> counter on it". `type` is a
        // non-empty counter type string; optional `min` is a positive integer
        // (default 1 when omitted).
        if (k === "hasCounter") {
            if (typeof v !== "object" || v === null || Array.isArray(v)) {
                return false;
            }
            const hc = v as Record<string, unknown>;
            const validType = typeof hc.type === "string" && hc.type.length > 0;
            const validMin =
                hc.min === undefined ||
                (typeof hc.min === "number" &&
                    Number.isInteger(hc.min) &&
                    hc.min >= 1);
            const knownKeys = Object.keys(hc).every(
                (key) => key === "type" || key === "min"
            );
            return validType && validMin && knownKeys;
        }
        // issue #897 — the OR-ACROSS-fields disjunctive clause list. A
        // non-empty array of full `EffectCardFilter` clauses, each itself
        // validated by this same function (an AND-of-fields shape, may
        // itself carry `any` — recursion is harmless, unused by any shipped
        // card, but not worth forbidding for a "generalize, don't add" shape).
        if (k === "any") {
            return (
                Array.isArray(v) &&
                v.length > 0 &&
                v.every((clause) =>
                    isCardFilter(clause, {
                        allowHasAbility,
                        allowIsAttacking,
                        allowControlledSinceTurnStart,
                        rejectManaCostEquals,
                    })
                )
            );
        }
        // CR 702 (issue #1097) — "with <keyword>" (Canopy Surge's "each
        // creature with flying"). A non-empty keyword string, shape mirrors
        // `name`'s literal-string branch. MEANINGFUL ONLY on a live
        // battlefield permanent read (`toPermanentFilter` → `requireAbility`,
        // `matchesPermanentFilter`) — a hidden-zone/snapshot card shape
        // (`matchesCardFilter`, hand/library/graveyard/exile cards, or a CR
        // 608.2h characteristics snapshot) carries no ability data at all, so
        // silently accepting the field there would fail OPEN: it would
        // validate but match every card at runtime (the #897 failure class
        // this repo already caught once). `allowHasAbility` is threaded in
        // ONLY from the battlefield-guaranteed selector sites
        // (`objectMatchesFilter`, a `forEach`/pile `{ set: "permanents",
        // zone: "battlefield" }` selector, and a `count`/`choice` site whose
        // sibling `zone` is confirmed `"battlefield"`) — every other site
        // rejects it as a static authoring error instead of a silent runtime
        // wrong answer.
        if (k === "hasAbility") {
            if (!allowHasAbility) return false;
            return typeof v === "string" && v.length > 0;
        }
        // CR 508.1 (issue #1097 — Tangle's "each attacking creature").
        // Same battlefield-only honesty rule as `hasAbility` right above: a
        // hidden-zone/snapshot card shape carries no combat role at all, so
        // `allowIsAttacking` is threaded in ONLY from the same
        // battlefield-guaranteed selector sites `hasAbility` already uses.
        if (k === "isAttacking") {
            if (!allowIsAttacking) return false;
            return typeof v === "boolean";
        }
        // "…that they controlled since the beginning of the turn" (Keldon
        // Twilight, PLS). Same battlefield-only honesty rule as
        // `hasAbility`/`isAttacking` above: a card in a hidden zone has no
        // controller at all (CR 108.4), so accepting the field there would
        // validate and then match every card at runtime.
        if (k === "controlledSinceTurnStart") {
            if (!allowControlledSinceTurnStart) return false;
            return typeof v === "boolean";
        }
        return false;
    });
}

/** Whether an `EffectCardFilter` uses `hasAbility`, directly or nested inside
 *  an `any` clause (issue #1097) — used by the `choice` Op's cross-field
 *  `check` to reject it outside `zone: "battlefield"` (the field-level
 *  `isCardFilter` call there is deliberately permissive since it can't see
 *  the sibling `zone` field; this is the zone-aware second pass). */
function filterUsesHasAbility(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const f = value as Record<string, unknown>;
    if (typeof f.hasAbility === "string" && f.hasAbility.length > 0) {
        return true;
    }
    return (
        Array.isArray(f.any) &&
        f.any.some((clause) => filterUsesHasAbility(clause))
    );
}

/** Whether an `EffectCardFilter` uses `isAttacking`, directly or nested
 *  inside an `any` clause (issue #1097) — the `isAttacking` sibling of
 *  `filterUsesHasAbility` right above, same rationale and same single call
 *  site (the `choice` Op's cross-field `check`). */
function filterUsesIsAttacking(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const f = value as Record<string, unknown>;
    if (typeof f.isAttacking === "boolean") {
        return true;
    }
    return (
        Array.isArray(f.any) &&
        f.any.some((clause) => filterUsesIsAttacking(clause))
    );
}

/** Whether an `EffectCardFilter` uses `controlledSinceTurnStart`, directly or
 *  nested inside an `any` clause — the third sibling of
 *  `filterUsesHasAbility`/`filterUsesIsAttacking`, same rationale (a card in a
 *  hidden zone has no controller at all, CR 108.4) and same single call site
 *  (the `choice` Op's cross-field `check`). */
function filterUsesControlledSinceTurnStart(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const f = value as Record<string, unknown>;
    if (typeof f.controlledSinceTurnStart === "boolean") {
        return true;
    }
    return (
        Array.isArray(f.any) &&
        f.any.some((clause) => filterUsesControlledSinceTurnStart(clause))
    );
}

/** Whether an `EffectCardFilter` uses `manaCostEquals`, directly or nested
 *  inside an `any` clause (issue #1898 finding 3) — the INVERTED sibling of
 *  `filterUsesHasAbility`/`filterUsesIsAttacking`: those two gate a field IN
 *  for `zone: "battlefield"`, this one gates `manaCostEquals` OUT there,
 *  because `toPermanentFilter` has no mapping for it (would fail OPEN,
 *  matching every permanent) — the `choice` Op's cross-field `check` is the
 *  one call site (`filter`'s field-level validation can't see the sibling
 *  `zone` value the field-level `isCardFilter` call there is field-level
 *  permissive for the very same reason `hasAbility`/`isAttacking` are). */
function filterUsesManaCostEquals(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const f = value as Record<string, unknown>;
    if (f.manaCostEquals !== undefined) {
        return true;
    }
    return (
        Array.isArray(f.any) &&
        f.any.some((clause) => filterUsesManaCostEquals(clause))
    );
}

/** Valid `EffectTokenSpec.types` members (CR 300.1). Mirrors the `CardType`
 *  union; a token type outside this set is rejected. */
const TOKEN_CARD_TYPES = new Set([
    "Creature",
    "Planeswalker",
    "Instant",
    "Sorcery",
    "Artifact",
    "Enchantment",
    "Land",
    "Battle",
    "Kindred",
]);

/** Valid `EffectTokenSpec.supertypes` members (CR 205.4). */
const TOKEN_SUPERTYPES = new Set([
    "Basic",
    "Legendary",
    "Ongoing",
    "Snow",
    "World",
]);

/** Valid `EffectTokenSpec.colors` members (CR 105.1, the five colors + C). */
const TOKEN_COLORS = new Set(["W", "U", "B", "R", "G", "C"]);

/** Valid colours in a source-scoped `preventDamage` shield's `match.colors`
 *  (issue #1955) — WUBRG only (CR 105.1). */
const SHIELD_MATCH_COLORS = new Set(["W", "U", "B", "R", "G"]);

/** Valid `grantGraveyardPlay.zones` members (issue #1149) — which card kinds
 *  a graveyard-cast permission grant covers. */
const GRAVEYARD_PLAY_ZONES = new Set(["land", "spell"]);

function isStringArray(value: unknown, allowed?: Set<string>): boolean {
    return (
        Array.isArray(value) &&
        value.every(
            (v) =>
                typeof v === "string" &&
                v.length > 0 &&
                (allowed === undefined || allowed.has(v))
        )
    );
}

/** The JSON-pure token spec of a `createToken` Op (issue #847, `EffectTokenSpec`).
 *  Every printed characteristic a token enters with, all plain data — name +
 *  a non-empty types array are required; subtypes / supertypes / P/T / colors /
 *  keyword static abilities / token art are optional. `staticEffects` is
 *  deliberately NOT accepted (its predicates carry closures — a token needing
 *  continuous static effects stays a `resolve()` card). Unknown keys are
 *  rejected: the grammar is frozen (ADR 0045). */
/** A token-scoped activated ability's JSON-pure `cost` (issue #1191, extended
 *  #778): the legs a token can plausibly need — `tap` (a manland-style
 *  token), `mana` (a `ManaCost`), `sacrifice` (the Clue/Treasure shape,
 *  "Sacrifice THIS token"), and `discardFilter` (the Blood shape, "{1}, {T},
 *  Discard a card, Sacrifice this token: Draw a card." — the SAME player-choice
 *  discard cost `ActivatedAbility.cost.discardFilter` already carries for a
 *  printed card's ability, e.g. Survival of the Fittest #901; a token ability
 *  is structurally an `ActivatedAbility`, so no new shape is invented, just
 *  the allow-list widened). Any other `ActivatedAbility.cost` leg (life,
 *  loyalty, removeCounter, other discard variants, …) is out of scope for a
 *  token spec until a real card needs it — "generalize, don't add" (extend
 *  this set when that happens, don't invent a parallel shape). */
const TOKEN_ABILITY_COST_KEYS = new Set([
    "tap",
    "mana",
    "sacrifice",
    "discardFilter",
]);
function isTokenAbilityCost(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const c = value as Record<string, unknown>;
    if (!Object.keys(c).every((k) => TOKEN_ABILITY_COST_KEYS.has(k))) {
        return false;
    }
    if ("tap" in c && typeof c.tap !== "boolean") return false;
    if ("mana" in c && !isManaCost(c.mana)) return false;
    if ("sacrifice" in c && typeof c.sacrifice !== "boolean") return false;
    if ("discardFilter" in c) {
        const df = c.discardFilter;
        if (typeof df !== "object" || df === null || Array.isArray(df)) {
            return false;
        }
        const d = df as Record<string, unknown>;
        if (!Object.keys(d).every((k) => k === "filter" || k === "count")) {
            return false;
        }
        if (!isCardFilter(d.filter)) return false;
        if (
            typeof d.count !== "number" ||
            !Number.isInteger(d.count) ||
            d.count < 1
        ) {
            return false;
        }
    }
    return true;
}

/** A token-scoped activated ability (issue #1191, `EffectTokenSpec.activatedAbilities`):
 *  a RESTRICTED, JSON-pure subset of `ActivatedAbility` — `id` / `cost`
 *  (tap/mana/sacrifice only) / `oracleText` / `useStack` / `effects`.
 *  `resolve` / `effect` / any other `ActivatedAbility` field is rejected:
 *  DSL-only, mirroring `EffectTokenSpec` itself omitting `staticEffects`
 *  because closures can't survive JSON (ADR 0046). The ability's `effects[]`
 *  SHAPE is checked here; its deep ref/purity validity is checked separately
 *  by `validateEffectOpList`'s nested-`createToken` pass, in the ability's OWN
 *  scope (fresh `$source`), not the outer script's. */
function isTokenActivatedAbility(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const a = value as Record<string, unknown>;
    const allowed = new Set([
        "id",
        "cost",
        "oracleText",
        "useStack",
        "effects",
    ]);
    if (!Object.keys(a).every((k) => allowed.has(k))) return false;
    if (typeof a.id !== "string" || a.id.length === 0) return false;
    if (!isTokenAbilityCost(a.cost)) return false;
    if (typeof a.oracleText !== "string" || a.oracleText.length === 0) {
        return false;
    }
    if (typeof a.useStack !== "boolean") return false;
    if ("effects" in a && !isOpList(a.effects)) return false;
    return true;
}

/** `EffectTokenSpec.entersWith` (CR 111.9/122.1, issue #1210) — counters a
 *  token enters WITH. A non-empty `counters` array of `{ type, count }`,
 *  `count` a full `EffectValue` (resolved by the `createToken` Op executor
 *  at token-creation time — the JSON-purity check here only needs to confirm
 *  it's a well-formed EffectValue, not that it resolves to anything in
 *  particular). Unknown keys rejected (ADR 0045). */
function isEntersWithSpec(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const s = value as Record<string, unknown>;
    if (!Object.keys(s).every((k) => k === "counters")) return false;
    if (!("counters" in s)) return true;
    if (!Array.isArray(s.counters) || s.counters.length === 0) return false;
    return s.counters.every((c) => {
        if (typeof c !== "object" || c === null || Array.isArray(c)) {
            return false;
        }
        const entry = c as Record<string, unknown>;
        if (!Object.keys(entry).every((k) => k === "type" || k === "count")) {
            return false;
        }
        if (typeof entry.type !== "string" || entry.type.length === 0) {
            return false;
        }
        return isEffectValue(entry.count);
    });
}

/** `EffectTokenSpec.backFace` (CR 712, issue #1210, ADR 0067) — the JSON-pure
 *  subset of a double-faced token's back face (`EffectCardBackFace`): the
 *  SAME printed-characteristic fields `isEffectTokenSpec` itself accepts,
 *  minus `activatedAbilities` (closures aren't JSON-expressible; a token
 *  whose back face needs an activated ability stays a `resolve()` card).
 *  Unknown keys rejected (ADR 0045). */
function isEffectCardBackFace(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const s = value as Record<string, unknown>;
    const allowed = new Set([
        "name",
        "types",
        "subtypes",
        "supertypes",
        "power",
        "toughness",
        "colors",
        "staticAbilities",
        "oracleText",
        "imagePrintId",
    ]);
    if (!Object.keys(s).every((k) => allowed.has(k))) return false;
    if (typeof s.name !== "string" || s.name.length === 0) return false;
    if (
        !Array.isArray(s.types) ||
        s.types.length === 0 ||
        !isStringArray(s.types, TOKEN_CARD_TYPES)
    ) {
        return false;
    }
    if ("subtypes" in s && !isStringArray(s.subtypes)) return false;
    if ("supertypes" in s && !isStringArray(s.supertypes, TOKEN_SUPERTYPES)) {
        return false;
    }
    if ("power" in s && !Number.isInteger(s.power)) return false;
    if ("toughness" in s && !Number.isInteger(s.toughness)) return false;
    if ("colors" in s && !isStringArray(s.colors, TOKEN_COLORS)) return false;
    if ("staticAbilities" in s && !isStringArray(s.staticAbilities)) {
        return false;
    }
    if (
        "oracleText" in s &&
        (typeof s.oracleText !== "string" || s.oracleText.length === 0)
    ) {
        return false;
    }
    if (
        "imagePrintId" in s &&
        (typeof s.imagePrintId !== "string" || s.imagePrintId.length === 0)
    ) {
        return false;
    }
    return true;
}

/** The JSON-pure token spec of a `createToken` Op (issue #847, `EffectTokenSpec`).
 *  Every printed characteristic a token enters with, all plain data — name +
 *  a non-empty types array are required; subtypes / supertypes / P/T / colors /
 *  keyword static abilities / token art / activated abilities are optional.
 *  `staticEffects` is deliberately NOT accepted (its predicates carry
 *  closures — a token needing continuous static effects stays a `resolve()`
 *  card). Unknown keys are rejected: the grammar is frozen (ADR 0045). */
function isEffectTokenSpec(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const s = value as Record<string, unknown>;
    const allowed = new Set([
        "name",
        "types",
        "subtypes",
        "supertypes",
        "power",
        "toughness",
        "colors",
        "staticAbilities",
        "imagePrintId",
        "activatedAbilities",
        "entersWith",
        "backFace",
        "entersTapped",
        "entersAttacking",
    ]);
    if (!Object.keys(s).every((k) => allowed.has(k))) return false;
    if (typeof s.name !== "string" || s.name.length === 0) return false;
    if (
        !Array.isArray(s.types) ||
        s.types.length === 0 ||
        !isStringArray(s.types, TOKEN_CARD_TYPES)
    ) {
        return false;
    }
    if ("subtypes" in s && !isStringArray(s.subtypes)) return false;
    if ("supertypes" in s && !isStringArray(s.supertypes, TOKEN_SUPERTYPES)) {
        return false;
    }
    if ("power" in s && !Number.isInteger(s.power)) return false;
    if ("toughness" in s && !Number.isInteger(s.toughness)) return false;
    if ("colors" in s && !isStringArray(s.colors, TOKEN_COLORS)) return false;
    if ("staticAbilities" in s && !isStringArray(s.staticAbilities)) {
        return false;
    }
    if (
        "imagePrintId" in s &&
        (typeof s.imagePrintId !== "string" || s.imagePrintId.length === 0)
    ) {
        return false;
    }
    if ("activatedAbilities" in s) {
        if (
            !Array.isArray(s.activatedAbilities) ||
            s.activatedAbilities.length === 0 ||
            !s.activatedAbilities.every(isTokenActivatedAbility)
        ) {
            return false;
        }
    }
    if ("entersWith" in s && !isEntersWithSpec(s.entersWith)) return false;
    if ("backFace" in s && !isEffectCardBackFace(s.backFace)) return false;
    // CR 508.4 (issue #1195) — Satya, Aetherflux Genius's "tapped and
    // attacking" token entry flags.
    if ("entersTapped" in s && !isBoolean(s.entersTapped)) return false;
    if ("entersAttacking" in s && !isBoolean(s.entersAttacking)) return false;
    return true;
}

/** `{ count: { zone, controller | acrossAllPlayers, filter? } }` — SHAPE of the
 *  count construct (ADR 0045). Exactly one player scope: a `controller` player
 *  ref (shape-checked here; any ref inside it is property-checked by the ordered
 *  ref pass) OR `acrossAllPlayers: true` (CR 122 "in all graveyards", issue
 *  #985 — the two are mutually exclusive). */
function isCountValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "count") return false;
    const spec = (value as { count: unknown }).count;
    if (typeof spec !== "object" || spec === null) return false;
    const s = spec as Record<string, unknown>;
    const allowed = new Set([
        "zone",
        "controller",
        "filter",
        "acrossAllPlayers",
        "smallestAcrossPlayers",
        "times",
        "countTypes",
    ]);
    if (!Object.keys(s).every((k) => allowed.has(k))) return false;
    if (
        s.zone !== "battlefield" &&
        s.zone !== "graveyard" &&
        s.zone !== "library" &&
        s.zone !== "hand"
    ) {
        return false;
    }
    // CR 401 / 402 (issues #783, #2006) — a `library` or `hand` count is a pure
    // cardinality read: the zone is hidden (CR 401.2 / 402.2) so there is
    // nothing a filter could honestly match, and `countTypes` is a
    // graveyard-only Delirium reading.
    if (
        (s.zone === "library" || s.zone === "hand") &&
        ("filter" in s || "countTypes" in s)
    ) {
        return false;
    }
    // issue #999 — an optional positive-integer multiplier ("twice the
    // number of …", Price of Progress). A literal only; no ref/X.
    if ("times" in s) {
        if (typeof s.times !== "number" || !Number.isInteger(s.times)) {
            return false;
        }
        if (s.times < 1) return false;
    }
    // CR 122 — `acrossAllPlayers` (issue #985) sums every player's zone and is
    // mutually exclusive with a `controller` (which names ONE player's zone).
    // CR 122 — `smallestAcrossPlayers` (issue #783) takes the MIN over every
    // player's zone ("a library has twenty or fewer cards in it"); like the sum
    // form it names no single player, so it excludes `controller` — and the two
    // all-players forms exclude each other (sum and min are different reads).
    if ("acrossAllPlayers" in s) {
        if (s.acrossAllPlayers !== true) return false;
        if ("controller" in s || "smallestAcrossPlayers" in s) return false;
    } else if ("smallestAcrossPlayers" in s) {
        if (s.smallestAcrossPlayers !== true) return false;
        if ("controller" in s) return false;
    } else if (!isPlayerRef(s.controller)) {
        return false;
    }
    // `hasAbility` / `isAttacking` (issue #1097) are honest only on the
    // "battlefield" branch — `countZoneForPlayer` (`gre/effects/interpreter.ts`)
    // reads them via the LIVE `toPermanentFilter`/`requireAbility`/`isAttacking`
    // path there, but falls back to `matchesCardFilter` for the "graveyard"
    // branch, which has no ability or combat-role data for a hidden-zone card
    // at all.
    // `manaCostEquals` (issue #1898 finding 3) is the INVERSE gate: honest
    // for the "graveyard" branch (`matchesCardFilter` via `getGraveyardCards`)
    // but not "battlefield" (`toPermanentFilter` has no mapping for it).
    if (
        "filter" in s &&
        !isCardFilter(s.filter, {
            allowHasAbility: s.zone === "battlefield",
            allowIsAttacking: s.zone === "battlefield",
            allowControlledSinceTurnStart: s.zone === "battlefield",
            rejectManaCostEquals: s.zone === "battlefield",
        })
    ) {
        return false;
    }
    return true;
}

/** `{ X: true }` — SHAPE of the chosen-cost X value construct (issue #852). A
 *  single `X` key holding the literal `true`; carries no other data (the value
 *  is read at resolution from `ctx.getX()`). */
function isXValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    return (
        keys.length === 1 &&
        keys[0] === "X" &&
        (value as { X: unknown }).X === true
    );
}

/** `{ counters: { of, type } }` — SHAPE of the counter-count value construct
 *  (issue #1015, CR 122.6). `of` is an object selector (an announced target
 *  slot, the ability-site `$source`, or a permanents-set forEach `$each`) — the
 *  ref inside it is family-checked as an OBJECT position by the ordered ref pass
 *  (the `of` keyHint in `collectRefUses`). `type` is a non-empty counter-kind
 *  string ("fuse", "+1/+1", "charge", …). No other keys are permitted. */
function isCountersValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "counters") return false;
    const spec = (value as { counters: unknown }).counters;
    if (typeof spec !== "object" || spec === null) return false;
    const s = spec as Record<string, unknown>;
    const allowed = new Set(["of", "type"]);
    if (!Object.keys(s).every((k) => allowed.has(k))) return false;
    if (typeof s.type !== "string" || s.type.length === 0) return false;
    return isObjectSelector(s.of);
}

/** `{ kickerCount: true }` — SHAPE of the kicker-count value construct
 *  (CR 702.33 / 702.33e). No parameters — reads the resolving spell's kicker
 *  tally off the stack item. Mirrors `{ X: true }` (isXValue). */
function isKickerCountValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    return (
        keys.length === 1 &&
        keys[0] === "kickerCount" &&
        (value as { kickerCount: unknown }).kickerCount === true
    );
}

/** `{ kickerPaid: "<id>" }` — SHAPE of the per-Kicker payment value construct
 *  (CR 702.33 / 702.33e, ADR 0079). One parameter: the `KickerCost.id` declared
 *  on the card. Reads how many times THAT Kicker was paid off the stack item's
 *  per-Kicker record; `>= 1` is "this Kicker was paid". A non-empty string is
 *  required — an empty id could never match a declared Kicker, so it is an
 *  authoring error, not a fail-closed read. Mirrors `isKickerCountValue`. */
function isKickerPaidValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "kickerPaid") return false;
    const id = (value as { kickerPaid: unknown }).kickerPaid;
    return typeof id === "string" && id.length > 0;
}

/** `{ manaValue: { of } }` — SHAPE of the mana-value value construct (CR 202.3,
 *  Overload). `of` is an object selector (an announced target slot, `$source`,
 *  or a permanents-set forEach `$each`) — the ref inside it is family-checked as
 *  an OBJECT position by the ordered ref pass (the `of` keyHint in
 *  `collectRefUses`). No other keys are permitted. Mirrors `isCountersValue`. */
function isManaValueValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "manaValue") return false;
    const spec = (value as { manaValue: unknown }).manaValue;
    if (typeof spec !== "object" || spec === null) return false;
    const s = spec as Record<string, unknown>;
    if (!Object.keys(s).every((k) => k === "of")) return false;
    return isObjectSelector(s.of);
}

/** `{ domain: { of, times? } }` — SHAPE of the Domain ability-word value
 *  construct (CR 702 preamble, issue #1066, ninth EffectValue member). `of`
 *  is a PLAYER selector (`EffectPlayerRef`) — UNLIKE `counters`/`manaValue`'s
 *  object `of`, Domain is a per-PLAYER scalar (Collapsing Borders reads the
 *  firing upkeep's player, not an object). Family-checked as a PLAYER
 *  position by the ordered ref pass (the `keyHint === "domain"` special case
 *  in `collectRefUses`, needed because the bare key name `of` collides with
 *  the OBJECT-family convention `counters`/`manaValue` established for it).
 *  `times` (optional, a positive-int literal) is a fixed scaling factor
 *  mirroring `EffectCountSpec.times` (Wandering Stream's "gain TWO life for
 *  each…"). No other keys are permitted. */
function isDomainValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "domain") return false;
    const spec = (value as { domain: unknown }).domain;
    if (typeof spec !== "object" || spec === null) return false;
    const s = spec as Record<string, unknown>;
    if (!Object.keys(s).every((k) => k === "of" || k === "times")) {
        return false;
    }
    if ("times" in s && !isPositiveInt(s.times)) return false;
    return isPlayerRef(s.of);
}

/** `{ escaped: { of } }` — SHAPE of the escaped value construct (CR 702.138e,
 *  issue #695). `of` is an object selector (an announced target slot, `$source`,
 *  or a permanents-set forEach `$each`) — family-checked as an OBJECT position
 *  by the ordered ref pass. No other keys are permitted. Mirrors
 *  `isManaValueValue`. */
function isEscapedValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "escaped") return false;
    const spec = (value as { escaped: unknown }).escaped;
    if (typeof spec !== "object" || spec === null) return false;
    const s = spec as Record<string, unknown>;
    if (!Object.keys(s).every((k) => k === "of")) return false;
    return isObjectSelector(s.of);
}

/** `{ abilityResolutionCount: true }` — SHAPE of the ability-resolution-count
 *  value construct (CR 122 / 603.3, issue #1189). No parameters — reads the
 *  CURRENTLY RESOLVING triggered ability's per-turn tally off the game state
 *  (`SpellContext.getAbilityResolutionCount()`). Mirrors `isKickerCountValue`
 *  / `isXValue` (a single literal-`true` key, no `of` selector — unlike
 *  `counters`/`manaValue`/`domain`, this value is scoped to the resolving
 *  stack item itself, not an announced object or player). */
function isAbilityResolutionCountValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    return (
        keys.length === 1 &&
        keys[0] === "abilityResolutionCount" &&
        (value as { abilityResolutionCount: unknown })
            .abilityResolutionCount === true
    );
}

/** `{ lifeGainedThisTurn: { of } }` — SHAPE of the per-turn life-gain value
 *  construct (CR 119.3, issue #1457, twelfth EffectValue member). `of` is a
 *  PLAYER selector (`EffectPlayerRef`) — like `domain`'s, and UNLIKE
 *  `counters`/`manaValue`'s object `of`: life gained is a per-PLAYER scalar.
 *  Family-checked as a PLAYER position by the ordered ref pass (the
 *  `keyHint === "lifeGainedThisTurn"` case in `collectRefUses`, needed for the
 *  same `of`-key collision reason `domain` documents). No other keys are
 *  permitted (no `times` — no card scales this the way Wandering Stream scales
 *  Domain). */
function isLifeGainedThisTurnValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "lifeGainedThisTurn") return false;
    const spec = (value as { lifeGainedThisTurn: unknown }).lifeGainedThisTurn;
    if (typeof spec !== "object" || spec === null) return false;
    const s = spec as Record<string, unknown>;
    if (!Object.keys(s).every((k) => k === "of")) return false;
    return isPlayerRef(s.of);
}

/** One operand of a `difference` (issue #2006) — a TERMINAL only: a
 *  positive-int literal or a `count`. Deliberately NOT `isEffectValue`: making
 *  the operand check non-recursive is what keeps the value grammar depth-1 and
 *  an expression tree unrepresentable, matching the `EffectDifferenceOperand`
 *  type. A `0`/negative literal is rejected by the same CR 107.1 positive-int
 *  literal rule the rest of the grammar uses — `{ from: 0, minus: v }` would
 *  be a back-door unary negation, which the SIGNED grammar's `negate` (issue
 *  #926) already owns at the one site where it has CR meaning. */
function isDifferenceOperand(value: unknown): boolean {
    return isPositiveInt(value) || isCountValue(value);
}

/** `{ difference: { from, minus } }` — SHAPE of the subtraction value construct
 *  (issue #2006, CR 107.1b). Exactly two keys, both required, each a terminal
 *  operand. One operator, two operands, no nesting: this is the entire
 *  arithmetic surface of the value grammar and must stay that way (a `plus` /
 *  `max` / nested `difference` is a new design decision with its own issue, not
 *  an incremental widening of this checker). */
function isDifferenceValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "difference") return false;
    const spec = (value as { difference: unknown }).difference;
    if (typeof spec !== "object" || spec === null) return false;
    const s = spec as Record<string, unknown>;
    if (!Object.keys(s).every((k) => k === "from" || k === "minus")) {
        return false;
    }
    return isDifferenceOperand(s.from) && isDifferenceOperand(s.minus);
}

/** A numeric Op parameter (ADR 0045 value grammar): a positive-int literal,
 *  a `ref`, a `count`, the chosen-cost `X` (issue #852), a `counters` count
 *  on a selected object (issue #1015), a selected object's `manaValue` (issue
 *  #680), a player's `domain` (issue #1066), an object's `escaped` flag
 *  (issue #695), the resolving triggered ability's `abilityResolutionCount`
 *  (issue #1189), or the `difference` of two terminals (issue #2006). Exactly
 *  those — one non-nestable subtraction, and beyond it no arithmetic and no
 *  expressions. */
function isEffectValue(value: unknown): boolean {
    return (
        isPositiveInt(value) ||
        isRefValue(value) ||
        isCountValue(value) ||
        isXValue(value) ||
        isCountersValue(value) ||
        isKickerCountValue(value) ||
        isKickerPaidValue(value) ||
        isManaValueValue(value) ||
        isDomainValue(value) ||
        isEscapedValue(value) ||
        isAbilityResolutionCountValue(value) ||
        isLifeGainedThisTurnValue(value) ||
        isDifferenceValue(value)
    );
}

/** `{ controllerOf: { target: n } }` — the controller of a targeted object
 *  (issue #806, "its controller"). */
function isControllerOfRef(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    return (
        keys.length === 1 &&
        keys[0] === "controllerOf" &&
        isTargetRef((value as { controllerOf: unknown }).controllerOf)
    );
}

/** `{ opponentOf: EffectPlayerRef }` — the controller-relative complement of
 *  an ARBITRARY resolved player ref (issue #1568), generalizing `"opponent"`
 *  (which only ever complements the resolving controller). Recursive: the
 *  wrapped value is itself validated as a full `EffectPlayerRef`, most
 *  commonly `{ controllerOf: { target: n } }` (Fractured Identity — "each
 *  player other than ITS controller"). */
function isOpponentOfRef(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    return (
        keys.length === 1 &&
        keys[0] === "opponentOf" &&
        isPlayerRef((value as { opponentOf: unknown }).opponentOf)
    );
}

/** `"controller" | "opponent" | { target: n } | { controllerOf } |
 *  { opponentOf } | { ref }` (EffectPlayerRef). The ref may be a property ref
 *  (`"$x.controller"`) or — inside a players-set forEach body (issue #807) —
 *  the bare `{ ref: "$each" }`; which of the two is legal WHERE is decided by
 *  the ordered ref pass. */
function isPlayerRef(value: unknown): boolean {
    return (
        value === "controller" ||
        value === "opponent" ||
        isTargetRef(value) ||
        isControllerOfRef(value) ||
        isOpponentOfRef(value) ||
        isRefValue(value) ||
        isBareRef(value)
    );
}

/** The Pending Choice kinds a `choice` Op may request (issue #805). Typed as
 *  an exhaustive Record over `EffectChoiceKind` so adding a union member
 *  without extending the allow-list (or vice versa) is a compile error. */
const EFFECT_CHOICE_KINDS: Record<EffectChoiceKind, true> = {
    "choose-permanents": true,
    "sacrifice-permanents": true,
    "discard-hand": true,
    "search-library": true,
    "choose-hand-card": true,
    "choose-graveyard-card": true,
    "choose-exile-card": true,
};

function isEffectChoiceKind(value: unknown): boolean {
    return (
        typeof value === "string" &&
        value in EFFECT_CHOICE_KINDS &&
        EFFECT_CHOICE_KINDS[value as EffectChoiceKind]
    );
}

/** The zones a `choice` Op may pick from — exactly the zones the Pending
 *  Choice submit validator knows how to gate (CR 608.2). */
function isChoiceZone(value: unknown): boolean {
    return (
        value === "battlefield" ||
        value === "hand" ||
        value === "library" ||
        value === "graveyard" ||
        value === "exile"
    );
}

function isNonEmptyString(value: unknown): boolean {
    return typeof value === "string" && value.length > 0;
}

/** The direction of a `counters` Op (issue #841, CR 122) — put counters on
 *  (`add`) or take them off (`remove`) a permanent. */
function isCounterAction(value: unknown): boolean {
    return value === "add" || value === "remove";
}

/** The JSON-pure `duration` discriminator of a `gainControl` Op (issue #848,
 *  `GainControlDuration`) — one of the three "for as long as" conditions the
 *  `ControlChangeCondition` grammar supports. Absent = an indefinite
 *  reassignment; there is deliberately no "until end of turn" member. */
function isGainControlDuration(value: unknown): boolean {
    return (
        value === "while-you-control-source" ||
        value === "while-source-tapped" ||
        value === "while-source-tapped-and-power-ge"
    );
}

/** The direction of a `tapUntap` Op (issue #842, CR 701.26) — tap or untap a
 *  permanent. */
function isTapUntapAction(value: unknown): boolean {
    return value === "tap" || value === "untap";
}

/** The JSON-pure `destination` discriminator of a `counter` Op (issue #683,
 *  `CounterDestination`) — where a COUNTERED SPELL ends up instead of CR
 *  701.5a's default owner's graveyard. */
function isCounterDestination(value: unknown): boolean {
    return (
        value === "graveyard" ||
        value === "exile" ||
        value === "hand" ||
        value === "library-top"
    );
}

/** The action of a `libraryLook` Op (issue #844, CR 701.20). Only `"shuffle"`
 *  is folded; peek/reorder are the `scryReorder` Op (issue #885). */
function isLibraryLookAction(value: unknown): boolean {
    return value === "shuffle";
}

/** The `destination` of a `scryReorder` Op (issue #885) — where the un-kept
 *  looked-at cards go (the `LibraryDestination` the `orderTop` primitive
 *  accepts): `"library-bottom"` (Scry, CR 701.22), `"graveyard"` (Surveil, CR
 *  701.44) or `"none"` (order-only, Ponder — every card stays on top). */
function isLibraryDestination(value: unknown): boolean {
    return (
        value === "library-bottom" || value === "graveyard" || value === "none"
    );
}

/** The `destination` of a `digMatchingToHand` Op (issue #1085) — where every
 *  NON-matching revealed card goes: `"exile"` (Desperate Research's "Exile
 *  the rest") or `"graveyard"` (a Surveil-shaped future card). Distinct from
 *  `isLibraryDestination` — this Op has no "stays on library" outcome, so
 *  `"library-bottom"` / `"none"` are not legal here. */
function isDigMatchingDestination(value: unknown): boolean {
    return value === "exile" || value === "graveyard";
}

/** The `pool` candidate-set discriminator of a `rangedTopdeck` Op (issue
 *  #1283) — only `"drawn-this-turn"` today (Sylvan Library's "cards in your
 *  hand drawn this turn"). A single-member enum kept as an explicit check
 *  (not a bare literal comparison inline) so a future second pool shape is a
 *  one-line addition here, mirroring `isRevealScope` / `isLibraryDestination`. */
function isRangedTopdeckPool(value: unknown): boolean {
    return value === "drawn-this-turn";
}

/** The `reveal` scope of a `digToHand` Op (CR 701.20a) — makes the look a
 *  PUBLIC reveal: `"window"` reveals the whole looked-at window before the
 *  keep/order choice ("Reveal the top N"), `"kept"` reveals only the cards put
 *  into hand after the pick ("Look at the top N ... you may reveal a card").
 *  Omitted for a purely private look (CR 401.4). */
function isRevealScope(value: unknown): boolean {
    return value === "window" || value === "kept";
}

/** The `categories` list of a `revealAndCategorize` Op (issue #1364, Atraxa):
 *  a NON-EMPTY ordered array of `{ label, filter }` pairs and nothing else —
 *  `label` a non-empty display string (what the picker shows above the
 *  category), `filter` an ordinary `EffectCardFilter` deciding which revealed
 *  cards belong to it. Kept strict (exactly those two keys, both required) so
 *  the grammar stays frozen, ADR 0045. */
function isPickCategoryList(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0) return false;
    return value.every((entry) => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry))
            return false;
        const keys = Object.keys(entry).sort();
        if (keys.length !== 2 || keys[0] !== "filter" || keys[1] !== "label")
            return false;
        const e = entry as { label: unknown; filter: unknown };
        return isNonEmptyString(e.label) && isCardFilter(e.filter);
    });
}

/** The `zone` of a `chooseCategorized` Op (issue #1945) — the already-visible
 *  domain to choose from: the chooser's own hand or own battlefield. Distinct
 *  from `isChoiceZone` (which also allows library/graveyard/exile — zones a
 *  categorized pick from an already-visible set has no use for). */
function isChooseCategorizedZone(value: unknown): boolean {
    return value === "hand" || value === "battlefield";
}

/** The `onPicked` action of a `chooseCategorized` Op (issue #1945) — what
 *  happens to the members actually picked: `"keep"` leaves them exactly where
 *  they are (Noxious Vapors), `"returnToHand"` bounces them via
 *  `SpellContext.returnToHand` (Planar Overlay, CR 701.10 — battlefield
 *  only, enforced by that schema's `check`). */
function isChooseCategorizedOnPicked(value: unknown): boolean {
    return value === "keep" || value === "returnToHand";
}

/** The `sweep` clause of a `chooseCategorized` Op (issue #1945) — every
 *  non-picked HAND member (optionally narrowed by `filter`, deliberately a
 *  SEPARATE, possibly broader filter than the categorization domain) is
 *  discarded (CR 701.9). Exactly `{ action: "discard" }` or `{ action:
 *  "discard", filter }` — kept strict like `isPickCategoryList` (ADR 0045,
 *  the grammar stays frozen). */
function isChooseCategorizedSweep(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const keys = Object.keys(value).sort();
    const shapeOk =
        (keys.length === 1 && keys[0] === "action") ||
        (keys.length === 2 && keys[0] === "action" && keys[1] === "filter");
    if (!shapeOk) return false;
    const v = value as { action: unknown; filter?: unknown };
    if (v.action !== "discard") return false;
    return v.filter === undefined || isCardFilter(v.filter);
}

/** A destination a `revealTopAndRoute` Op may send a revealed card to
 *  (`RevealRouteDestination`, CR 400.7). `"library"` is absent by design — the
 *  card is already there and putting it back is `scryReorder`'s job. */
function isRevealRouteDestination(value: unknown): boolean {
    return (
        value === "battlefield" ||
        value === "hand" ||
        value === "graveyard" ||
        value === "exile"
    );
}

/** The ordered `routes` list of a `revealTopAndRoute` Op: a non-empty list of
 *  `{ filter, to }` rules, evaluated first-match-wins per revealed card. Mirrors
 *  `isPickCategoryList`'s exact-key discipline so a typo'd field is a
 *  validation failure, not a silently ignored clause. */
function isRevealRouteList(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0) return false;
    return value.every((entry) => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry))
            return false;
        const keys = Object.keys(entry).sort();
        if (keys.length !== 2 || keys[0] !== "filter" || keys[1] !== "to")
            return false;
        const e = entry as { filter: unknown; to: unknown };
        return isCardFilter(e.filter) && isRevealRouteDestination(e.to);
    });
}

/** The `mode` discriminator of a `preventDamage` Op (issue #845 / #1955,
 *  CR 615): the six prevention-shield shapes folded here — three
 *  recipient-scoped (`next-n`, `all-combat`, `combat-to-and-by`,
 *  `next-n-divided`) and two SOURCE-scoped (`all-from-source`,
 *  `all-from-matching`). */
function isPreventDamageMode(value: unknown): boolean {
    return (
        value === "next-n" ||
        value === "all-combat" ||
        value === "combat-to-and-by" ||
        value === "all-from-source" ||
        value === "all-from-matching" ||
        value === "next-n-divided"
    );
}

/** The `match` arm of a source-scoped `preventDamage` shield (issue #1955):
 *  `{ colors?: Color[]; cardType?: CardType }`, at least one arm present. Kept
 *  a NARROW purpose-built shape rather than an `EffectCardFilter` on purpose —
 *  the matcher runs on the damage path against a live battlefield instance,
 *  and an unknown filter field there would fail OPEN (silently shielding every
 *  source). A closed vocabulary cannot. */
function isSourceShieldMatch(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const m = value as Record<string, unknown>;
    for (const key of Object.keys(m)) {
        if (key !== "colors" && key !== "cardType") return false;
    }
    if (m.colors !== undefined) {
        if (!Array.isArray(m.colors) || m.colors.length === 0) return false;
        // WUBRG only — CR 202.2: colourless is the ABSENCE of colour, so a
        // "colourless sources" shield is not expressible as a colour match
        // (and `"C"`, which `Color` carries for mana purposes, would silently
        // never match `getColors`' output).
        if (!m.colors.every((c) => SHIELD_MATCH_COLORS.has(c as string))) {
            return false;
        }
    }
    if (
        m.cardType !== undefined &&
        !TOKEN_CARD_TYPES.has(m.cardType as string)
    ) {
        return false;
    }
    return m.colors !== undefined || m.cardType !== undefined;
}

/** The destination zones a `moveZone` Op may name (issue #839, EffectMoveZone).
 *  The five zones a one-shot effect addresses (CR 400.7), plus `"library-top"`
 *  (issue #1125) — the `cards`-shape-only tutor-to-top destination ("search
 *  … then shuffle and put that card on top", Vampiric Tutor). */
function isMoveZone(value: unknown): boolean {
    return (
        value === "hand" ||
        value === "library" ||
        value === "library-top" ||
        value === "graveyard" ||
        value === "exile" ||
        value === "battlefield"
    );
}

/** The shared `from` field checker for BOTH `moveZone` non-`target` shapes
 *  (issue #677, #680, #1279) — the four plain zones `MovableZone` covers
 *  (`SpellContext.moveZone`/`moveCardById`'s own zone type). The `cards`-
 *  shape additionally excludes `"exile"` at the `check()` level (issue #677/
 *  #680's zones a `choice` Op can raise a picks binding from never include
 *  exile); the whole-zone bulk shape (issue #1279) accepts all four. */
function isMovableZone(value: unknown): boolean {
    return (
        value === "library" ||
        value === "hand" ||
        value === "graveyard" ||
        value === "exile"
    );
}

/** A non-empty array of `MovableZone` values (issue #1104) — the `moveZone`
 *  FOURTH shape's `fromZones`, one or more zones swept in a single filtered
 *  bulk pass (Lobotomy's "graveyard, hand, and library"). */
function isMovableZoneArray(value: unknown): boolean {
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((v) => isMovableZone(v))
    );
}

function isBoolean(value: unknown): boolean {
    return typeof value === "boolean";
}

/** `{ negate: <value> }` — SHAPE of the negated-value construct (issue #926,
 *  `EffectNegatedValue`). Wraps ANY plain `EffectValue` (checked via
 *  `isEffectValue`, defined above — so nesting is grammatically impossible:
 *  `isEffectValue` itself never accepts `negate`, only the SIGNED grammar
 *  below does). No other keys are permitted. Unblocks "-X/-X" style pump
 *  amounts driven off a non-negative-by-nature value member (Toxic Deluge's
 *  chosen-cost X, CR 118.4 pay-X-life). */
function isNegatedValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "negate") return false;
    return isEffectValue((value as { negate: unknown }).negate);
}

/** A SIGNED effect value, for a `pump` Op's P/T amounts (issue #840). Unlike
 *  `isEffectValue` (whose literal branch is a positive count, CR 107.1), a
 *  pump amount is a signed integer literal — a negative is a shrink (Weakness),
 *  a zero is a one-sided pump (+1/+0) — or a `ref` / `count` / chosen-cost `X` /
 *  `counters` count (all non-negative by nature; Howl from Beyond's +X/+0,
 *  issue #852; a "+1/+1 per fuse counter" pump, issue #1015) — or a
 *  `negate`-wrapped value member for the negative of one of those
 *  non-negative-by-nature reads (issue #926 — Toxic Deluge's "-X/-X"). */
function isSignedEffectValue(value: unknown): boolean {
    if (typeof value === "number") return Number.isInteger(value);
    return (
        isRefValue(value) ||
        isCountValue(value) ||
        isXValue(value) ||
        isCountersValue(value) ||
        isDomainValue(value) ||
        isNegatedValue(value)
    );
}

/** A `DurationSpec` (issue #840, CR 611.2) — the phase boundary at which a
 *  temporary effect expires, with optional `skip` / `player` qualifiers. */
function isDurationSpec(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const spec = value as Record<string, unknown>;
    const phaseOk =
        spec.phase === "end-of-turn" ||
        spec.phase === "end-of-combat" ||
        spec.phase === "upkeep" ||
        spec.phase === "untap";
    if (!phaseOk) return false;
    if (
        "skip" in spec &&
        !(typeof spec.skip === "number" && Number.isInteger(spec.skip))
    ) {
        return false;
    }
    if (
        "player" in spec &&
        spec.player !== "controller" &&
        spec.player !== "opponent"
    ) {
        return false;
    }
    // Only phase / skip / player are permitted (JSON-pure, ADR 0046).
    return Object.keys(spec).every(
        (k) => k === "phase" || k === "skip" || k === "player"
    );
}

/** `{ ref: "$name" }` — a BARE ref: a single `ref` key holding a binding name
 *  with NO property path. Three positions use the bare shape, each
 *  family-checked by the ordered ref pass: a picks ref (issue #805 — the
 *  instance ids a `choice` Op bound), a player ref to a players-set `$each`
 *  (issue #807), and an object ref to a permanents-set `$each` (issue #807). */
function isBareRef(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    return (
        keys.length === 1 &&
        keys[0] === "ref" &&
        typeof (value as { ref: unknown }).ref === "string" &&
        /^\$[A-Za-z][A-Za-z0-9]*$/.test((value as { ref: string }).ref)
    );
}

/** Alias for readability at picks positions (`discard.cards`,
 *  `sacrifice.permanents`). */
const isBarePicksRef = isBareRef;

/** `{ exiledWithSource: true }` — SHAPE of the CR 607 linked-exile selector
 *  (issue #783). A single key holding the literal `true`; the cards it names are
 *  read at resolution from `getCardsExiledWith(ctx.sourceInstanceId)`, so it
 *  carries no other data and needs no ref pass. */
function isExiledWithSourceSelector(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    return (
        keys.length === 1 &&
        keys[0] === "exiledWithSource" &&
        (value as { exiledWithSource: unknown }).exiledWithSource === true
    );
}

/** `{ ref: "$event.<field>" }` — a trigger-event ref (ADR 0049, issue #865).
 *  SHAPE only: a single `ref` key holding an `$event.field` string. Site
 *  legality (trigger-only, not a delayed body), field census, and family are
 *  checked by the ordered ref pass. */
function isEventRefValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    return (
        keys.length === 1 &&
        keys[0] === "ref" &&
        typeof (value as { ref: unknown }).ref === "string" &&
        /^\$event\.[A-Za-z]+$/.test((value as { ref: string }).ref)
    );
}

/** An object-acting Op's selector (destroy/exile `target`, dealDamage `to`):
 *  an announced target slot, the bare `{ ref: "$each" }` inside a permanents-set
 *  forEach body (issue #807), or a `{ ref: "$event.<field>" }` object field at a
 *  trigger site (issue #865). The ordered ref pass enforces the family and the
 *  trigger-site scope. */
function isObjectSelector(value: unknown): boolean {
    return isTargetRef(value) || isBareRef(value) || isEventRefValue(value);
}

/** A ManaCost's numeric pips — WUBRGC + generic + xFactor are non-negative
 *  integers; `X` is a non-negative integer or the variable marker `"X"`. */
const MANA_PIP_KEYS = new Set([
    "W",
    "U",
    "B",
    "R",
    "G",
    "C",
    "generic",
    "xFactor",
]);
function isManaCost(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    for (const [k, v] of Object.entries(value)) {
        if (k === "X") {
            if (
                v !== "X" &&
                !(typeof v === "number" && Number.isInteger(v) && v >= 0)
            ) {
                return false;
            }
            continue;
        }
        if (!MANA_PIP_KEYS.has(k)) return false;
        if (!(typeof v === "number" && Number.isInteger(v) && v >= 0)) {
            return false;
        }
    }
    return true;
}

/** A full `ManaCost` value for `EffectCardFilter.manaCostEquals`'s exact
 *  structural comparison (issue #1881, ADR 0078 decision 8) — unlike
 *  `isManaCost` right above (the narrower token-ability-cost shape with no
 *  Phyrexian/hybrid pips), this accepts every `ManaCost` key the comparison
 *  folds in (`gre/constants.ts::manaCostsEqual`): WUBRGC + `generic` +
 *  `xFactor` (non-negative integers), `X` (a non-negative integer OR the
 *  variable marker `"X"`), `phyrexian` (a colour-keyed non-negative-integer
 *  map, CR 107.4f), and `hybrid` (an array of two-colour pip pairs, CR
 *  202.1a). Fails CLOSED (returns false) on any unrecognised key or
 *  malformed value, matching every other field in this validator. */
function isManaCostFilterValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    for (const [k, v] of Object.entries(value)) {
        if (k === "X") {
            if (
                v !== "X" &&
                !(typeof v === "number" && Number.isInteger(v) && v >= 0)
            ) {
                return false;
            }
            continue;
        }
        if (k === "phyrexian") {
            if (typeof v !== "object" || v === null || Array.isArray(v)) {
                return false;
            }
            for (const [pk, pv] of Object.entries(v)) {
                if (!TOKEN_COLORS.has(pk)) return false;
                if (
                    !(typeof pv === "number" && Number.isInteger(pv) && pv >= 0)
                ) {
                    return false;
                }
            }
            continue;
        }
        if (k === "hybrid") {
            if (!Array.isArray(v)) return false;
            for (const pair of v) {
                if (!Array.isArray(pair) || pair.length !== 2) return false;
                if (
                    !pair.every(
                        (c) => typeof c === "string" && TOKEN_COLORS.has(c)
                    )
                ) {
                    return false;
                }
            }
            continue;
        }
        if (!MANA_PIP_KEYS.has(k)) return false;
        if (!(typeof v === "number" && Number.isInteger(v) && v >= 0)) {
            return false;
        }
    }
    return true;
}

/** The `mana` field of an `addMana` Op (CR 106.1, issue #850): a JSON-pure
 *  per-colour amount map — only the five colours + colorless (WUBRGC), each a
 *  POSITIVE integer, and at least one entry (a mana-add producing nothing is
 *  meaningless). No generic / X / xFactor: those are not fixed produced mana. */
const MANA_POOL_KEYS = new Set(["W", "U", "B", "R", "G", "C"]);
function isManaPool(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const entries = Object.entries(value);
    if (entries.length === 0) return false;
    for (const [k, v] of entries) {
        if (!MANA_POOL_KEYS.has(k)) return false;
        if (!(typeof v === "number" && Number.isInteger(v) && v > 0)) {
            return false;
        }
    }
    return true;
}

/** A `mayPay` permanent leg's `count`: a fixed cardinal (positive int) or a
 *  summed-power threshold `{ minTotalPower: positive int }` (CR 118, Phyrexian
 *  Dreadnought — "sacrifice any number … total power ≥ N"). */
function isSacrificeCount(value: unknown): boolean {
    if (isPositiveInt(value)) return true;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const obj = value as Record<string, unknown>;
    if (Object.keys(obj).length !== 1 || !("minTotalPower" in obj)) {
        return false;
    }
    return isPositiveInt(obj.minTotalPower);
}

/** A `mayPay` cost (CR 117.3a / 118.4 / 118.9 / 702.24 / 701.9 / 122.1): a bare
 *  `ManaCost`, or the shared `CostLegs` shape
 *  `{ mana?, life?, permanent?, hand?, energy? }` (ADR 0079). At least one leg
 *  must be present. */
function isMayPayCost(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const obj = value as Record<string, unknown>;
    const unionKeys = new Set(["mana", "life", "permanent", "hand", "energy"]);
    const isUnion = Object.keys(obj).every((k) => unionKeys.has(k));
    if (isUnion && Object.keys(obj).length > 0) {
        if ("mana" in obj && !isManaCost(obj.mana)) return false;
        if (
            "life" in obj &&
            !(
                typeof obj.life === "number" &&
                Number.isInteger(obj.life) &&
                obj.life > 0
            )
        ) {
            return false;
        }
        if ("permanent" in obj) {
            // Permanent leg (CR 701.16 sacrifice / 701.24 return, ADR 0079):
            // all three fields are required — the nested shape is what makes an
            // orphan `count` with no `filter` unrepresentable.
            const p = obj.permanent;
            if (typeof p !== "object" || p === null) return false;
            const perm = p as Record<string, unknown>;
            if (perm.action !== "sacrifice" && perm.action !== "return") {
                return false;
            }
            if (!("filter" in perm) || !("count" in perm)) return false;
            // `count` is either a fixed cardinal (positive int) or a
            // summed-power threshold `{ minTotalPower: positive int }` (CR 118,
            // Phyrexian Dreadnought). JSON-pure either way (ADR 0046).
            if (!isSacrificeCount(perm.count)) return false;
            // A THRESHOLD is a sacrifice-only shape: "return any number of
            // permanents with total power ≥ N" is not a printed cost, and the
            // return path's picker is fixed-count.
            if (typeof perm.count === "object" && perm.action !== "sacrifice") {
                return false;
            }
        }
        if ("hand" in obj) {
            // Hand leg (CR 701.9 discard / 701.13 exile, issue #899 / ADR
            // 0079): fixed cardinals only — no summed-power threshold shape
            // (that's permanent-specific).
            const h = obj.hand;
            if (typeof h !== "object" || h === null) return false;
            const hand = h as Record<string, unknown>;
            if (hand.action !== "discard" && hand.action !== "exile") {
                return false;
            }
            const reqs = hand.requirements;
            if (!Array.isArray(reqs) || reqs.length === 0) return false;
            for (const r of reqs) {
                if (typeof r !== "object" || r === null) return false;
                const req = r as Record<string, unknown>;
                if (!("filter" in req) || !isPositiveInt(req.count)) {
                    return false;
                }
                if (
                    typeof req.filter !== "object" ||
                    req.filter === null ||
                    Array.isArray(req.filter)
                ) {
                    return false;
                }
            }
        }
        if ("energy" in obj) {
            // Energy leg (CR 122.1, issue #1194): fixed positive count only.
            if (!isPositiveInt(obj.energy)) return false;
        }
        return true;
    }
    // Bare ManaCost shape (the historical mana-only value).
    return isManaCost(value);
}

/** A `mayPay` Op's dynamically-derived mana cost (issue #1150, generalized
 *  #1958): "pay <a base cost> reduced by <a generic amount>", where at least
 *  one of the two isn't knowable at authoring time. A SECOND accepted shape
 *  for `mayPay`'s `cost` field, alongside the static `isMayPayCost` union.
 *
 *  Exactly ONE base source, and it decides which printed shape this is:
 *
 *   - `manaCostOf` — a bare PICKS ref (the object a `choice` Op selected, e.g.
 *     `{ ref: "$picked" }`; the ordered ref pass enforces the picks family,
 *     same position as `moveZone`'s `cards`). Flash, MIR: "pay ITS mana cost
 *     reduced by {2}".
 *   - `mana` — a literal `ManaCost` base. Draco, PLS: "pay {10}. This cost is
 *     reduced by {2} for each basic land type among lands you control."
 *
 *  `reducedBy` is a full `EffectValue` — a plain non-negative integer is the
 *  historical fixed amount, anything else (Draco's `{ domain: { of:
 *  "controller", times: 2 } }`) is resolved at execution time through the same
 *  grammar every numeric Op parameter uses. `isEffectValue` already accepts a
 *  bare number, so the fixed case needs no separate arm. */
function isDynamicMayPayManaCost(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length !== 2 || !("reducedBy" in obj)) return false;
    // Exactly one base source (the `keys.length === 2` above plus `reducedBy`
    // already forces it to be the only other key).
    if ("manaCostOf" in obj) {
        if (!isBarePicksRef(obj.manaCostOf)) return false;
    } else if ("mana" in obj) {
        if (!isManaCost(obj.mana)) return false;
    } else {
        return false;
    }
    // A negative fixed amount is nonsense (it would RAISE the cost); every
    // other `EffectValue` is a runtime read the interpreter floors at {0}.
    if (typeof obj.reducedBy === "number") {
        return Number.isInteger(obj.reducedBy) && obj.reducedBy >= 0;
    }
    return isEffectValue(obj.reducedBy);
}

/** A `mayPay` Op's dynamically-derived ENERGY cost (issue #1195): `{
 *  energyEqualTo: EffectValue }` — "pay {E} equal to a runtime amount" (Satya,
 *  Aetherflux Genius — "pay {E} equal to its mana value"). `energyEqualTo`
 *  reuses the EXISTING `EffectValue` grammar wholesale (`isEffectValue`) — no
 *  new value kind — unlike the mana leg's bespoke `manaCostOf` + `reducedBy`
 *  shape. A THIRD accepted shape for `mayPay`'s `cost` field. */
function isDynamicMayPayEnergyCost(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length !== 1 || !("energyEqualTo" in obj)) return false;
    return isEffectValue(obj.energyEqualTo);
}

/** `mayPay`'s `cost` field: the static `MayPayCost` union, the
 *  dynamically-derived `{ manaCostOf, reducedBy }` mana shape (issue #1150),
 *  or the dynamically-derived `{ energyEqualTo }` energy shape (issue
 *  #1195). */
function isMayPayCostOrDynamic(value: unknown): boolean {
    // Dynamic shapes FIRST: `{ mana, reducedBy }` (issue #1958) shares its
    // `mana` key with the static `CostLegs` mana leg, and only the presence of
    // `reducedBy` tells the two apart — testing the static union first would
    // make the ordering load-bearing on `isMayPayCost` staying strict about
    // unknown keys.
    return (
        isDynamicMayPayManaCost(value) ||
        isDynamicMayPayEnergyCost(value) ||
        isMayPayCost(value)
    );
}

/** The relational operators an `if` comparison predicate may use (CR 107). */
const COMPARISON_OPS = new Set(["eq", "ne", "lt", "le", "gt", "ge"]);

/** SHAPE of an `if` predicate (issue #806): a boolean-binding test
 *  (`{ binding }` / `{ not: { binding } }`) or a comparison
 *  (`{ left, op, right }`). Binding EXISTENCE and family are checked by the
 *  ordered ref pass; this only rejects malformed shapes. */
function isPredicate(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === "binding") {
        return isBindingName(obj.binding);
    }
    if (keys.length === 1 && keys[0] === "not") {
        const n = obj.not;
        if (typeof n !== "object" || n === null) return false;
        const nk = Object.keys(n);
        return (
            nk.length === 1 &&
            nk[0] === "binding" &&
            isBindingName((n as { binding: unknown }).binding)
        );
    }
    // picksNonEmpty form (issue #1287) — a single key holding a bare picks
    // ref (`isRefValue` accepts only a `.property` ref, so check the shape
    // directly: a lone `ref` key whose value is a `$binding` string with no
    // dot). Binding EXISTENCE and family (must be "picks") are checked by
    // the ordered ref pass, like every other predicate form.
    if (keys.length === 1 && keys[0] === "picksNonEmpty") {
        const p = obj.picksNonEmpty;
        if (typeof p !== "object" || p === null) return false;
        const pk = Object.keys(p);
        return (
            pk.length === 1 &&
            pk[0] === "ref" &&
            typeof (p as { ref: unknown }).ref === "string" &&
            /^\$[A-Za-z][A-Za-z0-9]*$/.test((p as { ref: string }).ref)
        );
    }
    // targetIsAnother form (issue #1315, CR 702.165a) — a single key holding
    // an announced-target-slot ref (`isTargetRef`, the same `{ target: n }`
    // shape a `dealDamage`/`destroy` object selector uses).
    if (keys.length === 1 && keys[0] === "targetIsAnother") {
        return isTargetRef(obj.targetIsAnother);
    }
    // hasCityBlessing form (Ascend, CR 702.131b — issue #1460) — a single key
    // holding the player whose city's-blessing designation to read (normally
    // "controller"). A pure player-state predicate, no binding/target/zone.
    if (keys.length === 1 && keys[0] === "hasCityBlessing") {
        return isPlayerRef(obj.hasCityBlessing);
    }
    // sharesColor form (issue #1955, CR 105.2 / 202.2) — two OBJECT SELECTORS
    // whose live, layer-materialised colours are intersected (Guard Dogs).
    // Binding existence/family is checked by the ordered ref pass below, like
    // every other selector-carrying predicate form.
    if (
        keys.length === 2 &&
        keys.includes("sharesColor") &&
        keys.includes("with")
    ) {
        return isObjectSelector(obj.sharesColor) && isObjectSelector(obj.with);
    }
    // picksMatchFilter form (issue #1343) — a `choice` Op's picks binding
    // (bare picks ref, same shape as `picksNonEmpty`), plus `player` (whose
    // graveyard to resolve the picks against) and `filter` (the card shape
    // to test). Binding EXISTENCE and family are checked by the ordered ref
    // pass, like every other predicate form.
    if (
        keys.length === 3 &&
        keys.includes("picksMatchFilter") &&
        keys.includes("player") &&
        keys.includes("filter")
    ) {
        return (
            isBareRef(obj.picksMatchFilter) &&
            isPlayerRef(obj.player) &&
            isCardFilter(obj.filter)
        );
    }
    // boundMatchesFilter form (Minsc & Boo) — a bare ref to an object
    // SNAPSHOT plus the card shape to test its CR 608.2h last-known
    // characteristics against. No `player`: unlike `picksMatchFilter` this
    // form reads no zone at all (a sacrificed token is in none, CR 704.5d).
    if (
        keys.length === 2 &&
        keys.includes("boundMatchesFilter") &&
        keys.includes("filter")
    ) {
        return isBareRef(obj.boundMatchesFilter) && isCardFilter(obj.filter);
    }
    // objectMatchesFilter form (issue #1747, Figure of Destiny) — an OBJECT
    // SELECTOR (announced slot / `$source` / forEach `$each`) plus the card
    // shape to test its LIVE, layer-materialised characteristics against. The
    // selector position is what separates it from `boundMatchesFilter`'s bare
    // snapshot ref: this form reads the battlefield now, not a snapshot.
    if (
        keys.length === 2 &&
        keys.includes("objectMatchesFilter") &&
        keys.includes("filter")
    ) {
        // The interpreter (issue #1747) resolves the ref, then hard-requires
        // `target.type === "permanent"` AND battlefield membership before
        // matching — a non-permanent or off-battlefield resolution reads
        // `false` rather than falling through to this filter. So `filter`
        // here is ALWAYS tested against a live battlefield object —
        // `hasAbility` / `isAttacking` (issue #1097) are honest here the same
        // way they are for a `forEach { set: "permanents" }` member, and
        // (issue #1898 finding 3) `manaCostEquals` is REJECTED here for the
        // same reason: `toPermanentFilter` (the reader this form actually
        // uses, `interpreter.ts`'s `objectMatchesFilter` branch) has no
        // mapping for it — it would validate but silently match every
        // permanent at runtime.
        return (
            isObjectSelector(obj.objectMatchesFilter) &&
            isCardFilter(obj.filter, {
                allowHasAbility: true,
                allowIsAttacking: true,
                allowControlledSinceTurnStart: true,
                rejectManaCostEquals: true,
            })
        );
    }
    // Comparison form.
    if (keys.length !== 3) return false;
    return (
        "left" in obj &&
        "op" in obj &&
        "right" in obj &&
        isEffectValue(obj.left) &&
        typeof obj.op === "string" &&
        COMPARISON_OPS.has(obj.op) &&
        isEffectValue(obj.right)
    );
}

/** An `if` branch — an array of Ops. Deep validity (each Op's schema, refs) is
 *  checked by the recursive branch pass; this only asserts the array shape. */
function isOpList(value: unknown): boolean {
    return Array.isArray(value);
}

/** An `optionChoice` Op's `modes` (issue #849) — SHAPE only: a non-empty array
 *  of `{ label: <non-empty string>, effects: <non-empty Op list> }`. Each
 *  mode's Op-list deep validity (schema, refs, nesting) is checked by the
 *  recursive branch pass, exactly like an `if` branch. CR 700.2 requires at
 *  least one mode. */
function isModeList(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0) return false;
    return value.every((mode) => {
        if (typeof mode !== "object" || mode === null || Array.isArray(mode)) {
            return false;
        }
        const m = mode as {
            label?: unknown;
            effects?: unknown;
            id?: unknown;
            color?: unknown;
        };
        // Only `label`, `effects`, the optional `id` and the optional `color`
        // are permitted (grammar frozen, ADR 0045). `color` (issue: QA color-
        // picker redesign) tags a mode that IS a choice of color (CR 105.1) so
        // `PendingChoiceOptions` / `ModeRow` can draw the matching `ManaSymbol`
        // — never itself a new structural construct, just picker metadata.
        for (const key of Object.keys(mode)) {
            if (
                key !== "label" &&
                key !== "effects" &&
                key !== "id" &&
                key !== "color"
            ) {
                return false;
            }
        }
        return (
            isNonEmptyString(m.label) &&
            Array.isArray(m.effects) &&
            m.effects.length > 0 &&
            (m.id === undefined || isNonEmptyString(m.id)) &&
            (m.color === undefined ||
                (typeof m.color === "string" && TOKEN_COLORS.has(m.color)))
        );
    });
}

/** A `coinFlip` / `coinFlipSync` Op's `win` / `loss` branch (issue #851 /
 *  #1281, shared shape) — SHAPE only: `{ consequence: <non-empty string>,
 *  effects: <non-empty Op list> }`. Each branch's Op-list deep validity
 *  (schema, refs, nesting) is checked by the recursive schema / ref passes,
 *  exactly like an `optionChoice` mode or an `if` branch. Only `consequence`
 *  and `effects` are permitted (grammar frozen, ADR 0045). */
function isCoinFlipBranch(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    for (const key of Object.keys(value)) {
        if (key !== "consequence" && key !== "effects") return false;
    }
    const b = value as { consequence?: unknown; effects?: unknown };
    return (
        isNonEmptyString(b.consequence) &&
        Array.isArray(b.effects) &&
        b.effects.length > 0
    );
}

/** dealDamage's `to`: an announced target, the current forEach member
 *  (`{ ref: "$each" }`, issue #807), OR `{ player: <EffectPlayerRef> }`. */
function isDamageRecipient(value: unknown): boolean {
    if (isObjectSelector(value)) return true;
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    return (
        keys.length === 1 &&
        keys[0] === "player" &&
        isPlayerRef((value as { player: unknown }).player)
    );
}

/** The `forEach` construct's set selector (ADR 0045, issue #807) — `{ set:
 *  "players" }`, `{ set: "permanents", zone: "battlefield", controller?,
 *  filter?, excludeSource? }` (`excludeSource` — issue #1957 — drops the
 *  resolving ability/spell's own source from the frozen member set), `{ set:
 *  "graveyard", controller?, filter? }` (issue #1056), or `{ set: "bound",
 *  ref }`. Unknown keys are rejected (the grammar is frozen; selector SHAPES
 *  may grow like vocabulary, but only by extending this checker). */
function isForEachSelector(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const s = value as Record<string, unknown>;
    if (s.set === "players") {
        return Object.keys(s).length === 1;
    }
    // `bound` (ADR 0049, issue #866) — iterate a `string[]` LIST binding.
    // Exactly `{ set, ref }`; `ref` must be a binding name (its family — a list
    // binding — is checked by the ordered ref pass, not here).
    if (s.set === "bound") {
        return Object.keys(s).length === 2 && isBindingName(s.ref);
    }
    // A bulk graveyard-set sweep (issue #1056, CR 404) — exactly `{ set,
    // controller?, filter? }`; no `zone` (a graveyard is the only zone this set
    // reads). `$each` binds as a graveyard-card snapshot (the ref pass declares
    // it "snapshot", same as a permanents member).
    if (s.set === "graveyard") {
        const gAllowed = new Set(["set", "controller", "filter"]);
        if (!Object.keys(s).every((k) => gAllowed.has(k))) return false;
        if ("controller" in s && !isPlayerRef(s.controller)) return false;
        if ("filter" in s && !isCardFilter(s.filter)) return false;
        return true;
    }
    // `targets` (issue #1083) — iterate the whole announced target set. No
    // extra fields: exactly `{ set: "targets" }` (no controller/filter — the
    // member set is already exactly what the TargetRequirement picked).
    if (s.set === "targets") {
        return Object.keys(s).length === 1;
    }
    if (s.set !== "permanents") return false;
    const allowed = new Set([
        "set",
        "zone",
        "controller",
        "filter",
        "excludeSource",
    ]);
    if (!Object.keys(s).every((k) => allowed.has(k))) return false;
    // CR 110.1 — permanents only exist on the battlefield.
    if (s.zone !== "battlefield") return false;
    if ("controller" in s && !isPlayerRef(s.controller)) return false;
    // issue #1957 — reflexive self-exclude (Waterspout Elemental).
    if ("excludeSource" in s && typeof s.excludeSource !== "boolean") {
        return false;
    }
    // `zone` is confirmed "battlefield" above — `hasAbility` reads the LIVE
    // `staticAbilities` array and `isAttacking` (issue #1097 — Tangle's "each
    // attacking creature") reads the live combat-role flag, both via
    // `toPermanentFilter` / `matchesPermanentFilter` here, unlike the
    // graveyard branch above (which has no live battlefield object to read
    // either off of). `manaCostEquals` is rejected here (issue #1898 finding
    // 3) for the mirror-image reason — `toPermanentFilter` has NO mapping for
    // it, so it would validate but silently match every permanent.
    if (
        "filter" in s &&
        !isCardFilter(s.filter, {
            allowHasAbility: true,
            allowIsAttacking: true,
            allowControlledSinceTurnStart: true,
            rejectManaCostEquals: true,
        })
    ) {
        return false;
    }
    return true;
}

/** The only `forEach` body shape a `simultaneous: true` graveyard sweep may
 *  carry (CR 400.7 / 614-batch, issue #1094): a single reanimating `moveZone
 *  { target: { ref: "$each" }, to: "battlefield" }` (an optional `controller`
 *  override — Hymn-of-Rebirth-style redirect). The interpreter bypasses the
 *  normal per-member `runOpList` walk for this construct entirely — it hands
 *  the WHOLE frozen member set to `SpellContext.returnGraveyardSetToBattle-
 *  field` in one call — so no other body shape has defined simultaneous
 *  semantics (a multi-Op body would still need per-member sequencing for its
 *  OTHER Ops, which the batch primitive does not model). */
function isSimultaneousReanimationBody(effects: unknown): boolean {
    if (!Array.isArray(effects) || effects.length !== 1) return false;
    const op = effects[0] as Record<string, unknown>;
    if (op.op !== "moveZone" || op.to !== "battlefield") return false;
    const target = op.target as Record<string, unknown> | undefined;
    if (!target || target.ref !== "$each") return false;
    const allowed = new Set(["op", "target", "to", "controller"]);
    return Object.keys(op).every((k) => allowed.has(k));
}

/** Shape check for `divideIntoPiles`'s `objects` selector (ADR 0053, pile
 *  division) — deliberately its OWN small selector, not `EffectForEachSelector`
 *  (see the type doc): `controller`/`player` are REQUIRED, not optional, since
 *  the divide-piles choice always validates against exactly one zone owner. */
function isPileObjectSelector(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const s = value as Record<string, unknown>;
    if (s.set === "permanents") {
        const allowed = new Set(["set", "zone", "controller", "filter"]);
        if (!Object.keys(s).every((k) => allowed.has(k))) return false;
        if (s.zone !== "battlefield") return false;
        if (!isPlayerRef(s.controller)) return false;
        // `zone` is confirmed "battlefield" above — see the matching
        // `isForEachSelector` permanents-branch comment (issue #1097, and
        // issue #1898 finding 3 for `rejectManaCostEquals`).
        if (
            "filter" in s &&
            !isCardFilter(s.filter, {
                allowHasAbility: true,
                allowIsAttacking: true,
                allowControlledSinceTurnStart: true,
                rejectManaCostEquals: true,
            })
        ) {
            return false;
        }
        return true;
    }
    if (s.set === "library-top") {
        const allowed = new Set(["set", "player", "count"]);
        if (!Object.keys(s).every((k) => allowed.has(k))) return false;
        return isPlayerRef(s.player) && isEffectValue(s.count);
    }
    if (s.set === "graveyard") {
        const allowed = new Set(["set", "controller", "filter"]);
        if (!Object.keys(s).every((k) => allowed.has(k))) return false;
        if (!isPlayerRef(s.controller)) return false;
        if ("filter" in s && !isCardFilter(s.filter)) return false;
        return true;
    }
    return false;
}

/** The timings a `delayedTrigger` Op may fire at (CR 603.7, ADR 0048) —
 *  exactly the `DelayedTriggerTiming` union the engine's fire path handles. */
const DELAYED_TIMINGS = new Set([
    "next-end-step",
    "next-end-of-combat",
    "next-draw-step",
    "next-main-phase",
    "next-upkeep",
    // Instance leave-watch (CR 603.7a / 603.10, issue #731) — fires on the
    // watched permanent's PERMANENT_LEFT, not a step boundary. Requires
    // `watch`; rejects `targetPlayer` (checked below).
    "leaves-battlefield",
    // Indefinite instance leave-watch (CR 603.7a / 603.10, issue #1470) — the
    // same `watch` + PERMANENT_LEFT machinery with NO "this turn" bound: it is
    // excluded from the CLEANUP purge (phases.ts), so it survives end of turn
    // and still fires on a later turn (earthbend N's return clause). Requires
    // `watch`; rejects `targetPlayer`, exactly like its this-turn twin.
    "leaves-battlefield-indefinite",
    // Repeating combat-event watch (CR 603.7d / 603.10, issue #884) — fires
    // once per BLOCKERS_CONFIRMED event for the rest of the turn (Battle
    // Cry). Rejects both `targetPlayer` and `watch` (checked below), like the
    // phase-boundary timings — it is not scoped to a player nor one instance.
    "this-turn-creature-blocks",
    // Repeating combat-damage-to-player watch (CR 720.2, issue #1199) — fires
    // at most once per DAMAGE_DEALT-carrying event batch for the rest of the
    // turn (Forth Eorlingas!). Rejects both `targetPlayer` and `watch`, same
    // shape as "this-turn-creature-blocks".
    "this-turn-creature-deals-combat-damage-to-player",
    // Instance unblocked-attack watch (CR 603.7a / 509.1h) — fires on the
    // WATCHED permanent's ATTACKER_UNBLOCKED event ("This turn, when target
    // creature you control attacks and isn't blocked, …", Delif's Cone /
    // Cube). Instance-scoped like the leave-watches: requires `watch`, rejects
    // `targetPlayer`, dequeued by firing, purged at CLEANUP (the "this turn"
    // bound, CR 514.2).
    "attacks-unblocked",
]);

function isDelayedTiming(value: unknown): boolean {
    return typeof value === "string" && DELAYED_TIMINGS.has(value);
}

/** SHAPE of a `delayedTrigger` Op's `capture` map (ADR 0048): binding-name
 *  keys (the reserved `$each` / `$source` names are rejected), each value a
 *  literal string, an announced target slot, a bare binding ref, a
 *  `$x.controller` property ref, or a `{ select }` LIST-valued source (ADR
 *  0049, issue #866). Binding existence / family / property legality are checked
 *  by the ordered ref pass. */
function isCaptureMap(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    return Object.entries(value).every(
        ([k, v]) =>
            isBindingName(k) &&
            k !== "$each" &&
            k !== "$source" &&
            k !== "$host" &&
            (isNonEmptyString(v) ||
                isTargetRef(v) ||
                isBareRef(v) ||
                isRefValue(v) ||
                isListCaptureSource(v))
    );
}

/** SHAPE of a `reflexiveTrigger` Op's `capture` map (CR 603.3c). Same
 *  vocabulary as `isCaptureMap` MINUS the `{ select }` list source, which is a
 *  delayed-only shape (its freeze-at-cast combat-partner semantics has no
 *  reflexive analogue), and minus `$event.<field>` refs (a reflexive ability
 *  triggers off the resolving effect's own action, not a firing event — there
 *  is no `$event` in scope). A bare binding ref is the common case: it carries
 *  the recorded binding VERBATIM so CR 608.2h last-known information survives
 *  onto the separate stack object. */
function isReflexiveCaptureMap(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    return Object.entries(value).every(
        ([k, v]) =>
            isBindingName(k) &&
            k !== "$each" &&
            k !== "$source" &&
            k !== "$host" &&
            (isNonEmptyString(v) ||
                isTargetRef(v) ||
                isBareRef(v) ||
                (isRefValue(v) && !isEventRefValue(v)))
    );
}

/** SHAPE of a `TargetRequirement` carried inline on an Op (CR 603.3d — the
 *  `reflexiveTrigger` Op's own announced targets). Structural only: a plain
 *  object with a `type` (a non-empty string or array of strings) and a
 *  `count` (a non-negative int, `"X"`, or a `{ min, max? }` range). The FIELD
 *  vocabulary itself is enforced by `tsc` against `TargetRequirement` at
 *  authoring time and by the target-filter registry at resolution time; what
 *  this adds — and what tsc cannot — is that the requirement survives the DB
 *  round-trip as pure JSON (ADR 0046), checked by the script-wide purity
 *  pass. */
function isInlineTargetRequirement(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const req = value as Record<string, unknown>;
    const typeOk =
        isNonEmptyString(req.type) ||
        (Array.isArray(req.type) &&
            req.type.length > 0 &&
            req.type.every(isNonEmptyString));
    if (!typeOk) return false;
    const count = req.count;
    if (count === "X") return true;
    if (typeof count === "number") {
        return Number.isInteger(count) && count >= 0;
    }
    if (typeof count === "object" && count !== null && !Array.isArray(count)) {
        const c = count as Record<string, unknown>;
        const minOk = Number.isInteger(c.min) && (c.min as number) >= 0;
        const maxOk =
            c.max === undefined ||
            (Number.isInteger(c.max) && (c.max as number) >= 0);
        return minOk && maxOk;
    }
    return false;
}

/** Per-Op field schemas. Adding an Op = one registry row (mechanicsRegistry),
 *  one executor (interpreter) and one schema row here; the coverage guard
 *  test fails CI when the three drift apart. `bind` (ADR 0045) is an optional
 *  field on the object-moving Ops that can snapshot their target. */
const OP_SCHEMAS: Record<string, OpSchema> = {
    // CR 615 (issue #1065) — `unpreventable` skips prevention shields only
    // (Urza's Rage's kicked mode: "the damage can't be prevented"); CR 614
    // replacement and CR 702.16 protection are unaffected. Omitted/false is
    // the default preventable path every other `dealDamage` card uses.
    // CR 120.1 (issue #1416) — optional `source` names a bound PERMANENT that
    // is the damage source instead of the resolving stack item (Backlash: the
    // tapped creature deals the damage). An object selector (a `$c`-style bind
    // ref); routed through the permanent-source player-damage pipeline.
    dealDamage: {
        required: { amount: isEffectValue, to: isDamageRecipient },
        optional: { unpreventable: isBoolean, source: isObjectSelector },
    },
    // CR 601.2d / 120.4 — divide-as-you-choose damage over the announced target
    // group (Arc Lightning, Fiery Justice, Meteor Shower). `total` mirrors the
    // card's `divideAsChosen.total`.
    dealDamageDividedAsChosen: { required: { total: isDivideTotal } },
    draw: { required: { player: isPlayerRef, count: isEffectValue } },
    discardAtRandom: {
        required: { player: isPlayerRef, count: isEffectValue },
        optional: { bind: isBindingName },
    },
    // issue #1947 — no fields: always picks from the pile linked to
    // $source and routes to that card's own owner's hand.
    randomExileToHand: { required: {} },
    gainLife: { required: { player: isPlayerRef, amount: isEffectValue } },
    getEnergy: { required: { player: isPlayerRef, amount: isEffectValue } },
    loseLife: { required: { player: isPlayerRef, amount: isEffectValue } },
    // CR 500.7 (issue #686) — schedule an extra turn for `player` (Time Warp).
    extraTurn: { required: { player: isPlayerRef } },
    // CR 614.10 (issue #1957) — `player` skips their next turn (Waterspout
    // Elemental).
    skipNextTurn: { required: { player: isPlayerRef } },
    // CR 601.3a (issue #1057) — a turn-scoped per-player cast lock (Xantid
    // Swarm). `player` names whom to lock (the defending player via "opponent").
    // `cardTypes` (issue #1124, Abeyance) optionally narrows the lock to those
    // card types; omitted forbids every spell.
    restrictCasting: {
        required: { player: isPlayerRef },
        optional: {
            cardTypes: (v: unknown) => isStringArray(v, TOKEN_CARD_TYPES),
        },
    },
    // CR 602.1 / 605.1a (issue #1124) — a turn-scoped per-player "can't
    // activate non-mana abilities" lock (Abeyance). `player` names whom to lock.
    restrictActivation: { required: { player: isPlayerRef } },
    // CR 504.1 (issue #1097 — Elfhame Sanctuary) — a one-shot per-player
    // "skip your draw step this turn" flag. `player` names whose draw step
    // to skip.
    skipDrawStepThisTurn: { required: { player: isPlayerRef } },
    // CR 601.3e (Teferi, Time Raveler +1) — grant a per-player "cast as though
    // it had flash" timing permission. `player` names the grantee; `cardTypes`
    // (optional) narrows the grant to those card types (Teferi: ["Sorcery"]);
    // omitted grants flash for every spell.
    grantCastTiming: {
        required: { player: isPlayerRef },
        optional: {
            cardTypes: (v: unknown) => isStringArray(v, TOKEN_CARD_TYPES),
        },
    },
    // CR 305.1-analog / 601 (issue #1149) — grant a turn-scoped, player-wide
    // graveyard play/cast permission (Yawgmoth's Will). `player` names the
    // grantee; `zones` (optional, defaults to both) narrows to "land" and/or
    // "spell"; `maxManaValue` (optional) caps the spell half.
    grantGraveyardPlay: {
        required: { player: isPlayerRef },
        optional: {
            zones: (v: unknown) => isStringArray(v, GRAVEYARD_PLAY_ZONES),
            maxManaValue: (v: unknown) =>
                typeof v === "number" && Number.isInteger(v) && v >= 0,
        },
    },
    // CR 614 (issue #1145 / #1149) — arm a turn-scoped graveyard-bound
    // exile-redirect grant (Yawgmoth's Will's second clause). `player` names
    // the grantee.
    armGraveyardRedirect: { required: { player: isPlayerRef } },
    // CR 601.3e / 117.6 (issue #1156) — grant cast/play permission (+
    // optional cost waiver) for the exile card a preceding `choice(zone:
    // "exile")` Op picked. `card` is a bare picks ref; `player` names the
    // grantee; `window`/`withoutPayingManaCost` are optional.
    grantCastFromExile: {
        required: {
            // A bare picks ref (a preceding `choice(zone: "exile")` pick), OR
            // the CR 607 linked-exile selector `{ exiledWithSource: true }`
            // (issue #783 — Hideaway's "you may play the exiled card": the card
            // THIS ability's own source exiled, which no binding can name
            // because the two abilities resolve separately).
            card: (v: unknown) =>
                isExiledWithSourceSelector(v) || isBarePicksRef(v),
            player: isPlayerRef,
        },
        optional: {
            window: (v: unknown) => v === "this-turn" || v === "while-exiled",
            withoutPayingManaCost: isBoolean,
            // CR 305.9 (issue #1689) — true iff the grant's Oracle text says
            // "play" (land-inclusive), never for a "cast"-only grant.
            includesLand: isBoolean,
        },
    },
    // CR 601.3e / 117.6-analog (issue #1344) — grant cast permission (+
    // optional cost waiver) for a graveyard card. `card` is EITHER a bare
    // picks ref (the card a preceding Op bound — Malcolm) OR an announced
    // target slot (`{ target: n }`, CR 601.2c — Emry, Lurker of the Loch,
    // issue #1650); an `$event` ref is deliberately NOT accepted (there is no
    // graveyard-card event family). `player` names the grantee;
    // `window`/`withoutPayingManaCost` are optional.
    grantCastFromGraveyard: {
        required: {
            card: (v: unknown) => isTargetRef(v) || isBarePicksRef(v),
            player: isPlayerRef,
        },
        optional: {
            window: (v: unknown) =>
                v === "this-turn" || v === "while-in-graveyard",
            withoutPayingManaCost: isBoolean,
        },
    },
    // CR 608.2g (issue #1477 / #1478 / #1961) — play a card as part of this
    // resolution (a "you may cast/play" with no duration). `player` names the
    // caster; `free` (optional) waives the mana cost (Malcolm); `includesLand`
    // (optional, CR 116.2a/305) opts the LAND branch in — set it only when the
    // Oracle text says "play" (Hideaway); `resultBind` (optional) names a
    // boolean outcome binding a downstream `if` reads (Chandra, issue #1478).
    // Two mutually-exclusive card SOURCES:
    //   - `card` + `source` ("graveyard"/"exile") — either a bare picks ref
    //     (Malcolm) or the CR 607 linked-exile selector
    //     `{ exiledWithSource: true }` (issue #1961 — Hideaway's "you may play
    //     the exiled card", which no binding can name because the exiling and
    //     the playing ability resolve separately); the linked selector requires
    //     `source: "exile"`.
    //   - `fromTopOfLibrary: true` — exile + offer the top of the caster's
    //     library (cast from exile), Chandra's +1. `card`/`source` omitted.
    castDuringResolution: {
        required: {
            player: isPlayerRef,
        },
        optional: {
            card: (v: unknown) =>
                isExiledWithSourceSelector(v) || isBarePicksRef(v),
            source: (v: unknown) => v === "graveyard" || v === "exile",
            fromTopOfLibrary: (v: unknown) => v === true,
            free: isBoolean,
            // CR 116.2a / 305.9 (issue #1961) — true iff the granting Oracle
            // text says "play" (land-inclusive), never for a "cast"-only grant.
            includesLand: isBoolean,
            resultBind: isBindingName,
        },
        check: (entry) => {
            const errors: string[] = [];
            const hasCard = "card" in entry;
            const fromTop = entry.fromTopOfLibrary === true;
            if (fromTop) {
                if (hasCard) {
                    errors.push(
                        'field "card" is not valid with "fromTopOfLibrary" (the top-of-library card is the source)'
                    );
                }
                if ("source" in entry) {
                    errors.push(
                        'field "source" is not valid with "fromTopOfLibrary" (it is always cast from exile)'
                    );
                }
            } else {
                if (!hasCard) {
                    errors.push(
                        'requires "card" (a bare picks ref or { exiledWithSource: true }) unless "fromTopOfLibrary: true" is set'
                    );
                }
                if (!("source" in entry)) {
                    errors.push('field "source" is required with "card"');
                } else if (
                    isExiledWithSourceSelector(entry.card) &&
                    entry.source !== "exile"
                ) {
                    // CR 607 / 406 — the linked selector names a card the source
                    // permanent EXILED, so it can only be played from exile.
                    errors.push(
                        'field "source" must be "exile" with { exiledWithSource: true }'
                    );
                }
            }
            return errors;
        },
    },
    // CR 106.1 (issue #850) — add mana to a player's mana pool. `mana` is the
    // JSON-pure per-colour amount map (WUBRGC, positive integers); `player`
    // (optional) names whose pool (default the resolving controller).
    addMana: {
        required: { mana: isManaPool },
        optional: { player: isPlayerRef },
    },
    destroy: {
        required: { target: isObjectSelector },
        optional: { bind: isBindingName, cantBeRegenerated: isBoolean },
    },
    exile: {
        required: { target: isObjectSelector },
        optional: { bind: isBindingName },
    },
    // CR 608.2 (issue #1097) — the resolving spell exiles ITSELF instead of
    // going to the graveyard (Recall / Restock). No fields — it always
    // redirects the currently-resolving stack item. Mirrors
    // `shuffleSelfIntoLibrary`'s empty-required shape exactly.
    exileSelf: { required: {} },
    // CR 603.7a / 701.18 / ADR 0028 — exile the announced target keyed to
    // `$source`, arming the exile-and-return bundle (O-Ring / Banishing Light /
    // Tawnos's Coffin). `returnTapped` returns the host tapped; `includeAttachments`
    // bundles its Auras/Equipment to travel with and return re-attached (default
    // false — host-only). No `sourceId` field: the bundle always keys to the
    // resolving source, set by the interpreter, not the author.
    exileWithAttachments: {
        required: { target: isObjectSelector },
        optional: { returnTapped: isBoolean, includeAttachments: isBoolean },
    },
    // CR 603.7a / ADR 0028 — return every exile-and-return bundle held by
    // `$source`. No parameters — the source is always the resolving ability's own.
    returnExiledForSource: { required: {} },
    // CR 701.3a/701.3c (ADR 0065, issue #1311) — attach $source to the
    // announced target permanent (Reconfigure's first activated ability).
    attach: {
        required: { target: isObjectSelector },
    },
    // CR 701.3d (ADR 0065, issue #1311) — unattach $source from whatever
    // it's currently attached to (Reconfigure's second activated ability).
    // No target field — legality of "currently attached" is enforced by the
    // ability's own `canActivate` gate, not by this Op.
    unattach: { required: {} },
    // CR 400.7 (issue #839) — a plain zone change. `target` is an object
    // selector (announced slot or a bare snapshot ref like `$source`); `to` is
    // the destination zone. The source zone is inferred from the object's kind,
    // so there is no `from` field. `bind` (issue #680) snapshots the object
    // BEFORE the move — valid alongside `target` always, or alongside `cards`
    // ONLY when `to: "battlefield"` (issue #1151, below).
    // SECOND SHAPE (issue #677, #680): `cards` (a bare choice-picks ref) +
    // `player` + `from` — the search/self-select half of a tutor/fetch/
    // graveyard-pick effect, consuming a `choice(zone: "library" | "hand" |
    // "graveyard")` Op's picks (a hidden zone has no announced-target form,
    // CR 601.2b; a graveyard pick is a self-selection, not a spell target).
    // `tapped` (optional) is valid only alongside `cards` AND
    // `to: "battlefield"` (Fabled Passage's forced-tapped fetch). `bind`
    // (issue #1151, closing #1120 gap 3) is likewise valid alongside `cards`
    // only with `to: "battlefield"` — it snapshots the permanent that just
    // entered, unblocking a follow-up Op (haste grant, delayed-sacrifice
    // capture) on a hand-sourced permanent (Sneak Attack, Cauldron Dance's
    // hand-side clause).
    // THIRD SHAPE (issue #1279) — a bulk WHOLE-ZONE move: `player` + `from`,
    // no `target` and no `cards`. Every card in `from` moves to `to`, no
    // selection (Timetwister / Echo of Eons's "shuffles their hand and
    // graveyard into their library"). Exactly one of `target` / `cards` /
    // whole-zone (neither `target` nor `cards`) applies; `player`/`from` are
    // required with EITHER `cards` or whole-zone, and invalid with `target`.
    moveZone: {
        required: { to: isMoveZone },
        optional: {
            target: isObjectSelector,
            bind: isBindingName,
            controller: isPlayerRef,
            cards: isBarePicksRef,
            player: isPlayerRef,
            from: isMovableZone,
            tapped: isBoolean,
            // issue #1104 — the FOURTH shape: a filter-driven bulk sweep
            // across one or more zones (Lobotomy).
            fromZones: isMovableZoneArray,
            filter: isCardFilter,
            // issue #1726 — battlefield → library at a 1-based position from
            // the top (Teferi, Hero of Dominaria's −3 "third from the top").
            position: isPositiveInt,
            // issue #1947 — stamp `linkExileToSource` on every moved card
            // (the "cards" shape's own search-and-exile sweep), valid only
            // alongside `to: "exile"` (Skyship Weatherlight).
            linkToSource: isBoolean,
        },
        check: (entry) => {
            const hasTarget = "target" in entry;
            const hasCards = "cards" in entry;
            const hasFromZones = "fromZones" in entry;
            const hasBulk = !hasTarget && !hasCards && !hasFromZones;
            const errors: string[] = [];
            if (
                (hasTarget && hasCards) ||
                (hasTarget && hasFromZones) ||
                (hasCards && hasFromZones)
            ) {
                errors.push(
                    'at most one of "target" / "cards" / "fromZones" may be present (omit all three for the whole-zone bulk mode, issue #1279)'
                );
            }
            if (hasCards) {
                if (!("player" in entry)) {
                    errors.push('field "player" is required with "cards"');
                }
                if (!("from" in entry)) {
                    errors.push('field "from" is required with "cards"');
                }
                if (entry.from === "exile") {
                    errors.push(
                        'field "from" does not accept "exile" with "cards" — only "library" / "hand" / "graveyard"'
                    );
                }
                // issue #1151 (closing #1120 gap 3) — `bind` snapshots the
                // permanent that just entered the battlefield, so it only
                // makes sense alongside `to: "battlefield"` (a library/
                // graveyard/exile destination has no permanent to snapshot).
                if ("bind" in entry && entry.to !== "battlefield") {
                    errors.push(
                        'field "bind" is only valid with "cards" and to: "battlefield"'
                    );
                }
                if ("controller" in entry) {
                    errors.push('field "controller" is not valid with "cards"');
                }
                // issue #1947 — `linkToSource` stamps `linkExileToSource` on
                // every moved card; only meaningful when the destination
                // actually IS exile (Skyship Weatherlight's search-and-exile
                // sweep).
                if ("linkToSource" in entry && entry.to !== "exile") {
                    errors.push(
                        'field "linkToSource" is only valid with "cards" and to: "exile" (issue #1947)'
                    );
                }
            }
            if ("linkToSource" in entry && !hasCards) {
                errors.push(
                    'field "linkToSource" is only valid on the "cards" shape (issue #1947)'
                );
            }
            if (hasTarget) {
                if ("player" in entry) {
                    errors.push('field "player" is not valid with "target"');
                }
                // issue #1469 — the RETURN-A-DEPARTED-OBJECT shape. `from` is
                // otherwise inferred from the object's kind; it is legal on
                // the `target` shape ONLY to name the zone a snapshot `ref`'s
                // object left the battlefield FOR, and only for a reanimating
                // return (`to: "battlefield"`). An announced target slot never
                // needs it (its zone comes from the requirement), so `from`
                // requires a `ref` selector.
                if ("from" in entry) {
                    if (entry.from !== "graveyard" && entry.from !== "exile") {
                        errors.push(
                            'field "from" with "target" accepts only "graveyard" or "exile" (the zone a bound, already-departed object was put into)'
                        );
                    }
                    if (entry.to !== "battlefield") {
                        errors.push(
                            'field "from" is only valid with "target" and to: "battlefield"'
                        );
                    }
                    const sel = entry.target as
                        | Record<string, unknown>
                        | undefined;
                    if (!sel || !("ref" in sel)) {
                        errors.push(
                            'field "from" requires "target" to be a snapshot ref (e.g. { ref: "$a" }) — an announced target slot infers its own zone'
                        );
                    }
                }
                // issue #1726 — the positional library insert (battlefield →
                // library, Teferi's −3 "third from the top"). `position` is
                // meaningful only with to: "library"; omitted, a battlefield
                // permanent goes on TOP (position 1 — the "put on top of its
                // owner's library" default), and a graveyard-card target
                // keeps the historical moveCardById path (Worldspine Wurm's
                // shuffle-in, which follows with a shuffle anyway).
                if ("position" in entry && entry.to !== "library") {
                    errors.push(
                        'field "position" is only valid with "target" and to: "library" (issue #1726)'
                    );
                }
            }
            if ("position" in entry && !hasTarget) {
                errors.push(
                    'field "position" is only valid on the "target" shape (issue #1726)'
                );
            }
            // issue #1279 — the whole-zone bulk shape: required `player`/
            // `from`, and none of the single-object fields (`bind`,
            // `controller`, `tapped`) make sense with no single object to
            // act on. Restricted to the four PLAIN zones on both `from`/`to`
            // — no `to: "battlefield"` (that reanimation path is the
            // existing `forEach { set: "graveyard" }` + `simultaneous`
            // idiom) and no `to: "library-top"` (meaningless with no pick
            // list to order).
            if (hasBulk) {
                if (!("player" in entry)) {
                    errors.push(
                        'field "player" is required for the whole-zone bulk mode (no "target"/"cards")'
                    );
                }
                if (!("from" in entry)) {
                    errors.push(
                        'field "from" is required for the whole-zone bulk mode (no "target"/"cards")'
                    );
                }
                if ("bind" in entry) {
                    errors.push(
                        'field "bind" is not valid for the whole-zone bulk mode — there is no single object to snapshot'
                    );
                }
                if ("controller" in entry) {
                    errors.push(
                        'field "controller" is not valid for the whole-zone bulk mode'
                    );
                }
                if ("tapped" in entry) {
                    errors.push(
                        'field "tapped" is not valid for the whole-zone bulk mode'
                    );
                }
                if (entry.to === "battlefield" || entry.to === "library-top") {
                    errors.push(
                        `to: "${entry.to}" is not valid for the whole-zone bulk mode — only "library" / "hand" / "graveyard" / "exile"`
                    );
                }
            }
            // issue #1104 — the FOURTH shape: a filter-driven bulk sweep
            // across one or more zones (Lobotomy). Required `player` +
            // `filter`; none of the single-object fields make sense (no
            // single object to snapshot/tap/reassign control of — mirrors
            // the whole-zone bulk shape's own restrictions exactly).
            // Restricted to the four PLAIN zones on `to` for the same reason
            // the whole-zone shape is: no `to: "battlefield"` reanimation
            // branch (that's the `forEach { set: "graveyard" }` idiom) and no
            // `to: "library-top"` (meaningless with no ordered pick list).
            if (hasFromZones) {
                if (!("player" in entry)) {
                    errors.push('field "player" is required with "fromZones"');
                }
                if (!("filter" in entry)) {
                    errors.push('field "filter" is required with "fromZones"');
                }
                if ("bind" in entry) {
                    errors.push(
                        'field "bind" is not valid with "fromZones" — there is no single object to snapshot'
                    );
                }
                if ("controller" in entry) {
                    errors.push(
                        'field "controller" is not valid with "fromZones"'
                    );
                }
                if ("tapped" in entry) {
                    errors.push('field "tapped" is not valid with "fromZones"');
                }
                if ("from" in entry) {
                    errors.push(
                        'field "from" is not valid with "fromZones" — use "fromZones" itself (plural, no singular "from")'
                    );
                }
                if (entry.to === "battlefield" || entry.to === "library-top") {
                    errors.push(
                        `to: "${entry.to}" is not valid with "fromZones" — only "library" / "hand" / "graveyard" / "exile"`
                    );
                }
            }
            if ("filter" in entry && !hasFromZones) {
                errors.push('field "filter" is only valid with "fromZones"');
            }
            if ("controller" in entry && entry.to !== "battlefield") {
                errors.push(
                    'field "controller" is only valid with to: "battlefield"'
                );
            }
            // `tapped` (CR 110.5a) is meaningful on either object-selecting
            // shape, but only for a card ENTERING the battlefield. issue #1469
            // extends it from `cards` to `target` (the departed-object return
            // — needed by the earthbend return clause, #1468-B).
            if ("tapped" in entry && (hasBulk || entry.to !== "battlefield")) {
                errors.push(
                    'field "tapped" is only valid with "cards"/"target" and to: "battlefield"'
                );
            }
            // issue #1125 — "library-top" is the search-then-shuffle-then-top
            // tutor destination, meaningless outside the `cards` shape (a
            // `target`-shape object has no "put it on top" primitive) and
            // meaningless from any source other than the library itself (the
            // picked card never left the library — a search only chooses).
            if (entry.to === "library-top") {
                if (!hasCards) {
                    errors.push('to: "library-top" is only valid with "cards"');
                } else if (entry.from !== "library") {
                    errors.push('to: "library-top" requires from: "library"');
                }
            }
            return errors;
        },
    },
    // CR 613.4c (issue #840) — a temporary P/T buff (layer 7c). `target` is an
    // object selector (announced slot, `$source`, or a forEach `$each`);
    // `power`/`toughness` are SIGNED values (a negative shrinks); `duration` is
    // the phase boundary at which the buff expires (CR 611.2).
    pump: {
        required: {
            target: isObjectSelector,
            power: isSignedEffectValue,
            toughness: isSignedEffectValue,
            duration: isDurationSpec,
        },
    },
    // CR 613.4b layer 7b (issue #1318) — SET a permanent's base P/T to a fixed
    // value for `duration`. `power`/`toughness` are OPTIONAL non-negative-int
    // characteristics (0 is legal, CR 107.4b); at least one is required (an
    // omitted stat is left untouched — Island of Wak-Wak's power-only set).
    setBasePT: {
        required: {
            target: isObjectSelector,
        },
        optional: {
            power: isNonNegativeInt,
            toughness: isNonNegativeInt,
            // CR 611.2b (issue #1746) — omitted is INDEFINITE.
            duration: isDurationSpec,
        },
        check: (entry) =>
            entry.power === undefined && entry.toughness === undefined
                ? ['at least one of "power" / "toughness" is required']
                : [],
    },
    // CR 122 (issue #841) — put/remove counters on a permanent. `action`
    // selects the direction; `counter` is the free-form counter type; `target`
    // is an object selector (announced slot, `$source`, or a forEach `$each`);
    // `count` is the number of counters (a positive literal, a `ref`, or a
    // `count`).
    counters: {
        required: {
            action: isCounterAction,
            counter: isNonEmptyString,
            target: isObjectSelector,
            count: isEffectValue,
        },
    },
    // CR 701.26 (issue #842) — tap/untap a permanent. `action` selects the
    // direction; `target` is an object selector (announced slot, `$source`, or
    // a forEach `$each`). No amount — a permanent is tapped or it isn't.
    // Optional `bind` (issue #1416) snapshots the permanent's power/toughness/
    // controller as last-known information (CR 608.2h) WITHOUT a zone change —
    // a normal "snapshot" binding, like destroy/exile (Backlash reads
    // `$bound.power` for a trailing dealDamage).
    tapUntap: {
        required: {
            action: isTapUntapAction,
            target: isObjectSelector,
        },
        optional: { bind: isBindingName },
    },
    // CR 302.6 / 502.1 (PRD #795) — arm a one-shot "doesn't untap next untap
    // step" flag. `target` is an object selector (announced slot, `$source`, or
    // a forEach `$each`). No amount / duration — the one-shot scope is
    // intrinsic to the flag.
    skipNextUntap: {
        required: {
            target: isObjectSelector,
        },
    },
    // CR 701.15 (issue #846) — stack a regeneration shield on a permanent.
    // `target` is an object selector (announced slot, `$source`, or a forEach
    // `$each`). No amount / duration — one shield per Op, consumed by the next
    // destroy event and expiring at CLEANUP (CR 514.2 / 614.5).
    regenerate: {
        required: {
            target: isObjectSelector,
        },
    },
    preventRegeneration: {
        required: {
            target: isObjectSelector,
        },
    },
    // CR 510.1c (issue #1283) — mark a permanent to assign no combat damage
    // this turn. `target` is an object selector (announced slot, `$source`, or
    // a forEach `$each`). No other fields.
    markAssignsNoCombatDamage: {
        required: {
            target: isObjectSelector,
        },
    },
    // CR 701.27 / 712 (issue #1210) — transform a permanent. `target` is an
    // object selector (announced slot, `$source`, or a forEach `$each`). No
    // other fields — CR 712.8a's toggle (front→back / back→front) is
    // determined at RESOLUTION time by the permanent's own `transformed`
    // flag, not declared on the Op.
    transform: {
        required: {
            target: isObjectSelector,
        },
    },
    // CR 111 / 701.7 (issue #847) — create token permanents. `token` is the
    // JSON-pure token spec (EffectTokenSpec — name + types required, the rest
    // optional; staticEffects deliberately excluded, not JSON-expressible);
    // `controller` names who gets the tokens (controller / announced slot /
    // forEach `$each`); `count` is an optional EffectValue (default 1) for a
    // count-scaled token creation.
    createToken: {
        required: {
            token: isEffectTokenSpec,
            controller: isPlayerRef,
        },
        optional: { count: isEffectValue, bind: isBindingName },
    },
    // CR 707.2 + CR 111.1 (issue #1459) — create token COPIES of a runtime
    // source permanent. `source` is an object selector (an announced target
    // slot OR a `ref` to an earlier binding in the same script); `controller`
    // names who gets the copies; `count` is an optional EffectValue (default
    // 1) for a count-scaled creation; `bind` snapshots the last created copy.
    createTokenCopy: {
        required: {
            source: isObjectSelector,
            controller: isPlayerRef,
        },
        optional: {
            count: isEffectValue,
            bind: isBindingName,
            // CR 508.4 (issue #1195) — Satya, Aetherflux Genius's "tapped
            // and attacking" token-copy entry flags.
            entersTapped: isBoolean,
            entersAttacking: isBoolean,
        },
    },
    // CR 114 (issue #1221) — create a command-zone emblem. `emblem` is a
    // non-empty registry key (the closure-bearing definition lives in
    // `convex/cards/emblems.ts`); `controller` (default "controller") is the
    // emblem's owner.
    emblem: {
        required: {
            emblem: (v: unknown) => typeof v === "string" && v.length > 0,
        },
        optional: { controller: isPlayerRef },
    },
    // CR 720.2 (issue #1199) — crown a player the monarch. `controller`
    // (default "controller") names who is crowned.
    becomeMonarch: {
        required: {},
        optional: { controller: isPlayerRef },
    },
    // CR 613.1b (issue #848) — change control of a permanent (layer 2).
    // `target` is the permanent whose control changes (announced slot,
    // `$source`, or a forEach `$each`); `controller` names who gains control
    // (controller / announced slot / relative player); `duration` is the
    // optional JSON-pure "for as long as" discriminator (absent = indefinite).
    gainControl: {
        required: {
            target: isObjectSelector,
            controller: isPlayerRef,
        },
        optional: { duration: isGainControlDuration },
    },
    // CR 700.2 / 601.2b (issue #849) — modal "choose one". `modes` is a
    // non-empty list of `{ label, effects }` (SHAPE checked here; each mode's
    // Op-list validity is checked by the recursive branch pass, like an `if`
    // branch); `prompt` is the choice header; `player` (optional) names the
    // chooser (default the resolving controller).
    optionChoice: {
        required: {
            modes: isModeList,
            prompt: isNonEmptyString,
        },
        optional: { player: isPlayerRef },
    },
    // CR 705 (issue #851) — flip a coin, run the win / loss branch. `win` /
    // `loss` are each `{ consequence, effects }` (SHAPE checked here; each
    // branch's Op-list validity is checked by the recursive branch pass, like an
    // optionChoice mode); `player` (optional) names the flipping player (default
    // the resolving controller).
    coinFlip: {
        required: {
            win: isCoinFlipBranch,
            loss: isCoinFlipBranch,
        },
        optional: { player: isPlayerRef },
    },
    // CR 705 (issue #1281) — flip a coin INLINE, no reveal-ack suspension
    // (the synchronous sibling of `coinFlip`). Same shape as `coinFlip`: `win`
    // / `loss` are each `{ consequence, effects }` (SHAPE checked here; each
    // branch's Op-list validity is checked by the recursive branch pass);
    // `player` (optional) names the flipping player (default the resolving
    // controller).
    coinFlipSync: {
        required: {
            win: isCoinFlipBranch,
            loss: isCoinFlipBranch,
        },
        optional: { player: isPlayerRef },
    },
    // CR 611.1b / 613.1f (issue #843) — grant a keyword static ability to a
    // permanent for a limited duration (layer 6). `ability` is the free-form
    // keyword granted; `target` is an object selector (announced slot,
    // `$source`, or a forEach `$each`); `duration` is the phase boundary at
    // which the grant expires (CR 611.2).
    grantAbility: {
        required: {
            target: isObjectSelector,
        },
        optional: {
            ability: isNonEmptyString,
            grantedActivatedId: isNonEmptyString,
            grantedTriggeredId: isNonEmptyString,
            // CR 611.2b / 611.2c — omitted is an INDEFINITE grant on ALL THREE
            // legs: keyword (`grantStaticAbilityPermanent`, issue #1746),
            // triggered (`grantTriggeredAbilityPermanent`, issue #1665) and
            // activated (`grantActivatedAbilityPermanent`, issue #1880).
            duration: isDurationSpec,
        },
        // Exactly one payload: a keyword static grant (`ability`) OR an
        // activated-ability grant (`grantedActivatedId`, a `grantTemplates[]`
        // id on the resolving source, issue #738) OR a triggered-ability grant
        // (`grantedTriggeredId`, a `triggeredGrantTemplates[]` id on the
        // resolving source, issue #1665).
        check: (op) => {
            const hasKeyword = "ability" in op;
            const hasActivated = "grantedActivatedId" in op;
            const hasTriggered = "grantedTriggeredId" in op;
            const payloads = [hasKeyword, hasActivated, hasTriggered].filter(
                Boolean
            ).length;
            if (payloads !== 1) {
                return [
                    'requires exactly one of "ability", "grantedActivatedId" or "grantedTriggeredId"',
                ];
            }
            return [];
        },
    },
    // CR 613.1d layer 4 (issue #1194) — add a subtype to a permanent
    // INDEFINITELY, in addition to its other types. `target` is an object
    // selector (announced slot, `$source`, or a forEach `$each`); `subtype`
    // is the added subtype string. No `duration` — the effect is generated
    // by a resolving ability (CR 611.2c) and never expires on its own.
    addSubtype: {
        required: {
            target: isObjectSelector,
            subtype: isNonEmptyString,
        },
    },
    // CR 613.1e layer 5 (issue #1083) — set a target's color(s). `target` is
    // an object selector (announced slot, `$source`, or a forEach `$each`);
    // `colors` is the new color set (empty array = colorless — legal);
    // `duration` is optional (meaningful for a permanent target only, ignored
    // for a spell — indefinite when omitted).
    setColor: {
        required: {
            target: isObjectSelector,
            colors: (v) => isStringArray(v, TOKEN_COLORS),
        },
        optional: { duration: isDurationSpec },
    },
    // CR 305.7 / 611.2 layer 4 (issue #1083, widened by #1746) — REPLACE a
    // permanent's subtypes. `target` is an object selector; `subtypes` is the
    // full replacement list; `duration` is OPTIONAL — present reverts at that
    // boundary (Orcish Farmer's "becomes a Swamp until …"), omitted replaces
    // INDEFINITELY (CR 611.2b — Figure of Destiny "becomes a Kithkin Spirit").
    setSubtype: {
        required: {
            target: isObjectSelector,
            subtypes: (v) => isStringArray(v),
        },
        optional: {
            // CR 611.2b (issue #1746) — omitted REPLACES the subtypes
            // INDEFINITELY (Figure of Destiny's staged respec).
            duration: isDurationSpec,
        },
    },
    // CR 208.2 / 611.1 (issue #1317) — turn a permanent into a creature.
    // `target` is an object selector; `power`/`toughness` are the animation's
    // base P/T (0 is legal — a characteristic, not a CR 107.1 amount);
    // `subtype`/`additionalTypes`/`grantedAbilities` are optional; `duration`
    // is OPTIONAL — omitted means an INDEFINITE animation (CR 611.2b,
    // Earthbend N), present means a temporary one (Mishra's Factory).
    animate: {
        required: {
            target: isObjectSelector,
            power: isNonNegativeInt,
            toughness: isNonNegativeInt,
        },
        optional: {
            subtype: isNonEmptyString,
            additionalTypes: (v) => isStringArray(v, TOKEN_CARD_TYPES),
            grantedAbilities: (v) => isStringArray(v),
            duration: isDurationSpec,
        },
    },
    // CR 701.20 (issue #844) — shuffle a player's library. `action` is
    // "shuffle" (the only folded library primitive); `player` names whose
    // library (controller / announced slot / forEach `$each`).
    libraryLook: {
        required: {
            action: isLibraryLookAction,
            player: isPlayerRef,
        },
    },
    // CR 608.2 / 701.24 (issue #898) — the resolving spell shuffles ITSELF
    // into its owner's library instead of the graveyard (Green Sun's Zenith).
    // No fields — it always redirects the currently-resolving stack item.
    shuffleSelfIntoLibrary: { required: {} },
    // CR 401.4 / 701.22 / 701.44 (issue #885) — look at / reorder the top of a
    // library through the suspending `orderTop` primitive. `player` names whose
    // library; `count` is how many top cards to look at; `destination` is where
    // the un-kept cards go. `prompt` is an optional choice header. No `bind` —
    // the pick is consumed internally by `orderTop`, not by a later Op.
    scryReorder: {
        required: {
            player: isPlayerRef,
            count: isEffectValue,
            destination: isLibraryDestination,
        },
        // `chooser` (issue #1532, fateseal) — the player who MAKES the top/bottom
        // decision, when that is not the library's owner (Jace, the Mind
        // Sculptor's +2 fateseal: the controller looks at TARGET player's
        // library). Omitted = the library owner chooses (ordinary Scry/Surveil).
        optional: { prompt: isNonEmptyString, chooser: isPlayerRef },
    },
    // CR 701.17 (issue #885) — mill: move the top `count` cards of a player's
    // library into their graveyard (deterministic; no choice). `player` names
    // whose library is milled; `count` is how many cards.
    mill: {
        required: {
            player: isPlayerRef,
            count: isEffectValue,
        },
    },
    // CR 701.20a + CR 400.7 — reveal the top `count` card(s) of a library and
    // route each by what it IS (deterministic; no choice, never suspends).
    // Nadu, Winged Wisdom. `player` names whose library; `routes` is the
    // ordered first-match-wins `{ filter, to }` list; `fallback` is the
    // Oracle text's "Otherwise, …" destination and is therefore REQUIRED —
    // a script with no fallback would silently strand a non-matching card.
    // `count` (optional, default 1) is how many top cards are revealed.
    revealTopAndRoute: {
        required: {
            player: isPlayerRef,
            routes: isRevealRouteList,
            fallback: isRevealRouteDestination,
        },
        optional: {
            count: isEffectValue,
        },
    },
    // CR 401.4 (issue #984, extended #1101) — dig to hand: look at the top
    // `look` cards, put `take` (default 1) into hand, the rest to
    // `destination` (library bottom by default, graveyard — Reviving Vapors —
    // when set). Suspends on a `look-top` choice over the looked-at ids.
    // `player` names whose library; `look` is how many top cards to look at;
    // `take` (optional, default 1) is how many to keep; `prompt` is an
    // optional choice header. `bind` (issue #1101) snapshot-binds the FIRST
    // kept card for a later Op's `manaValue`-of read (Reviving Vapors'
    // "gain life equal to that card's mana value").
    digToHand: {
        required: {
            player: isPlayerRef,
            look: isEffectValue,
        },
        // `filter` restricts the hand-eligible subset (Narset's "noncreature,
        // nonland card"); `optional` makes the hand pick a "may" (min 0);
        // `destination` (issue #1101) is where the un-kept cards go
        // (`library-bottom` default / `graveyard`, mirrors `scryReorder`);
        // `randomBottom` bottoms the rest unordered + unknown (issue #1266,
        // meaningless for a graveyard destination); `bind` names the kept-card
        // snapshot binding.
        optional: {
            take: isEffectValue,
            prompt: isNonEmptyString,
            filter: isCardFilter,
            optional: isBoolean,
            destination: isLibraryDestination,
            randomBottom: isBoolean,
            bind: isBindingName,
            // CR 701.20a — public reveal of the looked-at window ("window") or
            // only the kept cards ("kept"); omit for a private look (CR 401.4).
            reveal: isRevealScope,
        },
    },
    // CR 702.75a (issue #783) — HIDEAWAY: look at the top `look` cards, exile
    // exactly ONE face down (linked to the source, CR 607), bottom the rest in a
    // random order. `digToHand`'s vocabulary minus every choice the keyword does
    // not offer: no `take` (always exactly one), no `filter` (any of the looked-at
    // cards is eligible), no `optional` (not a "may"), no `destination` (always
    // the library bottom), no `randomBottom` (always random), no `reveal` (the
    // look is private and the exile is face down), no `bind` (nothing later in
    // the same script reads the exiled card — the CR 607 link does, from a
    // DIFFERENT ability's resolution).
    hideaway: {
        required: {
            player: isPlayerRef,
            look: isEffectValue,
        },
        optional: {
            prompt: isNonEmptyString,
        },
    },
    // CR 701.20a + CR 401.4 (issue #1364) — reveal a fixed top-N window once,
    // keep at most ONE card per category out of that shared window, bottom the
    // rest. Atraxa, Grand Unifier. `categories` is a non-empty ordered list of
    // `{ label, filter }` pairs (the label is what the picker shows); the rest
    // of the vocabulary is `digToHand`'s, with identical semantics.
    revealAndCategorize: {
        required: {
            player: isPlayerRef,
            look: isEffectValue,
            categories: isPickCategoryList,
        },
        optional: {
            optional: isBoolean,
            destination: isLibraryDestination,
            randomBottom: isBoolean,
            reveal: isRevealScope,
            prompt: isNonEmptyString,
        },
    },
    // CR 601.2b / 701.9 (issue #1945) — per-category choice from an
    // ALREADY-VISIBLE set (the chooser's own hand or battlefield). `categories`
    // is the same non-empty `{ label, filter }` list `revealAndCategorize`
    // uses; `onPicked`/`sweep` decide what happens to the picked/unpicked
    // halves, since (unlike that Op) there is no fixed kept→hand/rest→bottom
    // polarity here. `check` enforces the two combinations the two shipped
    // cards actually need: `sweep` (a real CR 701.9 discard) only makes sense
    // when the domain IS the hand, and `onPicked: "returnToHand"` (CR 701.10)
    // only makes sense when the domain IS the battlefield (a hand card is
    // already in hand — "returning" it would be a no-op the grammar should
    // never even express).
    chooseCategorized: {
        required: {
            player: isPlayerRef,
            zone: isChooseCategorizedZone,
            categories: isPickCategoryList,
            onPicked: isChooseCategorizedOnPicked,
        },
        optional: {
            optional: isBoolean,
            sweep: isChooseCategorizedSweep,
            prompt: isNonEmptyString,
        },
        check: (entry) => {
            const errors: string[] = [];
            if (entry.sweep !== undefined && entry.zone !== "hand") {
                errors.push('"sweep" requires zone: "hand"');
            }
            if (
                entry.onPicked === "returnToHand" &&
                entry.zone !== "battlefield"
            ) {
                errors.push(
                    'onPicked: "returnToHand" requires zone: "battlefield"'
                );
            }
            return errors;
        },
    },
    // CR 401.4 (issue #1046) — put N cards from a hand on top of a library,
    // in the player's chosen order, through the suspending
    // `choose-hand-card` choice + `moveHandCardToLibraryTop` primitive pair.
    // `player` names whose hand/library; `count` is how many cards to put
    // back (clamped to hand size). `prompt` is an optional choice header. No
    // `bind` — the pick is consumed internally, not by a later Op.
    putBack: {
        required: {
            player: isPlayerRef,
            count: isEffectValue,
        },
        optional: { prompt: isNonEmptyString },
    },
    // CR 615 (issue #845) — establish a damage-prevention shield. `mode`
    // discriminates the three folded prevention primitives, each with its own
    // required fields (enforced by `check`): `"next-n"` needs `to` (a damage
    // recipient — permanent/player) + `amount` + `duration`; `"all-combat"` is
    // field-free (a turn-scoped global Fog); `"combat-to-and-by"` needs
    // `target` (a permanent) + `duration`. Fields belonging to another mode are
    // rejected (the grammar is frozen, ADR 0045).
    preventDamage: {
        required: { mode: isPreventDamageMode },
        optional: {
            to: isDamageRecipient,
            amount: isEffectValue,
            target: isObjectSelector,
            duration: isDurationSpec,
            // Source-scoped modes (issue #1955).
            source: isObjectSelector,
            match: isSourceShieldMatch,
            combatOnly: isBoolean,
            // Divided recipient-scoped mode (issue #1955); `total` mirrors the
            // card's `divideAsChosen.total` vocabulary exactly.
            total: isDivideTotal,
        },
        check: (entry) => {
            const errors: string[] = [];
            const has = (k: string) => k in entry;
            const requireFields = (
                fields: string[],
                allowed: string[] = []
            ) => {
                for (const f of fields) {
                    if (!has(f)) {
                        errors.push(
                            `mode "${String(entry.mode)}" requires field "${f}"`
                        );
                    }
                }
                for (const f of [
                    "to",
                    "amount",
                    "target",
                    "duration",
                    "source",
                    "match",
                    "combatOnly",
                    "total",
                ]) {
                    if (!fields.includes(f) && !allowed.includes(f) && has(f)) {
                        errors.push(
                            `field "${f}" is not valid with mode "${String(entry.mode)}"`
                        );
                    }
                }
            };
            if (entry.mode === "next-n") {
                requireFields(["to", "amount", "duration"]);
            } else if (entry.mode === "all-combat") {
                requireFields([]);
            } else if (entry.mode === "combat-to-and-by") {
                requireFields(["target", "duration"]);
            } else if (entry.mode === "all-from-source") {
                requireFields(["source"], ["combatOnly"]);
            } else if (entry.mode === "all-from-matching") {
                requireFields(["match"], ["combatOnly"]);
            } else if (entry.mode === "next-n-divided") {
                requireFields(["total", "duration"]);
            }
            return errors;
        },
    },
    // CR 701.20a (issue #920, #682, #945) — reveal to every player. Two
    // mutually-exclusive shapes, exactly one of `zone` / `cards`:
    //  - `zone: "hand"` — reveal `player`'s whole hand (Thoughtseize/Duress).
    //  - `cards: <bare picks ref>` — reveal the SPECIFIC card(s) a preceding
    //    search-library `choice` bound (issue #945, the "search …, reveal it,
    //    put it into your hand" tutor clause). A library-top positional reveal
    //    (Caustic Bronco-class) is still a distinct future Op.
    reveal: {
        required: { player: isPlayerRef },
        optional: { zone: (v) => v === "hand", cards: isBarePicksRef },
        check: (entry) => {
            const hasZone = "zone" in entry;
            const hasCards = "cards" in entry;
            if (hasZone === hasCards) {
                return ['exactly one of "zone" or "cards" is required'];
            }
            return [];
        },
    },
    // CR 701.18a look (Urza's Bauble) — private "look at a card at random in
    // `player`'s hand". `looker` (optional) names the private looker; defaults
    // to the resolving controller (CR 113.7).
    lookRandomHand: {
        required: { player: isPlayerRef },
        optional: { looker: isPlayerRef },
    },
    // CR 608.2 / 101.4 (issue #805) — mid-resolution choice through the
    // existing Pending Choice pipeline. `bind` is REQUIRED: a choice whose
    // picks nothing consumes is meaningless. `filter` is valid with any zone:
    // "battlefield" (the submit validator applies it directly to public
    // permanents), "library" / "hand" (issue #677 — hidden-to-the-opponent
    // zones, so the interpreter precomputes an explicit `candidateIds`
    // allow-list from the filter instead), or "graveyard" (issue #680 —
    // `choiceCandidates`'s graveyard branch now precomputes the same
    // allow-list from the filter, e.g. Titania's "a LAND card", Exhume's "a
    // CREATURE card" — a graveyard is a public zone, so no filter at all
    // admits every card, CR 400.7). `zoneOwnerId` (issue #920) names the zone
    // owner when it differs from the chooser (`player`) — "target player
    // reveals their hand, YOU choose a card from it", Thoughtseize/Duress.
    choice: {
        required: {
            kind: isEffectChoiceKind,
            player: isPlayerRef,
            zone: isChoiceZone,
            count: isChoiceCount,
            prompt: isNonEmptyString,
            bind: isBindingName,
        },
        // `id` (issue #1282) — an optional author-supplied stable choiceId,
        // overriding `bind` as the `PendingChoice.choiceId` a migrated card
        // needs to reproduce its `resolve()`-era literal id (e.g.
        // "bazaar-discard"). Any non-empty string — unlike `bind` it is
        // NEVER read back via `{ ref }`, so it isn't constrained to the
        // `$`-prefixed binding-name grammar.
        // `candidates` (Barrin's Spite) narrows the pick to already-known
        // battlefield objects — the announced targets — so "choose one of
        // THEM" is a click on a card instead of a list of sentences.
        // `bindOther` snapshots the single unpicked candidate ("the other"),
        // which no announced slot can name because which slot it is depends on
        // the choice.
        optional: {
            // `filter`'s shape can't see the sibling `zone` field here (each
            // field validator only sees its own value) — permissive at the
            // field level, gated below in `check` instead, mirroring the
            // `candidates` ⇒ battlefield rule right below.
            filter: (v) =>
                isCardFilter(v, {
                    allowHasAbility: true,
                    allowIsAttacking: true,
                    allowControlledSinceTurnStart: true,
                }),
            zoneOwnerId: isPlayerRef,
            id: isNonEmptyString,
            candidates: (v) =>
                Array.isArray(v) && v.length > 0 && v.every(isObjectSelector),
            bindOther: isBindingName,
        },
        check: (entry) => {
            const errors: string[] = [];
            // Value checks, not `in`: an explicitly-`undefined` optional key is
            // the same as an absent one everywhere else in the grammar.
            if (
                entry.candidates !== undefined &&
                entry.zone !== "battlefield"
            ) {
                errors.push(
                    '"candidates" is valid only with zone: "battlefield" — the other zones are hidden or unordered, so nothing in them can be named ahead of the pick'
                );
            }
            // `hasAbility` (issue #1097) is honest only for `zone:
            // "battlefield"` — the interpreter reads it via the LIVE
            // `toPermanentFilter` path there, but falls back to
            // `matchesCardFilter` for hand/library/graveyard/exile, which has
            // no ability data for a hidden-zone card at all (would fail OPEN
            // — validate but match every card at runtime).
            if (
                entry.zone !== "battlefield" &&
                filterUsesHasAbility(entry.filter)
            ) {
                errors.push(
                    '"filter.hasAbility" is valid only with zone: "battlefield" — a hand/library/graveyard/exile card carries no ability data to match against'
                );
            }
            // `isAttacking` (issue #1097) — the `hasAbility` rule right above,
            // applied to combat role instead of keywords: a hand/library/
            // graveyard/exile card has no combat role at all.
            if (
                entry.zone !== "battlefield" &&
                filterUsesIsAttacking(entry.filter)
            ) {
                errors.push(
                    '"filter.isAttacking" is valid only with zone: "battlefield" — a hand/library/graveyard/exile card carries no combat-role data to match against'
                );
            }
            // `controlledSinceTurnStart` — the `hasAbility`/`isAttacking` rule
            // again, applied to control continuity: a card in a hidden zone has
            // no controller at all (CR 108.4).
            if (
                entry.zone !== "battlefield" &&
                filterUsesControlledSinceTurnStart(entry.filter)
            ) {
                errors.push(
                    '"filter.controlledSinceTurnStart" is valid only with zone: "battlefield" — a hand/library/graveyard/exile card has no controller to have controlled it'
                );
            }
            // `manaCostEquals` (issue #1898 finding 3) is the INVERSE of
            // `hasAbility`/`isAttacking` right above: honest ONLY for a
            // hidden-zone `zone` (hand/library/graveyard/exile), NOT for
            // "battlefield" — `toPermanentFilter` has no mapping for it, so a
            // battlefield `choice` would validate cleanly and then match
            // EVERY permanent at runtime (fail OPEN).
            if (
                entry.zone === "battlefield" &&
                filterUsesManaCostEquals(entry.filter)
            ) {
                errors.push(
                    '"filter.manaCostEquals" is not valid with zone: "battlefield" — a live permanent has no printed-cost slot in the battlefield matcher (toPermanentFilter); use a hand/library/graveyard/exile zone instead'
                );
            }
            if (
                entry.bindOther !== undefined &&
                entry.candidates === undefined
            ) {
                errors.push(
                    '"bindOther" requires "candidates" — there is no candidate set to take the complement of'
                );
            }
            return errors;
        },
    },
    // CR 701.9 (issue #805) — discard the cards a `choice` Op picked, OR
    // (issue #1279, `cards` omitted) the bulk whole-hand shape — every card
    // currently in `player`'s hand.
    discard: {
        required: { player: isPlayerRef },
        optional: { cards: isBarePicksRef },
    },
    // CR 701.5a (issue #806) — counter the target spell. `destination`
    // (issue #683) redirects a COUNTERED SPELL to exile/library-top/hand
    // instead of the CR 701.5a graveyard default.
    counter: {
        required: { target: isTargetRef },
        optional: { destination: isCounterDestination },
    },
    // CR 117.3a / 118.4 (issue #806, #680) — optional "you may pay {cost}",
    // or a bare cost-free "you may …" decision when `cost` is omitted (issue
    // #680 — Squee, Goblin Nabob). `bind` is REQUIRED: a may-pay whose
    // boolean outcome nothing reads is meaningless.
    mayPay: {
        required: {
            player: isPlayerRef,
            prompt: isNonEmptyString,
            bind: isBindingName,
        },
        // `cost` accepts the static MayPayCost union OR a dynamically-derived
        // mana cost read off a runtime-selected object (issue #1150).
        optional: { cost: isMayPayCostOrDynamic },
    },
    // if — the `if` structural construct (ADR 0045, issue #806). `predicate`
    // shape is checked here; branch Op validity and predicate binding
    // references are checked by the recursive branch / ordered ref passes.
    if: {
        required: { predicate: isPredicate, then: isOpList },
        optional: { else: isOpList },
    },
    // CR 701.16 (issue #807) — sacrifice the permanents a `choice` Op picked.
    // CR 701.16 — sacrifice a `choice` Op's picks (`permanents`, the "each
    // player sacrifices …" forEach pattern) OR a single announced target /
    // snapshot-bound permanent (`target`, "sacrifice that/this creature" —
    // Kjeldoran Elite Guard, Phantasmal Mount, issue #731). Exactly one form.
    sacrifice: {
        required: {},
        optional: {
            permanents: isBarePicksRef,
            target: isObjectSelector,
            // CR 608.2h — last-known-info snapshot of the sacrificed
            // permanent, same binding family as destroy/exile/moveZone.
            bind: isBindingName,
        },
        check: (entry) => {
            const hasPicks = "permanents" in entry;
            const hasTarget = "target" in entry;
            if (hasPicks === hasTarget) {
                return [
                    'exactly one of "permanents" (a choice Op\'s picks) or "target" (a single permanent) is required',
                ];
            }
            return [];
        },
    },
    // forEach — the `forEach` structural construct (ADR 0045, issue #807).
    // The `select` selector shape is checked here; body Op validity, the
    // nesting ban, and `$each` ref references are checked by the recursive
    // schema / ordered ref passes. `simultaneous` (CR 400.7 / 614-batch,
    // issue #1094) is a graveyard-set-only, single-Op-body-only flag —
    // checked below.
    forEach: {
        required: { select: isForEachSelector, effects: isOpList },
        optional: { simultaneous: isBoolean },
        check: (entry) => {
            const errors: string[] = [];
            if (Array.isArray(entry.effects) && entry.effects.length === 0) {
                errors.push('field "effects" must be a non-empty Op list');
            }
            // Simultaneous batch reanimation (issue #1094): only meaningful
            // over a graveyard set, and only for the ONE body shape the
            // batch primitive executes — a single reanimating `moveZone`.
            // A multi-Op body has no CR 400.7 single-event analogue (the
            // per-member side effects would still need sequencing), so it
            // stays sequential (`simultaneous` omitted/false).
            if (entry.simultaneous === true) {
                const select = entry.select as { set?: unknown } | undefined;
                if (!select || select.set !== "graveyard") {
                    errors.push(
                        'field "simultaneous" is only valid with { select: { set: "graveyard" } }'
                    );
                }
                if (!isSimultaneousReanimationBody(entry.effects)) {
                    errors.push(
                        'field "simultaneous" requires "effects" to be exactly [{ op: "moveZone", target: { ref: "$each" }, to: "battlefield" }] (optionally "controller") — the one CR 400.7 single-event shape the batch primitive executes'
                    );
                }
            }
            return errors;
        },
    },
    // CR 603.7 (ADR 0048) — grant a delayed triggered ability with an INLINE
    // nested body. The capture map / body scoping / nesting ban are checked
    // by the recursive schema and ordered ref passes.
    delayedTrigger: {
        required: {
            timing: isDelayedTiming,
            oracleText: isNonEmptyString,
            effects: isOpList,
        },
        optional: {
            capture: isCaptureMap,
            targetPlayer: isPlayerRef,
            watch: isObjectSelector,
        },
        check: (entry) => {
            const errors: string[] = [];
            if (Array.isArray(entry.effects) && entry.effects.length === 0) {
                errors.push('field "effects" must be a non-empty Op list');
            }
            // CR 504 / 505 — the player-scoped timings fire on ONE player's
            // step, so they demand a target player; the global-boundary
            // timings ignore one, so declaring it is a definition bug.
            const playerScoped =
                entry.timing === "next-draw-step" ||
                entry.timing === "next-main-phase";
            if (playerScoped && !("targetPlayer" in entry)) {
                errors.push(
                    `timing "${String(entry.timing)}" is player-scoped (CR 504/505) — field "targetPlayer" is required`
                );
            }
            if (!playerScoped && "targetPlayer" in entry) {
                errors.push(
                    `field "targetPlayer" is only valid with the player-scoped timings "next-draw-step" / "next-main-phase"`
                );
            }
            // CR 603.7a / 603.10 (issues #731 / #1470) / 509.1h — every
            // INSTANCE-SCOPED timing fires on one specific watched permanent,
            // so each demands `watch`; the phase-boundary and repeating
            // combat-watch timings fire at a step / on any creature and reject
            // it. The instance-scoped timings differ only in their firing
            // EVENT (PERMANENT_LEFT vs ATTACKER_UNBLOCKED) and their turn
            // bound (the CLEANUP purge, phases.ts), never in required fields.
            const instanceScoped =
                entry.timing === "leaves-battlefield" ||
                entry.timing === "leaves-battlefield-indefinite" ||
                entry.timing === "attacks-unblocked";
            if (instanceScoped && !("watch" in entry)) {
                errors.push(
                    `timing "${String(entry.timing)}" is instance-scoped (CR 603.7a) — field "watch" is required`
                );
            }
            if (!instanceScoped && "watch" in entry) {
                errors.push(
                    `field "watch" is only valid with the instance-scoped timings "leaves-battlefield" / "leaves-battlefield-indefinite" / "attacks-unblocked"`
                );
            }
            return errors;
        },
    },
    // CR 603.3c — a REFLEXIVE triggered ability created by the resolving
    // effect ("Sacrifice a creature. When you do, …"). No `timing` (nothing
    // is waited for) and no `targetPlayer` / `watch` — the delayed-trigger
    // fields that scope a FUTURE firing have no reflexive analogue. The
    // capture map / body scoping / nesting ban are checked by the recursive
    // schema and ordered ref passes.
    reflexiveTrigger: {
        required: { oracleText: isNonEmptyString, effects: isOpList },
        optional: {
            capture: isReflexiveCaptureMap,
            targetRequirement: isInlineTargetRequirement,
        },
        check: (entry) =>
            Array.isArray(entry.effects) && entry.effects.length === 0
                ? ['field "effects" must be a non-empty Op list']
                : [],
    },
    // CR 104.2a (issue #1066) — designate the winning player, through the
    // SAME `state.gameOver` seam State-Based Actions use.
    winGame: { required: { player: isPlayerRef } },
    // ADR 0053 (pile division, issue #1067) — divide-then-choose. `objects`
    // is validated by shape here; `divider`/`chooser` resolve as ordinary
    // player refs (ordered ref pass); `chosenBind`/`otherBind` declare two
    // LIST bindings scoped to `chosenEffect`/`otherEffect` respectively
    // (checked by the recursive branch pass, like an `if` branch's `then`/
    // `else`). Either Op list may be EMPTY (a pile with no consequence) — no
    // non-empty cross-field rule, unlike `forEach.effects`.
    divideIntoPiles: {
        required: {
            objects: isPileObjectSelector,
            divider: isPlayerRef,
            chooser: isPlayerRef,
            dividePrompt: isNonEmptyString,
            pickPrompt: isNonEmptyString,
            chosenBind: isBindingName,
            otherBind: isBindingName,
            chosenEffect: isOpList,
            otherEffect: isOpList,
        },
        check: (entry) =>
            entry.chosenBind === entry.otherBind
                ? [
                      '"chosenBind" and "otherBind" must be different binding names',
                  ]
                : [],
    },
    // CR 508.1a / 509.1a / 509.1b — a turn-scoped combat restriction grant.
    // `target` is an object selector (announced slot, `$source`, or a forEach
    // `$each`). `"cant-be-blocked"` is the CR 509.1b evasion side (Teleport,
    // Trailblazer …), routing to `setCantBeBlockedThisTurn`.
    restrictCombat: {
        required: {
            restriction: (v) =>
                v === "cant-attack" ||
                v === "cant-block" ||
                v === "cant-be-blocked",
            target: isObjectSelector,
        },
    },
    // CR 508.1c (issue #1283) — Island Sanctuary's player-scoped "can't be
    // attacked except by flying/islandwalk" protection. `player` is the
    // protected player; no other fields.
    setIslandSanctuaryProtection: {
        required: { player: isPlayerRef },
    },
    // CR 702.16b/e/i (issue #674) — "you gain protection from everything until
    // your next turn" (The One Ring). `player` is the protected player; the
    // duration is intrinsic, so no other fields.
    setProtectionFromEverything: {
        required: { player: isPlayerRef },
    },
    // CR 118.4 / 121.1 (issue #1283) — a single ranged 0..N "drawn this turn"
    // hand pick with a per-NOT-chosen life cost (Sylvan Library). `pool` is
    // the candidate-set discriminator (only `"drawn-this-turn"` today); `max`
    // is the "choose N" cap; `costPerKept` is the life paid per pool member
    // NOT put on top. No `bind` — the pick is consumed internally, mirroring
    // `putBack`.
    rangedTopdeck: {
        required: {
            player: isPlayerRef,
            pool: isRangedTopdeckPool,
            max: isEffectValue,
            costPerKept: isEffectValue,
        },
        optional: { prompt: isNonEmptyString },
    },
    // CR 201.3 / 202.3 (issue #1085) — "chooses a card name" as part of
    // resolution. `bind` is REQUIRED (a name choice nothing reads back is
    // meaningless — mirrors `choice`'s own required `bind`). `excludeBasicLand`
    // (CR 201.3, Desperate Research's "other than a basic land card name") is
    // optional.
    nameCard: {
        required: {
            player: isPlayerRef,
            prompt: isNonEmptyString,
            bind: isBindingName,
        },
        optional: { excludeBasicLand: isBoolean },
    },
    // CR 701.20a reveal / CR 401.4 look (issue #1085) — deterministic sibling
    // of `digToHand`: PUBLICLY reveal the top `look` cards to every player
    // (transient dialog + persistent known-to-all), put every FILTER-matching
    // card into hand with no player choice, and send the rest to
    // `destination`. `filter` is REQUIRED but MAY be the match-all `{}` — a
    // public reveal-and-keep-all (Dark Confidant) that `digToHand`'s PRIVATE
    // keep-all (`take` = `look`) cannot express, so the two are NOT redundant.
    // `bind` (optional) snapshots the first card put into hand.
    digMatchingToHand: {
        required: {
            player: isPlayerRef,
            look: isEffectValue,
            filter: isCardFilter,
            destination: isDigMatchingDestination,
        },
        optional: { bind: isBindingName },
    },
};

/** Names of the Ops that have a static field schema — used by the coverage
 *  guard test to keep schemas 1:1 with the registry and the interpreter. */
export const SCHEMA_OP_NAMES: readonly string[] = Object.keys(OP_SCHEMAS);

/** Property paths legal in a NUMERIC ref position (amount / count).
 *  `manaValue` (issue #680) reads a `moveZone` reanimation `bind`'s CR 202.3
 *  mana value (Reanimate). `isPermanentCard` (issue #1311) reads a snapshot's
 *  "1"/"0" CR 205/110.1 flag captured at bind time (Lion Sash: "if it was a
 *  permanent card…"). */
const NUMBER_REF_PROPERTIES = new Set([
    "power",
    "toughness",
    "manaValue",
    "isPermanentCard",
]);
/** Property paths legal in a PLAYER ref position (a player selector). */
// "owner" (issue #1106) — CR 108.3, the immutable owner captured alongside
// controller in the same snapshot `bind` (Recoil: "return it to its owner's
// hand, that player discards" — distinct from `.controller` whenever a
// control-magic effect diverges the two, e.g. Spinal Embrace then Recoil).
const PLAYER_REF_PROPERTIES = new Set(["controller", "owner"]);

/** ADR 0046 — deep JSON-purity check: only null, booleans, finite numbers,
 *  strings, arrays and plain objects (no undefined values, functions,
 *  RegExp, Date, Map, class instances, NaN/Infinity). Anything else would
 *  be silently mangled or dropped by `JSON.stringify`. */
function findImpurity(value: unknown, path: string): string | null {
    if (value === null) return null;
    switch (typeof value) {
        case "boolean":
        case "string":
            return null;
        case "number":
            return Number.isFinite(value)
                ? null
                : `${path}: non-finite number ${String(value)}`;
        case "object":
            break;
        default:
            return `${path}: non-JSON value of type ${typeof value}`;
    }
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            const err = findImpurity(value[i], `${path}[${i}]`);
            if (err) return err;
        }
        return null;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
        return `${path}: non-plain object (${Object.prototype.toString.call(value)})`;
    }
    for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined) return `${path}.${key}: undefined value`;
        const err = findImpurity(entry, `${path}.${key}`);
        if (err) return err;
    }
    return null;
}

/** One recorded `ref` use: the ref string and whether it sits in a numeric, a
 *  player, a picks, a boolean, or an object position (which decides its legal
 *  shape, its legal property paths, and the binding family it may name). */
interface RefUse {
    ref: string;
    /** `name` (issue #2065) is the `EffectCardFilter.name` position, split OUT
     *  of `picks` where it used to sit. It is the only position that accepts
     *  the reserved `$target<N>.name` ref, and an EXPLICIT kind is what keeps
     *  that acceptance from leaking: were it still `picks`, `$target0.name`
     *  would have to be accepted for `moveZone.cards` and `choice.candidates`
     *  too, where the interpreter has no reader for it and would silently
     *  resolve nothing. The `picks` branch's other rules (bare name, picks or
     *  list family) still apply to a `name` ref that is NOT the reserved
     *  shape — a `nameCard` / `choice` binding, issues #1085 / #1104. */
    kind: "number" | "player" | "picks" | "boolean" | "object" | "name";
}

/** Walks an Op's parameters collecting every `{ ref }` use, tagged by
 *  position. A ref under a `player` / `controller` / `zoneOwnerId` key is a
 *  player ref (issue #920 — a `choice` Op's zone-owner override); a ref
 *  under a `cards` / `permanents` key is a picks ref (issues #805/#807 — reads
 *  a choice Op's picks); a ref under a `target` / `to` / `of` key is an object
 *  ref (issue #807 — acts ON / reads the referenced permanent, `$each`; `of` is
 *  a `counters` value's object selector, issue #1015); any other ref is
 *  numeric (amount / count). `count` specs are traversed so a ref in their
 *  `controller` is caught too. `if` predicates and branch Op lists are NOT
 *  walked here — the caller handles them explicitly (boolean-binding refs and
 *  per-branch scoping). */
function collectRefUses(value: unknown, keyHint: string, out: RefUse[]): void {
    if (typeof value !== "object" || value === null) return;
    if (Array.isArray(value)) {
        for (const v of value) collectRefUses(v, keyHint, out);
        return;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === "ref" && typeof obj.ref === "string") {
        out.push({
            ref: obj.ref,
            kind:
                keyHint === "player" ||
                keyHint === "controller" ||
                keyHint === "zoneOwnerId" ||
                // ADR 0053 (pile division) — divideIntoPiles's `divider` /
                // `chooser` player refs.
                keyHint === "divider" ||
                keyHint === "chooser"
                    ? "player"
                    : keyHint === "cards" ||
                        keyHint === "permanents" ||
                        // `mayPay`'s dynamically-derived cost (issue #1150):
                        // `manaCostOf` is a bare picks ref — the object an
                        // earlier `choice` Op selected.
                        keyHint === "manaCostOf" ||
                        // `grantCastFromExile`'s `card` field (issue #1156)
                        // — a bare picks ref naming a `choice` Op's bind
                        // (singular: the choice's `count: 1` pick).
                        keyHint === "card"
                      ? "picks"
                      : // `EffectCardFilter.name` (issues #1085 / #2065) — its
                        // own kind, because it accepts BOTH a bare ref naming a
                        // `nameCard`/`choice` binding (the picks-shaped case)
                        // and the reserved `$target<N>.name`, which no other
                        // position may accept. See `RefUse.kind`.
                        keyHint === "name"
                        ? "name"
                        : keyHint === "target" ||
                            keyHint === "to" ||
                            keyHint === "of" ||
                            // `choice`'s `candidates[]` (Barrin's Spite) — the
                            // already-known battlefield objects the pick is
                            // narrowed to, each an `EffectObjectSelector`
                            // exactly like `target`.
                            keyHint === "candidates" ||
                            // `createTokenCopy`'s `source` (issue #1459) — the
                            // runtime permanent being copied, an
                            // `EffectObjectSelector` exactly like `target`
                            // (Ocelot Pride's `{ ref: "$each" }`, issue #1461).
                            // The only other `source` field in the vocabulary
                            // (`moveZone`'s zone discriminator) is a string
                            // literal, never a `{ ref }` object, so it never
                            // reaches this branch.
                            keyHint === "source" ||
                            // `objectMatchesFilter` (issue #1747) — the live
                            // object under test, an `EffectObjectSelector`
                            // exactly like `target` (`{ ref: "$source" }` on
                            // Figure of Destiny's stage gates).
                            keyHint === "objectMatchesFilter" ||
                            // `sharesColor` / `with` (issue #1955) — the two
                            // objects whose live colours the Guard Dogs gate
                            // intersects, each an `EffectObjectSelector` exactly
                            // like `target`. No other field in the vocabulary is
                            // named `with`.
                            keyHint === "sharesColor" ||
                            keyHint === "with"
                          ? "object"
                          : "number",
        });
        return;
    }
    // domain — { domain: { of, times? } } (CR 702 preamble, issue #1066): `of`
    // here is a PLAYER position, unlike every other value member's
    // object-family `of` (`counters`/`manaValue`). Handled BEFORE the generic
    // recursion below so a ref under `domain.of` isn't mis-tagged "object" by
    // the shared `of` convention those two members established. The optional
    // `times` multiplier (a plain number, no ref grammar of its own) is
    // allowed alongside `of` without falling through to generic recursion —
    // review finding on issue #1066/PR #1091: a bare `keys.length === 1`
    // check would mis-tag `of` as "object" the moment `times` co-exists.
    if (
        keyHint === "domain" &&
        keys.includes("of") &&
        keys.every((k) => k === "of" || k === "times")
    ) {
        collectRefUses(obj.of, "player", out);
        return;
    }
    // lifeGainedThisTurn — { lifeGainedThisTurn: { of } } (CR 119.3, issue
    // #1457): `of` is a PLAYER position, same as `domain`'s and for the same
    // reason. Handled before the generic recursion so a ref under it isn't
    // mis-tagged "object" by the `of`-key convention `counters`/`manaValue`
    // established.
    if (
        keyHint === "lifeGainedThisTurn" &&
        keys.length === 1 &&
        keys[0] === "of"
    ) {
        collectRefUses(obj.of, "player", out);
        return;
    }
    // `{ opponentOf: EffectPlayerRef }` (issue #1568) — the wrapped ref
    // occupies the EXACT SAME player position as the wrapping key (it is
    // still a player selector, just phrased as "the opponent of ..."), so it
    // must recurse with the SAME `keyHint` — NOT the child key name
    // "opponentOf", which the generic fallback below would otherwise use and
    // mis-tag as `kind: "number"`.
    if (keys.length === 1 && keys[0] === "opponentOf") {
        collectRefUses(obj.opponentOf, keyHint, out);
        return;
    }
    for (const [k, v] of Object.entries(obj)) collectRefUses(v, k, out);
}

/** Splits `"$binding.property"`; returns `null` when malformed. */
function parseRef(ref: string): { binding: string; property: string } | null {
    const dot = ref.indexOf(".");
    if (!ref.startsWith("$") || dot < 0) return null;
    return { binding: ref.slice(0, dot), property: ref.slice(dot + 1) };
}

/** The binding families. A SNAPSHOT binding (destroy/exile `bind`, the implicit
 *  `$source`, a permanents-set `$each`) stores the bound object's power/
 *  toughness/controller/id; a PICKS binding (a `choice` Op's `bind`) stores the
 *  chooser's submitted instance ids; a BOOLEAN binding (a `mayPay` Op's `bind`,
 *  issue #806) stores a paid/declined bit; a PLAYER binding (a players-set
 *  `$each`, issue #807) stores the current player id. Ref positions are
 *  family-typed — value/`.controller` refs read snapshots, picks positions read
 *  picks, an `if` binding predicate reads a boolean, object positions read a
 *  snapshot, bare player positions read a player — so the interpreter
 *  interprets the persisted value unambiguously. */
// A LIST binding (ADR 0049, issue #866) stores a frozen `string[]` of instance
// ids captured by a `delayedTrigger` list-valued capture; only a
// `forEach { set: "bound", ref }` reads it (as its iterated member set), so it
// has no scalar ref position — a `.property` / object / player / picks / boolean
// ref naming a list binding is a family mismatch (checkRefUse reports it).
// `forEach { set: "bound" }` ALSO accepts a PICKS binding as its iterated ref
// (widened issue #1284): a `choice` Op's picks and a delayedTrigger/
// divideIntoPiles list capture are the identical `string[]` runtime storage,
// distinguished only by provenance — the family check on `s.set === "bound"`
// (below, in `checkOpListRefs`) accepts either.
type BindingKind = "snapshot" | "picks" | "boolean" | "player" | "list";

/** The binding family a `bind`-carrying Op declares. */
function bindingKindOf(op: unknown): BindingKind {
    if (op === "choice") return "picks";
    if (op === "mayPay") return "boolean";
    // issue #1085 — `nameCard` stores the chosen name as a single-element
    // string array, the identical runtime shape a `choice` Op's picks use,
    // so a later `EffectCardFilter.name` bare ref reads it through the SAME
    // picks family (not a new binding kind).
    if (op === "nameCard") return "picks";
    return "snapshot";
}

/** Collects the boolean-binding refs an `if` predicate reads (issue #806): a
 *  `{ binding }` or `{ not: { binding } }` form names a boolean binding. A
 *  comparison predicate's numeric refs (`left` / `right`) are collected as
 *  ordinary numeric refs. */
function collectPredicateRefUses(predicate: unknown, out: RefUse[]): void {
    if (typeof predicate !== "object" || predicate === null) return;
    const p = predicate as Record<string, unknown>;
    if (typeof p.binding === "string") {
        out.push({ ref: p.binding, kind: "boolean" });
        return;
    }
    if (
        typeof p.not === "object" &&
        p.not !== null &&
        typeof (p.not as { binding?: unknown }).binding === "string"
    ) {
        out.push({
            ref: (p.not as { binding: string }).binding,
            kind: "boolean",
        });
        return;
    }
    // picksNonEmpty (issue #1287) — names a picks binding (a `choice` Op's
    // `bind`), same family as `discard`/`sacrifice`'s bare `cards`/
    // `permanents` refs.
    if (
        typeof p.picksNonEmpty === "object" &&
        p.picksNonEmpty !== null &&
        typeof (p.picksNonEmpty as { ref?: unknown }).ref === "string"
    ) {
        out.push({
            ref: (p.picksNonEmpty as { ref: string }).ref,
            kind: "picks",
        });
        return;
    }
    // targetIsAnother (issue #1315) — an announced target slot (`{ target: n }`),
    // never a `$binding` string, so there is nothing for the ordered ref pass
    // to resolve (a target slot's existence isn't binding-tracked, mirroring
    // every other Op's `{ target: n }` object selector).
    if (typeof p.targetIsAnother === "object" && p.targetIsAnother !== null) {
        return;
    }
    // picksMatchFilter (issue #1343) — names a picks binding (same family as
    // picksNonEmpty), plus a player-position ref on `player`.
    if (
        typeof p.picksMatchFilter === "object" &&
        p.picksMatchFilter !== null &&
        typeof (p.picksMatchFilter as { ref?: unknown }).ref === "string"
    ) {
        out.push({
            ref: (p.picksMatchFilter as { ref: string }).ref,
            kind: "picks",
        });
        collectRefUses(p.player, "player", out);
        return;
    }
    // boundMatchesFilter (Minsc & Boo) — names an object SNAPSHOT binding
    // (the `object` position's family), no player ref.
    if (
        typeof p.boundMatchesFilter === "object" &&
        p.boundMatchesFilter !== null &&
        typeof (p.boundMatchesFilter as { ref?: unknown }).ref === "string"
    ) {
        out.push({
            ref: (p.boundMatchesFilter as { ref: string }).ref,
            kind: "object",
        });
        return;
    }
    // objectMatchesFilter (issue #1747) — an object SELECTOR, which may itself
    // be a ref (`$source` / a forEach `$each` / a bound snapshot); route it
    // through the shared object-position collector so a dangling binding is
    // caught exactly as at every other selector site.
    if ("objectMatchesFilter" in p) {
        collectRefUses(p.objectMatchesFilter, "objectMatchesFilter", out);
        return;
    }
    // sharesColor (issue #1955) — TWO object selectors, each of which may be a
    // ref; route both through the shared object-position collector.
    if ("sharesColor" in p) {
        collectRefUses(p.sharesColor, "sharesColor", out);
        collectRefUses(p.with, "with", out);
        return;
    }
    // Comparison: numeric refs on either side.
    collectRefUses(p.left, "left", out);
    collectRefUses(p.right, "right", out);
}

/** The `$event` scope threaded through the ref pass (ADR 0049, issue #865).
 *  `eventType` is the firing event's type at a triggered-ability site (undefined
 *  at spell / activated sites — `$event` is then illegal); `inDelayedBody` marks
 *  a `delayedTrigger` body, where `$event` is illegal even at a trigger site
 *  (the firing event is gone at fire time). */
interface EventScope {
    eventType: string | undefined;
    inDelayedBody: boolean;
}

/** Validates a `$event.<field>` ref (ADR 0049, issue #865). Legal ONLY at a
 *  trigger site (`eventType` known) and NOT inside a delayed body. The field
 *  must be censused for the trigger's event type, and its registry family must
 *  match the ref's POSITION (an object field in an object position, a player
 *  field in a player position). */
function checkEventRef(
    use: RefUse,
    eventScope: EventScope,
    at: string,
    errors: string[]
): void {
    const field = use.ref.slice(use.ref.indexOf(".") + 1);
    if (eventScope.inDelayedBody) {
        errors.push(
            `${at}: "$event" ref "${use.ref}" is not legal in a delayedTrigger body — the firing event is gone at fire time (ADR 0049); capture the field into a binding instead`
        );
        return;
    }
    if (eventScope.eventType === undefined) {
        errors.push(
            `${at}: "$event" ref "${use.ref}" is only legal at a triggered-ability site (ADR 0049) — there is no firing event at a spell / activated site`
        );
        return;
    }
    const row = getEventFieldRow(eventScope.eventType, field);
    if (!row) {
        errors.push(
            `${at}: "$event" ref "${use.ref}" — "${field}" is not a censused field for event "${eventScope.eventType}" (EVENT_FIELD_REGISTRY, ADR 0049)`
        );
        return;
    }
    // Family must match the ref position. An `$event` ref only ever reads an
    // object or player id — a numeric position is always a bug.
    const positionFamily =
        use.kind === "object"
            ? "object"
            : use.kind === "player"
              ? "player"
              : undefined;
    if (positionFamily === undefined) {
        errors.push(
            `${at}: "$event" ref "${use.ref}" appears in a ${use.kind} position — an $event ref reads an object or player id, not a ${use.kind} value`
        );
        return;
    }
    if (row.family !== positionFamily) {
        errors.push(
            `${at}: "$event" ref "${use.ref}" is a ${row.family} field in a ${positionFamily} position — the EVENT_FIELD_REGISTRY family must match the ref position`
        );
    }
}

/** Validates one recorded ref use against the bindings declared so far, pushing
 *  a human-readable error for a dangling binding, a family mismatch, or an
 *  unknown property path. */
function checkRefUse(
    use: RefUse,
    declared: ReadonlyMap<string, BindingKind>,
    at: string,
    errors: string[],
    eventScope: EventScope
): void {
    // `$event.<field>` (ADR 0049, issue #865) — resolved live from the firing
    // event, not a stored binding. Site / census / family are checked here.
    if (use.ref.startsWith("$event.")) {
        checkEventRef(use, eventScope, at, errors);
        return;
    }
    // `EffectCardFilter.name` (issue #2065) — the ONE position that accepts
    // the reserved `$target<N>.name` ref: the announced target's own live
    // name, readable with no preceding bind (Winnow). Accepted here WITHOUT
    // consulting `declared`, exactly like `$event.<field>` above and for the
    // same reason — no Op binds it; the interpreter reads it from
    // `ctx.targets`. A slot that was never announced resolves to undefined at
    // resolution and the filter matches nothing (CR 608.2b), so there is
    // nothing to check statically: the announced-target count is a property of
    // the CARD's `targetRequirement`, not of the script.
    //
    // Everything else in a `name` position falls through to the bare-binding
    // rules below: `$target0` with no property, or `$target0.power`, are
    // NEITHER the reserved ref (parse fails) NOR a declared binding, so they
    // are rejected there — fail-closed by construction rather than by an
    // extra check here.
    if (use.kind === "name" && parseTargetNameRef(use.ref) !== null) {
        return;
    }
    // Bare-binding positions (no property path): picks (#805), boolean
    // (#806, an `if` predicate), and the non-reserved half of a `name`
    // position (a `nameCard` / `choice` binding, issues #1085 / #1104 —
    // stored as picks).
    if (use.kind === "picks" || use.kind === "boolean" || use.kind === "name") {
        if (use.ref.includes(".")) {
            errors.push(
                `${at}: ${use.kind} ref "${use.ref}" must be a bare binding name (no property path)`
            );
            return;
        }
        const family = declared.get(use.ref);
        if (family === undefined) {
            errors.push(
                `${at}: ref "${use.ref}" references undefined binding "${use.ref}" — no earlier Op binds it`
            );
            return;
        }
        // A "picks" position (a bare picks ref, e.g. `moveZone`'s `cards`)
        // ALSO accepts a "list" binding (ADR 0049 `delayedTrigger` capture /
        // ADR 0053 `divideIntoPiles` pile bind) — both are the identical
        // `string[]` storage shape, distinguished only by provenance; a
        // `choice` Op's picks and a divideIntoPiles pile are equally valid
        // inputs to a bare-picks-ref consumer.
        const ok =
            use.kind === "boolean"
                ? family === "boolean"
                : family === "picks" || family === "list";
        if (!ok) {
            // A `name` position reads the same picks-shaped storage a `picks`
            // position does (issue #1085) — its wanted family and hint are
            // the picks ones, not the boolean ones.
            const wantsPicks = use.kind !== "boolean";
            const wanted = wantsPicks ? "picks" : "boolean";
            errors.push(
                `${at}: ref "${use.ref}" names a ${family} binding in a ${use.kind} position — a ${use.kind} position reads a ${wanted} binding (${wantsPicks ? "a choice Op's bind or a list binding" : "a mayPay Op's bind"})`
            );
        }
        return;
    }
    // Object position (issue #807): a BARE snapshot ref — in practice the
    // permanents-set `$each` (the only snapshot whose object is still expected
    // on the battlefield when acted on).
    if (use.kind === "object") {
        if (use.ref.includes(".")) {
            errors.push(
                `${at}: object ref "${use.ref}" must be a bare binding name (no property path)`
            );
            return;
        }
        const family = declared.get(use.ref);
        if (family === undefined) {
            errors.push(
                `${at}: ref "${use.ref}" references undefined binding "${use.ref}" — no earlier Op binds it (bare object refs are the forEach "$each" of a permanents set)`
            );
            return;
        }
        if (family !== "snapshot") {
            errors.push(
                `${at}: ref "${use.ref}" names a ${family} binding in an object position — object refs read a permanents-set "$each" snapshot`
            );
        }
        return;
    }
    // Player position, BARE shape (issue #807): the players-set `$each`. A
    // player ref WITH a property (`$x.controller`) falls through to the
    // snapshot-property path below.
    if (use.kind === "player" && !use.ref.includes(".")) {
        const family = declared.get(use.ref);
        if (family === undefined) {
            errors.push(
                `${at}: ref "${use.ref}" references undefined binding "${use.ref}" — no earlier Op binds it (bare player refs are the forEach "$each" of a players set)`
            );
            return;
        }
        if (family !== "player") {
            errors.push(
                `${at}: ref "${use.ref}" names a ${family} binding in a bare player position — only a players-set forEach "$each" is a player binding`
            );
        }
        return;
    }
    const parsed = parseRef(use.ref);
    if (!parsed) {
        errors.push(`${at}: malformed ref "${use.ref}"`);
        return;
    }
    const family = declared.get(parsed.binding);
    if (family === undefined) {
        errors.push(
            `${at}: ref "${use.ref}" references undefined binding "${parsed.binding}" — no earlier Op binds it`
        );
        return;
    }
    if (family !== "snapshot") {
        errors.push(
            `${at}: ref "${use.ref}" names a ${family} binding in a ${use.kind} position — power/toughness/manaValue/controller refs read snapshot bindings`
        );
        return;
    }
    const legal =
        use.kind === "player" ? PLAYER_REF_PROPERTIES : NUMBER_REF_PROPERTIES;
    if (!legal.has(parsed.property)) {
        errors.push(
            `${at}: ref "${use.ref}" has unknown property path ".${parsed.property}" in a ${use.kind} position`
        );
    }
}

/** Checks one `delayedTrigger` capture source (ADR 0048) against the bindings
 *  declared BEFORE the Op (captures resolve at scheduling time, in the outer
 *  scope). A bare ref must name a snapshot or player binding (single-value —
 *  picks/boolean/list bindings cannot cross the boundary as a bare ref). A
 *  property ref must be `.controller` on a snapshot. A `{ select }` LIST source
 *  (ADR 0049, issue #866) resolves its own `combatPartners` set at cast time —
 *  it names no outer binding, so nothing is checked here (shape already passed
 *  `isCaptureMap`). */
function checkCaptureSource(
    name: string,
    source: unknown,
    declared: ReadonlyMap<string, BindingKind>,
    at: string,
    errors: string[],
    eventScope: EventScope,
    /** CR 603.3c — a `reflexiveTrigger` capture carries the recorded binding
     *  VERBATIM instead of flattening it to a single id, so the single-value
     *  restriction below does not apply: a picks binding crosses as picks, a
     *  list as a list. (`$event` stays illegal either way — a reflexive
     *  ability has no firing event; the caller's `isReflexiveCaptureMap`
     *  already rejects that shape, and the `inDelayedBody` branch below
     *  catches any that slips through.) */
    verbatim = false
): void {
    if (typeof source !== "object" || source === null) return; // literal
    const obj = source as Record<string, unknown>;
    if (typeof obj.ref !== "string") return; // target slot — nothing to check
    const ref = obj.ref;
    // `$event.<field>` capture (ADR 0049, issue #865) — legal at a trigger
    // site's scheduling scope (a delayedTrigger capture map is resolved at fire
    // time, while the firing event is still live). Site legality and census are
    // checked here; the fire-time re-binding family is decided by
    // `captureBindingKind`. Either family is fine as a capture SOURCE — both
    // store a single id string.
    if (ref.startsWith("$event.")) {
        const field = ref.slice(ref.indexOf(".") + 1);
        if (eventScope.inDelayedBody || eventScope.eventType === undefined) {
            errors.push(
                `${at}: capture "${name}" "$event" ref "${ref}" is only legal at a triggered-ability site (ADR 0049)`
            );
            return;
        }
        if (!getEventFieldRow(eventScope.eventType, field)) {
            errors.push(
                `${at}: capture "${name}" "$event" ref "${ref}" — "${field}" is not a censused field for event "${eventScope.eventType}" (EVENT_FIELD_REGISTRY, ADR 0049)`
            );
        }
        return;
    }
    if (!ref.includes(".")) {
        const family = declared.get(ref);
        if (family === undefined) {
            errors.push(
                `${at}: capture "${name}" ref "${ref}" references undefined binding "${ref}" — no earlier Op binds it`
            );
            return;
        }
        if (verbatim) return;
        if (family !== "snapshot" && family !== "player") {
            errors.push(
                `${at}: capture "${name}" ref "${ref}" names a ${family} binding — only single-value snapshot/player bindings can cross to fire time (list captures are a tracked grammar gap, ADR 0048)`
            );
        }
        return;
    }
    const parsed = parseRef(ref);
    if (!parsed || parsed.property !== "controller") {
        errors.push(
            `${at}: capture "${name}" ref "${ref}" — only ".controller" property captures are supported (a power/toughness capture has no fire-time re-binding, ADR 0048)`
        );
        return;
    }
    const family = declared.get(parsed.binding);
    if (family === undefined) {
        errors.push(
            `${at}: capture "${name}" ref "${ref}" references undefined binding "${parsed.binding}" — no earlier Op binds it`
        );
    } else if (family !== "snapshot") {
        errors.push(
            `${at}: capture "${name}" ref "${ref}" — ".controller" reads a snapshot binding, not a ${family} binding`
        );
    }
}

/** The binding family a `delayedTrigger` capture key declares INSIDE the body
 *  scope (ADR 0048). A `.controller` capture carries a player id → player
 *  binding at fire time; a bare ref inherits its outer family; a target slot
 *  or a literal re-binds as a snapshot when the captured id is a live
 *  permanent (the fire-time seeding rule) — snapshot is the static family. */
function captureBindingKind(
    source: unknown,
    declared: ReadonlyMap<string, BindingKind>,
    eventType: string | undefined
): BindingKind {
    if (typeof source === "object" && source !== null) {
        // LIST-valued capture (ADR 0049, issue #866): the body binding is a
        // `string[]` list — a `forEach { set: "bound", ref }` iterates it.
        if ("select" in source) return "list";
        const ref = (source as Record<string, unknown>).ref;
        if (typeof ref === "string") {
            // `$event.<field>` capture (ADR 0049) — the fire-time family
            // follows the registry family: an object field re-binds as a live
            // snapshot, a player field as a player binding (runDelayedTriggerBody
            // seeds each accordingly). Checked BEFORE the generic `.`-property
            // branch below (an `$event.blockerId` also contains a dot).
            if (ref.startsWith("$event.") && eventType) {
                const field = ref.slice(ref.indexOf(".") + 1);
                const row = getEventFieldRow(eventType, field);
                return row?.family === "player" ? "player" : "snapshot";
            }
            if (ref.includes(".")) return "player"; // `.controller` capture
            const outer = declared.get(ref);
            if (outer === "player") return "player";
        }
    }
    return "snapshot";
}

/** The binding family a `reflexiveTrigger` capture key declares INSIDE the
 *  body scope (CR 603.3c). Unlike `captureBindingKind`, a BARE ref keeps its
 *  outer family wholesale — the interpreter carries the recorded binding
 *  across verbatim rather than flattening it to an instance id, so a picks
 *  binding is still picks inside the body (what lets an `if
 *  picksMatchFilter` gate read the sacrificed creature's card in the
 *  graveyard) and a snapshot is still a snapshot (what lets `$sac.power`
 *  read CR 608.2h last-known information). A `.controller` capture still
 *  narrows to a player binding; a literal / target slot re-binds as a
 *  snapshot, same as the delayed path. */
function reflexiveCaptureBindingKind(
    source: unknown,
    declared: ReadonlyMap<string, BindingKind>
): BindingKind {
    if (typeof source === "object" && source !== null) {
        const ref = (source as Record<string, unknown>).ref;
        if (typeof ref === "string") {
            if (ref.includes(".")) return "player"; // `.controller` capture
            const outer = declared.get(ref);
            if (outer !== undefined) return outer;
        }
    }
    return "snapshot";
}

/** Ordered ref pass (#802, extended #805 picks / #806 boolean + `if`): walks
 *  Ops top to bottom so a `ref` may only name a binding a PRECEDING Op
 *  declared. Reports dangling bindings, unknown property paths, family
 *  mismatches and duplicate binding names. Recurses into `if` branches
 *  (issue #806): a branch sees the bindings declared before the `if` (a CLONE,
 *  so a branch-local `bind` does not leak past the `if` — at runtime the branch
 *  may not run). Only inspects Ops whose shape already passed schema validation.
 *  Mutates `declared` in place with the top-level binds it encounters. */
function checkOpListRefs(
    effects: readonly unknown[],
    label: (i: number) => string,
    errors: string[],
    declared: Map<string, BindingKind>,
    eventScope: EventScope
): void {
    effects.forEach((raw, i) => {
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
            return;
        }
        const entry = raw as Record<string, unknown>;
        const at = label(i);
        const uses: RefUse[] = [];
        for (const [k, v] of Object.entries(entry)) {
            // `predicate`, `then`, `else` (if, #806) and `effects` (forEach /
            // delayedTrigger — the body is walked in its own scope below) are
            // handled explicitly; `select` (forEach) is walked below in the
            // OUTER scope so its `controller` ref resolves there but `$each`
            // is not yet visible; `capture` / `targetPlayer` (delayedTrigger,
            // ADR 0048) are checked explicitly below in the OUTER scope.
            // `objects` (divideIntoPiles, ADR 0053) is walked below in the
            // OUTER scope like `select`; `chosenEffect` / `otherEffect`
            // (divideIntoPiles) are walked in their own CLONED scopes below,
            // like `then`/`else`. `op` / `bind` never carry refs. `token`
            // (`createToken`, issue #1191) is MOSTLY skipped here: a token's
            // `activatedAbilities[].effects` is an independently-scoped script
            // (its own fresh `$source` = the token once created, no visibility
            // into this outer scope's binds) — `validateEffectOpList`'s
            // nested-`createToken` pass validates it in isolation instead, so
            // walking it here would check refs against the WRONG scope. The
            // ONE exception (issue #1210) is `token.entersWith.counters[].count`
            // — evaluated in THIS outer scope at token-creation time (same
            // scope `count`/`controller` already resolve in, e.g. Sunfall's
            // "Incubate X, where X is the number of creatures exiled this
            // way" binds X from an earlier Op in the SAME script), so it is
            // walked explicitly below rather than through the generic
            // recursion (which would otherwise also descend into
            // `activatedAbilities`).
            if (
                k === "op" ||
                k === "bind" ||
                k === "predicate" ||
                k === "then" ||
                k === "else" ||
                k === "effects" ||
                k === "modes" ||
                k === "win" ||
                k === "loss" ||
                k === "select" ||
                k === "capture" ||
                k === "targetPlayer" ||
                k === "watch" ||
                k === "objects" ||
                k === "chosenEffect" ||
                k === "otherEffect"
            ) {
                continue;
            }
            if (k === "token") {
                const token = v as { entersWith?: unknown } | null;
                if (token && typeof token === "object") {
                    collectRefUses(token.entersWith, "entersWith", uses);
                }
                continue;
            }
            collectRefUses(v, k, uses);
        }
        // `if` predicate refs (issue #806) — boolean bindings + comparison
        // numeric refs, resolved against the bindings declared BEFORE the `if`.
        if (entry.op === "if") {
            collectPredicateRefUses(entry.predicate, uses);
        }
        // forEach selector refs (issue #807): its `controller` player ref is
        // resolved in the OUTER scope — `$each` is not visible in the selector.
        if (entry.op === "forEach") {
            const select = entry.select;
            if (select && typeof select === "object") {
                const s = select as Record<string, unknown>;
                collectRefUses(s.controller, "controller", uses);
                // `bound` (ADR 0049, issue #866; widened issue #1284): the
                // iterated ref must name a LIST binding (a delayedTrigger/
                // divideIntoPiles list-valued capture) OR a PICKS binding (a
                // `choice` Op's `bind`) — both are the identical `string[]`
                // runtime storage (`readBinding`/`recallChoice`), distinguished
                // only by provenance; `execForEach`'s per-member `$each`
                // snapshot binding is unaffected either way (it snapshots the
                // member id off `readBinding`'s array regardless of which
                // family produced it). The family is checked here directly —
                // it is not a scalar ref position `checkRefUse` handles.
                if (s.set === "bound" && typeof s.ref === "string") {
                    const family = declared.get(s.ref);
                    if (family === undefined) {
                        errors.push(
                            `${at}: forEach { set: "bound" } ref "${s.ref}" references undefined binding — no earlier Op binds it (a bound-set ref names a delayedTrigger list-valued capture or a choice Op's picks, ADR 0049 / issue #1284)`
                        );
                    } else if (family !== "list" && family !== "picks") {
                        errors.push(
                            `${at}: forEach { set: "bound" } ref "${s.ref}" names a ${family} binding — a bound set iterates a list binding (a delayedTrigger list-valued capture) or a picks binding (a choice Op's bind), ADR 0049 / issue #1284`
                        );
                    }
                }
            }
        }
        // divideIntoPiles object-set selector refs (ADR 0053, pile division):
        // its `controller` (permanents/graveyard variant) / `player`
        // (library-top variant) player ref is resolved in the OUTER scope —
        // mirrors forEach's `select.controller` handling exactly.
        if (entry.op === "divideIntoPiles") {
            const objects = entry.objects;
            if (objects && typeof objects === "object") {
                const o = objects as Record<string, unknown>;
                collectRefUses(o.controller, "controller", uses);
                collectRefUses(o.player, "player", uses);
            }
        }
        // delayedTrigger (CR 603.7, ADR 0048): capture sources and the
        // `targetPlayer` selector resolve at SCHEDULING time, in the OUTER
        // scope (the body's own fire-time scope is walked below).
        // reflexiveTrigger (CR 603.3c) resolves its capture sources in the
        // SAME outer scope, at the moment the Op executes.
        if (entry.op === "delayedTrigger" || entry.op === "reflexiveTrigger") {
            const capture = entry.capture;
            if (capture && typeof capture === "object") {
                for (const [name, src] of Object.entries(capture)) {
                    checkCaptureSource(
                        name,
                        src,
                        declared,
                        at,
                        errors,
                        eventScope,
                        entry.op === "reflexiveTrigger"
                    );
                }
            }
            collectRefUses(entry.targetPlayer, "player", uses);
            // The leave-watch instance (issue #731) resolves at SCHEDULING time
            // in this same outer scope; its ref (e.g. `$source`) is an object
            // ref, so collect it under an object-family key hint ("target").
            collectRefUses(entry.watch, "target", uses);
        }
        for (const use of uses)
            checkRefUse(use, declared, at, errors, eventScope);

        // Recurse into branches with a CLONED scope (branch-local binds do not
        // escape the branch — CR: the branch may not execute).
        if (entry.op === "if") {
            for (const key of ["then", "else"] as const) {
                const branch = entry[key];
                if (Array.isArray(branch)) {
                    checkOpListRefs(
                        branch,
                        (j) => `${at}: ${key}[${j}]`,
                        errors,
                        new Map(declared),
                        eventScope
                    );
                }
            }
        }

        // Recurse into each `optionChoice` mode with a CLONED scope (issue
        // #849): a mode sees the bindings declared BEFORE the optionChoice, but
        // a mode-local `bind` does not leak past it (only one mode runs — like
        // an `if` branch, CR 700.2).
        if (entry.op === "optionChoice" && Array.isArray(entry.modes)) {
            entry.modes.forEach((mode, m) => {
                const effects = (mode as { effects?: unknown })?.effects;
                if (Array.isArray(effects)) {
                    checkOpListRefs(
                        effects,
                        (j) => `${at}: modes[${m}].effects[${j}]`,
                        errors,
                        new Map(declared),
                        eventScope
                    );
                }
            });
        }

        // Recurse into each `coinFlip` / `coinFlipSync` branch with a CLONED
        // scope (issue #851 / #1281): a branch sees the bindings declared
        // BEFORE the flip, but a branch-local `bind` does not leak past it
        // (only one branch runs — like an `if` branch / optionChoice mode,
        // CR 705).
        if (entry.op === "coinFlip" || entry.op === "coinFlipSync") {
            for (const key of ["win", "loss"] as const) {
                const branch = entry[key] as { effects?: unknown } | undefined;
                if (branch && Array.isArray(branch.effects)) {
                    checkOpListRefs(
                        branch.effects,
                        (j) => `${at}: ${key}.effects[${j}]`,
                        errors,
                        new Map(declared),
                        eventScope
                    );
                }
            }
        }

        // Recurse into the forEach body (issue #807) with a CLONED scope that
        // additionally declares `$each` — its family follows the selector (a
        // players member is a player id, a permanents member is a snapshot).
        // Body-local binds live in the clone, so they never leak past the
        // construct (they are iteration-scoped at runtime); outer bindings
        // stay readable (the clone carries them).
        if (entry.op === "forEach" && Array.isArray(entry.effects)) {
            const bodyScope = new Map(declared);
            const select = entry.select as Record<string, unknown> | null;
            bodyScope.set(
                "$each",
                select?.set === "players" ? "player" : "snapshot"
            );
            // forEach body stays in the SAME trigger scope — `$event` is still
            // legal inside a trigger's own forEach (ADR 0049).
            checkOpListRefs(
                entry.effects,
                (j) => `${at}: effects[${j}]`,
                errors,
                bodyScope,
                eventScope
            );
        }

        // Recurse into the delayedTrigger body (ADR 0048) with a FRESH scope:
        // the body runs at FIRE time in a new environment whose ONLY initial
        // bindings are the capture keys — outer bindings ($source included)
        // are NOT visible. Family follows the fire-time re-binding rule
        // (`captureBindingKind`).
        if (entry.op === "delayedTrigger" && Array.isArray(entry.effects)) {
            const bodyScope = new Map<string, BindingKind>();
            const capture = entry.capture;
            if (capture && typeof capture === "object") {
                for (const [name, src] of Object.entries(capture)) {
                    bodyScope.set(
                        name,
                        captureBindingKind(src, declared, eventScope.eventType)
                    );
                }
            }
            // "this-turn-creature-blocks" (issue #884) is the ONE delayed
            // timing whose firing event is still live at fire time: it
            // re-fires per BLOCKERS_CONFIRMED event, and `triggers.ts` threads
            // that event onto the built StackItem exactly like a normal
            // triggered ability — so its body may read `$event.blockerId`
            // directly (no capture needed). Every OTHER timing's body runs at
            // a phase boundary / after the watched permanent already left, so
            // `$event` stays illegal there (ADR 0049) — `inDelayedBody` flips
            // on for those.
            const eventBody = entry.timing === "this-turn-creature-blocks";
            checkOpListRefs(
                entry.effects,
                (j) => `${at}: effects[${j}]`,
                errors,
                bodyScope,
                eventBody
                    ? { eventType: "BLOCKERS_CONFIRMED", inDelayedBody: false }
                    : { eventType: eventScope.eventType, inDelayedBody: true }
            );
        }

        // Recurse into the reflexiveTrigger body (CR 603.3c) with a FRESH
        // scope, exactly like the delayed body above — its ONLY initial
        // bindings are the capture keys. Two differences, both following from
        // "carried verbatim, resolved immediately":
        //   * family — a bare ref keeps its OUTER family (a picks binding is
        //     still picks inside the body, so `picksMatchFilter` on it type-
        //     checks), because nothing is flattened to an id on the way in;
        //   * `$event` — a reflexive ability triggers off the resolving
        //     effect's own action, not an event, so `$event` is illegal in
        //     the body (`inDelayedBody: true` enforces it).
        if (entry.op === "reflexiveTrigger" && Array.isArray(entry.effects)) {
            const bodyScope = new Map<string, BindingKind>();
            const capture = entry.capture;
            if (capture && typeof capture === "object") {
                for (const [name, src] of Object.entries(capture)) {
                    bodyScope.set(
                        name,
                        reflexiveCaptureBindingKind(src, declared)
                    );
                }
            }
            checkOpListRefs(
                entry.effects,
                (j) => `${at}: effects[${j}]`,
                errors,
                bodyScope,
                { eventType: eventScope.eventType, inDelayedBody: true }
            );
        }

        // Recurse into `divideIntoPiles`'s `chosenEffect` / `otherEffect`
        // (ADR 0053, pile division) each with a CLONED scope that additionally
        // declares that branch's own pile binding (`chosenBind` in
        // `chosenEffect`'s scope, `otherBind` in `otherEffect`'s) as a LIST
        // family (ADR 0049) — a `forEach { set: "bound" }` reads it, or a
        // `moveZone { cards: <ref> }` consumes it directly. Each branch's
        // OWN pile binding is NOT visible in the OTHER branch (mirrors an
        // `if`/`optionChoice` branch's isolation): a card that destroys the
        // chosen pile has no business reading `otherBind`.
        if (entry.op === "divideIntoPiles") {
            for (const [bindField, effectsField] of [
                ["chosenBind", "chosenEffect"],
                ["otherBind", "otherEffect"],
            ] as const) {
                const bindName = entry[bindField];
                const list = entry[effectsField];
                if (typeof bindName !== "string" || !Array.isArray(list)) {
                    continue;
                }
                if (declared.has(bindName)) {
                    errors.push(
                        `${at}: "${bindField}" "${bindName}" re-declares an existing binding — binding names must be unique within a script`
                    );
                }
                const bodyScope = new Map(declared);
                bodyScope.set(bindName, "list");
                checkOpListRefs(
                    list,
                    (j) => `${at}: ${effectsField}[${j}]`,
                    errors,
                    bodyScope,
                    eventScope
                );
            }
        }

        // A binding becomes visible only AFTER its Op (snapshot ordering) and
        // must be unique within its scope (the persisted store keys by name).
        // `$each` is reserved for the forEach construct (issue #807) — an Op
        // may not bind it.
        if (typeof entry.bind === "string") {
            if (entry.bind === "$each") {
                errors.push(
                    `${at}: bind "$each" is reserved — only the forEach construct binds it (issue #807)`
                );
            } else if (declared.has(entry.bind)) {
                errors.push(
                    `${at}: bind "${entry.bind}" re-declares an existing binding — binding names must be unique within a script`
                );
            } else {
                declared.set(entry.bind, bindingKindOf(entry.op));
            }
        }

        // `choice.bindOther` declares an object SNAPSHOT binding — the single
        // candidate the chooser did NOT pick (Barrin's Spite's "the other").
        // Its own field rather than `bind`, which the Op already spends on the
        // picks binding, and a different family from it.
        if (entry.op === "choice" && typeof entry.bindOther === "string") {
            if (declared.has(entry.bindOther)) {
                errors.push(
                    `${at}: bindOther "${entry.bindOther}" re-declares an existing binding — binding names must be unique within a script`
                );
            } else {
                declared.set(entry.bindOther, "snapshot");
            }
        }

        // `castDuringResolution.resultBind` (issue #1478) declares a BOOLEAN
        // outcome binding (the mirror of `mayPay.bind`) under a distinct field
        // name — the Op already spends `bind`-family semantics on nothing, so a
        // dedicated field avoids overloading `bind`. Register it as boolean so a
        // downstream `if { binding }` / `{ not: { binding } }` resolves.
        if (
            entry.op === "castDuringResolution" &&
            typeof entry.resultBind === "string"
        ) {
            if (declared.has(entry.resultBind)) {
                errors.push(
                    `${at}: resultBind "${entry.resultBind}" re-declares an existing binding — binding names must be unique within a script`
                );
            } else {
                declared.set(entry.resultBind, "boolean");
            }
        }
    });
}

/** Entry point for the ordered ref pass over a whole script (spell or ability
 *  site). Seeds the `$source` implicit binding (issue #803, a snapshot) and
 *  delegates to the recursive walker. */
function checkRefUses(
    effects: readonly unknown[],
    label: string,
    errors: string[],
    implicit: ReadonlySet<string>,
    triggerEventType: string | undefined
): void {
    const declared = new Map<string, BindingKind>();
    for (const name of implicit) declared.set(name, "snapshot");
    checkOpListRefs(
        effects,
        (i) => `${label}: effects[${i}]`,
        errors,
        declared,
        { eventType: triggerEventType, inDelayedBody: false }
    );
}

/** Validates one Op's shape/vocabulary/schema (steps 1, 2) and RECURSES into an
 *  `if` construct's branches (issue #806) and a `forEach` construct's body
 *  (issue #807) so a malformed nested Op is reported at its own path. Ref/
 *  binding and JSON-purity checks run once over the whole script in
 *  `validateEffectOpList`, not here. `inForEach` bans forEach nesting — one
 *  construct level per script (issue #807). */
function validateOpSchema(
    raw: unknown,
    at: string,
    errors: string[],
    inForEach = false,
    inDelayed = false
): void {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        errors.push(`${at}: each Op must be a plain object`);
        return;
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.op !== "string") {
        errors.push(`${at}: missing string "op" field`);
        return;
    }
    if (entry.op === "forEach" && inForEach) {
        errors.push(
            `${at}: forEach must not nest inside a forEach body — one construct level per script (issue #807)`
        );
        return;
    }
    if (entry.op === "delayedTrigger" && inDelayed) {
        errors.push(
            `${at}: delayedTrigger must not nest inside a delayedTrigger body — one scheduling level per script (ADR 0048)`
        );
        return;
    }
    // CR 603.3c — a reflexive trigger's body is itself a fresh script run on
    // a separate stack object; nesting another deferred-body construct inside
    // it would compound capture scoping with no card needing it. `inDelayed`
    // covers BOTH deferred-body constructs (delayedTrigger / reflexiveTrigger)
    // — one deferral level per script, either kind.
    if (entry.op === "reflexiveTrigger" && inDelayed) {
        errors.push(
            `${at}: reflexiveTrigger must not nest inside a delayedTrigger / reflexiveTrigger body — one deferral level per script (CR 603.3c)`
        );
        return;
    }
    if (!isRegisteredEffectOp(entry.op)) {
        errors.push(
            `${at}: unknown Op "${entry.op}" — not in EFFECT_OP_REGISTRY (mechanicsRegistry.ts)`
        );
        return;
    }
    const schema = OP_SCHEMAS[entry.op];
    if (!schema) {
        errors.push(
            `${at}: Op "${entry.op}" is registered but has no field schema — add it to OP_SCHEMAS`
        );
        return;
    }
    const optional = schema.optional ?? {};
    for (const [field, check] of Object.entries(schema.required)) {
        if (!(field in entry)) {
            errors.push(`${at}: Op "${entry.op}" missing field "${field}"`);
        } else if (!check(entry[field])) {
            errors.push(
                `${at}: Op "${entry.op}" field "${field}" has invalid value ${JSON.stringify(entry[field])}`
            );
        }
    }
    for (const [field, check] of Object.entries(optional)) {
        if (field in entry && !check(entry[field])) {
            errors.push(
                `${at}: Op "${entry.op}" field "${field}" has invalid value ${JSON.stringify(entry[field])}`
            );
        }
    }
    for (const field of Object.keys(entry)) {
        if (
            field !== "op" &&
            !(field in schema.required) &&
            !(field in optional)
        ) {
            errors.push(
                `${at}: Op "${entry.op}" has unknown field "${field}" — the grammar is frozen (ADR 0045)`
            );
        }
    }
    // Cross-field rules (e.g. choice's filter ⇒ battlefield zone).
    if (schema.check) {
        for (const err of schema.check(entry)) {
            errors.push(`${at}: Op "${entry.op}" ${err}`);
        }
    }
    // Recurse into `if` branches (issue #806) — each branch Op is validated at
    // its own path. Only when the branch shape passed (`isOpList`); a
    // non-array branch was already reported above. `inForEach` is threaded so
    // a forEach nested inside an `if` inside a forEach is still rejected.
    if (entry.op === "if") {
        for (const key of ["then", "else"] as const) {
            const branch = entry[key];
            if (Array.isArray(branch)) {
                branch.forEach((op, j) => {
                    validateOpSchema(
                        op,
                        `${at}: ${key}[${j}]`,
                        errors,
                        inForEach,
                        inDelayed
                    );
                });
            }
        }
    }
    // Recurse into each `optionChoice` mode's body (issue #849) — each mode is a
    // nested Op list validated at its own path, exactly like an `if` branch.
    // `inForEach` / `inDelayed` thread through so nesting bans still apply.
    if (entry.op === "optionChoice" && Array.isArray(entry.modes)) {
        entry.modes.forEach((mode, m) => {
            const effects = (mode as { effects?: unknown })?.effects;
            if (Array.isArray(effects)) {
                effects.forEach((op, j) => {
                    validateOpSchema(
                        op,
                        `${at}: modes[${m}].effects[${j}]`,
                        errors,
                        inForEach,
                        inDelayed
                    );
                });
            }
        });
    }
    // Recurse into each `coinFlip` / `coinFlipSync` branch's body (issue #851 /
    // #1281) — win / loss are nested Op lists validated at their own paths,
    // exactly like an optionChoice mode. `inForEach` / `inDelayed` thread
    // through so nesting bans still apply.
    if (entry.op === "coinFlip" || entry.op === "coinFlipSync") {
        for (const key of ["win", "loss"] as const) {
            const branch = entry[key] as { effects?: unknown } | undefined;
            if (branch && Array.isArray(branch.effects)) {
                branch.effects.forEach((op, j) => {
                    validateOpSchema(
                        op,
                        `${at}: ${key}.effects[${j}]`,
                        errors,
                        inForEach,
                        inDelayed
                    );
                });
            }
        }
    }
    // Recurse into the `forEach` body (issue #807) — each body Op is validated
    // at its own path, with `inForEach` set so a nested forEach is rejected.
    if (entry.op === "forEach" && Array.isArray(entry.effects)) {
        entry.effects.forEach((op, j) => {
            validateOpSchema(
                op,
                `${at}: effects[${j}]`,
                errors,
                true,
                inDelayed
            );
        });
    }
    // Recurse into a `delayedTrigger` body (CR 603.7, ADR 0048) — a FRESH
    // script executed at fire time: `inForEach` resets (a body forEach is a
    // new script's single construct level) and `inDelayed` is set so a nested
    // delayedTrigger is rejected.
    if (entry.op === "delayedTrigger" && Array.isArray(entry.effects)) {
        entry.effects.forEach((op, j) => {
            validateOpSchema(op, `${at}: effects[${j}]`, errors, false, true);
        });
    }
    // Recurse into a `reflexiveTrigger` body (CR 603.3c) — same contract as
    // the delayed body above: a FRESH script executed on its own stack
    // object, so `inForEach` resets and `inDelayed` is set (banning a nested
    // deferred-body construct of either kind).
    if (entry.op === "reflexiveTrigger" && Array.isArray(entry.effects)) {
        entry.effects.forEach((op, j) => {
            validateOpSchema(op, `${at}: effects[${j}]`, errors, false, true);
        });
    }
    // Recurse into `divideIntoPiles`'s `chosenEffect` / `otherEffect` (ADR
    // 0053, pile division) — each is a nested Op list validated at its own
    // path, exactly like an `if` branch. `inForEach` / `inDelayed` thread
    // through UNCHANGED (not reset, not forced true): none of the six pile
    // cards nest `divideIntoPiles` inside a `forEach`, so this stays
    // unexercised in practice, but the same nesting bans apply if a future
    // card does.
    if (entry.op === "divideIntoPiles") {
        for (const key of ["chosenEffect", "otherEffect"] as const) {
            const list = entry[key];
            if (Array.isArray(list)) {
                list.forEach((op, j) => {
                    validateOpSchema(
                        op,
                        `${at}: ${key}[${j}]`,
                        errors,
                        inForEach,
                        inDelayed
                    );
                });
            }
        }
    }
}

/** Validates one `effects[]` Op list in isolation (steps 1, 2, 4, 5) — shape,
 *  vocabulary, ref/binding check and JSON purity. Site-agnostic: `implicit`
 *  carries the bindings the site provides for free (`$source` at ability
 *  sites, none at spell sites). Mutual-exclusivity (step 3) is the caller's
 *  job because the mutually-exclusive fields differ per site. */
/** Deep-scans an arbitrary (already-parsed) Op subtree for every `createToken`
 *  Op node, regardless of nesting depth (inside `if` branches, `forEach`
 *  bodies, `modes`, …) — issue #1191. Used to reach a token spec's
 *  `activatedAbilities[]`, which needs its OWN isolated validation pass (see
 *  the call site below): unlike every other nested Op list in the grammar
 *  (`if.then/else`, `forEach.effects`, `modes[].effects`), a token ability's
 *  `effects[]` does NOT share the outer script's binding scope — it runs
 *  later, at ability resolution, with a fresh `$source` (the token). */
function findCreateTokenOps(
    value: unknown,
    out: Record<string, unknown>[]
): void {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
        for (const v of value) findCreateTokenOps(v, out);
        return;
    }
    const obj = value as Record<string, unknown>;
    if (obj.op === "createToken") out.push(obj);
    for (const v of Object.values(obj)) findCreateTokenOps(v, out);
}

/** Deep-scans an arbitrary (already-parsed) Op subtree for every node whose
 *  `op` is a member of `names`, regardless of nesting depth — the same
 *  fully-generic walk as `findCreateTokenOps` above, parametrized. Used by
 *  the permanent-spell self-redirect gate (issue #1097) to catch `exileSelf`
 *  / `shuffleSelfIntoLibrary` wherever it appears in a script (top level, an
 *  `if` branch, a `forEach` body, …), not just at the top level. */
function findOpsWithNames(
    value: unknown,
    names: ReadonlySet<string>,
    out: Record<string, unknown>[]
): void {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
        for (const v of value) findOpsWithNames(v, names, out);
        return;
    }
    const obj = value as Record<string, unknown>;
    if (typeof obj.op === "string" && names.has(obj.op)) out.push(obj);
    for (const v of Object.values(obj)) findOpsWithNames(v, names, out);
}

/** `exileSelf` / `shuffleSelfIntoLibrary` (CR 608.2, issues #898 / #1097) both
 *  redirect the RESOLVING SPELL's own post-resolution destination — but only
 *  `finalizeSpellResolution`'s NON-permanent branch (`gre/state.ts`) ever
 *  reads either flag. A PERMANENT spell (Creature/Artifact/Enchantment/
 *  Planeswalker/Battle/Land, CR 300.1) resolves through the OTHER branch,
 *  which enters the permanent onto the battlefield and never looks at
 *  `exileOnResolve`/`shuffleIntoLibraryOnResolve` at all — the flag is set
 *  and then silently rides onto the resulting permanent, doing nothing. No
 *  shipped card hits this (both Ops are inherited from
 *  `shuffleSelfIntoLibrary`'s original instant/sorcery-only shape), but a
 *  future permanent card reaching for either Op would get a functional-
 *  looking no-op instead of a validation error — the same "ships
 *  functional-looking but is silently inert" class Guard A/B in
 *  `.claude/rules/gre-development.md` exist to catch for keywords/divergence
 *  markers. Caught here instead: a permanent card declaring either Op
 *  ANYWHERE in its spell-resolution `effects[]` is a static authoring error. */
const SELF_REDIRECT_OPS: ReadonlySet<string> = new Set([
    "exileSelf",
    "shuffleSelfIntoLibrary",
]);

function validateEffectOpList(
    effects: unknown,
    label: string,
    implicit: ReadonlySet<string>,
    errors: string[],
    triggerEventType: string | undefined
): void {
    if (!Array.isArray(effects)) {
        errors.push(`${label}: effects must be an array`);
        return;
    }
    if (effects.length === 0) {
        errors.push(`${label}: effects[] must not be empty`);
    }
    effects.forEach((raw, i) => {
        validateOpSchema(raw, `${label}: effects[${i}]`, errors);
    });

    // 5 — ordered ref / binding check (#802, extended for #806 predicates +
    // branches, #865 $event refs).
    checkRefUses(effects, label, errors, implicit, triggerEventType);

    // 4 — JSON purity (ADR 0046).
    const impurity = findImpurity(effects, `${label}: effects`);
    if (impurity) errors.push(impurity);

    // 6 — a `createToken` Op's token may carry `activatedAbilities[]` (issue
    // #1191, e.g. a Clue's "{2}, Sacrifice this token: Draw a card."). Each
    // such ability's `effects[]` is validated here as its OWN independently-
    // scoped script — fresh `ABILITY_BINDINGS` ($source only), no trigger
    // event (a token ability is never a triggered ability) — exactly the same
    // regime an ordinary card's activated ability gets via
    // `validateAbilityEffectScript`, just reached through the token spec
    // instead of `CardDefinition.activatedAbilities`.
    const nestedCreateTokenOps: Record<string, unknown>[] = [];
    findCreateTokenOps(effects, nestedCreateTokenOps);
    nestedCreateTokenOps.forEach((op) => {
        const token = op.token as Record<string, unknown> | undefined;
        const abilities = token?.activatedAbilities;
        if (!Array.isArray(abilities)) return;
        abilities.forEach((raw, j) => {
            const ability = raw as { id?: unknown; effects?: unknown };
            const abilityLabel = `${label}: createToken token.activatedAbilities[${j}] (id=${String(ability.id)})`;
            if (ability.effects !== undefined) {
                validateEffectOpList(
                    ability.effects,
                    abilityLabel,
                    ABILITY_BINDINGS,
                    errors,
                    undefined
                );
            }
        });
    });
}

/** Validates a card's SPELL-SITE Effect Script statically. Returns a list of
 *  human-readable errors — empty when the script is valid. A card without
 *  `effects[]` trivially passes (nothing to validate). */
export function validateEffectScript(def: EffectScriptHost): string[] {
    const errors: string[] = [];
    const label = `${def.name} (${def.id})`;

    if (def.effects === undefined) return errors;

    // 3 — mutual exclusivity per effect site (ADR 0045: one authoring mode
    // per site; `modes` carries its own per-mode resolution sites).
    for (const [field, present] of [
        ["resolve", !!def.resolve],
        ["resolveSteps", !!def.resolveSteps],
        ["effect", def.effect !== undefined],
        ["modes", !!def.modes],
    ] as const) {
        if (present) {
            errors.push(
                `${label}: declares both effects[] and ${field} — one authoring mode per effect site`
            );
        }
    }

    // A spell's source is the stack item, not a permanent — no `$source`; and a
    // spell has no firing event, so `$event` is illegal (ADR 0049).
    validateEffectOpList(def.effects, label, EMPTY_BINDINGS, errors, undefined);

    // exileSelf / shuffleSelfIntoLibrary on a PERMANENT spell (issue #1097) —
    // see `SELF_REDIRECT_OPS`'s own doc comment: the flag they set is never
    // read by a permanent's resolution branch, so it silently no-ops instead
    // of doing what the card author intended.
    if (
        def.types?.some((t) =>
            (PERMANENT_TYPES as readonly string[]).includes(t)
        )
    ) {
        const hits: Record<string, unknown>[] = [];
        findOpsWithNames(def.effects, SELF_REDIRECT_OPS, hits);
        for (const hit of hits) {
            errors.push(
                `${label}: declares "${String(hit.op)}" but is a permanent card (types: ${def.types!.join("/")}) — CR 608.2m's self-redirect (graveyard→exile/library) is only ever read by finalizeSpellResolution's NON-permanent branch; a permanent spell resolves onto the battlefield instead, so this flag is silently never consumed`
            );
        }
    }
    return errors;
}

/** No implicit bindings — a spell site provides no `$source` (its source is
 *  the resolving stack item, not a battlefield permanent). */
const EMPTY_BINDINGS: ReadonlySet<string> = new Set();
/** The bindings an ability site provides for free: `$source` (issue #803) and
 *  `$host` (issue #1341 — the permanent the source is attached to, CR 701.3).
 *  `$host` is declared STATICALLY at every ability site even though it is only
 *  seeded at runtime for an actually-attached source: an unattached source
 *  resolves it to undefined and the reading Op skips (CR 608.2b), exactly as
 *  `$source` does for a source that has left the battlefield. */
const ABILITY_BINDINGS: ReadonlySet<string> = new Set(["$source", "$host"]);

/** The narrow ability slice the ability-site validator reads. Both
 *  `ActivatedAbility` and `TriggeredAbility` satisfy it structurally.
 *  `aiEffects` (PRD #1423, issue #1431) is included so
 *  `validateAbilityAiEffectsScript` below can read it (issue #1514). */
export type AbilityEffectScriptHost = {
    id: string;
    effects?: unknown;
    resolve?: unknown;
    resolveSteps?: unknown;
    aiEffects?: unknown;
};

/** Validates an ABILITY-SITE Effect Script (activated / triggered, issue
 *  #803). Same Op-list checks as the spell site, plus the ability-specific
 *  mutual exclusivity (`effects[]` XOR `resolve`/`resolveSteps`) and the
 *  `$source` implicit binding. `label` identifies the owning card; the ability
 *  id is appended for a legible catalogue-sweep error. Returns [] when the
 *  ability has no `effects[]`.
 *
 *  `triggerEventType` (ADR 0049, issue #865) is the firing event's type when the
 *  ability is a TRIGGERED ability — it makes `$event.<field>` refs legal at this
 *  site and drives the family / census check. Omitted (undefined) for an
 *  ACTIVATED ability, where there is no firing event so `$event` is rejected. */
export function validateAbilityEffectScript(
    ability: AbilityEffectScriptHost,
    cardLabel: string,
    triggerEventType?: string
): string[] {
    const errors: string[] = [];
    if (ability.effects === undefined) return errors;
    const label = `${cardLabel} ability "${ability.id}"`;

    if (ability.resolve) {
        errors.push(
            `${label}: declares both effects[] and resolve — one authoring mode per effect site`
        );
    }
    if (ability.resolveSteps) {
        errors.push(
            `${label}: declares both effects[] and resolveSteps — one authoring mode per effect site`
        );
    }

    validateEffectOpList(
        ability.effects,
        label,
        ABILITY_BINDINGS,
        errors,
        triggerEventType
    );
    return errors;
}

// ─── AI-only shadow scripts (`aiEffects`, PRD #1423, issue #1431) ──────────
//
// `aiEffects` is a valuation-only `EffectOp[]` sketch attached to a
// `resolve()`/`resolveSteps` card or ability: it is NEVER dispatched by the
// interpreter/`getResolveFn`/`getAbilityEffectFn` — only walked, structurally,
// by `OP_VALUERS` (`convex/gre/ai/opValuers.ts` via `dslSpellScriptValue` /
// `dslAbilityScriptValue`, `convex/gre/ai/cardScriptValue.ts`) to give the
// bot's card-quality signal something to score. Because it is data walked at
// runtime rather than code the interpreter type-checks, an unregistered Op
// name, a dangling ref, or a non-JSON-pure value silently hits the walker's
// defensive `ZERO_OP_VALUE` default instead of throwing — recreating exactly
// the "silent AI-blindness" failure class the shadow-script mechanism exists
// to close (issue #1514). The two validators below run the IDENTICAL
// schema/vocabulary/ref/purity checks `validateEffectScript` /
// `validateAbilityEffectScript` run on a real `effects[]` script, MINUS the
// mutual-exclusivity check: a shadow script legitimately — and by design —
// coexists with `resolve()`/`resolveSteps` on the very same site (that's the
// whole point of the mechanism: it exists ONLY where there's no real
// `effects[]` to value instead), so declaring both is not an error here.

/** Validates a card's SPELL-SITE `aiEffects` shadow script statically. Same
 *  grounding as `validateEffectScript`'s spell-site check (no `$source`, no
 *  firing `$event` — ADR 0049): a spell's source is the resolving stack item,
 *  not a permanent, and a spell never fires from an event. Returns [] when
 *  the card has no `aiEffects`. */
export function validateAiEffectsScript(def: EffectScriptHost): string[] {
    const errors: string[] = [];
    if (def.aiEffects === undefined) return errors;
    const label = `${def.name} (${def.id}) aiEffects`;
    validateEffectOpList(
        def.aiEffects,
        label,
        EMPTY_BINDINGS,
        errors,
        undefined
    );
    return errors;
}

/** Validates an ABILITY-SITE (activated/triggered) `aiEffects` shadow script
 *  statically. Same `$source` implicit binding and `$event` scope
 *  (`triggerEventType`, ADR 0049) as `validateAbilityEffectScript`'s real
 *  check. Returns [] when the ability has no `aiEffects`. */
export function validateAbilityAiEffectsScript(
    ability: AbilityEffectScriptHost,
    cardLabel: string,
    triggerEventType?: string
): string[] {
    const errors: string[] = [];
    if (ability.aiEffects === undefined) return errors;
    const label = `${cardLabel} ability "${ability.id}" aiEffects`;
    validateEffectOpList(
        ability.aiEffects,
        label,
        ABILITY_BINDINGS,
        errors,
        triggerEventType
    );
    return errors;
}
