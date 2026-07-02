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

/** `"controller" | "opponent" | { target: n } | { ref }` (EffectPlayerRef). */
function isPlayerRef(value: unknown): boolean {
    return (
        value === "controller" ||
        value === "opponent" ||
        isTargetRef(value) ||
        isRefValue(value)
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

/** `{ ref: "$picked" }` — a BARE picks ref (issue #805): a single `ref` key
 *  holding a binding name with NO property path. Reads the instance ids a
 *  `choice` Op bound. Whether the binding exists and is picks-typed is
 *  decided by the ordered ref pass. */
function isBarePicksRef(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    return (
        keys.length === 1 &&
        keys[0] === "ref" &&
        typeof (value as { ref: unknown }).ref === "string" &&
        /^\$[A-Za-z][A-Za-z0-9]*$/.test((value as { ref: string }).ref)
    );
}

/** dealDamage's `to`: an announced target OR `{ player: <EffectPlayerRef> }`. */
function isDamageRecipient(value: unknown): boolean {
    if (isTargetRef(value)) return true;
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    return (
        keys.length === 1 &&
        keys[0] === "player" &&
        isPlayerRef((value as { player: unknown }).player)
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
        required: { target: isTargetRef },
        optional: { bind: isBindingName },
    },
    exile: {
        required: { target: isTargetRef },
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
 *  player, or a picks position (which decides its legal shape, its legal
 *  property paths, and the binding family it may name). */
interface RefUse {
    ref: string;
    kind: "number" | "player" | "picks";
}

/** Walks an Op's parameters collecting every `{ ref }` use, tagged by
 *  position. A ref under a `player` / `controller` key is a player ref; a ref
 *  under a `cards` key is a picks ref (issue #805 — reads a choice Op's
 *  picks); any other ref is numeric (amount / count). `count` specs are
 *  traversed so a ref in their `controller` is caught too. */
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
                    : keyHint === "cards"
                      ? "picks"
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

/** The two binding families (issue #805). A SNAPSHOT binding (destroy/exile
 *  `bind`, the implicit `$source`) stores the bound object's power/toughness/
 *  controller; a PICKS binding (a `choice` Op's `bind`) stores the chooser's
 *  submitted instance ids. Ref positions are family-typed: numeric and player
 *  refs read snapshots, picks positions read picks — the interpreter relies
 *  on this static agreement to interpret the persisted value unambiguously. */
type BindingKind = "snapshot" | "picks";

/** Ordered ref pass (#802, extended for #805): walks Ops top to bottom, so a
 *  `ref` may only name a binding a PRECEDING Op declared with `bind`
 *  (snapshot semantics — the value must exist before it is read). Reports
 *  dangling bindings, unknown property paths, family mismatches (a picks
 *  binding read in a numeric/player position or vice versa) and duplicate
 *  binding names (uniqueness makes the persisted binding store unambiguous).
 *  Only inspects Ops whose shape already passed schema validation (a
 *  `bind`/`ref` on a malformed Op is reported there instead). */
function checkRefUses(
    effects: readonly unknown[],
    label: string,
    errors: string[],
    implicit: ReadonlySet<string>
): void {
    // Ability-site scripts (issue #803) get `$source` for free (the source
    // permanent — a snapshot), so seed it as already-declared.
    const declared = new Map<string, BindingKind>();
    for (const name of implicit) declared.set(name, "snapshot");
    effects.forEach((raw, i) => {
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
            return;
        }
        const entry = raw as Record<string, unknown>;
        const at = `${label}: effects[${i}]`;
        const uses: RefUse[] = [];
        for (const [k, v] of Object.entries(entry)) {
            if (k === "op" || k === "bind") continue;
            collectRefUses(v, k, uses);
        }
        for (const use of uses) {
            // Picks position (issue #805): a BARE binding name, no property.
            if (use.kind === "picks") {
                if (use.ref.includes(".")) {
                    errors.push(
                        `${at}: picks ref "${use.ref}" must be a bare binding name (no property path)`
                    );
                    continue;
                }
                const family = declared.get(use.ref);
                if (family === undefined) {
                    errors.push(
                        `${at}: ref "${use.ref}" references undefined binding "${use.ref}" — no earlier Op binds it`
                    );
                    continue;
                }
                if (family !== "picks") {
                    errors.push(
                        `${at}: ref "${use.ref}" names a snapshot binding in a picks position — only a choice Op's bind carries picks`
                    );
                }
                continue;
            }
            const parsed = parseRef(use.ref);
            if (!parsed) {
                errors.push(`${at}: malformed ref "${use.ref}"`);
                continue;
            }
            const family = declared.get(parsed.binding);
            if (family === undefined) {
                errors.push(
                    `${at}: ref "${use.ref}" references undefined binding "${parsed.binding}" — no earlier Op binds it`
                );
                continue;
            }
            if (family !== "snapshot") {
                errors.push(
                    `${at}: ref "${use.ref}" names a picks binding in a ${use.kind} position — power/toughness/controller refs read snapshot bindings`
                );
                continue;
            }
            const legal =
                use.kind === "player"
                    ? PLAYER_REF_PROPERTIES
                    : NUMBER_REF_PROPERTIES;
            if (!legal.has(parsed.property)) {
                errors.push(
                    `${at}: ref "${use.ref}" has unknown property path ".${parsed.property}" in a ${use.kind} position`
                );
            }
        }
        // A binding becomes visible only AFTER its Op — a ref cannot read the
        // result of the same Op that produces it (snapshot ordering). Names
        // must be unique within a script: the binding store persists entries
        // by name (issue #805), so a re-declaration would be ambiguous.
        if (typeof entry.bind === "string") {
            if (declared.has(entry.bind)) {
                errors.push(
                    `${at}: bind "${entry.bind}" re-declares an existing binding — binding names must be unique within a script`
                );
            } else {
                declared.set(
                    entry.bind,
                    entry.op === "choice" ? "picks" : "snapshot"
                );
            }
        }
    });
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
        const at = `${label}: effects[${i}]`;
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
            errors.push(`${at}: each Op must be a plain object`);
            return;
        }
        const entry = raw as Record<string, unknown>;
        if (typeof entry.op !== "string") {
            errors.push(`${at}: missing string "op" field`);
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
    });

    // 5 — ordered ref / binding check (#802).
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
