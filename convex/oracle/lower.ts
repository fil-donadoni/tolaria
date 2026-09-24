/**
 * Lowering — intermediate form → `CardDefinition` fields.
 *
 * The second place a clause can go missing. A grammar can consume a line
 * perfectly and then lower only half of what it understood, and the result
 * looks exactly like a correct compile. Two things stop that here:
 *
 *  1. `lowerLine` switches on `SlotIR["kind"]` with an exhaustiveness check, so
 *     a slot that has no lowering is a TYPE ERROR at build time rather than a
 *     silently ignored ability at run time.
 *  2. Every field it writes is derived from the whole IR node. There is no
 *     "take the first keyword" or "take the first mana option" anywhere below —
 *     the IR nodes carry lists, and the lists are lowered whole.
 */

import type {
    ActivatedAbility,
    CardDefinition,
    EffectOp,
    KickerCost,
    ManaCost,
    SpellMode,
    TargetRequirement,
} from "../cards/types";
import type { CompiledStaticEffect } from "../cards/compiledStatics";
import type { CompiledTriggeredAbility } from "../cards/compiledTriggers";
import { lowerActivatedAbility, lowerManaAbility } from "./lowerActivated";
import {
    lowerAdditionalCosts,
    lowerFlashback,
    lowerKickers,
    lowerSpellBody,
    lowerSpellModes,
} from "./lowerSpell";
import {
    isDefinitionLevelKeyword,
    lowerStaticClause,
    type LoweredStatic,
} from "./lowerStatic";
import type { HostNoun } from "./grammar/shared/staticClause";
import { destroysEveryLand } from "./lowerEffects";
import { lowerTriggeredAbility } from "./lowerTriggered";
import { sortKeys } from "./gates";
import { readManaCost } from "./manaCost";
import type { CompiledDefinition, OracleCard, ParsedTypeLine } from "./types";
import type { LineParse, SlotIR } from "./grammar/ir";
import type { EffectSentenceIR } from "./grammar/shared/effectClause";
import { keywordVocabulary } from "./grammar/shared/keywordVocabulary";
import { CREATURE_SUBTYPES } from "./grammar/shared/subtypes";

export type LowerResult =
    | {
          readonly ok: true;
          readonly definition: CompiledDefinition;
          readonly plannedMechanics: readonly string[];
          readonly ungrantableKeywords: readonly string[];
      }
    | {
          readonly ok: false;
          readonly reason: string;
          readonly fragment: string;
      };

/** Deterministic, stable ability ids — the catalogue's own `<card>-mana` shape. */
export function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

interface Accumulator {
    staticAbilities: string[];
    activatedAbilities: ActivatedAbility[];
    compiledTriggeredAbilities: CompiledTriggeredAbility[];
    compiledStaticEffects: CompiledStaticEffect[];
    entersTapped: boolean;
    drawStepReplacement: boolean;
    shuffleFromAnywhere: boolean;
    /** CR 614.12a — the "as this enters, choose a creature type" lines read. */
    asEntersCreatureTypeLines: string[];
    entersWithCounters: {
        type: string;
        count: number | "kicker" | { additionalCostPaid: string };
    }[];
    /** CR 702.33e — how each kicker-counted entry rider reads the tally, and
     *  (CR 702.33f) which one kicker a "with its {A} kicker" rider names. */
    kickerRiders: {
        per: "kicked" | "each-kick";
        line: string;
        kickerId?: string;
    }[];
    /** CR 702.33a — the card's kicker costs, lowered BEFORE every other line
     *  so a line that reads a kicker back can name it (see `lowerCard`). */
    kickers?: KickerCost[];
    plannedMechanics: string[];
    ungrantableKeywords: string[];
    /** CR 113.3a — the spell site: ONE resolution body per card, however
     *  many Oracle lines print it (see `lowerLine`). */
    spellEffects?: EffectOp[];
    /** CR 608.2c — every spell-text sentence read so far, in printed order;
     *  `spellEffects` is always this list lowered as one body. */
    spellSentences?: EffectSentenceIR[];
    spellTargetRequirement?: TargetRequirement;
    /** CR 115.3 — the spell's SECOND and later target groups ("… Another
     *  target creature gets -2/-2"), chosen after the primary one. */
    spellAdditionalTargetRequirements?: TargetRequirement[];
    /** CR 702.33g — the announcement a kicked cast swaps in. */
    spellKickedTargetRequirement?: TargetRequirement;
    /** CR 702.5a — the Aura's printed enchant restriction, at most one. */
    enchantRequirement?: TargetRequirement;
    /** CR 303.4b — every "enchanted <noun>" a static line named, checked
     *  against `enchantRequirement` once every line is read. */
    hostNouns: HostNoun[];
    /** CR 113.1a — abilities granted in quotation marks, by template id. */
    grantTemplates: ActivatedAbility[];
    /** CR 113.1a / 614.1c — the TRIGGERED twin of `grantTemplates` above, as
     *  compiled descriptors (see `CardDefinition.compiledTriggeredGrantTemplates`). */
    triggeredGrantTemplates: CompiledTriggeredAbility[];
    /** CR 702.16n — "This effect doesn't remove this Aura." */
    exemptFromProtectionDetach?: true;
    /** Every id this card has handed out, so a second one is never minted. */
    mintedIds: Set<string>;
    spellModes?: SpellMode[];
    additionalCosts?: NonNullable<CardDefinition["additionalCosts"]>;
    flashback?: NonNullable<CardDefinition["flashback"]>;
}

/**
 * CR 702.1 / #962 — census the keywords an effect SENTENCE grants.
 *
 * The mirror of what `lowerStatic.ts` does for a `keyword-grant` static
 * clause, and it exists for the same reason: `status: "implemented"` is the
 * only thing standing between a grant and a card that resolves and does
 * nothing. Guard A polices `staticAbilities[]`, which a `grantAbility` Op
 * never touches — the grant writes the TARGET instance's abilities at
 * resolution — so nothing else in the pipeline asks the question.
 *
 * Called from every slot whose IR carries effect sentences, rather than from
 * `lowerSentence`, because the census is a CARD-level tally (`plannedMechanics`
 * quarantines the card, not the ability) and routing it through the per-Op
 * lowering would mean threading an accumulator through three call sites to
 * reach the same list.
 */
function censusGrantedKeywords(
    effects: readonly EffectSentenceIR[],
    acc: Accumulator
): void {
    for (const outer of effects) {
        // A WRAPPER (`optional`, `kicked`) gates its inner sentence without
        // changing what it grants, so the census reads through it — a grant
        // behind "If this spell was kicked," is still a grant.
        let sentence = outer;
        while (sentence.kind === "optional" || sentence.kind === "kicked")
            sentence = sentence.effect;
        // "Choose a color. … gain protection from the chosen color …" grants
        // the SAME base keyword ("protection") as the parameterised
        // `grant-ability` case below, just five times over — one per colour
        // mode — so it is censused against the same registry row rather than
        // against a `keyword` field it carries none of.
        if (sentence.kind === "choose-color-grant-protection") {
            const protection = keywordVocabulary().get("protection");
            if (protection !== undefined && protection.status !== "implemented")
                acc.plannedMechanics.push("protection");
            continue;
        }
        if (sentence.kind !== "grant-ability") continue;
        const { ability, status } = sentence.keyword;
        if (status !== "implemented") acc.plannedMechanics.push(ability);
        // CR 702.1 — a keyword whose behaviour comes from an ADR 0054
        // definition-level expander produces NOTHING when granted to another
        // permanent, because the expander never reads the target instance's
        // `staticAbilities` (issue #2700).
        else if (isDefinitionLevelKeyword(ability))
            acc.ungrantableKeywords.push(ability);
    }
}

/**
 * CR 605.1a — the painland cycle prints TWO mana abilities ("{T}: Add {C}."
 * then "{T}: Add <c1> or <c2>. This land deals 1 damage to you.", issue
 * #3828) that the hand-written catalogue models as ONE `manaChoices` ability
 * whose first option is the painless colourless tap and whose coloured
 * options carry `dealsDamageToControllerOnColoredTap` (Adarkar Wastes,
 * `cards/sets/ice/colorless.ts`). Two abilities sharing an activation cost are
 * the same choice to a player who can pay that cost only once, so folding the
 * colourless line into the very next coloured-choice-with-rider line that
 * shares its cost changes no behaviour — it reproduces the shape the
 * catalogue already ships, which is what lets those cards round-trip
 * (Guard C).
 *
 * `prior` must be EXACTLY what this `case`'s own fixed-production branch
 * constructs below — no other field, and no colour in `manaProduced` — so the
 * merge never reaches for a hand-authored ability this compiler did not just
 * build; a card printing "{T}: Add {C}." as its ONLY mana line is untouched.
 */
const FIXED_MANA_ABILITY_KEYS: ReadonlySet<string> = new Set([
    "id",
    "oracleText",
    "cost",
    "useStack",
    "manaProduced",
]);

function isPainlessColorlessTap(ability: ActivatedAbility): boolean {
    const mana = ability.manaProduced;
    return (
        ability.useStack === false &&
        mana !== undefined &&
        mana.C !== undefined &&
        Object.keys(mana).every((k) => k === "C") &&
        Object.keys(ability).every((k) => FIXED_MANA_ABILITY_KEYS.has(k))
    );
}

function sameCost(
    a: ActivatedAbility["cost"],
    b: ActivatedAbility["cost"]
): boolean {
    return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

/** A card-unique id: `base`, then `base-2`, `base-3` … on reuse. */
function mintId(acc: Accumulator, base: string): string {
    let id = base;
    for (let n = 2; acc.mintedIds.has(id); n++) id = `${base}-${n}`;
    acc.mintedIds.add(id);
    return id;
}

/**
 * CR 113.1a — an ability granted in quotation marks, lowered into the
 * template the `activated-grant` / `triggered-grant` descriptor names.
 *
 * "This creature" inside the quote is the HOST, because the ability is the
 * host's (the engine resolves a granted ability with the host as its source —
 * `StaticActivatedGrant` / `StaticTriggeredGrant`), and the ordinary `$source`
 * lowering already says exactly that. The census a printed ability pays is
 * paid here too.
 *
 * A TRIGGERED grant (CR 614.1c — Necravolver's "… and with 'Whenever this
 * creature deals damage, you gain that much life.'") lowers to a
 * `CompiledTriggeredAbility` DESCRIPTOR, not a real `TriggeredAbility`:
 * `matches` is a required closure and the compiler emits JSON only (see
 * `compiledTriggeredAbilities`'s own doc comment) — the descriptor is
 * rebuilt at the `expandDefinition` seam by `expandCompiledTriggers`, through
 * the SAME `resolveCompiledTrigger` a printed trigger uses.
 */
function lowerQuotedAbility(
    quoted: NonNullable<LoweredStatic["quotedAbilities"]>[number],
    card: OracleCard,
    acc: Accumulator
):
    | { ok: true; kind: "activated"; ability: ActivatedAbility }
    | { ok: true; kind: "triggered"; ability: CompiledTriggeredAbility }
    | { ok: false; reason: string } {
    const ir = quoted.ability;
    if (ir.kind === "mana-ability") {
        const lowered = lowerManaAbility({
            id: quoted.id,
            oracleText: quoted.text,
            cost: ir.cost,
            produces: ir.produces,
        });
        return lowered.ok
            ? { ok: true, kind: "activated", ability: lowered.ability }
            : lowered;
    }
    if (ir.kind === "triggered") {
        censusGrantedKeywords(ir.effects, acc);
        const lowered = lowerTriggeredAbility({
            id: quoted.id,
            oracleText: quoted.text,
            cardName: card.name,
            head: ir.head,
            ...(ir.condition !== undefined ? { condition: ir.condition } : {}),
            effects: ir.effects,
        });
        return lowered.ok
            ? { ok: true, kind: "triggered", ability: lowered.ability }
            : lowered;
    }
    censusGrantedKeywords(ir.effects, acc);
    const lowered = lowerActivatedAbility({
        id: quoted.id,
        oracleText: quoted.text,
        cardName: card.name,
        cost: ir.cost,
        effects: ir.effects,
        restrictions: ir.restrictions,
    });
    return lowered.ok
        ? { ok: true, kind: "activated", ability: lowered.ability }
        : lowered;
}

function lowerLine(
    parsed: LineParse,
    card: OracleCard,
    acc: Accumulator
): string | null {
    const ir: SlotIR = parsed.ir;
    switch (ir.kind) {
        case "keywords": {
            for (const kw of ir.keywords) {
                acc.staticAbilities.push(kw.ability);
                // CR 702.1 — a keyword IS its rule; if the engine does not
                // implement it, the card would ship silently inert (the Guard A
                // shape, #962). Recorded, then quarantined by the gates.
                if (kw.status !== "implemented")
                    acc.plannedMechanics.push(kw.ability);
            }
            return null;
        }
        case "kicker":
            // Lowered by `lowerCard`'s pre-pass, before any line that reads
            // it back — see there.
            return null;
        case "enchant": {
            // CR 702.5c — several instances of enchant all apply, but the
            // engine reads ONE printed restriction off `targetRequirement`;
            // merging two into it would keep one and drop the other.
            if (acc.enchantRequirement !== undefined)
                return "a card declares enchant twice (CR 702.5c)";
            acc.enchantRequirement = ir.requirement;
            return null;
        }
        case "mana-ability": {
            const index = acc.activatedAbilities.length;
            const id =
                index === 0
                    ? `${slugify(card.name)}-mana`
                    : `${slugify(card.name)}-mana-${index + 1}`;
            const lowered = lowerManaAbility({
                id,
                oracleText: parsed.line,
                cost: ir.cost,
                produces: ir.produces,
            });
            if (!lowered.ok) return lowered.reason;
            const ability = lowered.ability;
            // See `isPainlessColorlessTap`'s doc comment — the painland merge.
            if (
                ir.produces.kind === "choice" &&
                ir.produces.dealsDamageToControllerOnColoredTap !== undefined
            ) {
                const prior =
                    acc.activatedAbilities[acc.activatedAbilities.length - 1];
                if (
                    prior !== undefined &&
                    isPainlessColorlessTap(prior) &&
                    sameCost(prior.cost, ability.cost)
                ) {
                    const colorless = prior.manaProduced!;
                    delete prior.manaProduced;
                    prior.manaChoices = [
                        colorless,
                        ...(ir.produces.options as ManaCost[]),
                    ];
                    prior.dealsDamageToControllerOnColoredTap =
                        ir.produces.dealsDamageToControllerOnColoredTap;
                    prior.oracleText = `${prior.oracleText}\n${parsed.line}`;
                    return null;
                }
            }
            acc.activatedAbilities.push(ability);
            return null;
        }
        case "activated": {
            const index = acc.activatedAbilities.length;
            const id =
                index === 0
                    ? `${slugify(card.name)}-ability`
                    : `${slugify(card.name)}-ability-${index + 1}`;
            censusGrantedKeywords(ir.effects, acc);
            const lowered = lowerActivatedAbility({
                id,
                oracleText: parsed.line,
                cardName: card.name,
                cost: ir.cost,
                effects: ir.effects,
                restrictions: ir.restrictions,
            });
            if (!lowered.ok) return lowered.reason;
            acc.activatedAbilities.push(lowered.ability);
            return null;
        }
        case "triggered": {
            const index = acc.compiledTriggeredAbilities.length;
            const id =
                index === 0
                    ? `${slugify(card.name)}-trigger`
                    : `${slugify(card.name)}-trigger-${index + 1}`;
            censusGrantedKeywords(ir.effects, acc);
            const lowered = lowerTriggeredAbility({
                id,
                oracleText: parsed.line,
                cardName: card.name,
                head: ir.head,
                ...(ir.condition !== undefined
                    ? { condition: ir.condition }
                    : {}),
                effects: ir.effects,
                ...(acc.kickers !== undefined ? { kickers: acc.kickers } : {}),
            });
            if (!lowered.ok) return lowered.reason;
            acc.compiledTriggeredAbilities.push(lowered.ability);
            return null;
        }
        case "static": {
            const slug = slugify(card.name);
            const lowered = lowerStaticClause(
                ir.clause,
                parsed.line,
                (suffix) => mintId(acc, `${slug}-${suffix}`),
                acc.kickers
            );
            if (!lowered.ok) return lowered.reason;
            const out = lowered.lowered;
            // CR 113.1a — a granted ability is lowered by the SAME function a
            // printed one is, so a quoted ability is exactly as well read as
            // the line it would be if it were printed on the host. Lowered
            // BEFORE anything is committed to `acc`, so a refusal here leaves
            // the card with no half-applied line.
            const templates: ActivatedAbility[] = [];
            const triggeredTemplates: CompiledTriggeredAbility[] = [];
            for (const quoted of out.quotedAbilities ?? []) {
                const template = lowerQuotedAbility(quoted, card, acc);
                if (!template.ok) return template.reason;
                if (template.kind === "triggered")
                    triggeredTemplates.push(template.ability);
                else templates.push(template.ability);
            }
            if (templates.length > 0) acc.grantTemplates.push(...templates);
            if (triggeredTemplates.length > 0)
                acc.triggeredGrantTemplates.push(...triggeredTemplates);
            acc.compiledStaticEffects.push(...(out.effects ?? []));
            if (out.host !== undefined) acc.hostNouns.push(out.host);
            if (out.exemptFromProtectionDetach === true)
                acc.exemptFromProtectionDetach = true;
            // CR 702.1 — see `lowerStatic.ts`: a granted keyword is censused
            // exactly like a printed one, so an unimplemented grant
            // quarantines instead of shipping an inert card.
            for (const granted of out.grantedKeywords ?? [])
                if (!granted.implemented)
                    acc.plannedMechanics.push(granted.ability);
            acc.ungrantableKeywords.push(...(out.ungrantableKeywords ?? []));
            if (out.entersTapped === true) acc.entersTapped = true;
            if (out.drawStepReplacement === true)
                acc.drawStepReplacement = true;
            if (out.shuffleFromAnywhere === true)
                acc.shuffleFromAnywhere = true;
            if (out.asEntersCreatureType === true) {
                // Two such lines are two choices; `entersWith.asEnters` would
                // ask both, but "the chosen type" (CR 607.2d) could no longer
                // say which one it reads — refuse rather than guess.
                if (acc.asEntersCreatureTypeLines.length > 0)
                    return "a card declares an as-enters creature-type choice twice";
                acc.asEntersCreatureTypeLines.push(parsed.line);
            }
            if (out.entersWithCounters !== undefined)
                acc.entersWithCounters.push(out.entersWithCounters);
            if (out.kickerCounters !== undefined) {
                // Same-type entries SUM, so a second rider reading the SAME
                // payment would add to the first silently — a sign a line was
                // misread, as a marker named twice is. The one printed shape
                // with two is CR 702.33f's: each rider names a DIFFERENT one
                // of the card's kickers ("with its {1}{U} kicker" / "with its
                // {B} kicker", the Apocalypse Volvers), so each reads its own
                // payment record and the sums are the printed ones.
                const kickerId = out.kickerCounters.kickerId;
                if (
                    acc.kickerRiders.some(
                        (r) =>
                            r.kickerId === undefined ||
                            kickerId === undefined ||
                            r.kickerId === kickerId
                    )
                )
                    return "a card declares a kicked entry rider twice";
                acc.entersWithCounters.push(...out.kickerCounters.counters);
                acc.kickerRiders.push({
                    per: out.kickerCounters.per,
                    line: parsed.line,
                    ...(kickerId !== undefined ? { kickerId } : {}),
                });
            }
            if (out.staticAbility !== undefined) {
                // The same duplicate check the keyword-line slot pays: a
                // marker named twice on one card is a sign a line was misread,
                // not something to silently dedupe.
                if (acc.staticAbilities.includes(out.staticAbility))
                    return `"${out.staticAbility}" is declared twice on one card`;
                acc.staticAbilities.push(out.staticAbility);
            }
            return null;
        }
        case "spell": {
            // CR 113.3a / 608.2c — a spell has ONE resolution body, and its
            // controller follows the instructions "in the order written". An
            // Oracle paragraph break ("Destroy target artifact.\nDraw a
            // card.") is layout, not a second spell: every spell-text line is
            // one more run of sentences in that single body. Each line routed
            // here was consumed WHOLE by the spell slot, so appending it
            // cannot swallow an unread clause.
            //
            // The body is re-lowered from the whole prefix on every line, not
            // line by line: the sentence walk carries referents and target
            // slots ACROSS sentences ("it", a second "target" becoming slot
            // 1), and a failure is charged to the line whose sentences broke
            // it — the same fragment a single-line card reports.
            if (acc.spellModes !== undefined)
                return "a card declares spell text twice (CR 113.3a)";
            censusGrantedKeywords(ir.effects, acc);
            const sentences = [...(acc.spellSentences ?? []), ...ir.effects];
            const body = lowerSpellBody(sentences, {
                // CR 107.3 — a spell announces X for the `{X}` pip in its own
                // printed mana cost, and only then. Judged HERE because it is
                // a fact about the cost rather than about the sentence
                // (`lowerEffects.ts` — `SiteOptions`).
                allowX: hasVariableX(card.manaCost),
                selfName: card.name,
                ...(acc.kickers !== undefined ? { kickers: acc.kickers } : {}),
            });
            if (!body.ok) return body.reason;
            acc.spellSentences = sentences;
            acc.spellEffects = body.value.effects;
            if (body.value.targetRequirement !== undefined)
                acc.spellTargetRequirement = body.value.targetRequirement;
            if (body.value.additionalTargetRequirements !== undefined)
                acc.spellAdditionalTargetRequirements =
                    body.value.additionalTargetRequirements;
            if (body.value.kickedTargetRequirement !== undefined)
                acc.spellKickedTargetRequirement =
                    body.value.kickedTargetRequirement;
            return null;
        }
        case "spell-modal": {
            if (acc.spellEffects !== undefined || acc.spellModes !== undefined)
                return "a card declares spell text twice (CR 113.3a)";
            for (const mode of ir.modes)
                censusGrantedKeywords(mode.effects, acc);
            const modes = lowerSpellModes(
                ir.modes,
                { slug: slugify(card.name), name: card.name },
                {
                    allowX: hasVariableX(card.manaCost),
                    selfName: card.name,
                    ...(acc.kickers !== undefined
                        ? { kickers: acc.kickers }
                        : {}),
                }
            );
            if (!modes.ok) return modes.reason;
            acc.spellModes = modes.value;
            return null;
        }
        case "additional-cost": {
            // CR 601.2f — two additional-cost lines would both be paid, and
            // merging them into one `additionalCosts` record would silently
            // drop whichever field the second reuses.
            if (acc.additionalCosts !== undefined)
                return "a card declares an additional cost twice (CR 601.2f)";
            const costs = lowerAdditionalCosts(ir.cost.atoms);
            if (!costs.ok) return costs.reason;
            acc.additionalCosts = costs.value;
            return null;
        }
        case "flashback": {
            if (acc.flashback !== undefined)
                return "a card declares flashback twice (CR 702.34a)";
            const flashback = lowerFlashback(ir.cost);
            if (!flashback.ok) return flashback.reason;
            acc.flashback = flashback.value;
            return null;
        }
        default: {
            const never: never = ir;
            return `no lowering for slot IR ${JSON.stringify(never)}`;
        }
    }
}

/**
 * CR 107.3 — does the printed mana cost announce a value for {X}?
 *
 * Read off the RAW printed string rather than the parsed `ManaCost`, because
 * the parse happens later (and can fail) while this question is asked as each
 * line is lowered. `readManaCost` writes a variable pip as `X: "X"`; the
 * printed form is the literal symbol, and nothing else in a cost string
 * contains it.
 */
function hasVariableX(printedManaCost: string): boolean {
    return printedManaCost.includes("{X}");
}

/** CR 208.1 — power/toughness are printed numbers; `*` is a CDA (#2700). */
function readPt(
    value: string | undefined,
    what: string
): number | { error: string } {
    if (value === undefined)
        return { error: `creature has no printed ${what}` };
    if (!/^-?\d+$/.test(value))
        return { error: `non-numeric ${what} "${value}"` };
    return Number(value);
}

export function lowerCard(
    card: OracleCard,
    typeLine: ParsedTypeLine,
    lines: readonly LineParse[]
): LowerResult {
    const acc: Accumulator = {
        staticAbilities: [],
        activatedAbilities: [],
        compiledTriggeredAbilities: [],
        compiledStaticEffects: [],
        entersTapped: false,
        drawStepReplacement: false,
        shuffleFromAnywhere: false,
        asEntersCreatureTypeLines: [],
        entersWithCounters: [],
        kickerRiders: [],
        plannedMechanics: [],
        ungrantableKeywords: [],
        hostNouns: [],
        grantTemplates: [],
        triggeredGrantTemplates: [],
        mintedIds: new Set(),
    };
    // CR 702.33e — a kicker's linked abilities "can refer only to those
    // specific kicker … abilities" printed on the same object, so every line
    // that reads one back needs the card's kicker list, ids assigned. Lowered
    // first, in its own pass, so the answer never depends on line order.
    const kickerLines = lines.filter((line) => line.ir.kind === "kicker");
    if (kickerLines.length > 1)
        return {
            ok: false,
            reason: "a card declares kicker on two lines (one kicker line per card, the catalogue convention)",
            fragment: kickerLines[1]!.line,
        };
    const kickerLine = kickerLines[0];
    if (kickerLine !== undefined && kickerLine.ir.kind === "kicker") {
        const kickers = lowerKickers(kickerLine.ir.kickers);
        if (!kickers.ok)
            return {
                ok: false,
                reason: kickers.reason,
                fragment: kickerLine.line,
            };
        acc.kickers = kickers.value;
    }
    for (const line of lines) {
        const err = lowerLine(line, card, acc);
        if (err !== null)
            return { ok: false, reason: err, fragment: line.line };
    }

    const definition: CompiledDefinition = {
        name: card.name,
        types: [...typeLine.types],
    };
    if (typeLine.supertypes.length > 0)
        definition.supertypes = [...typeLine.supertypes];
    if (typeLine.subtypes.length > 0)
        definition.subtypes = [...typeLine.subtypes];

    if (card.manaCost.trim().length > 0) {
        const cost = readManaCost(card.manaCost);
        if (!cost.ok)
            return { ok: false, reason: cost.reason, fragment: cost.fragment };
        definition.manaCost = cost.cost;
    }

    if (typeLine.types.includes("Creature")) {
        const power = readPt(card.power, "power");
        if (typeof power !== "number")
            return { ok: false, reason: power.error, fragment: card.typeLine };
        const toughness = readPt(card.toughness, "toughness");
        if (typeof toughness !== "number")
            return {
                ok: false,
                reason: toughness.error,
                fragment: card.typeLine,
            };
        definition.power = power;
        definition.toughness = toughness;
    }
    if (typeLine.types.includes("Planeswalker")) {
        const loyalty = readPt(card.loyalty, "loyalty");
        if (typeof loyalty !== "number")
            return {
                ok: false,
                reason: loyalty.error,
                fragment: card.typeLine,
            };
        definition.loyalty = loyalty;
    }

    if (card.oracleText.length > 0) definition.oracleText = card.oracleText;
    if (acc.staticAbilities.length > 0)
        definition.staticAbilities = acc.staticAbilities;
    if (acc.activatedAbilities.length > 0)
        definition.activatedAbilities = acc.activatedAbilities;
    // CR 113.3c — descriptors, not abilities: the seam rebuilds them
    // (`cards/compiledTriggers.ts`). Nothing downstream of the compiler ever
    // sees this field — `expandDefinition` consumes it.
    if (acc.compiledTriggeredAbilities.length > 0)
        definition.compiledTriggeredAbilities = acc.compiledTriggeredAbilities;
    // CR 611 — descriptors, not effects, for the same reason as the triggers
    // above: `StaticEffect` is a predicate closure and the compiler emits JSON
    // (`cards/compiledStatics.ts`). `expandDefinition` consumes the field.
    if (acc.compiledStaticEffects.length > 0)
        definition.compiledStaticEffects = acc.compiledStaticEffects;
    // CR 614.1c / 122.1 — entry riders, applied AS the permanent enters. Never
    // a continuous effect and never a trigger (issue #1693).
    if (acc.entersTapped) definition.entersTapped = true;
    // CR 614.10 — "Skip your draw step" is a replacement effect the phase code
    // reads off the definition, never a trigger and never a continuous effect.
    if (acc.drawStepReplacement) definition.drawStepReplacement = true;
    // CR 614.1a — a replacement is a closure; the compiler emits the flag and
    // `expandDefinition` rebuilds the `replacementEffects[]` entry from it.
    if (acc.shuffleFromAnywhere) definition.shuffleFromAnywhere = true;
    // CR 702.33d — `count: "kicker"` reads how many times the spell was
    // kicked. "If this creature was kicked, it enters with N counters" means
    // 0 or N, which that tally gives only for a lone, single kicker: a second
    // kicker or Multikicker would multiply the counters. "For each time it
    // was kicked" is the tally itself, and needs only a kicker to count.
    // A rider naming its kicker (CR 702.33f) reads that kicker's own payment
    // record, already resolved against this card's kicker line in lowering.
    const rider = acc.kickerRiders.find((r) => r.kickerId === undefined);
    if (rider !== undefined) {
        const kickers = acc.kickers ?? [];
        if (kickers.length === 0)
            return {
                ok: false,
                reason: "a kicked entry rider on a card that prints no kicker (CR 702.33e)",
                fragment: rider.line,
            };
        if (
            rider.per === "kicked" &&
            (kickers.length !== 1 || kickers[0]!.multi === true)
        )
            return {
                ok: false,
                reason: '"if it was kicked" counted by the kicker tally needs exactly one single kicker (CR 702.33d)',
                fragment: rider.line,
            };
    }
    if (acc.kickers !== undefined) definition.kickers = acc.kickers;
    if (
        acc.entersWithCounters.length > 0 ||
        acc.asEntersCreatureTypeLines.length > 0
    )
        definition.entersWith = {
            ...(acc.entersWithCounters.length > 0
                ? { counters: acc.entersWithCounters }
                : {}),
            // CR 614.12a / 205.3m — the whole creature-type list, the shape
            // the hand-written catalogue declares (Brass Herald).
            ...(acc.asEntersCreatureTypeLines.length > 0
                ? {
                      asEnters: [
                          {
                              kind: "subtypes" as const,
                              from: [...CREATURE_SUBTYPES],
                              count: 1,
                          },
                      ],
                  }
                : {}),
        };
    // CR 113.3a — the spell site. `modes` and `effects` are mutually exclusive
    // by construction (one `lowerLine` case writes each, and a line of the
    // other kind fails the card), which is also what `validateEffectScript`
    // asserts. Several plain spell-text lines are ONE `effects` body.
    // CR 601.2f / 702.34a — an additional cost and a flashback cost are RIDERS
    // on casting the spell; neither is a spell. A card that consumed one and
    // no body line is a card whose effect line we failed to read while
    // reporting success, so it fails rather than compiling to a castable spell
    // that does nothing. (No corpus card reaches this today — it is the
    // invariant, not a fix.)
    // A kicker (CR 702.33a) on an instant or sorcery is the same kind of
    // rider; on a permanent it rides the permanent spell, which has no text
    // of its own to lose.
    const isSpellCard =
        typeLine.types.includes("Instant") ||
        typeLine.types.includes("Sorcery");
    if (
        (acc.additionalCosts !== undefined ||
            acc.flashback !== undefined ||
            (acc.kickers !== undefined && isSpellCard)) &&
        acc.spellEffects === undefined &&
        acc.spellModes === undefined
    )
        return {
            ok: false,
            reason: "a cast-time cost rider with no spell text to ride on",
            fragment: card.oracleText,
        };
    // CR 303.4b — "enchanted <noun>" is the Aura's host. A card that says it
    // without an enchant line has no host we read, and a noun its enchant
    // restriction can never satisfy ("Enchant land" + "Enchanted creature")
    // names an object the Aura cannot be attached to — both misreads.
    if (acc.hostNouns.length > 0) {
        const requirement = acc.enchantRequirement;
        if (requirement === undefined)
            return {
                ok: false,
                reason: '"enchanted" on a card with no enchant line (CR 303.4b)',
                fragment: card.oracleText,
            };
        const enchantable = Array.isArray(requirement.type)
            ? requirement.type
            : [requirement.type];
        const stranger = acc.hostNouns.find(
            (noun) => noun !== "permanent" && !enchantable.includes(noun)
        );
        if (stranger !== undefined)
            return {
                ok: false,
                reason: `"enchanted ${stranger.toLowerCase()}" on an Aura that cannot enchant one (CR 303.4b)`,
                fragment: card.oracleText,
            };
    }
    if (acc.grantTemplates.length > 0)
        definition.grantTemplates = acc.grantTemplates;
    if (acc.triggeredGrantTemplates.length > 0)
        definition.compiledTriggeredGrantTemplates =
            acc.triggeredGrantTemplates;
    if (acc.exemptFromProtectionDetach === true)
        definition.exemptFromProtectionDetach = true;
    if (acc.enchantRequirement !== undefined) {
        // CR 702.5a / 303.4a — enchant restricts an AURA; on any other object
        // it restricts nothing the engine would ever ask about, so a card that
        // reads as one is a card whose type line or text we misread.
        if (!typeLine.subtypes.includes("Aura"))
            return {
                ok: false,
                reason: "enchant on an object that is not an Aura (CR 702.5a)",
                fragment: card.typeLine,
            };
        // The same card-level field carries a spell's announced target; an
        // Aura with spell text as well would have two claims on it.
        //
        // Issue #4220 — the ADDITIONAL list is checked too. `declareTargets`
        // leaves `targetRequirement` undefined when the spell's first group is
        // kicker-gated (CR 702.33g), so an Aura whose only target sits inside
        // the gate would slip past a primary-only check: the enchant
        // restriction would take slot 0 and shift the gated group to slot 1,
        // while the compiled script's gated op still reads `{ target: 0 }`.
        // Emitting a wrong definition is the one thing a fail-closed compiler
        // may not do, so the refusal covers both claims. UNREACHABLE today
        // and untestable through the compiler: the spell slot refuses "If
        // this spell was kicked, …" on an Aura type line two layers earlier,
        // and the corpus holds no Aura that is kicked AND targets. Kept for
        // the same reason `castAdjustedTargetRequirement`'s morph branch is —
        // this states a fact about the RULE, not about today's corpus.
        if (
            acc.spellTargetRequirement !== undefined ||
            acc.spellAdditionalTargetRequirements !== undefined
        )
            return {
                ok: false,
                reason: "an Aura's enchant restriction and a spell target both claim targetRequirement",
                fragment: card.oracleText,
            };
        definition.targetRequirement = acc.enchantRequirement;
    }
    if (acc.spellEffects !== undefined) {
        definition.effects = acc.spellEffects;
        if (destroysEveryLand(acc.spellEffects))
            definition.destroysAllLands = true;
    }
    if (acc.spellTargetRequirement !== undefined)
        definition.targetRequirement = acc.spellTargetRequirement;
    if (acc.spellAdditionalTargetRequirements !== undefined)
        definition.additionalTargetRequirements =
            acc.spellAdditionalTargetRequirements;
    if (acc.spellKickedTargetRequirement !== undefined)
        definition.kickedTargetRequirement = acc.spellKickedTargetRequirement;
    if (acc.spellModes !== undefined) definition.modes = acc.spellModes;
    if (acc.additionalCosts !== undefined)
        definition.additionalCosts = acc.additionalCosts;
    if (acc.flashback !== undefined) definition.flashback = acc.flashback;

    return {
        ok: true,
        definition,
        plannedMechanics: acc.plannedMechanics,
        ungrantableKeywords: acc.ungrantableKeywords,
    };
}
