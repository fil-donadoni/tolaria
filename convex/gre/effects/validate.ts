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
import {
    getEventFieldRow,
    isRegisteredEffectOp,
} from "../../cards/mechanicsRegistry";

/** The slice of CardDefinition the validator reads — kept narrow so tests
 *  can validate synthetic shapes without building a full definition. */
export type EffectScriptHost = Pick<
    CardDefinition,
    "id" | "name" | "effects" | "resolve" | "resolveSteps" | "effect" | "modes"
>;

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
 *  validity of the refs that read it is checked in the ordered ref pass. */
function isBindingName(value: unknown): boolean {
    return typeof value === "string" && /^\$[A-Za-z][A-Za-z0-9]*$/.test(value);
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

/** `{ type?, excludeType?, subtype?, supertype?, color?, manaValueAtMost?,
 *  isToken?, name? }` — the minimal card filter for a `count` set or a `choice`
 *  Op's
 *  zone-restricted candidates (issue #677). `type`/`excludeType`/`subtype`/
 *  `color` accept a single value OR a non-empty array (OR within the field —
 *  a fetchland's "a Forest or Island card"). `excludeType` (issue #682) is
 *  the negative of `type` — Thoughtseize's "nonland card", Duress's
 *  "noncreature, nonland card". `supertype` is the "search for a BASIC land
 *  card" restriction (CR 205.4a) and its value must be a real printed
 *  supertype (reuses `TOKEN_SUPERTYPES`). `color` reuses `TOKEN_COLORS`.
 *  `manaValueAtMost` is a non-negative integer ceiling (Spellseeker's "mana
 *  value 2 or less") — a literal only, no `ref`/`X` (a dynamic ceiling like
 *  Green Sun's Zenith's "mana value X or less" is not expressible here). */
function isCardFilter(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
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
        if (k === "manaValueAtMost") {
            return typeof v === "number" && Number.isInteger(v) && v >= 0;
        }
        if (k === "isToken") {
            return typeof v === "boolean";
        }
        if (k === "name") {
            return typeof v === "string" && v.length > 0;
        }
        return false;
    });
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
        "times",
        "countTypes",
    ]);
    if (!Object.keys(s).every((k) => allowed.has(k))) return false;
    if (s.zone !== "battlefield" && s.zone !== "graveyard") return false;
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
    if ("acrossAllPlayers" in s) {
        if (s.acrossAllPlayers !== true) return false;
        if ("controller" in s) return false;
    } else if (!isPlayerRef(s.controller)) {
        return false;
    }
    if ("filter" in s && !isCardFilter(s.filter)) return false;
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

/** A numeric Op parameter (ADR 0045 value grammar): a positive-int literal,
 *  a `ref`, a `count`, the chosen-cost `X` (issue #852), a `counters` count
 *  on a selected object (issue #1015), a selected object's `manaValue` (issue
 *  #680), or a player's `domain` (issue #1066). Exactly those — no
 *  arithmetic, no expressions. */
function isEffectValue(value: unknown): boolean {
    return (
        isPositiveInt(value) ||
        isRefValue(value) ||
        isCountValue(value) ||
        isXValue(value) ||
        isCountersValue(value) ||
        isKickerCountValue(value) ||
        isManaValueValue(value) ||
        isDomainValue(value)
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

/** `"controller" | "opponent" | { target: n } | { controllerOf } | { ref }`
 *  (EffectPlayerRef). The ref may be a property ref (`"$x.controller"`) or —
 *  inside a players-set forEach body (issue #807) — the bare
 *  `{ ref: "$each" }`; which of the two is legal WHERE is decided by the
 *  ordered ref pass. */
function isPlayerRef(value: unknown): boolean {
    return (
        value === "controller" ||
        value === "opponent" ||
        isTargetRef(value) ||
        isControllerOfRef(value) ||
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
        value === "graveyard"
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

/** The `mode` discriminator of a `preventDamage` Op (issue #845, CR 615): the
 *  three prevention-shield shapes folded here. */
function isPreventDamageMode(value: unknown): boolean {
    return (
        value === "next-n" ||
        value === "all-combat" ||
        value === "combat-to-and-by"
    );
}

/** The destination zones a `moveZone` Op may name (issue #839, EffectMoveZone).
 *  The five zones a one-shot effect addresses (CR 400.7). */
function isMoveZone(value: unknown): boolean {
    return (
        value === "hand" ||
        value === "library" ||
        value === "graveyard" ||
        value === "exile" ||
        value === "battlefield"
    );
}

/** The hidden/public source zone a `moveZone` Op's `cards`-shape (issue #677,
 *  #680) may name — the zones a `choice` Op can raise a picks binding from
 *  that this shape knows how to move out of. `"graveyard"` (issue #680) is
 *  the self-selection pick, distinct from an announced target (Exhume,
 *  Titania). */
function isMoveZoneFrom(value: unknown): boolean {
    return value === "library" || value === "hand" || value === "graveyard";
}

function isBoolean(value: unknown): boolean {
    return typeof value === "boolean";
}

/** A SIGNED effect value, for a `pump` Op's P/T amounts (issue #840). Unlike
 *  `isEffectValue` (whose literal branch is a positive count, CR 107.1), a
 *  pump amount is a signed integer literal — a negative is a shrink (Weakness),
 *  a zero is a one-sided pump (+1/+0) — or a `ref` / `count` / chosen-cost `X` /
 *  `counters` count (all non-negative by nature; Howl from Beyond's +X/+0,
 *  issue #852; a "+1/+1 per fuse counter" pump, issue #1015). */
function isSignedEffectValue(value: unknown): boolean {
    if (typeof value === "number") return Number.isInteger(value);
    return (
        isRefValue(value) ||
        isCountValue(value) ||
        isXValue(value) ||
        isCountersValue(value) ||
        isDomainValue(value)
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

/** A `mayPay` sacrifice leg's `count`: a fixed cardinal (positive int) or a
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

/** A `mayPay` cost (CR 117.3a / 118.4 / 702.24): a bare `ManaCost`, or the
 *  `{ mana?, life?, sacrifice? }` union. At least one leg must be present. */
function isMayPayCost(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const obj = value as Record<string, unknown>;
    const unionKeys = new Set(["mana", "life", "sacrifice"]);
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
        if ("sacrifice" in obj) {
            const s = obj.sacrifice;
            if (typeof s !== "object" || s === null) return false;
            const sac = s as Record<string, unknown>;
            if (!("filter" in sac) || !("count" in sac)) return false;
            // `count` is either a fixed cardinal (positive int) or a
            // summed-power threshold `{ minTotalPower: positive int }` (CR 118,
            // Phyrexian Dreadnought). JSON-pure either way (ADR 0046).
            if (!isSacrificeCount(sac.count)) return false;
        }
        return true;
    }
    // Bare ManaCost shape (the historical mana-only value).
    return isManaCost(value);
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
        const m = mode as { label?: unknown; effects?: unknown; id?: unknown };
        // Only `label`, `effects` and the optional `id` are permitted (grammar
        // frozen, ADR 0045).
        for (const key of Object.keys(mode)) {
            if (key !== "label" && key !== "effects" && key !== "id") {
                return false;
            }
        }
        return (
            isNonEmptyString(m.label) &&
            Array.isArray(m.effects) &&
            m.effects.length > 0 &&
            (m.id === undefined || isNonEmptyString(m.id))
        );
    });
}

/** A `coinFlip` Op's `win` / `loss` branch (issue #851) — SHAPE only:
 *  `{ consequence: <non-empty string>, effects: <non-empty Op list> }`. Each
 *  branch's Op-list deep validity (schema, refs, nesting) is checked by the
 *  recursive schema / ref passes, exactly like an `optionChoice` mode or an
 *  `if` branch. Only `consequence` and `effects` are permitted (grammar frozen,
 *  ADR 0045). */
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
 *  filter? }`, `{ set: "graveyard", controller?, filter? }` (issue #1056), or
 *  `{ set: "bound", ref }`. Unknown keys are rejected (the grammar is frozen;
 *  selector SHAPES may grow like vocabulary, but only by extending this
 *  checker). */
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
    if (s.set !== "permanents") return false;
    const allowed = new Set(["set", "zone", "controller", "filter"]);
    if (!Object.keys(s).every((k) => allowed.has(k))) return false;
    // CR 110.1 — permanents only exist on the battlefield.
    if (s.zone !== "battlefield") return false;
    if ("controller" in s && !isPlayerRef(s.controller)) return false;
    if ("filter" in s && !isCardFilter(s.filter)) return false;
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
        if ("filter" in s && !isCardFilter(s.filter)) return false;
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
    // Repeating combat-event watch (CR 603.7d / 603.10, issue #884) — fires
    // once per BLOCKERS_CONFIRMED event for the rest of the turn (Battle
    // Cry). Rejects both `targetPlayer` and `watch` (checked below), like the
    // phase-boundary timings — it is not scoped to a player nor one instance.
    "this-turn-creature-blocks",
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
            (isNonEmptyString(v) ||
                isTargetRef(v) ||
                isBareRef(v) ||
                isRefValue(v) ||
                isListCaptureSource(v))
    );
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
    dealDamage: {
        required: { amount: isEffectValue, to: isDamageRecipient },
        optional: { unpreventable: isBoolean },
    },
    draw: { required: { player: isPlayerRef, count: isEffectValue } },
    gainLife: { required: { player: isPlayerRef, amount: isEffectValue } },
    loseLife: { required: { player: isPlayerRef, amount: isEffectValue } },
    // CR 601.3a (issue #1057) — a turn-scoped per-player cast lock (Xantid
    // Swarm). `player` names whom to lock (the defending player via "opponent").
    restrictCasting: { required: { player: isPlayerRef } },
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
    // CR 400.7 (issue #839) — a plain zone change. `target` is an object
    // selector (announced slot or a bare snapshot ref like `$source`); `to` is
    // the destination zone. The source zone is inferred from the object's kind,
    // so there is no `from` field. `bind` (issue #680) snapshots the object
    // BEFORE the move — valid only alongside `target` (the `cards` shape's
    // picks are hidden-zone ids with no snapshot machinery).
    // SECOND SHAPE (issue #677, #680): `cards` (a bare choice-picks ref) +
    // `player` + `from` — the search/self-select half of a tutor/fetch/
    // graveyard-pick effect, consuming a `choice(zone: "library" | "hand" |
    // "graveyard")` Op's picks (a hidden zone has no announced-target form,
    // CR 601.2b; a graveyard pick is a self-selection, not a spell target).
    // Exactly one of `target` / `cards` is required; `player`/`from` are
    // required with `cards` and invalid with `target`. `tapped` (optional) is
    // valid only alongside `cards` AND `to: "battlefield"` (Fabled Passage's
    // forced-tapped fetch).
    moveZone: {
        required: { to: isMoveZone },
        optional: {
            target: isObjectSelector,
            bind: isBindingName,
            controller: isPlayerRef,
            cards: isBarePicksRef,
            player: isPlayerRef,
            from: isMoveZoneFrom,
            tapped: isBoolean,
        },
        check: (entry) => {
            const hasTarget = "target" in entry;
            const hasCards = "cards" in entry;
            const errors: string[] = [];
            if (hasTarget === hasCards) {
                errors.push('exactly one of "target" or "cards" is required');
            }
            if (hasCards) {
                if (!("player" in entry)) {
                    errors.push('field "player" is required with "cards"');
                }
                if (!("from" in entry)) {
                    errors.push('field "from" is required with "cards"');
                }
                if ("bind" in entry) {
                    errors.push('field "bind" is not valid with "cards"');
                }
                if ("controller" in entry) {
                    errors.push('field "controller" is not valid with "cards"');
                }
            }
            if (hasTarget) {
                if ("player" in entry) {
                    errors.push('field "player" is not valid with "target"');
                }
                if ("from" in entry) {
                    errors.push('field "from" is not valid with "target"');
                }
            }
            if ("controller" in entry && entry.to !== "battlefield") {
                errors.push(
                    'field "controller" is only valid with to: "battlefield"'
                );
            }
            if (
                "tapped" in entry &&
                (!hasCards || entry.to !== "battlefield")
            ) {
                errors.push(
                    'field "tapped" is only valid with "cards" and to: "battlefield"'
                );
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
    tapUntap: {
        required: {
            action: isTapUntapAction,
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
        optional: { count: isEffectValue },
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
    // CR 611.1b / 613.1f (issue #843) — grant a keyword static ability to a
    // permanent for a limited duration (layer 6). `ability` is the free-form
    // keyword granted; `target` is an object selector (announced slot,
    // `$source`, or a forEach `$each`); `duration` is the phase boundary at
    // which the grant expires (CR 611.2).
    grantAbility: {
        required: {
            ability: isNonEmptyString,
            target: isObjectSelector,
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
        optional: { prompt: isNonEmptyString },
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
    // CR 401.4 (issue #984) — dig to hand: look at the top `look` cards, put
    // `take` (default 1) into hand, the rest on the bottom. Suspends on a
    // `look-top` choice over the looked-at ids. `player` names whose library;
    // `look` is how many top cards to look at; `take` (optional, default 1) is
    // how many to keep; `prompt` is an optional choice header. No `bind` — the
    // pick is consumed internally, not by a later Op.
    digToHand: {
        required: {
            player: isPlayerRef,
            look: isEffectValue,
        },
        optional: { take: isEffectValue, prompt: isNonEmptyString },
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
        },
        check: (entry) => {
            const errors: string[] = [];
            const has = (k: string) => k in entry;
            const requireFields = (fields: string[]) => {
                for (const f of fields) {
                    if (!has(f)) {
                        errors.push(
                            `mode "${String(entry.mode)}" requires field "${f}"`
                        );
                    }
                }
                for (const f of ["to", "amount", "target", "duration"]) {
                    if (!fields.includes(f) && has(f)) {
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
        optional: { filter: isCardFilter, zoneOwnerId: isPlayerRef },
    },
    // CR 701.9 (issue #805) — discard the cards a `choice` Op picked.
    discard: {
        required: { player: isPlayerRef, cards: isBarePicksRef },
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
        optional: { cost: isMayPayCost },
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
        optional: { permanents: isBarePicksRef, target: isObjectSelector },
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
            // CR 603.7a / 603.10 (issue #731) — the instance leave-watch timing
            // fires on a specific watched permanent, so it demands `watch`; the
            // phase-boundary timings fire at a step and reject it.
            const leaveWatch = entry.timing === "leaves-battlefield";
            if (leaveWatch && !("watch" in entry)) {
                errors.push(
                    `timing "leaves-battlefield" is instance-scoped (CR 603.7a) — field "watch" is required`
                );
            }
            if (!leaveWatch && "watch" in entry) {
                errors.push(
                    `field "watch" is only valid with the instance leave-watch timing "leaves-battlefield"`
                );
            }
            return errors;
        },
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
    // CR 508.1a / 509.1b (ADR 0053, pile division) — a turn-scoped attack/
    // block restriction grant. `target` is an object selector (announced
    // slot, `$source`, or a forEach `$each` — the shape every pile card
    // uses).
    restrictCombat: {
        required: {
            restriction: (v) => v === "cant-attack" || v === "cant-block",
            target: isObjectSelector,
        },
    },
};

/** Names of the Ops that have a static field schema — used by the coverage
 *  guard test to keep schemas 1:1 with the registry and the interpreter. */
export const SCHEMA_OP_NAMES: readonly string[] = Object.keys(OP_SCHEMAS);

/** Property paths legal in a NUMERIC ref position (amount / count).
 *  `manaValue` (issue #680) reads a `moveZone` reanimation `bind`'s CR 202.3
 *  mana value (Reanimate). */
const NUMBER_REF_PROPERTIES = new Set(["power", "toughness", "manaValue"]);
/** Property paths legal in a PLAYER ref position (a player selector). */
const PLAYER_REF_PROPERTIES = new Set(["controller"]);

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
    kind: "number" | "player" | "picks" | "boolean" | "object";
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
                    : keyHint === "cards" || keyHint === "permanents"
                      ? "picks"
                      : keyHint === "target" ||
                          keyHint === "to" ||
                          keyHint === "of"
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
type BindingKind = "snapshot" | "picks" | "boolean" | "player" | "list";

/** The binding family a `bind`-carrying Op declares. */
function bindingKindOf(op: unknown): BindingKind {
    if (op === "choice") return "picks";
    if (op === "mayPay") return "boolean";
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
    // Bare-binding positions (no property path): picks (#805) and boolean
    // (#806, an `if` predicate).
    if (use.kind === "picks" || use.kind === "boolean") {
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
            const wanted = use.kind === "picks" ? "picks" : "boolean";
            errors.push(
                `${at}: ref "${use.ref}" names a ${family} binding in a ${use.kind} position — a ${use.kind} position reads a ${wanted} binding (${use.kind === "picks" ? "a choice Op's bind or a list binding" : "a mayPay Op's bind"})`
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
    eventScope: EventScope
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
            // like `then`/`else`. `op` / `bind` never carry refs.
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
                // `bound` (ADR 0049, issue #866): the iterated ref MUST name a
                // LIST binding (a delayedTrigger list-valued capture). The
                // family is checked here directly — it is not a scalar ref
                // position `checkRefUse` handles.
                if (s.set === "bound" && typeof s.ref === "string") {
                    const family = declared.get(s.ref);
                    if (family === undefined) {
                        errors.push(
                            `${at}: forEach { set: "bound" } ref "${s.ref}" references undefined binding — no earlier Op binds it (a bound-set ref names a delayedTrigger list-valued capture, ADR 0049)`
                        );
                    } else if (family !== "list") {
                        errors.push(
                            `${at}: forEach { set: "bound" } ref "${s.ref}" names a ${family} binding — a bound set iterates a list binding (a delayedTrigger list-valued capture, ADR 0049)`
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
        if (entry.op === "delayedTrigger") {
            const capture = entry.capture;
            if (capture && typeof capture === "object") {
                for (const [name, src] of Object.entries(capture)) {
                    checkCaptureSource(
                        name,
                        src,
                        declared,
                        at,
                        errors,
                        eventScope
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

        // Recurse into each `coinFlip` branch with a CLONED scope (issue #851):
        // a branch sees the bindings declared BEFORE the coinFlip, but a
        // branch-local `bind` does not leak past it (only one branch runs — like
        // an `if` branch / optionChoice mode, CR 705).
        if (entry.op === "coinFlip") {
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
    // Recurse into each `coinFlip` branch's body (issue #851) — win / loss are
    // nested Op lists validated at their own paths, exactly like an optionChoice
    // mode. `inForEach` / `inDelayed` thread through so nesting bans still apply.
    if (entry.op === "coinFlip") {
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
    return errors;
}

/** No implicit bindings — a spell site provides no `$source` (its source is
 *  the resolving stack item, not a battlefield permanent). */
const EMPTY_BINDINGS: ReadonlySet<string> = new Set();
/** The bindings an ability site provides for free (issue #803): `$source`. */
const ABILITY_BINDINGS: ReadonlySet<string> = new Set(["$source"]);

/** The narrow ability slice the ability-site validator reads. Both
 *  `ActivatedAbility` and `TriggeredAbility` satisfy it structurally. */
export type AbilityEffectScriptHost = {
    id: string;
    effects?: unknown;
    resolve?: unknown;
    resolveSteps?: unknown;
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
