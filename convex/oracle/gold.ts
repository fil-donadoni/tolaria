/**
 * The gold round-trip harness.
 *
 * The 2,026 hand-written cards are the compiler's oracle in the other sense of
 * the word: each one is a known-good answer to "what does this Oracle text
 * mean?", written by a human against the CR. Compiling a card's OWN text and
 * comparing the result to the hand-written definition is the only measurement
 * that can distinguish "the grammar parsed it" from "the grammar parsed it
 * CORRECTLY" — and it is precisely the measurement the competitor never took,
 * which is how 88% "supported" and ~4,700 silent misparses coexist (PRD #2693).
 *
 * ── Precision is the gate; recall is a number ──────────────────────────────
 *
 * PRECISION = of the gold cards the compiler ACCEPTED (emitted a definition
 * for), how many match. This is gated at 100%, for every bucket, always. A
 * wrong accepted card is the defect this whole project is organised around;
 * one is too many.
 *
 * RECALL = of the gold cards in a bucket, how many the compiler accepted. This
 * is REPORTED and never gated. Grammar v0 refuses far more than it accepts by
 * design, and a recall gate would create pressure to accept doubtful cards —
 * exactly the wrong incentive.
 *
 * ── What is compared, and why not everything ───────────────────────────────
 *
 * Only the BEHAVIOURAL projection (below). `manaCost`, `types`, `power` and so
 * on are read from Scryfall's structured fields, not from rules text: no
 * grammar is involved, so comparing them would measure the fixture rather than
 * the compiler. `aiValue`/`aiCombatHint`/`aiEffects` are hand-tuned Bot hints
 * with no Oracle text behind them at all. Everything else — every ability,
 * effect, static effect, target requirement, replacement, cost rider — is
 * compared, and a compiler that INVENTED a behavioural field would fail here
 * just as loudly as one that dropped a keyword.
 */

import { expandDefinition } from "../cards/registry";
import type { CardDefinition } from "../cards/types";
import { compileCard } from "./compile";
import { sortKeys } from "./gates";
import type { ManaCost } from "../cards/types";
import type { CompiledDefinition, OracleCard } from "./types";

/** Fields with no rules text behind them — see the header. */
export const PASSTHROUGH_KEYS: ReadonlySet<string> = new Set([
    "id",
    "name",
    "rarity",
    "manaCost",
    "types",
    "subtypes",
    "supertypes",
    "power",
    "toughness",
    "loyalty",
    "oracleText",
    "imagePrintId",
    "imagePrintFace",
    "aiValue",
    "aiCombatHint",
    "aiEffects",
    "offBattlefieldCharacteristics",
]);

/**
 * Per-ability keys excluded from the comparison.
 *
 * `oracleText` on an ability is a DISPLAY string: the catalogue stores the
 * printing's wording ("Sacrifice Black Lotus") while Scryfall's current Oracle
 * says something else ("Sacrifice this artifact"), and neither is more correct
 * than the other. `id` is an engine-internal handle. Both are compared nowhere
 * and asserted nowhere else, so this exclusion is stated rather than assumed.
 */
const ABILITY_DISPLAY_KEYS: ReadonlySet<string> = new Set(["oracleText", "id"]);

/**
 * Dead-field elision on a FIXED-OUTPUT mana ability.
 *
 * Several hand-written mana abilities carry BOTH `manaProduced` and a legacy
 * `effect: (ctx) => ctx.addMana(...)` closure. `convex/gre/effects/validate.ts`
 * (the token mana-ability validator) states the engine's rule outright: a mana
 * authority recognises a mana ability by its DESCRIPTOR — `!useStack &&
 * (manaProduced | manaChoices | manaColorSource | getManaChoices)` — and "never
 * by reading an `effects` body, which a fixed-output mana ability does not
 * execute at all (the mana is deposited structurally from this field)".
 *
 * The closure on such an ability is therefore dead code, and a compiled ability
 * that omits it is not missing behaviour. The elision is deliberately as narrow
 * as that claim: descriptor present, no Effect Script, `useStack` false. Any
 * other closure anywhere in a definition shows up as `"[closure]"` and fails
 * the comparison, which is what should happen.
 */
function isDeadManaAbilityClosure(ability: Record<string, unknown>): boolean {
    return (
        ability.useStack === false &&
        ability.effects === undefined &&
        (ability.manaProduced !== undefined ||
            ability.manaChoices !== undefined)
    );
}

const ABILITY_ARRAY_KEYS: ReadonlySet<string> = new Set([
    "activatedAbilities",
    "triggeredAbilities",
    "grantTemplates",
    "triggeredGrantTemplates",
]);

export type GoldBucket = "vanilla" | "keyword-only" | "mana-ability" | "other";

/** Behavioural projection: everything the GRAMMAR is responsible for. */
export function behaviouralProjection(
    definition: CardDefinition | CompiledDefinition
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(definition)) {
        if (PASSTHROUGH_KEYS.has(key) || value === undefined) continue;
        if (ABILITY_ARRAY_KEYS.has(key) && Array.isArray(value)) {
            out[key] = value.map((ability) => {
                const record = ability as Record<string, unknown>;
                const deadClosure = isDeadManaAbilityClosure(record);
                const copy: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(record)) {
                    if (ABILITY_DISPLAY_KEYS.has(k)) continue;
                    if (k === "effect" && deadClosure) continue;
                    copy[k] = v;
                }
                return sortKeys(copy);
            });
            continue;
        }
        out[key] = sortKeys(value);
    }
    return sortKeys(out) as Record<string, unknown>;
}

/** Which v0 shape a hand-written card is, judged from the HAND-WRITTEN side. */
export function goldBucket(definition: CardDefinition): GoldBucket {
    const keys = Object.keys(behaviouralProjection(definition));
    if (keys.length === 0) return "vanilla";
    if (keys.length === 1 && keys[0] === "staticAbilities")
        return "keyword-only";
    if (keys.length === 1 && keys[0] === "activatedAbilities") {
        const abilities = definition.activatedAbilities ?? [];
        if (
            abilities.length > 0 &&
            abilities.every((a) => a.useStack === false)
        ) {
            return "mana-ability";
        }
    }
    return "other";
}

/** Inverse of `readManaCost` — reconstructs the printed cost string. */
export function printManaCost(cost: ManaCost | undefined): string {
    if (cost === undefined) return "";
    const parts: string[] = [];
    if (cost.X === "X") {
        for (let i = 0; i < (cost.xFactor ?? 1); i += 1) parts.push("{X}");
        if (cost.generic) parts.push(`{${cost.generic}}`);
    } else if (typeof cost.X === "number" && cost.X > 0) {
        parts.push(`{${cost.X}}`);
    }
    for (const colour of ["W", "U", "B", "R", "G", "C"] as const) {
        for (let i = 0; i < (cost[colour] ?? 0); i += 1)
            parts.push(`{${colour}}`);
    }
    for (const [a, b] of cost.hybrid ?? []) parts.push(`{${a}/${b}}`);
    for (const [colour, count] of Object.entries(cost.phyrexian ?? {})) {
        for (let i = 0; i < (count as number); i += 1)
            parts.push(`{${colour}/P}`);
    }
    return parts.join("");
}

/** Reconstruct the Scryfall-shaped input for a hand-written card. */
export function goldOracleCard(definition: CardDefinition): OracleCard {
    const head = [...(definition.supertypes ?? []), ...definition.types].join(
        " "
    );
    const subtypes = definition.subtypes ?? [];
    return {
        oracleId: definition.id,
        name: definition.name,
        manaCost: printManaCost(definition.manaCost),
        typeLine:
            subtypes.length > 0 ? `${head} — ${subtypes.join(" ")}` : head,
        oracleText: definition.oracleText ?? "",
        power:
            definition.power === undefined
                ? undefined
                : String(definition.power),
        toughness:
            definition.toughness === undefined
                ? undefined
                : String(definition.toughness),
        loyalty:
            definition.loyalty === undefined
                ? undefined
                : String(definition.loyalty),
        layout: "normal",
    };
}

export interface GoldMismatch {
    readonly name: string;
    readonly bucket: GoldBucket;
    readonly state: "ready" | "quarantine";
    readonly expected: string;
    readonly actual: string;
}

export interface GoldBucketStats {
    total: number;
    accepted: number;
    equal: number;
}

export interface GoldReport {
    readonly buckets: Record<GoldBucket, GoldBucketStats>;
    readonly slots: Record<string, GoldBucketStats>;
    readonly mismatches: readonly GoldMismatch[];
    /**
     * Hand-written cards with NO `oracleText` field at all. They are excluded
     * from every count above, because the compiler's INPUT is missing rather
     * than empty: compiling `""` would "succeed" on a card that plainly has
     * rules text (Berserk, Channel, Fear …) and score it as a vanilla match.
     * A missing fixture is not a passing test. The number is reported so the
     * hole stays visible — see docs/findings/2694-gold-cards-without-oracletext.md.
     */
    readonly withoutOracleText: readonly string[];
}

export function runGoldHarness(cards: readonly CardDefinition[]): GoldReport {
    const buckets: Record<GoldBucket, GoldBucketStats> = {
        vanilla: { total: 0, accepted: 0, equal: 0 },
        "keyword-only": { total: 0, accepted: 0, equal: 0 },
        "mana-ability": { total: 0, accepted: 0, equal: 0 },
        other: { total: 0, accepted: 0, equal: 0 },
    };
    const slots: Record<string, GoldBucketStats> = {};
    const mismatches: GoldMismatch[] = [];
    const withoutOracleText: string[] = [];

    for (const definition of cards) {
        if (definition.oracleText === undefined) {
            withoutOracleText.push(definition.name);
            continue;
        }
        const bucket = goldBucket(definition);
        buckets[bucket].total += 1;
        const outcome = compileCard(goldOracleCard(definition));
        if (outcome.state === "unparsed") continue;
        buckets[bucket].accepted += 1;
        // Compare through the REAL registry seam (ADR 0046): `getAllCards()`
        // returns expanded definitions, so a bare `staticAbilities: ["exalted"]`
        // on the gold side already carries its injected CR 702.83a trigger. The
        // compiled side must go through the same expansion or every implicit-
        // keyword card would read as a dropped ability.
        const expandedActual = expandDefinition({
            ...(outcome.definition as CardDefinition),
            id: definition.id,
            rarity: definition.rarity,
        });

        const slotKey =
            outcome.slots.length === 0 ? "vanilla" : outcome.slots.join("+");
        slots[slotKey] ??= { total: 0, accepted: 0, equal: 0 };
        slots[slotKey].total += 1;
        slots[slotKey].accepted += 1;

        const expected = JSON.stringify(behaviouralProjection(definition));
        const actual = JSON.stringify(behaviouralProjection(expandedActual));
        if (expected === actual) {
            buckets[bucket].equal += 1;
            slots[slotKey].equal += 1;
        } else {
            mismatches.push({
                name: definition.name,
                bucket,
                state: outcome.state,
                expected,
                actual,
            });
        }
    }

    return {
        buckets,
        slots,
        mismatches,
        withoutOracleText: withoutOracleText.sort(),
    };
}
