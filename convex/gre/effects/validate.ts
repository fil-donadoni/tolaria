// Effect Script static validator (ADR 0045 / ADR 0046, issue #800).
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
//      happen), which rules out functions, RegExp, undefined, NaN, etc.
//
// The catalogue-wide sweep test (`convex/cards/__tests__/effectScripts.test.ts`)
// runs this over every registered CardDefinition, so a schema violation or an
// invented Op name fails CI before any game ever loads the card.

import type { CardDefinition } from "../../cards/types";
import { isRegisteredEffectOp } from "../../cards/mechanicsRegistry";

/** The slice of CardDefinition the validator reads — kept narrow so tests
 *  can validate synthetic shapes without building a full definition. */
export type EffectScriptHost = Pick<
    CardDefinition,
    "id" | "name" | "effects" | "resolve" | "resolveSteps" | "effect" | "modes"
>;

/** Field schema for one Op: field name → predicate over the raw value.
 *  Every listed field is required; any field NOT listed (besides `op`) is
 *  rejected as unknown. */
type OpSchema = Record<string, (value: unknown) => boolean>;

/** CR 107.1 — amounts/counts in rules text are positive integers. */
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

/** `"controller" | "opponent" | { target: n }` (EffectPlayerRef). */
function isPlayerRef(value: unknown): boolean {
    return value === "controller" || value === "opponent" || isTargetRef(value);
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
 *  test fails CI when the three drift apart. */
const OP_SCHEMAS: Record<string, OpSchema> = {
    dealDamage: { amount: isPositiveInt, to: isDamageRecipient },
    draw: { player: isPlayerRef, count: isPositiveInt },
    gainLife: { player: isPlayerRef, amount: isPositiveInt },
    loseLife: { player: isPlayerRef, amount: isPositiveInt },
    destroy: { target: isTargetRef },
};

/** Names of the Ops that have a static field schema — used by the coverage
 *  guard test to keep schemas 1:1 with the registry and the interpreter. */
export const SCHEMA_OP_NAMES: readonly string[] = Object.keys(OP_SCHEMAS);

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

/** Validates one card's Effect Script statically. Returns a list of
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

    // 1 + 2 — shape, schema and vocabulary.
    if (!Array.isArray(def.effects)) {
        errors.push(`${label}: effects must be an array`);
        return errors;
    }
    if (def.effects.length === 0) {
        errors.push(`${label}: effects[] must not be empty`);
    }
    def.effects.forEach((raw, i) => {
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
        for (const [field, check] of Object.entries(schema)) {
            if (!(field in entry)) {
                errors.push(`${at}: Op "${entry.op}" missing field "${field}"`);
            } else if (!check(entry[field])) {
                errors.push(
                    `${at}: Op "${entry.op}" field "${field}" has invalid value ${JSON.stringify(entry[field])}`
                );
            }
        }
        for (const field of Object.keys(entry)) {
            if (field !== "op" && !(field in schema)) {
                errors.push(
                    `${at}: Op "${entry.op}" has unknown field "${field}" — the grammar is frozen (ADR 0045)`
                );
            }
        }
    });

    // 4 — JSON purity (ADR 0046).
    const impurity = findImpurity(def.effects, `${label}: effects`);
    if (impurity) errors.push(impurity);

    return errors;
}
