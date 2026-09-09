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
import type { CardDefinition, GameEventType } from "../cards/types";
import type { CompiledTriggerHead } from "../cards/compiledTriggers";
import { compileCard } from "./compile";
import { canonicaliseShorthands, sortKeys } from "./gates";
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
 * comparison too.
 *
 * Six cards print `effect: "destroy-target"`. Five (Disenchant, Ice Storm,
 * Shatter, Sinkhole, Stone Rain) agree with the compiler on everything else
 * and are counted `incomparable`; the sixth, Desert Twister, does NOT, and is
 * a mismatch — see `BODY_KEYS`, which is what keeps the sentinel from
 * exempting a card's comparable fields along with its body.
 */
const CLOSURE_VALUED_KEYS: ReadonlySet<string> = new Set(["effect"]);

/**
 * Static-effect arrays, and the ONE display key their elements carry.
 *
 * Narrower than {@link ABILITY_DISPLAY_KEYS} in exactly the place that
 * matters: `id` is NOT here. ADR 0114 §4 — the comparator never folds a field
 * the engine reads to DECIDE — and a `cast-permission`'s id is read twice
 * (the cross-battlefield dedupe in `gre/castPermissions.ts`, and the
 * `alternativeCostId` the cast mutation resolves). It stays compared.
 *
 * `label` is the opposite kind of field, and it is the SAME field the modes'
 * `label` row above describes: UI copy the catalogue writes ("Cast with
 * Aluren") in place of the printed paragraph. Issue #3284 split it out of
 * `oracleText` precisely because one field was doing two jobs; comparing it
 * would make Guard C unsatisfiable for every card whose author writes one,
 * since no grammar can derive an author's copy. `oracleText` beside it is
 * card data and IS compared — the compiler emits the sentence it read.
 *
 * `cast-permission` is the only static kind carrying either field, so the
 * entry scopes itself exactly as the modes' `label` does (issue #3268).
 */
const STATIC_ARRAY_KEYS: ReadonlySet<string> = new Set([
    "staticEffects",
    "compiledStaticEffects",
]);
const STATIC_DISPLAY_KEYS: ReadonlySet<string> = new Set(["label"]);

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
        if (STATIC_ARRAY_KEYS.has(key) && Array.isArray(value)) {
            out[key] = value.map((effect) => {
                const record = effect as Record<string, unknown>;
                const copy: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(record)) {
                    if (STATIC_DISPLAY_KEYS.has(k)) continue;
                    copy[k] = v;
                }
                return sortKeys(copy);
            });
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

/**
 * The TOP-LEVEL fields that hold a card's resolution body, in either encoding.
 *
 * A card whose body is a closure is incomparable IN ITS BODY — that is the
 * whole of `GoldIncomparable`'s argument. It is not incomparable in its
 * `targetRequirement`, its `additionalCosts` or its `flashback`, and treating
 * it as such is how the harness stopped seeing that Desert Twister
 * ("Destroy target permanent.") declares `targetRequirement.type: "any"` — CR
 * 115.4's *any target*, which cannot name an artifact — the fifth instance of
 * a catalogue defect this compiler exists to surface.
 *
 * So the sentinel exempts these keys, and the rest of the card is compared
 * like anyone's.
 */
const BODY_KEYS: ReadonlySet<string> = new Set([
    "effect",
    "effects",
    "resolve",
    "resolveSteps",
]);

/** A projection with the resolution body removed from BOTH sides.
 *
 *  Exported for `scripts/lib/catalogue-merge.ts`, which needs the same rule
 *  the verdict below is taken on — and needs the OBJECT, not its rendering,
 *  because it names the field a divergence sits on. Keeping one implementation
 *  is the point: a merge that exempted a closure card more broadly than this
 *  would reintroduce exactly the Desert Twister blind spot `roundTripCard`
 *  documents. */
export function withoutBodyProjection(
    projection: Record<string, unknown>
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(projection)) {
        if (BODY_KEYS.has(key)) continue;
        out[key] = value;
    }
    return out;
}

/** A projection with the resolution body removed from BOTH sides. */
function withoutBody(projection: Record<string, unknown>): string {
    return JSON.stringify(withoutBodyProjection(projection));
}

/** What `sortKeys` renders a function-valued field as (`gates.ts`).
 *  Exported for `scripts/oracle-behavioural.ts`, which selects the closure
 *  cards by asking the projection rather than walking the object for
 *  `typeof === "function"` — the walk misses the `effect: "<name>"` shorthand
 *  that `cards/effectRegistry.ts` resolves to a closure at resolution time. */
export const CLOSURE_SENTINEL = '"[closure]"';

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

/** What `compiledTwin` produced, or why it could not. */
export type TwinResult =
    | {
          readonly ok: true;
          /** The compiler's own output, id/rarity restored, BEFORE
           *  `expandDefinition`. This is the object to hand
           *  `preloadDefinitions`: the registry expands on read, and expanding
           *  an already-expanded definition would inject an implicit keyword's
           *  triggers a second time. */
          readonly raw: CardDefinition;
          /** `expandDefinition(raw)` — what `getDefinition` will return for
           *  this card once `raw` is registered, by the expansion memo's
           *  identity guarantee. */
          readonly definition: CardDefinition;
          readonly outcome: CompileOutcome;
      }
    | {
          readonly ok: false;
          readonly kind: "no-oracle-text" | "unparsed";
          readonly detail: string;
          readonly outcome?: CompileOutcome;
      };

/**
 * A hand-written card's COMPILED TWIN: its own Oracle text run through the
 * compiler and dressed so the result is interchangeable with the hand-written
 * definition at the registry seam (ADR 0046).
 *
 * Two consumers, one implementation, deliberately. `roundTripCard` below
 * compares the twin STRUCTURALLY — which is decisive for a DSL card and
 * impossible for a closure card, whose body is a function nothing can diff
 * (`GoldIncomparable`). The behavioural harness (issue #2703,
 * `scripts/oracle-behavioural.ts` + `vitest.setup.node.ts`) serves the twin
 * FROM the registry for the duration of the card's own tests, so a closure
 * card's proof is its assertions passing against the compiled body. If the two
 * built their twin separately, "the compiler accepted this card" and "the card
 * we then tested" could drift apart and neither report would say so.
 *
 * The `id`/`rarity` restore and the `expandDefinition` pass are the dressing.
 * `getAllCards()` returns EXPANDED definitions, so a bare
 * `staticAbilities: ["exalted"]` on the gold side already carries its injected
 * CR 702.83a trigger; a twin that skipped the same seam would read as a dropped
 * ability in the comparison and would behave differently under test.
 *
 * A card with NO `oracleText` fails rather than being skipped. Compiling `""`
 * does not error — it produces a behaviourless definition, which MATCHES a
 * vanilla creature (Grizzly Bears is exactly such a card), so treating the
 * missing input as an empty one would score a fixture hole as a pass. See
 * `docs/findings/2694-gold-cards-without-oracletext.md`.
 */
export function compiledTwin(definition: CardDefinition): TwinResult {
    if (definition.oracleText === undefined) {
        return {
            ok: false,
            kind: "no-oracle-text",
            detail: "the definition carries no `oracleText` — the compiler's input is missing, not empty",
        };
    }
    const outcome = compileCard(goldOracleCard(definition));
    if (outcome.state === "unparsed") {
        return {
            ok: false,
            kind: "unparsed",
            detail: outcome.gaps
                .map((g) => `"${g.fragment}" (${g.reason})`)
                .join("; "),
            outcome,
        };
    }
    const raw: CardDefinition = graftAbilityIds(definition, {
        ...(outcome.definition as CardDefinition),
        id: definition.id,
        rarity: definition.rarity,
    });
    return { ok: true, raw, definition: expandDefinition(raw), outcome };
}

/**
 * The `GameEventType` a compiled trigger HEAD fires on — the same event each
 * factory in `cards/abilities/triggers/*Trigger.ts` bakes into the
 * `TriggeredAbility` it returns (`enteredTrigger` → `PERMANENT_ENTERED`,
 * `diedTrigger` → `CREATURE_DIED`, and so on). `Record<CompiledTriggerHead
 * ["kind"], …>` makes the table exhaustive by construction: a new head added
 * to that closed union without a row here is a compile error, not a silent
 * pairing gap. Used to pair a compiled descriptor against the hand-written
 * ability that shares its trigger head (issue #3060 gap 3), rather than by
 * array position.
 */
const TRIGGER_HEAD_EVENT: Record<CompiledTriggerHead["kind"], GameEventType> = {
    entered: "PERMANENT_ENTERED",
    died: "CREATURE_DIED",
    attacks: "ATTACKERS_DECLARED",
    "combat-damage-to-player": "DAMAGE_DEALT",
    phase: "PHASE_BEGIN",
    "spell-cast": "SPELL_CAST",
};

/** `TriggeredAbility.event` normalised to an array — CR 603.2 lets one Oracle
 *  line span several engine events, so a scalar and a singleton array mean
 *  the same thing for pairing purposes. */
function eventsOf(event: GameEventType | GameEventType[]): GameEventType[] {
    return Array.isArray(event) ? event : [event];
}

/**
 * Carry the HAND-WRITTEN ability ids onto the twin, PAIRED by a structural
 * key rather than by array position (issue #3060 gap 3).
 *
 * An ability `id` is an engine handle, not behaviour, and this file already
 * says so: it sits in `ABILITY_DISPLAY_KEYS`, excluded from the structural
 * comparison, because no Oracle text produces it — the compiler invents
 * `<slug>-ability` and the catalogue invents `royal-assassin-destroy`, and
 * neither is more correct.
 *
 * The behavioural harness has to neutralise it for the same reason, or the two
 * harnesses disagree about what counts as behaviour. Concretely: a per-card
 * test pushes an ability onto the stack by its literal id
 * (`abilityId: "royal-assassin-destroy"`), so an un-grafted twin's ability is
 * never found, nothing resolves, and the test reds — reporting a NAME
 * difference as a semantic one, on a card whose compiled body is exactly right.
 * That is the same false signal in the opposite direction from a vacuous green,
 * and just as wrong.
 *
 * The PREVIOUS version paired ability `i` on one side with ability `i` on the
 * other whenever the counts matched, with nothing checking the compiler read
 * them in the SAME order — dormant only because every card in the population
 * carries exactly one ability of each kind. A compiler that emitted the right
 * number in a different order would graft the wrong hand-written id onto the
 * wrong compiled body, and a test addressing that id by name would then
 * execute something other than what its title claims.
 *
 * Paired instead by a STRUCTURAL key: activation `cost` (CR 602.1's "[Cost]:
 * [Effect]") for an activated ability, trigger HEAD event for a triggered one
 * — see `TRIGGER_HEAD_EVENT`. A single ability on each side (today's whole
 * population) pairs trivially, since there is nothing else it could pair
 * with. Two or more abilities pair by exact key match; a key this card's own
 * abilities SHARE (which the key alone cannot disambiguate) is left
 * UNGRAFTED rather than guessed — the compiled body keeps its own invented
 * id, the per-card test addressing the hand-written id cannot find it, and
 * the run reds. That refusal is the safe direction: a spurious red gets
 * investigated, a wrong pairing does not.
 *
 * A different COUNT is still refused outright, before any pairing is
 * attempted — a different count means the compiler read a different NUMBER
 * of abilities out of the card, which IS a behavioural difference the twin
 * must keep so the run reds on it.
 *
 * `modes` carries an `id` too, addressed as `chosenModeId`, and is deliberately
 * not grafted: no modal card is in the behavioural population yet, and a graft
 * nothing exercises is untested code claiming to be a guarantee. Add it with the
 * first modal card that needs it. `compiledStaticEffects` needs nothing — a
 * static effect is never addressed by an id.
 */
/** Exported for `convex/oracle/__tests__/gold.test.ts` (issue #3060 gap 3) —
 *  the pairing logic below has no compiled fixture in the current catalogue
 *  with more than one ability of a kind, so it is exercised with hand-built
 *  `CardDefinition` fragments rather than through `compiledTwin`. */
export function graftAbilityIds(
    handWritten: CardDefinition,
    compiled: CardDefinition
): CardDefinition {
    const patched: CardDefinition = {
        ...compiled,
        ...graftIds("activatedAbilities", handWritten, compiled),
    };
    return { ...patched, ...graftTriggerIds(handWritten, compiled) };
}

/** Id graft over one same-named array on both sides, paired by `cost` — see
 *  the header on `graftAbilityIds` above. */
function graftIds(
    key: "activatedAbilities",
    handWritten: CardDefinition,
    compiled: CardDefinition
): Partial<CardDefinition> {
    const gold = handWritten[key];
    const mine = compiled[key];
    if (gold === undefined || mine === undefined) return {};
    if (gold.length !== mine.length) return {};
    if (gold.length === 1) {
        // Nothing else the single compiled ability could pair with —
        // today's whole population, and the case a cost-key comparison would
        // trivially resolve anyway.
        return typeof gold[0].id === "string"
            ? { [key]: [{ ...mine[0], id: gold[0].id }] }
            : {};
    }
    const costKey = (a: { cost: unknown }) => JSON.stringify(sortKeys(a.cost));
    const goldByCost = new Map<string, number[]>();
    gold.forEach((a, i) => {
        const k = costKey(a);
        goldByCost.set(k, [...(goldByCost.get(k) ?? []), i]);
    });
    return {
        [key]: mine.map((ability) => {
            const candidates = goldByCost.get(costKey(ability)) ?? [];
            // Ambiguous — 0 or ≥2 of this card's OWN abilities share this
            // cost — refuse rather than guess; see the header.
            if (candidates.length !== 1) return ability;
            const goldId = gold[candidates[0]].id;
            return typeof goldId === "string"
                ? { ...ability, id: goldId }
                : ability;
        }),
    };
}

/**
 * The trigger graft, which needs its own function because the compiler does not
 * emit a `TriggeredAbility`.
 *
 * `TriggeredAbility.matches` is a required closure and the compiler emits only
 * JSON, so a compiled trigger travels as a DESCRIPTOR in
 * `compiledTriggeredAbilities` and `expandCompiledTriggers` rebuilds the real
 * ability from it at the registry seam (issue #2698). The rebuilt ability takes
 * its `id` straight from the descriptor, so the graft has to happen on the
 * descriptor, BEFORE expansion — grafting `triggeredAbilities` on the raw
 * compiled definition finds nothing there and silently does nothing, which is
 * how all four of the first run's behavioural reds turned out to be one
 * un-grafted id (Juzám Djinn, Mogg Sentry, Onulet, Serendib Efreet — every red
 * a triggered card, and every twin otherwise identical to the hand-written
 * ability).
 *
 * PAIRED by trigger HEAD event (issue #3060 gap 3) rather than by the position
 * `expandCompiledTriggers`'s concatenation would produce — `triggeredAbilities`
 * first, then the rebuilt descriptors, direct entries and descriptors both
 * processed in that order so an earlier pairing's claim is visible to a later
 * one. See `graftIds`'s header for the same argument in the activated-ability
 * case: a single ability on each side (today's whole population) pairs
 * trivially; with more than one, a card whose own abilities fire on the SAME
 * event is left ungrafted rather than paired by a guess.
 */
function graftTriggerIds(
    handWritten: CardDefinition,
    compiled: CardDefinition
): Partial<CardDefinition> {
    const gold = handWritten.triggeredAbilities;
    if (gold === undefined) return {};
    const direct = compiled.triggeredAbilities ?? [];
    const descriptors = compiled.compiledTriggeredAbilities ?? [];
    if (gold.length !== direct.length + descriptors.length) return {};

    if (gold.length === 1) {
        const goldId = gold[0].id;
        const withId = <T extends { id: string }>(a: T): T =>
            typeof goldId === "string" ? { ...a, id: goldId } : a;
        return {
            ...(direct.length === 1
                ? { triggeredAbilities: [withId(direct[0])] }
                : {}),
            ...(descriptors.length === 1
                ? { compiledTriggeredAbilities: [withId(descriptors[0])] }
                : {}),
        };
    }

    // One "unit" per position in the direct+descriptor concatenation, each
    // carrying the event(s) it fires on: a direct ability states its own
    // `event`; a descriptor's is read off its trigger HEAD.
    const units: { expected: GameEventType[] }[] = [
        ...direct.map((a) => ({ expected: eventsOf(a.event) })),
        ...descriptors.map((d) => ({
            expected: [TRIGGER_HEAD_EVENT[d.head.kind]],
        })),
    ];
    const claimed = new Set<number>();
    const idAt = (unitIndex: number): string | undefined => {
        const expected = units[unitIndex].expected;
        const candidates = gold
            .map((g, j) => ({ j, events: eventsOf(g.event) }))
            .filter(
                ({ j, events }) =>
                    !claimed.has(j) && expected.some((e) => events.includes(e))
            );
        // Ambiguous — no candidate, or this card's own abilities share an
        // event the head alone cannot disambiguate — refuse; see the header.
        if (candidates.length !== 1) return undefined;
        claimed.add(candidates[0].j);
        const id = gold[candidates[0].j].id;
        return typeof id === "string" ? id : undefined;
    };
    return {
        ...(compiled.triggeredAbilities === undefined
            ? {}
            : {
                  triggeredAbilities: direct.map((ability, i) => {
                      const id = idAt(i);
                      return id === undefined ? ability : { ...ability, id };
                  }),
              }),
        ...(compiled.compiledTriggeredAbilities === undefined
            ? {}
            : {
                  compiledTriggeredAbilities: descriptors.map(
                      (descriptor, i) => {
                          const id = idAt(direct.length + i);
                          return id === undefined
                              ? descriptor
                              : { ...descriptor, id };
                      }
                  ),
              }),
    };
}

/**
 * Compile one hand-written card's own Oracle text and compare the result to the
 * card itself. THE single comparator: `runGoldHarness` below and Guard C
 * (`convex/cards/__tests__/compilerRoundTrip.test.ts`) both route through it,
 * so a catalogue-wide report and a catalogue-wide gate can never disagree about
 * what "round-trips" means.
 */
export function roundTripCard(definition: CardDefinition): RoundTrip {
    const twin = compiledTwin(definition);
    if (!twin.ok) {
        return {
            verdict: { ok: false, kind: twin.kind, detail: twin.detail },
            outcome: twin.outcome,
        };
    }
    const { outcome, definition: expandedActual } = twin;
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
    // A closure on the gold side makes the card's BODY incomparable and
    // nothing else — see `BODY_KEYS`. Testing the sentinel against the WHOLE
    // serialised projection exempted the entire card, which is how Desert
    // Twister's `type: "any"` for "target permanent" went unseen: its body is
    // the `effect: "destroy-target"` shorthand, so the sentinel was present
    // and every other field rode along under it. The verdict is therefore
    // taken on the card MINUS its body, unless the sentinel SURVIVES that
    // strip — a closure nested inside an ability, which this projection cannot
    // separate from that ability's comparable fields.
    if (expected.includes(CLOSURE_SENTINEL)) {
        const bodilessExpected = withoutBody(behaviouralProjection(definition));
        if (
            bodilessExpected.includes(CLOSURE_SENTINEL) ||
            bodilessExpected ===
                withoutBody(behaviouralProjection(expandedActual))
        ) {
            return {
                verdict: { ok: true, kind: "incomparable" },
                outcome,
                expected,
                actual,
            };
        }
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
