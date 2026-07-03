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
import { isRegisteredEffectOp } from "../../cards/mechanicsRegistry";

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

/** `{ target: n }` — an announced-target slot index (CR 601.2c order). */
function isTargetRef(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "target") return false;
    const n = (value as { target: unknown }).target;
    return typeof n === "number" && Number.isInteger(n) && n >= 0;
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

/** `{ type?, subtype? }` — the minimal card filter for a `count` set. Only
 *  those two keys, each a non-empty string when present. */
function isCardFilter(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const entries = Object.entries(value);
    return entries.every(
        ([k, v]) =>
            (k === "type" || k === "subtype") &&
            typeof v === "string" &&
            v.length > 0
    );
}

/** `{ count: { zone, controller, filter? } }` — SHAPE of the count construct
 *  (ADR 0045). The `controller` player ref is shape-checked here; any ref
 *  inside it is property-checked by the ordered ref pass. */
function isCountValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    if (keys.length !== 1 || keys[0] !== "count") return false;
    const spec = (value as { count: unknown }).count;
    if (typeof spec !== "object" || spec === null) return false;
    const s = spec as Record<string, unknown>;
    const allowed = new Set(["zone", "controller", "filter"]);
    if (!Object.keys(s).every((k) => allowed.has(k))) return false;
    if (s.zone !== "battlefield" && s.zone !== "graveyard") return false;
    if (!isPlayerRef(s.controller)) return false;
    if ("filter" in s && !isCardFilter(s.filter)) return false;
    return true;
}

/** A numeric Op parameter (ADR 0045 value grammar): a positive-int literal,
 *  a `ref`, or a `count`. Exactly those three — no expressions. */
function isEffectValue(value: unknown): boolean {
    return isPositiveInt(value) || isRefValue(value) || isCountValue(value);
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

/** An object-acting Op's selector (destroy/exile `target`, dealDamage `to`):
 *  an announced target slot, or — inside a permanents-set forEach body
 *  (issue #807) — the bare `{ ref: "$each" }`. The ordered ref pass enforces
 *  that an object-position bare ref IS `$each` of a permanents iteration. */
function isObjectSelector(value: unknown): boolean {
    return isTargetRef(value) || isBareRef(value);
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
            if (!isPositiveInt(sac.count)) return false;
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

/** The `forEach` construct's set selector (ADR 0045, issue #807) — exactly
 *  `{ set: "players" }` or `{ set: "permanents", zone: "battlefield",
 *  controller?, filter? }`. Unknown keys are rejected (the grammar is frozen;
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
    if (s.set !== "permanents") return false;
    const allowed = new Set(["set", "zone", "controller", "filter"]);
    if (!Object.keys(s).every((k) => allowed.has(k))) return false;
    // CR 110.1 — permanents only exist on the battlefield.
    if (s.zone !== "battlefield") return false;
    if ("controller" in s && !isPlayerRef(s.controller)) return false;
    if ("filter" in s && !isCardFilter(s.filter)) return false;
    return true;
}

/** The timings a `delayedTrigger` Op may fire at (CR 603.7, ADR 0048) —
 *  exactly the `DelayedTriggerTiming` union the engine's fire path handles. */
const DELAYED_TIMINGS = new Set([
    "next-end-step",
    "next-end-of-combat",
    "next-draw-step",
    "next-main-phase",
    "next-upkeep",
]);

function isDelayedTiming(value: unknown): boolean {
    return typeof value === "string" && DELAYED_TIMINGS.has(value);
}

/** SHAPE of a `delayedTrigger` Op's `capture` map (ADR 0048): binding-name
 *  keys (the reserved `$each` / `$source` names are rejected), each value a
 *  literal string, an announced target slot, a bare binding ref, or a
 *  `$x.controller` property ref. Binding existence / family / property
 *  legality are checked by the ordered ref pass. */
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
                isRefValue(v))
    );
}

/** Per-Op field schemas. Adding an Op = one registry row (mechanicsRegistry),
 *  one executor (interpreter) and one schema row here; the coverage guard
 *  test fails CI when the three drift apart. `bind` (ADR 0045) is an optional
 *  field on the object-moving Ops that can snapshot their target. */
const OP_SCHEMAS: Record<string, OpSchema> = {
    dealDamage: { required: { amount: isEffectValue, to: isDamageRecipient } },
    draw: { required: { player: isPlayerRef, count: isEffectValue } },
    gainLife: { required: { player: isPlayerRef, amount: isEffectValue } },
    loseLife: { required: { player: isPlayerRef, amount: isEffectValue } },
    destroy: {
        required: { target: isObjectSelector },
        optional: { bind: isBindingName },
    },
    exile: {
        required: { target: isObjectSelector },
        optional: { bind: isBindingName },
    },
    // CR 608.2 / 101.4 (issue #805) — mid-resolution choice through the
    // existing Pending Choice pipeline. `bind` is REQUIRED: a choice whose
    // picks nothing consumes is meaningless.
    choice: {
        required: {
            kind: isEffectChoiceKind,
            player: isPlayerRef,
            zone: isChoiceZone,
            count: isPositiveInt,
            prompt: isNonEmptyString,
            bind: isBindingName,
        },
        optional: { filter: isCardFilter },
        check: (entry) =>
            "filter" in entry && entry.zone !== "battlefield"
                ? [
                      `field "filter" is only valid with zone "battlefield" — the Pending Choice submit validator applies filters to battlefield picks only`,
                  ]
                : [],
    },
    // CR 701.9 (issue #805) — discard the cards a `choice` Op picked.
    discard: {
        required: { player: isPlayerRef, cards: isBarePicksRef },
    },
    // CR 701.5a (issue #806) — counter the target spell.
    counter: {
        required: { target: isTargetRef },
    },
    // CR 117.3a / 118.4 (issue #806) — optional "you may pay {cost}". `bind`
    // is REQUIRED: a may-pay whose boolean outcome nothing reads is
    // meaningless.
    mayPay: {
        required: {
            player: isPlayerRef,
            cost: isMayPayCost,
            prompt: isNonEmptyString,
            bind: isBindingName,
        },
    },
    // if — the `if` structural construct (ADR 0045, issue #806). `predicate`
    // shape is checked here; branch Op validity and predicate binding
    // references are checked by the recursive branch / ordered ref passes.
    if: {
        required: { predicate: isPredicate, then: isOpList },
        optional: { else: isOpList },
    },
    // CR 701.16 (issue #807) — sacrifice the permanents a `choice` Op picked.
    sacrifice: {
        required: { permanents: isBarePicksRef },
    },
    // forEach — the `forEach` structural construct (ADR 0045, issue #807).
    // The `select` selector shape is checked here; body Op validity, the
    // nesting ban, and `$each` ref references are checked by the recursive
    // schema / ordered ref passes.
    forEach: {
        required: { select: isForEachSelector, effects: isOpList },
        check: (entry) =>
            Array.isArray(entry.effects) && entry.effects.length === 0
                ? ['field "effects" must be a non-empty Op list']
                : [],
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
        optional: { capture: isCaptureMap, targetPlayer: isPlayerRef },
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
            return errors;
        },
    },
};

/** Names of the Ops that have a static field schema — used by the coverage
 *  guard test to keep schemas 1:1 with the registry and the interpreter. */
export const SCHEMA_OP_NAMES: readonly string[] = Object.keys(OP_SCHEMAS);

/** Property paths legal in a NUMERIC ref position (amount / count). */
const NUMBER_REF_PROPERTIES = new Set(["power", "toughness"]);
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
 *  position. A ref under a `player` / `controller` key is a player ref; a ref
 *  under a `cards` / `permanents` key is a picks ref (issues #805/#807 — reads
 *  a choice Op's picks); a ref under a `target` / `to` key is an object ref
 *  (issue #807 — acts ON the referenced permanent, `$each`); any other ref is
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
                keyHint === "player" || keyHint === "controller"
                    ? "player"
                    : keyHint === "cards" || keyHint === "permanents"
                      ? "picks"
                      : keyHint === "target" || keyHint === "to"
                        ? "object"
                        : "number",
        });
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
type BindingKind = "snapshot" | "picks" | "boolean" | "player";

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

/** Validates one recorded ref use against the bindings declared so far, pushing
 *  a human-readable error for a dangling binding, a family mismatch, or an
 *  unknown property path. */
function checkRefUse(
    use: RefUse,
    declared: ReadonlyMap<string, BindingKind>,
    at: string,
    errors: string[]
): void {
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
        const wanted = use.kind === "picks" ? "picks" : "boolean";
        if (family !== wanted) {
            errors.push(
                `${at}: ref "${use.ref}" names a ${family} binding in a ${use.kind} position — a ${use.kind} position reads a ${wanted} binding (${use.kind === "picks" ? "a choice Op's bind" : "a mayPay Op's bind"})`
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
            `${at}: ref "${use.ref}" names a ${family} binding in a ${use.kind} position — power/toughness/controller refs read snapshot bindings`
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
 *  picks/boolean bindings cannot cross the boundary; list captures are a
 *  tracked grammar gap). A property ref must be `.controller` on a snapshot. */
function checkCaptureSource(
    name: string,
    source: unknown,
    declared: ReadonlyMap<string, BindingKind>,
    at: string,
    errors: string[]
): void {
    if (typeof source !== "object" || source === null) return; // literal
    const obj = source as Record<string, unknown>;
    if (typeof obj.ref !== "string") return; // target slot — nothing to check
    const ref = obj.ref;
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
    declared: ReadonlyMap<string, BindingKind>
): BindingKind {
    if (typeof source === "object" && source !== null) {
        const ref = (source as Record<string, unknown>).ref;
        if (typeof ref === "string") {
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
    declared: Map<string, BindingKind>
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
            // `op` / `bind` never carry refs.
            if (
                k === "op" ||
                k === "bind" ||
                k === "predicate" ||
                k === "then" ||
                k === "else" ||
                k === "effects" ||
                k === "select" ||
                k === "capture" ||
                k === "targetPlayer"
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
                collectRefUses(
                    (select as Record<string, unknown>).controller,
                    "controller",
                    uses
                );
            }
        }
        // delayedTrigger (CR 603.7, ADR 0048): capture sources and the
        // `targetPlayer` selector resolve at SCHEDULING time, in the OUTER
        // scope (the body's own fire-time scope is walked below).
        if (entry.op === "delayedTrigger") {
            const capture = entry.capture;
            if (capture && typeof capture === "object") {
                for (const [name, src] of Object.entries(capture)) {
                    checkCaptureSource(name, src, declared, at, errors);
                }
            }
            collectRefUses(entry.targetPlayer, "player", uses);
        }
        for (const use of uses) checkRefUse(use, declared, at, errors);

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
                        new Map(declared)
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
            checkOpListRefs(
                entry.effects,
                (j) => `${at}: effects[${j}]`,
                errors,
                bodyScope
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
                    bodyScope.set(name, captureBindingKind(src, declared));
                }
            }
            checkOpListRefs(
                entry.effects,
                (j) => `${at}: effects[${j}]`,
                errors,
                bodyScope
            );
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
    implicit: ReadonlySet<string>
): void {
    const declared = new Map<string, BindingKind>();
    for (const name of implicit) declared.set(name, "snapshot");
    checkOpListRefs(
        effects,
        (i) => `${label}: effects[${i}]`,
        errors,
        declared
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
    errors: string[]
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
    // branches).
    checkRefUses(effects, label, errors, implicit);

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

    // A spell's source is the stack item, not a permanent — no `$source`.
    validateEffectOpList(def.effects, label, EMPTY_BINDINGS, errors);
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
 *  ability has no `effects[]`. */
export function validateAbilityEffectScript(
    ability: AbilityEffectScriptHost,
    cardLabel: string
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

    validateEffectOpList(ability.effects, label, ABILITY_BINDINGS, errors);
    return errors;
}
