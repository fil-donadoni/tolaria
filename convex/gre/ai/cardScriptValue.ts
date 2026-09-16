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
    PermanentView,
    TriggeredAbility,
} from "../../cards/types";
import {
    contextFreeGrounding,
    withGraveyardSource,
    withLatentLens,
    type GroundingContext,
    type LatentLens,
} from "./grounding";
import type { LatentWeights } from "./evalWeights";
import { valueEffectScript } from "./opValuers";
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

/** Ability scripts are conditional and often one-shot (an ETB, a tap ability),
 *  and the creature body already counts the permanent — so their script value
 *  is discounted before being added to the body (never doubled with it). */
const ABILITY_SCRIPT_DISCOUNT = 0.5;

/** True when any part of `value` reads a BINDING (`{ ref: "$x" }`) — the
 *  discriminator for a delayed-trigger template body whose subject is
 *  scheduling-time data rather than anything the reader can place
 *  (`delayedTriggerTemplateOpValue` below). Walks plain data only: an Effect
 *  Script is JSON by construction (`validateEffectScript`'s purity rule), so
 *  there is nothing else to descend into. */
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
    if (carriesShadowScript(def)) return undefined;
    let acc: OpValue | undefined;
    for (const template of def.delayedTriggers ?? []) {
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
 *  `case "if"` in `opValuers.ts`, which values a conditional branch at 1.0;
 *  `coinFlip`'s even-odds split is NOT the analogue (that is a genuinely
 *  random CR 705 outcome, where 0.5 is the true expectation).
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
 *  so the plain script reader above finds nothing. Value it the same way the
 *  `optionChoice` walker values a resolution-time modal: worth its BEST mode,
 *  since the chooser picks it (`opValuers.ts` `valueOp`). Modes authored as
 *  `resolve()` closures contribute nothing (no script to walk); `undefined`
 *  when NO mode carries a script, which keeps the `aiValue` / `base + MV`
 *  fallback for a fully-imperative modal card. */
function modesScriptOpValue(
    def: CardDefinition,
    ctx: GroundingContext
): OpValue | undefined {
    const modeScripts = (def.modes ?? [])
        .map((mode) => effectiveScript(mode))
        .filter((s): s is EffectOp[] => s !== undefined);
    if (modeScripts.length === 0) return undefined;
    let best: OpValue | undefined;
    for (const script of modeScripts) {
        const value = valueEffectScript(script, ctx);
        if (!best || value.points > best.points) best = value;
    }
    return best;
}

/** The best-mode `OpValue` of an ABILITY-site mode list (CR 700.2 / 603.3c) —
 *  the `AbilityMode` twin of `modesScriptOpValue` above. `undefined` when there
 *  are no modes, or when no mode carries a script (an all-`resolve()` modal
 *  ability contributes nothing, same convention as a modal spell's). */
function bestModeOpValue(
    modes: AbilityMode[] | undefined,
    ctx: GroundingContext
): OpValue | undefined {
    let best: OpValue | undefined;
    for (const mode of modes ?? []) {
        const script = effectiveScript(mode);
        if (!script) continue;
        const value = valueEffectScript(script, ctx);
        if (!best || value.points > best.points) best = value;
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
 *  with it a gate that reads the instance is answered exactly. */
export function dslAbilityScriptOpValue(
    def: CardDefinition,
    ctx: GroundingContext = contextFreeGrounding(),
    self?: PermanentView
): OpValue | undefined {
    let acc: OpValue | undefined;
    const abilities: {
        effects?: EffectOp[];
        aiEffects?: EffectOp[];
        modes?: AbilityMode[];
        gate?: TriggeredAbility["gate"];
        zone?: TriggeredAbility["zone"];
        activateFromGraveyard?: boolean;
    }[] = [
        ...(def.activatedAbilities ?? []),
        ...(def.triggeredAbilities ?? []),
    ];
    for (const ability of abilities) {
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
        const abilityCtx =
            ability.zone === "graveyard" ||
            ability.activateFromGraveyard === true
                ? withGraveyardSource(ctx)
                : ctx;
        const script = effectiveScript(ability);
        // CR 700.2 / 603.3c — a MODAL ability (activated, issue #1341; or
        // triggered, issue #2461) carries its resolution in per-mode scripts,
        // so the plain reader above finds nothing. Value it at its BEST mode,
        // exactly as `modesScriptOpValue` does for a modal SPELL: the announcer
        // picks the mode, so the ability is worth the arm they would pick. This
        // is what replaces a hand-written `aiEffects` shadow sketch of one arm.
        const raw = script
            ? valueEffectScript(script, abilityCtx)
            : bestModeOpValue(ability.modes, abilityCtx);
        if (!raw) continue;
        // CR 603.4 (issue #1936) — an ability that only fires under a
        // condition is not worth (or is not charged) its full script value.
        const weight = gateWeight(ability, self);
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
    self?: PermanentView
): number {
    return dslAbilityScriptOpValue(def, ctx, self)?.points ?? 0;
}

/** The merged, DISCOUNTED `{ points, tags }` of a card's activated + triggered
 *  ability scripts under `ctx` (context-free by default) — the LATENT
 *  (in-hand) sibling of `dslAbilityScriptOpValue`: same tags, points scaled by
 *  `ABILITY_SCRIPT_DISCOUNT` (tags are a membership fact, not a magnitude —
 *  discounting them makes no sense). `undefined` when the card has no
 *  ability scripts (same convention as the realized reader). */
export function dslLatentAbilityScriptOpValue(
    def: CardDefinition,
    ctx: GroundingContext = contextFreeGrounding()
): OpValue | undefined {
    const realized = dslAbilityScriptOpValue(def, ctx);
    if (!realized) return undefined;
    return {
        points: realized.points * ABILITY_SCRIPT_DISCOUNT,
        tags: realized.tags,
    };
}

/** The DSL ability-script value of a card's activated + triggered abilities
 *  (context-free by default), discounted and summed — the LATENT (in-hand)
 *  ability worth added to a creature's body by the `latentValue` precedence.
 *  Kept strictly below its realized (in-play) counterpart
 *  (`dslRealizedAbilityScriptValue`) by `ABILITY_SCRIPT_DISCOUNT < 1`, so a
 *  creature's latent worth stays below its realized board worth — casting a
 *  utility creature is strictly positive (issue #149, review #1440). 0 when
 *  the card has no ability scripts. */
export function dslAbilityScriptValue(
    def: CardDefinition,
    ctx: GroundingContext = contextFreeGrounding()
): number {
    return dslLatentAbilityScriptOpValue(def, ctx)?.points ?? 0;
}
