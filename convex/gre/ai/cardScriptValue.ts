// DSL-derived card valuation (PRD #1423, issue #1426; aiEffects shadow-script
// mechanism, issue #1431) — the bridge between the per-Op value model
// (`opValuers.ts`) and the latent `cardValue` primitive (`../cardValue.ts`).
// Reads a `CardDefinition`'s Effect Script(s) under CONTEXT-FREE grounding
// (the card's worth in hand) and returns the two scalar pieces the
// `latentValue` precedence composes:
//
//   • spell-script value — a NON-CREATURE's resolution: a real `effects[]`
//     script if present, else its `aiEffects` valuation-only shadow script
//     (issue #1431) if present — both walked through the SAME `OP_VALUERS`.
//     `undefined` when the card has neither (a bare `resolve()` /
//     `effect`-shorthand card) — the signal to fall back to `aiValue`/
//     `base + MV`.
//   • ability-script value — a permanent's activated + triggered ability
//     scripts (real `effects[]`, else `aiEffects`), summed and discounted
//     (conditional / one-shot value on top of the body). 0 when it has none.
//
// Kept isomorphic (types + pure `valueEffectScript`) so it rides in the
// client-importable `cardValue` barrel.

import type {
    AbilityMode,
    CardDefinition,
    EffectOp,
    GameEventType,
    ModeSelection,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "../../cards/types";
import {
    announceableModeCombinations,
    type ModeSelectionFacts,
} from "../modeSelection";
import { isManaAbilityDefinition } from "../constants";
import {
    contextFreeGrounding,
    withGraveyardSource,
    withLatentLens,
    type GroundingContext,
    type LatentLens,
    type StepGate,
} from "./grounding";
import type { LatentWeights } from "./evalWeights";
import {
    BINDING_ONLY_OPS,
    SAC_SELF_COST,
    STRUCTURAL_CONSTRUCTS,
    VALUED_OR_STRUCTURAL,
    addValues,
    eachStepDifferentialValue,
    isEachStepEngineScript,
    isEachStepScopedScript,
    opBeneficence,
    valueEffectScript,
} from "./opValuers";
import { withTypedRepresentativeVictim } from "./representativeVictim";
import type { OpValue, ValueTag } from "./featureBasis";

/** A real `effects[]` script wins outright; otherwise fall back to the
 *  `aiEffects` valuation-only shadow script (issue #1431) — both are walked
 *  through the identical `OP_VALUERS` table, so the caller can't tell them
 *  apart from the resulting `{ points, tags }`. `undefined` when neither is
 *  present (the "no honest shadow script" case the catalogue guard governs). */
function effectiveScript(site: {
    effects?: EffectOp[];
    aiEffects?: EffectOp[];
}): EffectOp[] | undefined {
    if (site.effects && site.effects.length > 0) return site.effects;
    if (site.aiEffects && site.aiEffects.length > 0) return site.aiEffects;
    return undefined;
}

/** Standing ability scripts are conditional (a tap ability still has to be
 *  paid for and used), and the creature body already counts the permanent —
 *  so their LATENT script value is discounted before being added to the body
 *  (never doubled with it). An ETB Ability is not: casting the card fires it
 *  (issue #4758, `dslLatentAbilityScriptOpValue`). */
const ABILITY_SCRIPT_DISCOUNT = 0.5;

/** True when any part of `value` reads a BINDING (`{ ref: "$x" }`) at all — a
 *  deliberate OVER-APPROXIMATION of "this body's subject is a scheduling-time
 *  capture" (`delayedTriggerTemplateOpValue` below), erring in the direction
 *  that is safe: a template the reader is unsure of contributes nothing, which
 *  is exactly what it contributed before the reader existed. So it also fires
 *  on `{ ref: "$source" }` and on a body that binds its own variable and reads
 *  it back — neither is a payload capture, and neither ships on a template
 *  today. It zeroes the WHOLE template rather than the offending Op, same
 *  reason.
 *
 *  It is NOT too narrow, which is the half that would matter: every payload
 *  key is bound as `$name` by `runDelayedTriggerBody`
 *  (`gre/effects/interpreter.ts`) and every read of a binding in the
 *  interpreter goes through `{ ref }` — a capture has no bare-string channel
 *  into the body.
 *
 *  Walks plain data only: an Effect Script is JSON by construction
 *  (`validateEffectScript`'s purity rule), so there is nothing else to descend
 *  into. */
function readsBinding(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(readsBinding);
    if (value !== null && typeof value === "object") {
        if (typeof (value as { ref?: unknown }).ref === "string") return true;
        return Object.values(value).some(readsBinding);
    }
    return false;
}

/** True when the card carries an `aiEffects` valuation-only shadow script
 *  ANYWHERE (card site or any ability site, issue #1431). A shadow is the
 *  author's stand-in for a whole `resolve()` RESOLUTION — scheduling included
 *  — so a template valued on top of it would count the delayed half twice. */
function carriesShadowScript(def: CardDefinition): boolean {
    const sites: { aiEffects?: EffectOp[] }[] = [
        def,
        ...(def.activatedAbilities ?? []),
        ...(def.triggeredAbilities ?? []),
    ];
    return sites.some((s) => (s.aiEffects?.length ?? 0) > 0);
}

/** CR 603.7a (issue #3383) — the `{ points, tags }` of the card's own
 *  `delayedTriggers[]` TEMPLATES, the array no valuer read at all until this
 *  reader: a real `effects[]` on a template was worth exactly zero, so
 *  Mishra's Bauble — whose whole point is its delayed `draw` — priced as if
 *  the draw did not exist.
 *
 *  Valued through the SAME `valueEffectScript` / `OP_VALUERS` path an ability
 *  script uses, and — deliberately — with NO discount for the wait, so a body
 *  scheduled from a named template and the identical body scheduled INLINE by
 *  the `delayedTrigger` Op (ADR 0048, whose valuer recurses straight into
 *  `op.effects`) price identically. The two paths disagreeing would make the
 *  bot's opinion of a card depend on its authoring form.
 *
 *  Three exclusions, every one fail-CLOSED (an excluded template contributes
 *  nothing, exactly as today) and every one a PREDICATE over the shape rather
 *  than a per-card list (ADR 0102):
 *
 *  1. **No `effects[]`** — a `resolve()`-only template has no script to walk,
 *     the same convention `effectiveScript` applies everywhere else.
 *  2. **The body reads a BINDING** (`{ ref: "$targetId" }`) — the subject is
 *     a scheduling-time capture the context-free reader cannot place, and
 *     guessing is actively wrong-signed: Stone Giant's
 *     `destroy { ref: "$targetId" }` destroys the CONTROLLER'S OWN creature
 *     (the one it just gave flying) and prices as +110 of opponent removal;
 *     Krovikan Elementalist's `sacrifice` charges its optional ability's cost
 *     while the benefit that ability pays for is a `resolve()` the reader
 *     cannot see. Dragon Whelp rides the same exclusion and is the
 *     CONDITIONAL-arm case besides (its template is scheduled only at the
 *     fourth activation).
 *  3. **The card carries an `aiEffects` shadow anywhere** — see
 *     `carriesShadowScript`.
 *
 *  What survives is the shape the reader can honestly price: a body with no
 *  captured subject, on a card whose resolution arms it unconditionally — the
 *  next-upkeep cantrip rider (Mishra's Bauble, Clairvoyance, Portent, Barbed
 *  Sextant). WHICH ability arms a template is not statically discoverable
 *  (scheduling happens inside a `resolve()`), so a conditionally-armed
 *  capture-free template would be over-counted; none exists in the catalogue,
 *  and `delayedTriggerTemplateValue.bot.test.ts` pins the whole classification
 *  so a new template reds until it is reviewed. */
export function delayedTriggerTemplateOpValue(
    def: CardDefinition,
    ctx: GroundingContext = contextFreeGrounding()
): OpValue | undefined {
    // Almost no card carries a template at all, and this runs per hand card
    // per ISMCTS leaf — answer those before `carriesShadowScript` allocates its
    // site list (PR review finding 6).
    if (!def.delayedTriggers?.length) return undefined;
    if (carriesShadowScript(def)) return undefined;
    let acc: OpValue | undefined;
    for (const template of def.delayedTriggers) {
        const script = template.effects;
        if (!script || script.length === 0) continue;
        if (readsBinding(script)) continue;
        const value = valueEffectScript(script, ctx);
        acc = acc ? mergeOpValue(acc, value) : value;
    }
    return acc;
}

/** Weight on the script value of a triggered ability whose gate is
 *  `{ undecidable: true }` — a CR 603.4 check-time condition the reader cannot
 *  reconstruct (it reads the firing event or the wider board).
 *
 *  **Face value — a deliberate no-op** (issue #1936, PR #1962 review). The
 *  precedent that governs an unresolvable STATE predicate in this codebase is
 *  `case "if"` in `opValuers.ts`, which values a conditional branch at 1.0 —
 *  UNLESS the predicate reads as a `coinFlipSeries` win-check (issue #4470),
 *  the one exception where the condition is a genuinely random CR 705 outcome
 *  rather than an authoring-form discriminator, and 0.5 ** count IS the true
 *  expectation. `coinFlip`'s even-odds split is the same exception, one
 *  construct over.
 *
 *  Discounting here would penalise AUTHORING FORM rather than semantics.
 *  `{ undecidable }` is overwhelmingly not "an uncertain condition" but an
 *  event DISCRIMINATOR living in `condition:` only because `scope`/`filter`
 *  can't express it: saga chapter dispatch (CR 714.2b guarantees each chapter
 *  fires exactly once), Skullclamp's `wasAttachedToLeaver`, the nth-spell /
 *  nth-draw counters on Cori-Steel Cutter / Ledger Shredder / Faerie
 *  Mastermind, The One Ring's "if you cast it". A semantically identical
 *  `diedTrigger({ scope: "self" })` carries no gate at all — so a discount
 *  would make the two authoring forms disagree about the same predicate.
 *  Measured: 0.5 here halved 49 catalogue cards (History of Benalia
 *  168.1 → 84.05, Urza's Saga 80 → 40, The One Ring 45 → 22.5) to fix 5 that
 *  the decidable `{ onSelf }` branch below already fixes on its own. */
const UNDECIDABLE_GATE_WEIGHT = 1;

/** Weight on an `{ onSelf }` gate with NO instance to read — a card still in
 *  hand, where which way it will land (evoked vs hard-cast) is exactly the
 *  decision not yet made. Even odds is the honest expectation for a binary the
 *  reader is about to CHOOSE, and unlike the undecidable case above it is a
 *  narrow, semantically-real uncertainty: the same ability read on the
 *  realized (in-play) path is decided exactly, so the weight only ever applies
 *  to the latent reading. It cuts in BOTH directions and that symmetry is the
 *  point — a gated BONUS stops being counted as guaranteed, a gated COST stops
 *  being charged as certain. */
const UNDECIDED_SELF_GATE_WEIGHT = 0.5;

/** Issue #5151 — the trigger events that RECUR every turn by the turn's own
 *  structure (CR 500.1): a `PHASE_BEGIN` trigger fires at the beginning of a
 *  step or phase of every turn it is scoped to — an upkeep, a draw step, a
 *  combat step, an end step — for as long as its permanent stays. The ONE
 *  place this set is named; both readers of a standing ability consult it
 *  through `recurrenceWeight` below, never a local copy. An event raised by
 *  what players DO (a spell cast, a creature dying, an attack declared) is
 *  not recurring: nothing guarantees it happens again next turn. */
export const RECURRING_TRIGGER_EVENTS: readonly GameEventType[] = [
    "PHASE_BEGIN",
];

/** True when `event` (a `TriggeredAbility.event`, scalar or list) names a
 *  recurring turn-structure event — the list case reads "any member", the
 *  same way `triggerHandlesEventType` (`gre/triggers.ts`) matches one. */
export function isRecurringTriggerEvent(
    event: GameEventType | GameEventType[] | undefined
): boolean {
    if (event === undefined) return false;
    const events = Array.isArray(event) ? event : [event];
    return events.some((e) => RECURRING_TRIGGER_EVENTS.includes(e));
}

/** Issue #5151 — how many times a STANDING ability's script is expected to
 *  resolve over its permanent's life: `latent.recurrence` (the fitted turns
 *  the permanent survives) for a trigger on a recurring turn-structure event,
 *  1 for everything else:
 *
 *   - an activated ability (its gating is the cost, already valued, and how
 *     often it is used is the search's to find);
 *   - a one-shot trigger ("when you cast", "when it dies");
 *   - a graveyard-zoned trigger (CR 113.6b, `zone: "graveyard"`): its source
 *     is a card in a graveyard, not a permanent with a lifetime, and what it
 *     does is leave;
 *   - a recurring trigger whose script can REMOVE ITS OWN SOURCE — sacrifice,
 *     destroy, exile or move it out of play, at any depth and behind any
 *     guard: "at the beginning of your upkeep, sacrifice it", "return this
 *     Aura to its owner's hand", cumulative upkeep's "sacrifice it unless
 *     you pay" (PR #5333 review). The removal happens at most ONCE, and the
 *     script's whole reading is dominated by the charge for it (a guarded
 *     cumulative-upkeep sacrifice reads the same −20 as an unguarded one), so
 *     compounding it would charge the permanent's loss six times over. Weight
 *     1 is the pre-#5151 reading for the whole class; pricing the recurring
 *     PAYMENT apart from the one-time sacrifice is a refinement the reader
 *     does not make yet. */
function recurrenceWeight(
    ability: {
        event?: GameEventType | GameEventType[];
        zone?: TriggeredAbility["zone"];
    },
    script: EffectOp[] | undefined,
    ctx: GroundingContext
): number {
    if (!isRecurringTriggerEvent(ability.event)) return 1;
    if (ability.zone === "graveyard") return 1;
    if (script && removesSource(script)) return 1;
    return ctx.latent.weights.recurrence;
}

/** The Ops that take their `target` off the battlefield for good, or out of
 *  play: named here for `removesSource` only. */
const SOURCE_REMOVING_OPS: ReadonlySet<string> = new Set([
    "sacrifice",
    "destroy",
    "exile",
    "moveZone",
]);

/** Does this script remove its own source (`{ ref: "$source" }`) at any
 *  nesting depth, on any branch, behind any guard? Deliberately broader than
 *  `sacrificesSource`: a conditional or guarded self-removal still bounds the
 *  trigger's lifetime, and the question here is "can this fire more than once
 *  with its source still around", not "is the body gone for certain". */
function removesSource(node: unknown): boolean {
    if (Array.isArray(node)) return node.some(removesSource);
    if (node === null || typeof node !== "object") return false;
    const op = node as { op?: unknown; target?: { ref?: unknown } };
    if (
        typeof op.op === "string" &&
        SOURCE_REMOVING_OPS.has(op.op) &&
        op.target?.ref === "$source"
    ) {
        return true;
    }
    return Object.values(node).some(removesSource);
}

/** How much of a triggered ability's script value survives its check-time gate
 *  (CR 603.4) — 1 when it always fires, 0 when the gate is decidably false for
 *  `self`, and for the two un-decided cases the weights above.
 *
 *  `self` is the SOURCE PERMANENT being valued, and is only available on the
 *  realized (in-play) path.
 *
 *  Activated abilities carry no gate (their gating is the activation cost,
 *  already valued) and always score 1. */
function gateWeight(
    ability: { gate?: TriggeredAbility["gate"] },
    self: PermanentView | undefined
): number {
    const gate = ability.gate;
    if (!gate) return 1;
    if ("undecidable" in gate) return UNDECIDABLE_GATE_WEIGHT;
    if (!self) return UNDECIDED_SELF_GATE_WEIGHT;
    return gate.onSelf(self) ? 1 : 0;
}

/** The full DSL-derived `{ points, tags }` of a NON-CREATURE card's spell
 *  script — its real `effects[]` if present, else its `aiEffects` shadow
 *  script (issue #1431), both walked through the identical `OP_VALUERS`.
 *  `undefined` when the card carries neither (see `dslSpellScriptValue`
 *  below). Exposes the TAGS alongside the scalar (`dslSpellScriptValue`
 *  strips them) for a caller that needs to know WHICH feature dimension the
 *  script loads onto — the choice-node `priorFor` seam's context-aware
 *  removal-target bonus (issue #1433) is the first such reader. Defaults to
 *  CONTEXT-FREE grounding (a card's worth in hand); a context-aware caller
 *  passes its own `GroundingContext` (`contextAwareGrounding`, PRD #1423). */
export function dslSpellScriptOpValue(
    def: CardDefinition,
    ctx: GroundingContext = contextFreeGrounding()
): OpValue | undefined {
    const script = effectiveScript(def);
    if (script) return valueEffectScript(script, ctx);
    return modesScriptOpValue(def, ctx);
}

/** A CAST-TIME modal spell (CR 601.2b–c / 700.2, `modes[]`) carries its
 *  resolution in per-mode Effect Scripts, not in a card-level `effects[]` —
 *  so the plain script reader above finds nothing. Value it at its best
 *  announceable mode COMBINATION (`bestModeCombinationOpValue`); for a
 *  one-mode list that is its best mode. */
function modesScriptOpValue(
    def: CardDefinition,
    ctx: GroundingContext
): OpValue | undefined {
    return bestModeCombinationOpValue(def.modes, def.modeSelection, ctx);
}

/** The facts a context-free valuation announces under: no board, no kicker —
 *  a conditional count's `when` never holds, so a card is valued at the count
 *  it is guaranteed, never at one a Wizard or a kicker would unlock. */
const CONTEXT_FREE_MODE_FACTS: ModeSelectionFacts = {
    controls: () => false,
    kicked: false,
};

/** The value of a mode list (a spell's or an ability's, CR 700.2) at its best
 *  announceable COMBINATION (issue #2265, ADR 0094). The chooser picks, so the
 *  list is worth the combination they would pick — but the modes INSIDE one
 *  combination all resolve (CR 700.2d / 608.2c), so their values COMPOSE:
 *  each instance is valued as its own script (its own target slots and
 *  bindings) and the instances add. That is deliberately not the
 *  `optionChoice` best-of recursion (`opValuers.ts`), where the arms compete.
 *  With no `selection` every combination is one mode, so this reduces to the
 *  best single mode — the historical read. Modes authored as `resolve()`
 *  closures contribute nothing (no script to walk); `undefined` when NO mode
 *  carries a script, which keeps the `aiValue` / `base + MV` fallback for a
 *  fully-imperative modal card. */
function bestModeCombinationOpValue(
    modes:
        | readonly {
              id: string;
              effects?: EffectOp[];
              aiEffects?: EffectOp[];
          }[]
        | undefined,
    selection: ModeSelection | undefined,
    ctx: GroundingContext
): OpValue | undefined {
    if (!modes || modes.length === 0) return undefined;
    const valueById = new Map<string, OpValue>();
    for (const mode of modes) {
        const script = effectiveScript(mode);
        if (script) valueById.set(mode.id, valueEffectScript(script, ctx));
    }
    if (valueById.size === 0) return undefined;
    let best: OpValue | undefined;
    for (const ids of announceableModeCombinations({
        modes,
        selection,
        facts: CONTEXT_FREE_MODE_FACTS,
        isModeLegal: () => true,
        ownerName: "mode list",
    })) {
        let combined: OpValue | undefined;
        for (const id of ids) {
            const value = valueById.get(id);
            if (!value) continue;
            combined = combined ? addValues(combined, value) : value;
        }
        if (combined && (!best || combined.points > best.points)) {
            best = combined;
        }
    }
    return best;
}

/** The DSL spell-script value of a NON-CREATURE card (context-free): its real
 *  `effects[]` script if present, else its `aiEffects` shadow script (issue
 *  #1431) — either walked identically through `OP_VALUERS`. `undefined` when
 *  the card carries neither (a bare `resolve()` / `effect`-shorthand /
 *  `modes[]` card whose every mode is a `resolve()` closure — those fall back
 *  to `aiValue`/`base + MV`). A modal spell is valued at its BEST mode either
 *  way: a cast-time `modes[]` card via `modesScriptOpValue` below, a
 *  resolution-time `optionChoice` Op via the walker. */
export function dslSpellScriptValue(
    def: CardDefinition,
    /** Issue #3398 — the board the spell is being valued against, when the
     *  caller has one (`evaluate`'s hand term). Omitted, the valuation stays
     *  purely context-free and every targeted, board-affecting Op prices at
     *  exactly one representative victim — the pre-#3398 number. */
    board?: LatentLens,
    /** Issue #3406 — the latent unit prices this valuation runs at. Omitted,
     *  the production vector. An evaluation running on ANY other vector (the
     *  Weight Fit's probe, a `SearchVariant.evalWeights` ladder arm) must pass
     *  its own, or the script half of the card's worth is silently priced at
     *  the committed weights and `evaluate(s, id, W)` stops being a function
     *  of `W` — which is exactly what made the fit irreproducible.
     *
     *  `board` WINS over this when both are given: a board lens carries its
     *  own weights and replaces the whole lens. Production is consistent
     *  because `latentBoardFor` (`evaluate.ts`) builds that lens from the very
     *  same `weights.latent`; pass two different vectors and the board's is
     *  the one that prices the script. */
    latent?: LatentWeights
): number | undefined {
    const ctx = contextFreeGrounding(latent);
    return dslSpellScriptOpValue(def, board ? withLatentLens(ctx, board) : ctx)
        ?.points;
}

/** Merges two `OpValue`s: points summed, tags unioned (dedup) — mirrors
 *  `opValuers.ts`'s internal `addValues`, kept as its own tiny helper here
 *  since it composes ABILITY scripts across an activated + triggered list
 *  rather than Ops within one script. */
function mergeOpValue(a: OpValue, b: OpValue): OpValue {
    const tags = new Set<ValueTag>([...a.tags, ...b.tags]);
    return { points: a.points + b.points, tags: [...tags] };
}

/** The LATENT (in-hand) value of a card's delayed-trigger templates — the
 *  template reader's points under the same `ABILITY_SCRIPT_DISCOUNT` an
 *  ability script pays, since a template is the same kind of future,
 *  conditional payoff. 0 when the card has no valued template.
 *
 *  Exposed for the NON-CREATURE branch of `latentValue` (`cardValue.ts`),
 *  which reads a card's SPELL script and never its ability value — so without
 *  this the template would be priced everywhere except the leaf evaluator.
 *  A creature's branch must NOT read it: `dslAbilityScriptValue` already
 *  carries the same templates, merged. */
export function dslLatentDelayedTemplateValue(
    def: CardDefinition,
    ctx: GroundingContext = contextFreeGrounding()
): number {
    const templates = delayedTriggerTemplateOpValue(def, ctx);
    return (templates?.points ?? 0) * ABILITY_SCRIPT_DISCOUNT;
}

/** True when the card carries a script the value model can read at a SPELL or
 *  ABILITY site — a real `effects[]`, an `aiEffects` shadow or a `modes[]`
 *  arm, at the card site or on any activated/triggered ability.
 *
 *  The question it answers is not "is this card worth something" but "has the
 *  reader SEEN the card's own resolution" (issue #3383). A card whose only
 *  readable script is a delayed-trigger TEMPLATE — Mishra's Bauble, whose
 *  activated ability is a `resolve()` — answers FALSE: the ability that
 *  schedules the template is still opaque, so the template is one KNOWN part
 *  of an otherwise unread card, never the whole of it. `candidateValue.ts`
 *  reads this to keep its no-script floor standing under such a card and add
 *  the template ON TOP, instead of letting a partial reading replace a
 *  fallback that stands for the rest. */
export function carriesSpellOrAbilityScript(def: CardDefinition): boolean {
    const sites: {
        effects?: EffectOp[];
        aiEffects?: EffectOp[];
        modes?: AbilityMode[];
    }[] = [
        { effects: def.effects, aiEffects: def.aiEffects, modes: def.modes },
        ...(def.activatedAbilities ?? []),
        ...(def.triggeredAbilities ?? []),
    ];
    return sites.some(
        (site) =>
            effectiveScript(site) !== undefined ||
            (site.modes ?? []).some(
                (mode) => effectiveScript(mode) !== undefined
            )
    );
}

/** The merged, RAW (un-discounted) `{ points, tags }` of a card's activated +
 *  triggered ability scripts under `ctx` (context-free by default): each
 *  ability's real `effects[]` script if present, else its `aiEffects` shadow
 *  script (issue #1431), summed / tag-unioned across every ability. This is
 *  the ability worth of a permanent that is ALREADY IN PLAY — its abilities
 *  are immediately usable, so no in-hand discount applies (the latent
 *  (in-hand) reader, `dslLatentAbilityScriptOpValue` below, discounts this).
 *  `undefined` when the card carries NO ability script at all (real or
 *  shadow) on any ability — the same "no Op maps" `undefined` convention
 *  `dslSpellScriptOpValue` uses. Exposes TAGS (the scalar-only
 *  `dslRealizedAbilityScriptValue` below strips them) for a caller that
 *  needs to know which feature dimension an ABILITY-ONLY card's worth loads
 *  onto — issue #1433 review: Icy Manipulator / Royal Assassin / Nevinyrral's
 *  Disk carry `boardRemoval` + `targeted` only on an ACTIVATED ability (they
 *  have no spell `effects[]` of their own), so a tag reader that only
 *  consults `dslSpellScriptOpValue` never sees it.
 *
 *  `self` — the SOURCE PERMANENT, when the caller has one (the realized,
 *  in-play path). It decides each triggered ability's check-time gate
 *  (CR 603.4, `gateWeight`): without it a gated ability is only weighted,
 *  with it a gate that reads the instance is answered exactly.
 *
 *  An ETB Ability is NOT read here (issue #4758): it is spent on entering, so
 *  it belongs to the latent reader below and never to a permanent in play. */
export function dslAbilityScriptOpValue(
    def: CardDefinition,
    ctx: GroundingContext = contextFreeGrounding(),
    self?: PermanentView
): OpValue | undefined {
    return abilityScriptOpValue(def, ctx, self, "realized");
}

/** Which of a card's abilities a reading covers (issue #4758). An **ETB
 *  Ability** (`TriggeredAbility.etbAbility`, CR 603.6a) is spent the moment
 *  its permanent enters: it belongs to the latent face (hand, library,
 *  graveyard, playable exile) and never to the realized one — on the
 *  battlefield, what it did is already in the state it left behind.
 *
 *  `"realized"` reads every ability EXCEPT the ETB Abilities (plus the
 *  delayed-trigger templates); `"etb"` reads the ETB Abilities alone. The
 *  latent reader sums the two at different discounts. */
type AbilitySelection = "realized" | "etb" | "standing";

function abilityScriptOpValue(
    def: CardDefinition,
    ctx: GroundingContext,
    self: PermanentView | undefined,
    selection: AbilitySelection,
    /** Issue #5164 — the board a standing each-step ENGINE is read against
     *  (`eachStepDifferentialValue`). Only such an engine reads it: every
     *  other ability keeps `ctx`. */
    engineLens?: LatentLens
): OpValue | undefined {
    let acc: OpValue | undefined;
    const abilities: {
        effects?: EffectOp[];
        aiEffects?: EffectOp[];
        modes?: AbilityMode[];
        modeSelection?: ModeSelection;
        gate?: TriggeredAbility["gate"];
        event?: TriggeredAbility["event"];
        zone?: TriggeredAbility["zone"];
        phaseScope?: TriggeredAbility["phaseScope"];
        interveningIf?: TriggeredAbility["interveningIf"];
        sourceTapCondition?: TriggeredAbility["sourceTapCondition"];
        activateFromGraveyard?: boolean;
        activateFromHand?: boolean;
        etbAbility?: boolean;
        targetRequirement?: TargetRequirement;
        cost?: {
            sacrifice?: boolean;
            exileThis?: boolean;
            discardThis?: boolean;
        };
        /** CR 605.1a / 605.1b — a mana ability, on either shape: an activated
         *  one classified by the engine's one predicate
         *  (`isManaAbilityDefinition`), a triggered one by its own flag. */
        manaAbility?: boolean;
    }[] = [
        ...(def.activatedAbilities ?? []).map((a) => ({
            ...a,
            manaAbility: isManaAbilityDefinition(a),
        })),
        ...(def.triggeredAbilities ?? []),
    ];
    for (const ability of abilities) {
        // Issue #5155 — a MANA ability is never standing worth: the `mana`
        // term (`evaluate.ts`) already scores every mana source, so reading
        // its script here too would count a land's mana twice. This is what
        // admits a LAND to the standing reading (`carriesStandingAbilityWorth`,
        // `cardValue.ts`): a Library of Alexandria's draw, a Maze of Ith's
        // untap, a Factory's animate are read exactly as an artifact's
        // abilities are, while a basic or a dual still reads nothing.
        if (selection === "standing" && ability.manaAbility === true) continue;
        // Issue #4758 — a spent ETB Ability is no part of a permanent's
        // realized worth. Only an explicit `true` counts as spent: an
        // unclassified trigger stays realized (fail-closed, the census in
        // `etbAbilityCensus.bot.test.ts` keeps the catalogue classified).
        if ((ability.etbAbility === true) !== (selection === "etb")) continue;
        // Issue #5145 — an ability whose cost sacrifices or exiles its OWN source is
        // consumed by use: the permanent and the effect it buys are one asset,
        // so reading the ability as STANDING worth would charge the permanent's
        // worth twice (once held, once as the effect) and make using it read as
        // a loss — Seal of Cleansing worth 86 in play would never trade itself
        // for a 48-point artifact. Such a card keeps its `base + MV` worth; the
        // effect is priced where it is spent (the move that activates it).
        // Issue #5155 (review) — the same class on its HAND side: an ability
        // activated only from hand (`activateFromHand`) that discards the
        // card as its cost (`cost.discardThis`) — cycling,
        // CR 702.29a, "functions only while the card ... is in a player's
        // hand"; channel takes the same shape — is no part of the permanent's
        // standing worth either: a Triome on the battlefield is a tapped-in
        // tri-land, not a cantrip.
        if (
            selection === "standing" &&
            (ability.cost?.sacrifice === true ||
                ability.cost?.exileThis === true ||
                ability.cost?.discardThis === true ||
                ability.activateFromHand === true)
        ) {
            continue;
        }
        // CR 603.6e / 602.5b / issue #1964 (review round 1) — a GRAVEYARD-
        // sourced ability's `$source` denotes a GRAVEYARD card, not a
        // battlefield permanent, on EITHER ability shape: a `TriggeredAbility`
        // marks this with `zone: "graveyard"` (Master of Death's upkeep
        // return), an `ActivatedAbility` marks it with `activateFromGraveyard:
        // true` (Whiteout's "Sacrifice a snow land: Return this card from
        // your graveyard to your hand" — CR 113.6/602.5b). Both must force
        // the self-bounce-as-cost valuer OFF so the graveyard→hand move keeps
        // scoring as the card advantage (regrowth) it is; reading only `zone`
        // left `activateFromGraveyard` abilities un-gated and inverted
        // Whiteout's sign (scored as a self-bounce cost instead of regrowth).
        // Every other ability (the overwhelming majority of both shapes)
        // keeps the outer `ctx` unchanged.
        const sourceCtx =
            ability.zone === "graveyard" ||
            ability.activateFromGraveyard === true
                ? withGraveyardSource(ctx)
                : ctx;
        const abilityCtx =
            selection === "etb" ? etbGrounding(sourceCtx, ability) : sourceCtx;
        const script = effectiveScript(ability);
        // CR 700.2 / 603.3c — a MODAL ability (activated, issue #1341; or
        // triggered, issue #2461) carries its resolution in per-mode scripts,
        // so the plain reader above finds nothing. Value it at its BEST mode,
        // exactly as `modesScriptOpValue` does for a modal SPELL: the announcer
        // picks the mode, so the ability is worth the arm they would pick. This
        // is what replaces a hand-written `aiEffects` shadow sketch of one arm.
        // Issue #5164 (ADR 0151) — a standing engine on every player's step
        // is read by Differential Reading against the board it stands on.
        // With no board, or a board that could not answer, it reads NOTHING:
        // a Symmetric Effect never carries a fixed sign (ADR 0151 §1), and
        // the representative walk would read `$event.activePlayerId` as the
        // controller — "its controller draws" on every board. The card then
        // keeps its Latent Floor (unmeasured, incomplete). Issue #5575 — the
        // same for every standing script on the scoped player beyond the
        // life family (`isEachStepScopedScript`): a family the Differential
        // does not read yet (a discard at random, a mill, mana) reads
        // nothing, never the representative sign. The life family itself is
        // read per side when its amounts ground (issue #5574's
        // `isEachStepEngineScript`).
        const eachStepEngine =
            ability.phaseScope === "each" &&
            script !== undefined &&
            (isEachStepEngineScript(script) || isEachStepScopedScript(script));
        // Issue #5574 — its CR 603.4 intervening-if is decided per side; a
        // check-time condition nothing can decide reads nothing (fail-closed).
        const stepGate = eachStepEngine ? stepGateOf(ability) : undefined;
        const engine =
            eachStepEngine && engineLens && stepGate !== UNDECIDABLE_STEP_GATE
                ? eachStepDifferentialValue(
                      script,
                      withLatentLens(abilityCtx, engineLens),
                      stepGate
                  )
                : undefined;
        if (eachStepEngine && !engine) continue;
        // Issue #5576 — an engine is ONE number on every face (ADR 0151): the
        // standing reader discounts its whole total by
        // `ABILITY_SCRIPT_DISCOUNT`, so the realized reader — the creature
        // face of an ANIMATED engine, un-discounted everywhere else — takes
        // the same factor on the engine alone. Animating a Howling Mine adds
        // its body and leaves its engine worth where it was.
        const raw = engine
            ? selection === "realized"
                ? {
                      points: engine.points * ABILITY_SCRIPT_DISCOUNT,
                      tags: engine.tags,
                  }
                : engine
            : script
              ? valueEffectScript(script, abilityCtx)
              : bestModeCombinationOpValue(
                    ability.modes,
                    ability.modeSelection,
                    abilityCtx
                );
        if (!raw) continue;
        // CR 603.4 (issue #1936) — an ability that only fires under a
        // condition is not worth (or is not charged) its full script value.
        // Issue #5151 — and a STANDING trigger on a per-turn step is worth
        // every firing its permanent lives to see, not one: the hand face
        // (`dslStandingAbilityScriptValue`) and the board face
        // (`nonCreatureBodyValue` → `cardValue` → the same reader) both take
        // this reading, so casting the permanent is never a value loss the
        // multiplier causes (issue #5145's one-number rule). The REALIZED
        // reading takes it too for a card that is not PRINTED a creature: a
        // non-creature permanent animated on the battlefield (an enchantment
        // under Opalescence) is scored by `evaluateCreature`, whose ability
        // half is this reading — left at weight 1 its board face is the body
        // plus ONE firing while its hand face is the whole stream (Sylvan
        // Library: 282 in hand against a 2/2 plus 94), so casting it read as
        // a loss on exactly the boards that animate it. A printed creature's
        // triggers keep weight 1 (out of scope, issue #5151 — a creature's
        // recurrence is a follow-up).
        const recurs =
            selection === "standing" ||
            (selection === "realized" && !def.types.includes("Creature"));
        const weight =
            gateWeight(ability, self) *
            (recurs ? recurrenceWeight(ability, script, abilityCtx) : 1);
        if (weight === 0) continue;
        // Tags are a MEMBERSHIP fact, not a magnitude — a weighted ability
        // still loads onto the same feature dimension, so only points scale
        // (same treatment `ABILITY_SCRIPT_DISCOUNT` gets below).
        const v =
            weight === 1
                ? raw
                : { points: raw.points * weight, tags: raw.tags };
        acc = acc ? mergeOpValue(acc, v) : v;
    }
    // CR 603.7a (issue #3383) — the card's own delayed-trigger TEMPLATES, on
    // top of its abilities: a delayed body is part of what the card does, and
    // the scheduling site is an ability (or the card's resolution) either way.
    // Un-gated and un-discounted, matching the inline `delayedTrigger` Op's
    // own valuer; the latent (in-hand) reader below discounts the merged total
    // exactly as it discounts an ability script.
    if (selection !== "realized") return acc;
    const templates = delayedTriggerTemplateOpValue(def, ctx);
    if (templates) acc = acc ? mergeOpValue(acc, templates) : templates;
    return acc;
}

/** The RAW (un-discounted) sum of a card's activated + triggered ability-script
 *  values under `ctx` (context-free by default) — the scalar-only sibling of
 *  `dslAbilityScriptOpValue`. This is the ability worth of a permanent that is
 *  ALREADY IN PLAY — its abilities are immediately usable, so no in-hand
 *  discount applies. The latent (in-hand) paths discount this before adding
 *  it to the body (`ABILITY_SCRIPT_DISCOUNT`), the realized (in-play) path
 *  does not. 0 when the card has no ability scripts. Pass `self` (the live
 *  permanent) so gated triggers are decided rather than weighted — an evoked
 *  Incarnation is charged its self-sacrifice, a hard-cast one is not
 *  (issue #1936). */
export function dslRealizedAbilityScriptValue(
    def: CardDefinition,
    ctx: GroundingContext = contextFreeGrounding(),
    self?: PermanentView,
    /** Issue #5576 — see `abilityScriptOpValue`: the board an ANIMATED
     *  non-creature engine is read against on its creature face. */
    engineLens?: LatentLens
): number {
    return (
        abilityScriptOpValue(def, ctx, self, "realized", engineLens)?.points ??
        0
    );
}

/** The merged, DISCOUNTED `{ points, tags }` of a card's activated + triggered
 *  ability scripts under `ctx` (context-free by default) — the LATENT
 *  (in-hand) sibling of `dslAbilityScriptOpValue`: points scaled by
 *  `ABILITY_SCRIPT_DISCOUNT` (tags are a membership fact, not a magnitude —
 *  discounting them makes no sense), and the card's ETB Abilities INCLUDED
 *  at full value (issue #4758): in hand they are still potential, priced
 *  context-free at their Representative Victim times the Latent Weight,
 *  whatever the board, and casting the card is all it takes to fire them. `undefined` when the card has no
 *  ability scripts (same convention as the realized reader). */
export function dslLatentAbilityScriptOpValue(
    def: CardDefinition,
    ctx: GroundingContext = contextFreeGrounding()
): OpValue | undefined {
    const standing = abilityScriptOpValue(def, ctx, undefined, "realized");
    const etb = abilityScriptOpValue(def, ctx, undefined, "etb");
    const discounted = standing && {
        points: standing.points * ABILITY_SCRIPT_DISCOUNT,
        tags: standing.tags,
    };
    // Issue #4758 — an ETB Ability is NOT discounted: casting the card fires
    // it, with no further cost or condition to meet (a gate still weighs it
    // through `gateWeight`), whereas a standing ability still has to be paid
    // for and used. Discounting it the same way priced the potential a
    // player holds the card for below what the body gains by entering, so
    // no ETB could ever be worth waiting for.
    if (!discounted) return etb;
    return etb ? mergeOpValue(discounted, etb) : discounted;
}

/** Issue #4903 — the grounding an ETB Ability is valued under: `ctx` with
 *  each target slot it cannot answer priced at a representative victim of
 *  the ability's own target TYPE rather than the 2/2. One helper for both
 *  readings of an ETB — its potential in hand and its value in flight — so
 *  the two can never price the same ability differently — except that a
 *  `ctx` carrying a board lens (a self-sacrificing creature in hand, issue
 *  #5014) answers the ability's requirement against that board, while the
 *  in-flight reading runs context-free: its trigger is already on the stack
 *  and the search settles it before a leaf, so the split is deliberate. */
function etbGrounding(
    ctx: GroundingContext,
    ability: { targetRequirement?: TargetRequirement }
): GroundingContext {
    const requirement = ability.targetRequirement;
    if (!requirement) return ctx;
    const typed = withTypedRepresentativeVictim(ctx.latent, requirement);
    // Issue #5014 — a lens attached to a real board answers the ability's own
    // requirement: what its target can actually hit THERE, ahead of the
    // representative victim.
    const measured = ctx.latent.requirementUnits?.(requirement);
    if (measured === undefined) return withLatentLens(ctx, typed);
    // A triggered ability declares ONE requirement, so only slot 0 is its.
    const types = Array.isArray(requirement.type)
        ? requirement.type
        : [requirement.type];
    const reachesFace = types.some((t) => t === "any" || t === "player");
    return withLatentLens(ctx, {
        ...typed,
        victimUnits: (slot) =>
            slot === 0 ? measured : typed.victimUnits(slot),
        faceOnly: (slot) => slot === 0 && measured === 0 && reachesFace,
    });
}

/** Issue #4758 — the value of ONE ETB Ability of `def` while it is IN FLIGHT:
 *  triggered, on the stack, not yet resolved. Spent on entering is a statement
 *  about the battlefield; between the two, the ability is neither in the
 *  permanent's realized worth nor in the state it will leave behind, so the
 *  evaluation credits it here (`evaluate.ts`, `etbAbilitiesInFlight`) — at its
 *  full, context-free script value, the gate decided on `self` (the stack
 *  item's snapshot of its source: an evoked one pays its sacrifice). 0 for an
 *  unknown ability or one that is not an ETB Ability. */
export function dslEtbAbilityInFlightValue(
    def: CardDefinition,
    abilityId: string,
    ctx: GroundingContext = contextFreeGrounding(),
    self?: PermanentView,
    /** Issue #4901 — the source this ability is in flight from: its realized
     *  worth (read lazily, only when the script sacrifices it) and the route
     *  it was cast by. Given, a `sacrifice $source` is priced at the body it
     *  takes away instead of the flat `SAC_SELF_COST`: the source still reads
     *  as kept on the battlefield while the ability waits. An escaped
     *  source's "unless it escaped" sacrifice never happens (CR 702.138b). */
    source?: { worth: () => number; route: LatentCastRoute }
): number {
    const ability = (def.triggeredAbilities ?? []).find(
        (a) => a.id === abilityId
    );
    if (ability?.etbAbility !== true) return 0;
    const script = effectiveScript(ability);
    const etbCtx = etbGrounding(ctx, ability);
    const raw = script
        ? valueEffectScript(script, etbCtx)
        : bestModeCombinationOpValue(ability.modes, undefined, etbCtx);
    let points = raw?.points ?? 0;
    // A `mayPay` leaves the body's fate to its controller (see
    // `etbSelfSacrificeWeight`), so the sacrifice is not charged as certain.
    if (
        source &&
        script &&
        sacrificesSource(script, source.route) &&
        !hasOp(script, "mayPay")
    ) {
        points += -SAC_SELF_COST - source.worth();
    }
    return points * gateWeight(ability, self);
}

/** Issue #4758 — how surely a creature's body is gone the moment it enters:
 *  the largest gate weight (`gateWeight`, no instance — the card is not in
 *  play) of an ETB Ability whose script sacrifices its own source ("When this
 *  creature enters, sacrifice it unless it escaped", an evoke sacrifice).
 *  0 when no ETB Ability does. Context-free like the rest of the latent
 *  reading: an `if` around the sacrifice counts as taken, exactly as the `if`
 *  walker takes its `then` branch.
 *
 *  The latent body is scaled by what survives this (`latentValue`). Without
 *  it, a card in hand kept the full discounted body its own ETB sacrifices,
 *  and once the search saw the sacrifice resolve (`policyProbeState`) casting
 *  it read as throwing that body away — so the Bot held a Titan whose
 *  hard-cast is a burn spell, forever. */
export function etbSelfSacrificeWeight(
    def: CardDefinition,
    route: LatentCastRoute = "hand"
): number {
    let weight = 0;
    for (const ability of def.triggeredAbilities ?? []) {
        if (ability.etbAbility !== true) continue;
        const script = effectiveScript(ability);
        if (!script || !sacrificesSource(script, route)) continue;
        // "Sacrifice it unless you pay …" (a `mayPay` in the same script,
        // Phyrexian Dreadnought's power-12 sacrifice): the controller's own
        // payment decides whether the body stays, so the sacrifice is not a
        // certainty and the body keeps its latent worth. "Unless it escaped"
        // and an evoke sacrifice are decided by how the card was cast instead.
        let payWeight = 1;
        if (hasOp(script, "mayPay")) {
            // A sacrifice that no `mayPay` guards (Mold Demon's "fewer than
            // two Swamps" branch) happens whether or not the controller
            // could pay: whether the payment is possible is the board's to
            // say, and the latent reading has none, so it is an undecided
            // gate rather than a certainty or a nothing.
            if (!sacrificesSource(script, route, "unpaid")) continue;
            payWeight = UNDECIDED_SELF_GATE_WEIGHT;
        }
        weight = Math.max(weight, payWeight * gateWeight(ability, undefined));
    }
    return weight;
}

/** Issue #4897 — the route a card's latent worth is read along. A card in
 *  HAND is cast from hand (`escaped` is 0); a card in a GRAVEYARD that can
 *  escape on its own (printed escape, CR 702.138a) is cast by escape
 *  (`escaped` is 1), so its "unless it escaped" sacrifice never happens and
 *  the body stays. Escape payability (five other cards to exile) is not
 *  checked here: reach asks whether the card can escape at all. */
export type LatentCastRoute = "hand" | "escape";

/** `a op b` over numbers — the `EffectComparisonOp` set. */
function compareNumbers(
    op: string | undefined,
    a: number,
    b: number
): boolean | undefined {
    switch (op) {
        case "eq":
            return a === b;
        case "ne":
            return a !== b;
        case "lt":
            return a < b;
        case "le":
            return a <= b;
        case "gt":
            return a > b;
        case "ge":
            return a >= b;
        default:
            return undefined;
    }
}

/** What an `if` predicate that reads `escaped` against a literal decides when
 *  the card was cast by escape (`escaped` = 1); `undefined` for any other
 *  predicate, which the route does not decide. */
function escapedPredicateOnEscapeRoute(
    predicate: unknown
): boolean | undefined {
    if (predicate === null || typeof predicate !== "object") return undefined;
    const p = predicate as { left?: unknown; op?: string; right?: unknown };
    if (
        p.left === null ||
        typeof p.left !== "object" ||
        !("escaped" in (p.left as object)) ||
        typeof p.right !== "number"
    ) {
        return undefined;
    }
    return compareNumbers(p.op, 1, p.right);
}

/** Does this script sacrifice `$source`, at any nesting depth? On the escape
 *  route an `if` on `escaped` takes the branch escape decides; on the hand
 *  route (and for any other `if`) every branch counts, as the `if` walker
 *  takes its `then`. */
function sacrificesSource(
    node: unknown,
    route: LatentCastRoute,
    /** `"unpaid"`: count only a sacrifice that no earlier `mayPay` of its
     *  enclosing op lists guards — one the payment cannot avert. */
    mode: "any" | "unpaid" = "any",
    guarded = false
): boolean {
    if (Array.isArray(node)) {
        let seen = guarded;
        for (const n of node) {
            if (sacrificesSource(n, route, mode, seen)) return true;
            if (mode === "unpaid" && hasOp(n, "mayPay")) seen = true;
        }
        return false;
    }
    if (node === null || typeof node !== "object") return false;
    const op = node as {
        op?: unknown;
        target?: { ref?: unknown };
        predicate?: unknown;
        then?: unknown;
        else?: unknown;
    };
    if (op.op === "sacrifice" && op.target?.ref === "$source") return !guarded;
    if (op.op === "if" && route === "escape") {
        const taken = escapedPredicateOnEscapeRoute(op.predicate);
        if (taken !== undefined) {
            return sacrificesSource(
                taken ? op.then : op.else,
                route,
                mode,
                guarded
            );
        }
    }
    return Object.values(node).some((n) =>
        sacrificesSource(n, route, mode, guarded)
    );
}

/** Does this script carry an Op named `name`, at any nesting depth? */
function hasOp(node: unknown, name: string): boolean {
    if (Array.isArray(node)) return node.some((n) => hasOp(n, name));
    if (node === null || typeof node !== "object") return false;
    if ((node as { op?: unknown }).op === name) return true;
    return Object.values(node).some((n) => hasOp(n, name));
}

/** The DSL ability-script value of a card's activated + triggered abilities
 *  (context-free by default), discounted and summed — the LATENT (in-hand)
 *  ability worth added to a creature's body by the `latentValue` precedence.
 *  Kept strictly below its realized (in-play) counterpart
 *  (`dslRealizedAbilityScriptValue`) by `ABILITY_SCRIPT_DISCOUNT < 1` for the
 *  abilities both faces read, so casting a utility creature is strictly
 *  positive (issue #149, review #1440). An ETB Ability is the deliberate
 *  exception (issue #4758): counted here and never realized, so casting a
 *  creature whose ETB finds nothing to hit reads as the loss it is, and only
 *  what the ETB actually does on resolution pays it back. 0 when the card has
 *  no ability scripts. */
export function dslAbilityScriptValue(
    def: CardDefinition,
    ctx: GroundingContext = contextFreeGrounding()
): number {
    return dslLatentAbilityScriptOpValue(def, ctx)?.points ?? 0;
}

/** Issue #5145 — the latent worth of a NON-CREATURE permanent's own standing
 *  ability scripts (activated + triggered, real `effects[]` else `aiEffects`
 *  shadow), at `ABILITY_SCRIPT_DISCOUNT`: the "standing" reading is
 *  `"realized"` minus the delayed-trigger templates (`latentValue` adds those
 *  through its own field, so reading them here too would count them twice),
 *  minus the ETB Abilities (spent on entering — a permanent that
 *  is still valued on the battlefield by this same number must not keep
 *  charging for an effect that already happened), and minus every MANA
 *  ability (issue #5155 — the `mana` term scores those, which is what lets a
 *  utility land take this reading). Signed: a symmetric or
 *  self-harming ability (a tax, an upkeep cost) reads negative, which
 *  `latentValue` nets against the card's other scripts and then floors.
 *  `undefined` when the card carries no readable ability script. */
export function dslStandingAbilityScriptValue(
    def: CardDefinition,
    ctx: GroundingContext = contextFreeGrounding(),
    /** Issue #5164 — see `abilityScriptOpValue`. */
    engineLens?: LatentLens
): number | undefined {
    const standing = abilityScriptOpValue(
        def,
        ctx,
        undefined,
        "standing",
        engineLens
    );
    return standing && standing.points * ABILITY_SCRIPT_DISCOUNT;
}

/** Issue #5574 — a standing each-step engine's CR 603.4 gate, asked for
 *  one player's step (`StepGate`): its `interveningIf` given the PHASE_BEGIN
 *  event of that player's step. The event's `phase` is the board's own — the
 *  `phaseTrigger` wrapper narrows its predicate on the event type alone,
 *  `matches` is what reads the phase. `undefined` when the trigger has no
 *  gate. An `{ onSelf }` gate is decided on the source. A check-time
 *  `condition` (`{ undecidable }`) with no `interveningIf` beside it is a
 *  predicate no reader can ask: `UNDECIDABLE_STEP_GATE`. A compiled
 *  intervening-if passes ONE predicate as both (`resolveCompiledTrigger`,
 *  CR 603.4 checks it twice), so its `interveningIf` decides it.
 *
 *  Issue #5578 — an intervening-if declared as data on the source's tapped
 *  state (`sourceTapCondition`) is read off the declaration, never the
 *  closure: the side's source carries the tapped state it will have on that
 *  player's step (`EachPlayerSide.stepGateHolds`). */
function stepGateOf(ability: {
    gate?: TriggeredAbility["gate"];
    interveningIf?: TriggeredAbility["interveningIf"];
    sourceTapCondition?: TriggeredAbility["sourceTapCondition"];
}): StepGate | typeof UNDECIDABLE_STEP_GATE | undefined {
    const onSelf =
        ability.gate && "onSelf" in ability.gate
            ? ability.gate.onSelf
            : undefined;
    const tap = ability.sourceTapCondition;
    if (tap !== undefined) {
        return (_activePlayerId, self) =>
            (onSelf === undefined || onSelf(self)) &&
            (self.isTapped === true) === (tap === "tapped");
    }
    const predicate = ability.interveningIf;
    if (!predicate) {
        if (onSelf) return (_activePlayerId, self) => onSelf(self);
        return ability.gate ? UNDECIDABLE_STEP_GATE : undefined;
    }
    return (activePlayerId, self, state) =>
        (onSelf === undefined || onSelf(self)) &&
        predicate(
            { type: "PHASE_BEGIN", phase: state.phase, activePlayerId },
            self,
            state as unknown as TriggerStateView
        );
}

const UNDECIDABLE_STEP_GATE = Symbol("undecidable-step-gate");

/** Issue #5164 (ADR 0151) — true when the card carries a standing ENGINE on
 *  every player's step: a `phaseScope: "each"` trigger whose script
 *  `eachStepDifferentialValue` reads per side. Memoised per definition — the
 *  board face asks it for every non-creature permanent at every leaf, and
 *  only such a card is worth a board lens there. */
export function carriesEachStepEngine(def: CardDefinition): boolean {
    let known = EACH_STEP_ENGINE_MEMO.get(def);
    if (known === undefined) {
        known = (def.triggeredAbilities ?? []).some((t) => {
            if (t.phaseScope !== "each") return false;
            const script = effectiveScript(t);
            return script !== undefined && isEachStepEngineScript(script);
        });
        EACH_STEP_ENGINE_MEMO.set(def, known);
    }
    return known;
}

const EACH_STEP_ENGINE_MEMO = new WeakMap<CardDefinition, boolean>();

/** One script-bearing site of a definition, in the shape every reader above
 *  takes: a script (real or shadow), per-mode scripts, or an imperative body
 *  the value model cannot walk. */
type ScriptSite = {
    effects?: EffectOp[];
    aiEffects?: EffectOp[];
    modes?: readonly ScriptSite[];
    resolve?: unknown;
    resolveSteps?: unknown;
    effect?: unknown;
};

/** The scripts of one site into `out`; FALSE when part of the site is an
 *  imperative body no script stands in for (a `resolve()`, `resolveSteps`,
 *  an activated `effect`, a mode closure) — an unread clause. */
function collectSiteScripts(site: ScriptSite, out: EffectOp[][]): boolean {
    const script = effectiveScript(site);
    if (script) {
        out.push(script);
        return true;
    }
    if (site.modes && site.modes.length > 0) {
        for (const mode of site.modes) {
            const modeScript = effectiveScript(mode);
            if (modeScript) out.push(modeScript);
            else if (mode.resolve !== undefined) return false;
        }
        return true;
    }
    return (
        site.resolve === undefined &&
        site.resolveSteps === undefined &&
        site.effect === undefined
    );
}

/** The Op nodes of a script at any nesting depth (structural constructs,
 *  scheduled bodies), in order. Walks plain data — an Effect Script is JSON
 *  by construction — and keeps only nodes naming an implemented Op, so a
 *  predicate node is never mistaken for one. */
function collectOps(node: unknown, out: EffectOp[]): void {
    if (Array.isArray(node)) {
        for (const n of node) collectOps(n, out);
        return;
    }
    if (node === null || typeof node !== "object") return;
    const op = (node as { op?: unknown }).op;
    if (typeof op === "string" && VALUED_OR_STRUCTURAL.has(op)) {
        out.push(node as EffectOp);
    }
    for (const n of Object.values(node)) collectOps(n, out);
}

/** Issue #5161 (ADR 0151) — a leaf Op whose `neutral` sign is not an
 *  unpriced stake: a binder (its reader carries the sign) or a `sacrifice` of
 *  the ability's OWN source, which the `sacrifice` valuer prices as
 *  `SAC_SELF_COST` (the pay-or-lose penalty of a cumulative upkeep or an
 *  echo). A sacrifice over picks — an edict, or a cost the controller wants
 *  to pay — stays neutral and keeps the floor.
 *
 *  A `pick-source` choice (CR 609.7a, issue #5601) is a binder too, and only
 *  that kind: the chooser freely names the source a following shield reads
 *  (`preventDamage` `"next-from-source"`), so the stake is the shield's. It
 *  keeps the Circle of Protection cycle exactly as complete as it was while
 *  a one-Op `aiEffects` shadow priced that same shield. The other free-pick
 *  kinds are not looked through: their readers are not one shape. */
function isPricedNeutralOp(op: EffectOp): boolean {
    if (BINDING_ONLY_OPS.has(op.op)) return true;
    if (op.op === "choice" && op.kind === "pick-source") return true;
    return (
        op.op === "sacrifice" &&
        op.permanents === undefined &&
        op.target !== undefined &&
        typeof op.target === "object" &&
        (op.target as { ref?: unknown }).ref === "$source"
    );
}

/** The `CardDefinition` keys the latent reading accounts for: identity and
 *  presentation (inert), the scripts it walks (spell, modes, abilities,
 *  delayed templates — an imperative body among them is caught per site),
 *  their target slots, and the AI-only hints. Every OTHER key a definition
 *  sets — a static effect, a replacement, a keyword, an alternative or
 *  additional cost, a mana substitution, a graveyard permission, … — carries
 *  a clause the hand face never prices, so the card is incomplete. An
 *  allowlist rather than a list of known unread fields (review, issue
 *  #5161): a mechanic field added tomorrow is unread until someone teaches
 *  the reader and adds it here, which is the fail-closed direction. */
const LATENT_READ_KEYS: ReadonlySet<string> = new Set([
    "id",
    "name",
    "rarity",
    "oracleText",
    "setCode",
    "imagePrintId",
    "imagePrintFace",
    "types",
    "subtypes",
    "supertypes",
    "manaCost",
    "power",
    "toughness",
    "effects",
    "aiEffects",
    "resolve",
    "resolveSteps",
    "effect",
    "modes",
    "modeSelection",
    "targetRequirement",
    "additionalTargetRequirements",
    "activatedAbilities",
    "triggeredAbilities",
    "delayedTriggers",
    "aiValue",
    "aiCombatHint",
]);

/** True when the definition sets a key outside {@link LATENT_READ_KEYS}. An
 *  empty array is no clause. */
function carriesUnreadField(def: CardDefinition): boolean {
    for (const [key, value] of Object.entries(def)) {
        if (value === undefined || LATENT_READ_KEYS.has(key)) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        return true;
    }
    return false;
}

/** An event-bound player reference (`$event.activePlayerId`,
 *  `$event.playerId`, …): the trigger acts on whichever player the event
 *  names — every player alike for an "each upkeep" or "whenever a player
 *  draws" trigger (Howling Mine, Bottomless Pit, Phyrexian Tyranny). The
 *  Symmetric Effect shape the `$each` test misses; fail-closed, so a
 *  "your upkeep" trigger naming its own active player is incomplete too. */
function readsEventPlayer(node: unknown): boolean {
    if (Array.isArray(node)) return node.some(readsEventPlayer);
    if (node === null || typeof node !== "object") return false;
    const ref = (node as { ref?: unknown }).ref;
    if (typeof ref === "string" && /^\$event\.\w*[pP]layerId$/.test(ref)) {
        return true;
    }
    return Object.values(node).some(readsEventPlayer);
}

/** A `forEach` selector that ranges over every player alike: the players
 *  themselves, or permanents with no `controller` narrowing. */
function isSymmetricSelector(select: unknown): boolean {
    const sel = select as { set?: unknown; controller?: unknown };
    return (
        sel.set === "players" ||
        (sel.set === "permanents" && sel.controller === undefined)
    );
}

function computeCompleteScript(def: CardDefinition): boolean {
    if (carriesUnreadField(def)) return false;
    const scripts: EffectOp[][] = [];
    if (!collectSiteScripts(def as ScriptSite, scripts)) return false;
    for (const ability of [
        ...(def.activatedAbilities ?? []).map((a) => ({
            site: a as ScriptSite,
            cost: a.cost as
                | {
                      sacrifice?: boolean;
                      exileThis?: boolean;
                      discardThis?: boolean;
                  }
                | undefined,
            activateFromHand: a.activateFromHand,
            etbAbility: undefined,
            mana: isManaAbilityDefinition(a),
        })),
        ...(def.triggeredAbilities ?? []).map((t) => ({
            site: t as ScriptSite,
            cost: undefined,
            activateFromHand: undefined,
            etbAbility: t.etbAbility,
            mana: t.manaAbility === true,
        })),
    ]) {
        // An ability the non-creature latent reading never prices — a mana
        // ability (the `mana` term's, and only on the battlefield), spent on
        // entering (an ETB Ability), consumed by its own cost, or hand-only
        // (`dslStandingAbilityScriptValue`'s exclusions) — is an unread
        // clause: the card keeps its floor. Skipping it instead would read a
        // mana rock as its drawback alone (review: Mana Crypt at −112).
        if (
            ability.mana ||
            ability.etbAbility === true ||
            ability.cost?.sacrifice === true ||
            ability.cost?.exileThis === true ||
            ability.cost?.discardThis === true ||
            ability.activateFromHand === true
        ) {
            return false;
        }
        if (!collectSiteScripts(ability.site, scripts)) return false;
    }
    // CR 603.7a — a template the reader prices is a script; one it skips (no
    // `effects[]`, or a body reading a scheduling-time capture) is an unread
    // clause, unless a shadow stands for the whole resolution
    // (`delayedTriggerTemplateOpValue`'s exclusions).
    if (def.delayedTriggers?.length && !carriesShadowScript(def)) {
        for (const template of def.delayedTriggers) {
            if (!template.effects?.length || readsBinding(template.effects)) {
                return false;
            }
            scripts.push(template.effects);
        }
    }
    if (readsEventPlayer(scripts)) return false;
    const ops: EffectOp[] = [];
    collectOps(scripts, ops);
    let leaves = 0;
    for (const op of ops) {
        // CR 101.4 — "each player" is a Symmetric Effect: its sign is the
        // board's (Differential Reading), never the representative member's.
        // A sweep over every player's permanents (no `controller` narrowing —
        // Armageddon, a wrath) is one too (ADR 0151 § Decision 1).
        if (op.op === "forEach" && isSymmetricSelector(op.select)) {
            return false;
        }
        if (STRUCTURAL_CONSTRUCTS.has(op.op)) continue;
        leaves++;
        if (isPricedNeutralOp(op)) continue;
        if (opBeneficence(op) === "neutral") return false;
    }
    return leaves > 0;
}

const completeScriptCache = new WeakMap<CardDefinition, boolean>();

/** Issue #5161 (ADR 0151) — is this definition a **Complete Script**: every
 *  Op of every script the latent reading walks (spell, modes, activated and
 *  triggered abilities, delayed templates) carries a declared beneficence
 *  (the issue #3006 census), none is an "each player" reference, and the
 *  definition carries no clause the reading cannot see? The condition under
 *  which `latentValue` trusts a context-free reading BELOW the Latent Floor
 *  (down to 0).
 *
 *  Fail-closed throughout: one `neutral` Op, one symmetric reference
 *  (`forEach` over players or every player's permanents, an `$event`
 *  player), one clause the reader cannot see (a definition field outside
 *  {@link LATENT_READ_KEYS}, an imperative body with no shadow, an ability
 *  the non-creature reading skips) and the answer is false — the
 *  floor stands, exactly as before. A definition with no Op at all is not
 *  complete (a blank card IS the floor). No per-Op flag and no definition
 *  field: declaring a beneficence row is the only way a script completes.
 *
 *  Memoized per definition object: it is read for every hand card at every
 *  search leaf, and a definition is immutable. */
export function isCompleteScript(def: CardDefinition): boolean {
    const cached = completeScriptCache.get(def);
    if (cached !== undefined) return cached;
    const complete = computeCompleteScript(def);
    completeScriptCache.set(def, complete);
    return complete;
}
