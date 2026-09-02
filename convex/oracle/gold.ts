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
import type { CompiledDefinition, CompileOutcome, OracleCard } from "./types";

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
const ABILITY_DISPLAY_KEYS: ReadonlySet<string> = new Set([
    "oracleText",
    "id",
    // CR 700.2 — a MODE's picker label, by the same argument. The catalogue
    // writes a human's shortened phrasing ("Counter target blue spell") where
    // the compiler can only offer the bullet as printed ("Counter target spell
    // if it's blue"); neither is more correct, and `ModeOption.label` is
    // display-only — no engine path reads it. Only modes carry the field, so
    // adding it here scopes itself.
    "label",
]);

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

/**
 * Fields `cards/types.ts` documents as "single X is shorthand for one X".
 *
 * `subtypeFilter: "Wall"` and `subtypeFilter: ["Wall"]` are the SAME filter —
 * every consumer normalises them at read time, and the catalogue writes both,
 * sometimes for the same phrase on two different cards ("Sacrifice a Saproling"
 * is `subtypes: "Saproling"` on Nemata and `subtypes: ["Saproling"]` on Elvish
 * Farmer). Comparing the two encodings as different values would report a
 * dozen spurious mismatches and say nothing about whether the compiler READ the
 * card correctly, which is the only question this harness exists to answer.
 *
 * So the comparison is canonicalised the same way `sortKeys` canonicalises key
 * ORDER: symmetrically, on both sides, over an ENUMERATED list of fields whose
 * own doc comment declares the equivalence. It is deliberately not "lift every
 * bare string into an array" — that would also erase a difference between
 * `name: "Wall"` and `name: ["Wall"]`, which is not a shorthand and not
 * equivalent.
 */
const SHORTHAND_ARRAY_KEYS: ReadonlySet<string> = new Set([
    "type",
    "types",
    "subtypes",
    "supertypes",
    "colors",
    "subtypeFilter",
    "supertypeFilter",
    "excludeTypes",
    "excludeSubtypes",
    "excludeSupertypes",
    "excludeColors",
    "combatRoleFilter",
    "spellTypeFilter",
    "spellExcludeTypeFilter",
    "spellTargetsTypeFilter",
]);

/**
 * `ManaCost`-valued fields, where a generic component of ZERO is the same
 * second documented dual encoding.
 *
 * `printManaCost` renders `{}` and `{ X: 0 }` identically (a zero generic
 * contributes no symbol), and `gold.test.ts` already states the equivalence
 * outright — "`{0}` is encoded both as `{}` and as `{ X: 0 }` in the
 * catalogue". Blinking Spirit writes `{ X: 0 }` for its "{0}:" cost and Urza's
 * Avenger writes `{}` for the same printed cost, so a comparison that told them
 * apart would report one of the two as a compiler defect whichever way the
 * compiler chose.
 */
const MANA_COST_KEYS: ReadonlySet<string> = new Set([
    "mana",
    "manaCost",
    "manaProduced",
]);

/** Lift every declared shorthand field to its canonical form, at any depth. */
function canonicaliseShorthands(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicaliseShorthands);
    if (value === null || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(
        value as Record<string, unknown>
    )) {
        const canonical = canonicaliseShorthands(inner);
        if (SHORTHAND_ARRAY_KEYS.has(key) && typeof canonical === "string") {
            out[key] = [canonical];
            continue;
        }
        out[key] =
            MANA_COST_KEYS.has(key) && canonical !== null
                ? withoutZeroGeneric(canonical)
                : canonical;
    }
    return out;
}

function withoutZeroGeneric(value: unknown): unknown {
    if (typeof value !== "object" || value === null) return value;
    const record = value as Record<string, unknown>;
    if (record.X !== 0) return value;
    const rest: Record<string, unknown> = { ...record };
    delete rest.X;
    return rest;
}

const ABILITY_ARRAY_KEYS: ReadonlySet<string> = new Set([
    "activatedAbilities",
    "triggeredAbilities",
    "grantTemplates",
    "triggeredGrantTemplates",
    // CR 700.2 — a modal spell's modes carry the same display-vs-behaviour
    // split an ability does: `id` is an engine handle and `label`/`oracleText`
    // are strings a picker renders, while `effects` and `targetRequirement`
    // are the behaviour this harness exists to compare.
    "modes",
]);

export type GoldBucket =
    | "vanilla"
    | "keyword-only"
    | "mana-ability"
    | "activated"
    | "triggered"
    | "static"
    | "spell"
    | "other";

/**
 * `effect: "<shorthand>"` is a CLOSURE reached by name.
 *
 * `cards/effectRegistry.ts` maps the shorthand to a `ResolveFn`, so a card
 * authoring its behaviour this way is in exactly the position `GoldIncomparable`
 * describes for `resolve()`: an Effect Script and a closure are not comparable
 * in either direction. The only thing that kept these cards out of that bucket
 * was a representation accident — the projection sees the registry KEY, a
 * string, where a `resolve()` body is a function `sortKeys` already renders as
 * the sentinel.
 *
 * `CompiledDefinition` omits `effect` by construction (`oracle/types.ts`), so
 * the compiled side can never carry one: a gold card that does is saying "my
 * behaviour lives in a closure", and rendering it as one says so to the
 * comparison too. The five cards this covers (Disenchant, Ice Storm, Shatter,
 * Sinkhole, Stone Rain) all print "Destroy target …", which the compiler reads
 * into the ADR-0045-mandated Effect Script — neither a match nor a defect.
 */
const CLOSURE_VALUED_KEYS: ReadonlySet<string> = new Set(["effect"]);

/** Behavioural projection: everything the GRAMMAR is responsible for. */
export function behaviouralProjection(
    definition: CardDefinition | CompiledDefinition
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(definition)) {
        if (PASSTHROUGH_KEYS.has(key) || value === undefined) continue;
        if (CLOSURE_VALUED_KEYS.has(key)) {
            out[key] = sortKeys(() => undefined);
            continue;
        }
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
    return canonicaliseShorthands(sortKeys(out)) as Record<string, unknown>;
}

/**
 * The card-level keys a compiled SPELL may write (`lower.ts`), and nothing
 * else. Enumerated rather than derived so a new card-level field cannot widen
 * the bucket silently: a card carrying a rider the spell slot does not emit is
 * not a spell-slot measurement, whatever its type line says.
 */
const SPELL_BUCKET_KEYS: ReadonlySet<string> = new Set([
    "effects",
    "modes",
    "targetRequirement",
    "additionalCosts",
    "flashback",
]);

/** Which v0 shape a hand-written card is, judged from the HAND-WRITTEN side. */
export function goldBucket(definition: CardDefinition): GoldBucket {
    const keys = Object.keys(behaviouralProjection(definition));
    if (keys.length === 0) return "vanilla";
    if (keys.length === 1 && keys[0] === "staticAbilities")
        return "keyword-only";
    // CR 113.3c — a card whose only behaviour is triggered abilities is the
    // #2698 shape, measured on its own for the same reason `mana-ability` and
    // `activated` are: it is produced by its own slot, so a bucket that mixed
    // it into `other` would hide a trigger regression behind the 1,400-card
    // bucket the grammar deliberately refuses.
    if (keys.length === 1 && keys[0] === "triggeredAbilities")
        return "triggered";
    // CR 113.3d — a card whose only behaviour is a continuous static effect is
    // the #2700 shape, measured on its own for the same reason `triggered` is:
    // it is produced by its own slot, so folding it into the 1,200-card `other`
    // bucket the grammar deliberately refuses would hide a static regression.
    if (keys.length === 1 && keys[0] === "staticEffects") return "static";
    // CR 113.3a — an instant or sorcery, measured on its own for the reason
    // every other slot bucket is: it is produced by its own slot (#2699), and
    // it is the one shape whose behaviour hangs on the CARD rather than in an
    // ability array, so its keys are a SET rather than a single field —
    // `effects` or `modes` for the body, plus whatever cast-time riders the
    // card prints. A card with any key outside this vocabulary is a shape the
    // spell slot did not produce alone, and belongs in `other`.
    if (
        (keys.includes("effects") || keys.includes("modes")) &&
        keys.every((key) => SPELL_BUCKET_KEYS.has(key))
    )
        return "spell";
    if (keys.length === 1 && keys[0] === "activatedAbilities") {
        const abilities = definition.activatedAbilities ?? [];
        if (abilities.length === 0) return "other";
        // CR 605.1a — a card whose every activated ability is a mana ability is
        // the shape grammar v0 shipped first; anything with a stack-using
        // ability is the #2697 shape, and the two are measured separately
        // because they are produced by different slots.
        if (abilities.every((a) => a.useStack === false)) return "mana-ability";
        return "activated";
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
    /** Accepted cards whose hand-written side the projection cannot read. */
    incomparable: number;
}

/**
 * An accepted card whose hand-written definition keeps its behaviour in a
 * CLOSURE (`resolve` / `resolveSteps` / `canActivate` / `getTargetRequirement`).
 *
 * `sortKeys` renders a function as the sentinel `"[closure]"` rather than
 * dropping it, so such a card never silently "matches" — but it never
 * legitimately mismatches either: an Effect Script and a closure are not
 * comparable in either direction, and calling the difference a compiler defect
 * would be as unfounded as calling it a pass. Counted and listed on its own, so
 * the hole is a number somebody can watch rather than an absence, exactly like
 * `withoutOracleText`.
 */
export interface GoldIncomparable {
    readonly name: string;
    readonly bucket: GoldBucket;
    readonly expected: string;
    readonly actual: string;
}

export interface GoldReport {
    readonly buckets: Record<GoldBucket, GoldBucketStats>;
    readonly slots: Record<string, GoldBucketStats>;
    readonly mismatches: readonly GoldMismatch[];
    /** Accepted cards the projection cannot compare — see `GoldIncomparable`. */
    readonly incomparable: readonly GoldIncomparable[];
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

/** What `sortKeys` renders a function-valued field as (`gates.ts`). */
const CLOSURE_SENTINEL = '"[closure]"';

/**
 * What compiling ONE hand-written card's own Oracle text back against its own
 * definition proved.
 *
 * `equal` and `incomparable` are both round-trip PASSES for Guard C (issue
 * #2701) and are still counted apart by the gold report, because they answer
 * different questions: `equal` says the grammar read the card correctly,
 * `incomparable` says only that it produced a definition for a card whose
 * hand-written behaviour lives in a closure an Effect Script can never equal
 * (see `GoldIncomparable`). Guard C accepts the weaker claim on purpose — the
 * issue's own wording, "for closure cards, 'compiles to a definition' is enough
 * at this guard"; behavioural equality for those is its own ticket.
 */
export type RoundTripVerdict =
    | { readonly ok: true; readonly kind: "equal" | "incomparable" }
    | {
          readonly ok: false;
          readonly kind: "no-oracle-text" | "unparsed" | "mismatch";
          /** One clause naming what stopped it — a gap's fragment, or the
           *  first differing projection. */
          readonly detail: string;
      };

export interface RoundTrip {
    readonly verdict: RoundTripVerdict;
    /** `undefined` only for `no-oracle-text`, where nothing was compiled. */
    readonly outcome?: CompileOutcome;
    /** The two compared projections — present whenever a comparison ran. */
    readonly expected?: string;
    readonly actual?: string;
}

/**
 * Compile one hand-written card's own Oracle text and compare the result to the
 * card itself. THE single comparator: `runGoldHarness` below and Guard C
 * (`convex/cards/__tests__/compilerRoundTrip.test.ts`) both route through it,
 * so a catalogue-wide report and a catalogue-wide gate can never disagree about
 * what "round-trips" means.
 *
 * A card with NO `oracleText` fails rather than being skipped. Compiling `""`
 * does not error — it produces a behaviourless definition, which MATCHES a
 * vanilla creature (Grizzly Bears is exactly such a card), so treating the
 * missing input as an empty one would score a fixture hole as a pass. See
 * `docs/findings/2694-gold-cards-without-oracletext.md`.
 */
export function roundTripCard(definition: CardDefinition): RoundTrip {
    if (definition.oracleText === undefined) {
        return {
            verdict: {
                ok: false,
                kind: "no-oracle-text",
                detail: "the definition carries no `oracleText` — the compiler's input is missing, not empty",
            },
        };
    }
    const outcome = compileCard(goldOracleCard(definition));
    if (outcome.state === "unparsed") {
        return {
            verdict: {
                ok: false,
                kind: "unparsed",
                detail: outcome.gaps
                    .map((g) => `"${g.fragment}" (${g.reason})`)
                    .join("; "),
            },
            outcome,
        };
    }
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
    const expected = JSON.stringify(behaviouralProjection(definition));
    const actual = JSON.stringify(behaviouralProjection(expandedActual));
    if (expected === actual) {
        return {
            verdict: { ok: true, kind: "equal" },
            outcome,
            expected,
            actual,
        };
    }
    if (expected.includes(CLOSURE_SENTINEL)) {
        return {
            verdict: { ok: true, kind: "incomparable" },
            outcome,
            expected,
            actual,
        };
    }
    return {
        verdict: {
            ok: false,
            kind: "mismatch",
            detail: `expected ${expected}`,
        },
        outcome,
        expected,
        actual,
    };
}

export function runGoldHarness(cards: readonly CardDefinition[]): GoldReport {
    const buckets: Record<GoldBucket, GoldBucketStats> = {
        vanilla: { total: 0, accepted: 0, equal: 0, incomparable: 0 },
        "keyword-only": { total: 0, accepted: 0, equal: 0, incomparable: 0 },
        "mana-ability": { total: 0, accepted: 0, equal: 0, incomparable: 0 },
        activated: { total: 0, accepted: 0, equal: 0, incomparable: 0 },
        triggered: { total: 0, accepted: 0, equal: 0, incomparable: 0 },
        static: { total: 0, accepted: 0, equal: 0, incomparable: 0 },
        spell: { total: 0, accepted: 0, equal: 0, incomparable: 0 },
        other: { total: 0, accepted: 0, equal: 0, incomparable: 0 },
    };
    const slots: Record<string, GoldBucketStats> = {};
    const mismatches: GoldMismatch[] = [];
    const incomparable: GoldIncomparable[] = [];
    const withoutOracleText: string[] = [];

    for (const definition of cards) {
        if (definition.oracleText === undefined) {
            withoutOracleText.push(definition.name);
            continue;
        }
        const bucket = goldBucket(definition);
        buckets[bucket].total += 1;
        // ONE comparator, shared with Guard C — see `roundTripCard`.
        const { verdict, outcome, expected, actual } =
            roundTripCard(definition);
        if (outcome === undefined || outcome.state === "unparsed") continue;
        buckets[bucket].accepted += 1;

        const slotKey =
            outcome.slots.length === 0 ? "vanilla" : outcome.slots.join("+");
        slots[slotKey] ??= { total: 0, accepted: 0, equal: 0, incomparable: 0 };
        slots[slotKey].total += 1;
        slots[slotKey].accepted += 1;

        if (verdict.kind === "equal") {
            buckets[bucket].equal += 1;
            slots[slotKey].equal += 1;
        } else if (verdict.kind === "incomparable") {
            buckets[bucket].incomparable += 1;
            slots[slotKey].incomparable += 1;
            incomparable.push({
                name: definition.name,
                bucket,
                expected: expected!,
                actual: actual!,
            });
        } else {
            mismatches.push({
                name: definition.name,
                bucket,
                state: outcome.state,
                expected: expected!,
                actual: actual!,
            });
        }
    }

    return {
        buckets,
        slots,
        mismatches,
        incomparable,
        withoutOracleText: withoutOracleText.sort(),
    };
}
