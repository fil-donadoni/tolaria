/**
 * Slot: mana ability (CR 605.1a).
 *
 * Grammar v0 accepts an activated ability written, per CR 113.3b, as
 * "[Cost]: [Effect.]" whose effect is nothing but adding mana:
 *
 *     {T}: Add {G}.
 *     {T}: Add {C}{C}.
 *     {2}, {T}: Add {B} or {R}.
 *     {T}: Add {W}, {U}, or {B}.
 *     {T}: Add one mana of any color.
 *
 * ── Why the CR 605.1a criteria hold by construction ────────────────────────
 *
 * CR 605.1a makes an activated ability a mana ability iff it (a) does not
 * require a target, (b) could add mana on resolution, (c) is not a loyalty
 * ability, and (d) neither its cost nor its effect moves a card to or from a
 * library. Its only effect is "Add", so (b) holds and (a) cannot be violated —
 * "Add" takes no target. The COST is the shared activation-cost sub-grammar
 * (`grammar/shared/cost.ts`), which is what lets this slot read "Sacrifice a
 * Goblin: Add {R}" and "{T}, Pay 1 life: Add {B} or {R}"; every atom that
 * sub-grammar accepts pays with the tap symbol, mana, a permanent, life, a
 * card in hand, a counter or a card in a graveyard, and NONE of them touches a
 * library, so (d) holds, and none of them is a loyalty cost, so (c) does. The
 * classification is therefore still a property of the accepted language, not a
 * check applied to the output — which is why `useStack: false` (CR 605.3b: a
 * mana ability does not go on the stack) is safe to emit. A cost atom that
 * could move a card to or from a library would have to re-open this argument,
 * and the criterion is written out here so that it must be.
 *
 * The one rider that DOES move a card from a library is "Draw a card"
 * (`DRAW_RIDER`): the slot reads it, and `lowerManaAbility` lowers that line as
 * an ordinary stack ability instead, because (d) fails for it.
 *
 * ── What v0 deliberately refuses ───────────────────────────────────────────
 *
 * "Add three mana of any color" and "Add {G} for each Forest you control"
 * need a mana DESCRIPTOR the engine models with `manaColorSource` /
 * `getManaChoices` rather than with a fixed `ManaCost`, so the shared quantity
 * sub-grammar landing in #2697 is necessary but not sufficient for them. They
 * stay `unparsed`, not approximated: a quantity read as a constant is the
 * competitor's documented "for each collapsed to a constant" misparse.
 *
 * "Add one mana of any color" is the ONE member of that family the engine
 * needs no descriptor for (issue #4134): the offered set is the five colours
 * of mana, constant and board-independent (CR 106.1a), which is exactly the
 * `manaChoices` list the hand-written catalogue already ships for it (Birds of
 * Paradise, Phyrexian Altar, Celestial Prism). `anyColorProduction` below
 * reads it; every NEIGHBOUR that restricts or counts the set —
 * "…of any color that a land you control could produce" (board-derived,
 * `manaColorSource`), "…in your commander's color identity", "two mana of any
 * one color" — stays refused, because each needs a descriptor this rule does
 * not emit.
 *
 * The painland rider (`PAINLAND_RIDER` below, issue #3828) is scoped to the
 * literal "This land …" — the Talisman cycle prints the byte-identical shape
 * on "This artifact …" (`cards/abilities/index.ts`'s `makeTalisman`, whose own
 * comment calls out the shared shape) and stays unparsed here. Widening the
 * pattern to every self-referring noun (`grammar/shared/cost.ts`'s
 * `isSelfPhrase`) is the natural next slice — left for the corpus report to
 * rank rather than folded into this one, which is scoped to the land cycle
 * issue #3828 names.
 */

import { PERMANENT_TYPES } from "../../../cards/types";
import type { ManaCost } from "../../../cards/types";
import { readManaCost } from "../../manaCost";
import {
    fail,
    listOf,
    map,
    ok,
    oneOf,
    pair,
    rule,
    subGrammar,
    terminated,
    type Rule,
} from "../../rule";
import type { ParseContext } from "../../types";
import { COLORED_MANA_COLORS, MANA_COLORS } from "../../../gre/manaColors";
import { activationCostRule } from "../shared/cost";
import { forEachRule, readNumberWord } from "../shared/quantity";
import {
    boardManaFilterFromDescriptor,
    descriptorRule,
} from "../shared/targetFilter";
import type { ManaProductionIR, ManaRiderIR, SlotIR } from "../ir";

export const MANA_ABILITY_SLOT = "mana-ability";

/** A run of mana symbols, e.g. `"{G}"`, `"{C}{C}"`, `"{2}"` (CR 107.4). */
const manaSymbols: Rule<ManaCost> = rule("mana symbols", (span) => {
    const read = readManaCost(span);
    return read.ok ? ok(read.cost) : fail(read.reason, read.fragment);
});

const fixedProduction: Rule<ManaProductionIR> = map(manaSymbols, (mana) => ({
    kind: "fixed" as const,
    mana,
}));

/**
 * `"{B} or {R}"` / `"{W}, {U}, or {B}"`.
 *
 * The two shapes are told apart by a SYNTACTIC marker (`", or "`) rather than
 * by trying both and taking whichever matches first: `", or "` contains `" or "`
 * as a substring, so an `oneOf` over the two would report every three-way list
 * as ambiguous. Dispatching on the marker keeps the choice deterministic and
 * still leaves each branch all-consuming.
 */
const choiceProduction: Rule<ManaProductionIR> = rule(
    "mana choice",
    (span, ctx) => {
        const inner: Rule<ManaCost[]> = span.includes(", or ")
            ? pair(
                  "oxford mana list",
                  ", or ",
                  listOf("mana list head", ", ", manaSymbols, { min: 2 }),
                  manaSymbols,
                  (head, last) => [...head, last]
              )
            : pair("mana pair", " or ", manaSymbols, manaSymbols, (a, b) => [
                  a,
                  b,
              ]);
        const parsed = inner.run(span, ctx);
        if (!parsed.ok) return parsed;
        return ok({ kind: "choice" as const, options: parsed.value });
    }
);

/** The sub-grammar the attribution diagnostic names for this slot. */
export const MANA_PRODUCTION = "mana production";

/**
 * CR 106.1a — "one mana of any color": the five COLOURS of mana (not the six
 * types — colorless is not a colour), one of which the activating player picks
 * at activation. `ManaCost` objects are minted fresh per parse because the
 * lowering hands the array straight to `ActivatedAbility.manaChoices` and the
 * painland merge spreads it into a longer list; a module-level literal would
 * be one object shared by every compiled card.
 */
function anyColorOptions(): ManaCost[] {
    return [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }];
}

/**
 * CR 605.1a / 106.1a — "Add one mana of any color."
 *
 * Lowered as a CHOICE production, i.e. the same IR "Add {B} or {R}" produces,
 * because to the engine the two ARE the same thing: a list of `ManaCost`
 * options the activator picks from (`manaChoices`), which is how every
 * hand-written twin of this line already ships it. Sharing the IR node also
 * means the painland rider composes for free — "Add one mana of any color.
 * This land deals N damage to you." (Grand Coliseum, Tarnished Citadel) is
 * read by `addEffect`'s existing rider branch, which fires only on a choice.
 *
 * Fail-closed on the exact span: anything AFTER "color" restricts the offered
 * set (a board-derived filter, a commander's colour identity) or counts it,
 * and would need a descriptor this rule does not emit — refused, with the
 * neighbours pinned by `manaAnyColor.test.ts`.
 */
const ANY_COLOR_SPAN = "one mana of any color";

const anyColorProduction: Rule<ManaProductionIR> = rule(
    "mana any color",
    (span) =>
        span === ANY_COLOR_SPAN
            ? ok({ kind: "choice" as const, options: anyColorOptions() })
            : fail(`production is not "${ANY_COLOR_SPAN}"`, span)
);

/**
 * CR 106.1a / 605.1a — "Add three mana of any one color" (Lion's Eye Diamond,
 * Diamond Lion): the activator picks ONE of the five colours and all three
 * mana are that colour, i.e. a CHOICE production whose options are the five
 * triples `{W:3} … {G:3}` — exactly the `manaChoices` list the hand-written
 * twin ships. "three mana of any color" (each mana picked separately) and
 * other counts are different mana descriptors and stay refused.
 */
const ANY_ONE_COLOR_TRIPLE_SPAN = "three mana of any one color";

const anyOneColorTripleProduction: Rule<ManaProductionIR> = rule(
    "mana three of any one color",
    (span) =>
        span === ANY_ONE_COLOR_TRIPLE_SPAN
            ? ok({
                  kind: "choice" as const,
                  options: COLORED_MANA_COLORS.map(
                      (c) => ({ [c]: 3 }) as ManaCost
                  ),
              })
            : fail(`production is not "${ANY_ONE_COLOR_TRIPLE_SPAN}"`, span)
);

/**
 * CR 608.2h / 605.1a — "{G} for each creature you control", "{G} for each Elf
 * on the battlefield" (Gaea's Cradle, Serra's Sanctum, Priest of Titania):
 * one unit of mana per permanent the descriptor names when the ability
 * resolves, lowered to `manaAmountSource` (issue #5195) — never to a constant,
 * which is the "for each collapsed to a constant" misparse `quantity.ts`'s
 * header names.
 *
 * The descriptor is `forEachRule`'s, read whole, and its clauses are the
 * engine's to evaluate: `boardManaFilterFromDescriptor` refuses every clause
 * the board-derived filter cannot carry. Two scopes and only two: "you
 * control" (CR 109.5), and "on the battlefield" (CR 109.2 — every player's
 * permanents, so it may carry no controller clause of its own).
 *
 * The unit is ONE mana of ONE type: the engine scales `manaProduced` and every
 * single-colour consumer reads `mana[color]` off it.
 */
const FOR_EACH = " for each ";
const ON_THE_BATTLEFIELD = " on the battlefield";

const forEachProduction: Rule<ManaProductionIR> = rule(
    "mana for each",
    (span, ctx) => {
        const at = span.indexOf(FOR_EACH);
        if (at === -1)
            return fail('production is not "<mana> for each …"', span);
        const unit = manaSymbols.run(span.slice(0, at), ctx);
        if (!unit.ok) return unit;
        const produced = Object.entries(unit.value).filter(
            ([, n]) => n !== undefined
        );
        if (
            produced.length !== 1 ||
            !(MANA_COLORS as readonly string[]).includes(produced[0]![0]) ||
            produced[0]![1] !== 1
        )
            return fail(
                "a for-each unit is one mana of one type",
                span.slice(0, at)
            );
        let counted = span.slice(at + 1);
        const wholeBoard = counted.endsWith(ON_THE_BATTLEFIELD);
        if (wholeBoard) counted = counted.slice(0, -ON_THE_BATTLEFIELD.length);
        const each = forEachRule.run(counted, ctx);
        if (!each.ok) return each;
        if (each.value.kind !== "for-each")
            return fail("not a counted set of permanents", counted);
        const filter = boardManaFilterFromDescriptor(
            each.value.per,
            wholeBoard ? "wholeBoard" : "you"
        );
        if (!filter.ok) return filter;
        return ok({
            kind: "for-each" as const,
            unit: unit.value,
            filter: filter.value,
        });
    }
);

/**
 * CR 106.7 — "one mana of any type that a land you control could produce"
 * (Reflecting Pool, Naga Vitalist): the offered set is every TYPE of mana the
 * described permanents could produce when the ability resolves, colourless
 * included (CR 106.1b), lowered to a `manaColorSource` with the
 * `"producesType"` read (issue #5195).
 *
 * Only the TYPE read: "any COLOR that a land an opponent controls could
 * produce" (Fellwar Stone) is the same descriptor with `"produces"`, a
 * neighbour this rule refuses rather than reads — it stays its own gap.
 */
const ANY_TYPE_THAT = /^one mana of any type that an? (.+) could produce$/;

const boardChoiceProduction: Rule<ManaProductionIR> = rule(
    "mana any type a permanent could produce",
    (span, ctx) => {
        const m = ANY_TYPE_THAT.exec(span);
        if (m === null)
            return fail(
                'production is not "one mana of any type that … could produce"',
                span
            );
        const descriptor = descriptorRule.run(m[1]!, ctx);
        if (!descriptor.ok) return descriptor;
        if (descriptor.value.plural === true)
            return fail(
                '"a … could produce" names a singular descriptor',
                m[1]!
            );
        const filter = boardManaFilterFromDescriptor(descriptor.value, "you");
        if (!filter.ok) return filter;
        return ok({
            kind: "board-choice" as const,
            read: "type" as const,
            filter: filter.value,
        });
    }
);

const production: Rule<ManaProductionIR> = subGrammar(
    MANA_PRODUCTION,
    oneOf(MANA_PRODUCTION, [
        fixedProduction,
        choiceProduction,
        anyColorProduction,
        anyOneColorTripleProduction,
        forEachProduction,
        boardChoiceProduction,
    ])
);

/**
 * The attribution sub-grammar of a sentence AFTER a production that parsed —
 * "{T}: Add {R}. This land deals 1 damage to you." (issue #3822). The slot has
 * no rider sentences at all, so the production refuses the whole remainder;
 * the missing rule is the rider, and the diagnostic says so.
 */
export const MANA_ABILITY_RIDER = "mana ability rider";

/**
 * CR 605.1a — "This land deals N damage to you", the painland cycle's rider on
 * a CHOICE production (Adarkar Wastes, the enemy painlands — issue #3828):
 * `cards/types.ts`'s `dealsDamageToControllerOnColoredTap`, fired only on the
 * coloured pick. The identical sentence after a FIXED production is the
 * unconditional `dealsDamageToControllerOnTap` (Ancient Tomb) — a different
 * field this rule does not read; a FIXED production is refused the rider by
 * `addEffect` below rather than by this pattern.
 */
const PAINLAND_RIDER = /^This land deals (\S+) damage to you$/;

function readPainlandDamage(span: string): number | null {
    const m = PAINLAND_RIDER.exec(span);
    if (m === null) return null;
    const damage = readNumberWord(m[1]!);
    // "Deals 0 damage" is not a printed sentence, and the field it would
    // write is a no-op the engine silently accepts — stay fail-closed rather
    // than emit a rider with no effect.
    return damage !== null && damage > 0 ? damage : null;
}

/**
 * CR 121.1 / 605.1a — "Draw a card" after a production (Chromatic Sphere and
 * the Invasion eggs). A draw moves a card from a library, so the line is not a
 * mana ability: `lowerManaAbility` lowers it to a stack ability. Scoped to ONE
 * card: "Draw two cards" is a different count no printed ability needs.
 */
const DRAW_RIDER = "Draw a card";

/**
 * CR 602.5b — "Activate only once each turn." after a production (Wall of
 * Roots): the ability's own `oncePerTurn` gate, checked at activation.
 */
const ONCE_PER_TURN_RIDER = "Activate only once each turn";

/**
 * CR 605.3a — "Activate only as an instant." (Lion's Eye Diamond): a mana
 * ability is activatable any time its controller has priority or is paying a
 * cost, so the restriction is already the engine's behaviour and lowers to no
 * field. Read, not skipped, so the sentence is accounted for.
 */
const INSTANT_ONLY_RIDER = "Activate only as an instant";

/**
 * CR 122.1 / 701.21a — "If there are no depletion counters on this land,
 * sacrifice it", the Mercadian Masques depletion lands' second sentence
 * (`sacrificesSourceWhenNoCountersRemain`). The counter kind is read, not
 * assumed (Gemstone Mine prints "mining"); `lowerManaAbility` ties it to the
 * cost's own counter leg.
 */
const NO_COUNTERS_SACRIFICE_RIDER =
    /^If there are no (\S+) counters on this land, sacrifice it$/;

/**
 * CR 502.3 / 605.1a — "During your next untap step, as you untap your
 * permanents, return this land to its owner's hand" (Undiscovered Paradise):
 * the return is part of the activator's next untap turn-based action, armed
 * by the stackless mana-ability script (`manaAbilityEffects`,
 * `returnToHandAtNextUntap`; issue #5509). Read as one fixed sentence: the
 * object is the land itself, the hand its owner's, the step its activator's.
 */
const NEXT_UNTAP_RETURN_RIDER =
    "During your next untap step, as you untap your permanents, return this land to its owner's hand";

/**
 * CR 605.1a — the rider sentence after a production this grammar reads, for
 * the production it follows. Fail-closed: the sentence must be one of the
 * four printed forms below; the painland damage form is owned by the CHOICE
 * production (`readPainlandDamage`), the unconditional form by the FIXED one.
 */
function readManaRider(
    head: ManaProductionIR,
    span: string
): ManaProductionIR | null {
    const rider = ((): ManaRiderIR | null => {
        if (span === DRAW_RIDER) return { kind: "draw-card" };
        if (span === ONCE_PER_TURN_RIDER) return { kind: "once-per-turn" };
        if (span === INSTANT_ONLY_RIDER) return { kind: "instant-only" };
        if (span === NEXT_UNTAP_RETURN_RIDER)
            return { kind: "return-source-at-next-untap" };
        const sacrifice = NO_COUNTERS_SACRIFICE_RIDER.exec(span);
        if (sacrifice !== null)
            return {
                kind: "sacrifice-without-counters",
                counter: sacrifice[1]!,
            };
        if (head.kind === "fixed") {
            const damage = readPainlandDamage(span);
            if (damage !== null)
                return { kind: "damage-to-controller", amount: damage };
        }
        return null;
    })();
    if (rider === null) return null;
    return { ...head, riders: [rider] };
}

/** CR 106.1 / 605.1a — the effect half: "Add <mana>". */
const addEffect: Rule<ManaProductionIR> = rule("add effect", (span, ctx) => {
    if (!span.startsWith("Add "))
        return fail('effect does not begin with "Add "', span);
    const body = span.slice("Add ".length);
    const r = production.run(body, ctx);
    if (r.ok) return r;
    // Verdict and reason are the production's; only the blame moves, and only
    // when the first sentence alone is a production this grammar reads.
    const stop = body.indexOf(". ");
    if (stop === -1) return r;
    const head = production.run(body.slice(0, stop), ctx);
    if (!head.ok) return r;
    const riderSpan = body.slice(stop + ". ".length);
    if (head.value.kind === "choice") {
        const damage = readPainlandDamage(riderSpan);
        if (damage !== null)
            return ok({
                ...head.value,
                dealsDamageToControllerOnColoredTap: damage,
            });
    }
    const withRider = readManaRider(head.value, riderSpan);
    if (withRider !== null) return ok(withRider);
    return fail(r.reason, r.fragment, {
        path: [MANA_ABILITY_RIDER],
        span: riderSpan,
        progress: 1,
    });
});

const manaAbilityBody: Rule<SlotIR> = pair(
    MANA_ABILITY_SLOT,
    ": ",
    activationCostRule,
    addEffect,
    (cost, produces) => ({ kind: "mana-ability" as const, cost, produces })
);

const PERMANENT_TYPE_SET = new Set<string>(PERMANENT_TYPES);

/**
 * CR 113.3b — the sentence ends in a full stop, which belongs to the ability.
 *
 * The slot additionally refuses any card that is not a permanent: an activated
 * ability whose cost taps something has no meaning on an instant or sorcery.
 *
 * (Lands with a basic land type are refused a level up, in `compile.ts` — the
 * reason is about the card, not about this line, and their text is usually pure
 * reminder text that never reaches a slot at all.)
 */
export const manaAbilitySlot: Rule<SlotIR> = rule(
    MANA_ABILITY_SLOT,
    (span, ctx) => {
        const context = ctx as ParseContext;
        if (!context.typeLine.types.some((t) => PERMANENT_TYPE_SET.has(t))) {
            return fail("a mana ability needs a permanent (CR 605.1a)", span);
        }
        return terminated(".", manaAbilityBody).run(span, ctx);
    }
);
