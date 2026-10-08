/**
 * Slot: an ALTERNATIVE COST line (CR 118.9) — a hand pitch, a land given up,
 * or a conditional free cast.
 *
 * "You may exile a blue card from your hand rather than pay this spell's mana
 * cost." / "You may discard an Island card and another card rather than pay
 * this spell's mana cost." — a printed line of its own, on instants, sorceries
 * and permanents alike, so it is a slot and not a branch of the spell slot
 * (whose guard refuses a permanent). It is paid as the spell is CAST
 * (CR 601.2b), never on resolution, which is why it is not an effect sentence.
 *
 * ── What is read ───────────────────────────────────────────────────────────
 *
 * Exactly the two HAND legs `CostLegs.hand` can pay (CR 701.9 discard /
 * CR 701.13 exile) in the two shapes the corpus prints:
 *
 *   - "exile a <colour> card from your hand"      (Force of Will family)
 *   - "discard an Island card and another card"   (Foil)
 *
 * the PERMANENT leg `CostLegs.permanent` pays (issue #4558):
 *
 *   - "sacrifice two Mountains"                   (Fireblast, CR 701.21a)
 *   - "return two Islands you control to their owner's hand" /
 *     "return an Island you control to its owner's hand"
 *                                                  (Gush, Daze, CR 400.3)
 *
 * and CR 118.9's other phrasing, "you may cast this spell without paying its
 * mana cost", on the one condition the corpus prints it with on a two-sided
 * board (the Mercadian Masques Legate cycle, Mogg Salvage):
 *
 *   - "If an opponent controls an Island and you control a Mountain, …"
 *
 * ── What is refused, and why ───────────────────────────────────────────────
 *
 * Everything else, fail-closed. In particular the neighbours the engine has no
 * surface for: an exile leg over the GRAVEYARD ("exile the top three black
 * cards of your graveyard" — `CostLegs` has no graveyard leg), a REVEAL cost
 * with a hand-contents condition ("If you have no land cards in hand, you may
 * reveal your hand" — `AlternativeCostCondition` has no such member), a
 * life-plus-pitch cost and a turn-gated one (separate printed forms, separate
 * gaps), every other free-cast condition ("If you control a commander"), and
 * a permanent leg whose count, noun and pronoun disagree ("two Mountain",
 * "an Island … their owner's hand") — a line we have misread.
 */

import {
    COLOR_WORDS,
    descriptorRule,
    permanentFilterFromDescriptor,
} from "../shared/targetFilter";
import { singularControlledFilter } from "../shared/condition";
import { readNumberWord } from "../shared/quantity";
import {
    fail,
    ok,
    rule,
    type Rule,
    type RuleContext,
    type RuleResult,
} from "../../rule";
import type { AlternativeCostIR, SlotIR } from "../ir";

export const ALTERNATIVE_COST_SLOT = "alternative-cost";

const ALTERNATIVE_COST =
    /^You may (.+) rather than pay this spell's mana cost\.$/;

/** CR 701.13 — "exile a <colour> card from your hand". */
const EXILE_COLOURED = /^exile an? (\w+) card from your hand$/;

/** CR 701.9 — Foil's two-requirement discard, Island first (see the greedy-
 *  ordering constraint on `CostLegs.hand`). */
const DISCARD_ISLAND_AND_CARD = "discard an Island card and another card";

function readBody(body: string): AlternativeCostIR | null {
    if (body === DISCARD_ISLAND_AND_CARD)
        return {
            id: "pitch-discard-island-and-card",
            description: "Discard an Island card and another card",
            hand: {
                action: "discard",
                requirements: [
                    { filter: { subtype: "Island" }, count: 1 },
                    { filter: {}, count: 1 },
                ],
            },
        };
    const exile = EXILE_COLOURED.exec(body);
    if (exile !== null) {
        const colour = COLOR_WORDS.get(exile[1]!);
        if (colour === undefined) return null;
        return {
            id: `pitch-exile-${exile[1]}`,
            description: `Exile ${body.slice("exile ".length)}`,
            hand: {
                action: "exile",
                requirements: [{ filter: { color: colour }, count: 1 }],
            },
        };
    }
    return null;
}

const SACRIFICE_LEG = /^sacrifice (\S+) (.+)$/;
const RETURN_LEG =
    /^return (\S+) (.+) you control to (its|their) owner's hand$/;
const FREE_CAST =
    /^If an opponent controls (.+?) and you control (.+), you may cast this spell without paying its mana cost\.$/;

/**
 * CR 701.21a / 400.3 — the permanent leg: "sacrifice two Mountains", "return
 * an Island you control to its owner's hand". The count word and the noun
 * must agree ("two Mountains", "an Island"), as must the pronoun ("its" for
 * one, "their" for several). The id names the action and the printed object
 * ("sacrifice-two-mountains", "return-an-island"); the description is the
 * clause as the caster reads it on the cast option.
 */
function readPermanentLeg(
    body: string,
    span: string,
    ctx: RuleContext
): RuleResult<AlternativeCostIR> {
    const sacrifice = SACRIFICE_LEG.exec(body);
    const returned = sacrifice === null ? RETURN_LEG.exec(body) : null;
    const match = sacrifice ?? returned;
    if (match === null)
        return fail(
            `"${body}" is not an alternative cost this grammar reads (CR 118.9)`,
            span
        );
    const count = readNumberWord(match[1]!);
    if (count === null) return fail(`"${match[1]}" is not a count`, span);
    if (returned !== null && (returned[3] === "its") !== (count === 1))
        return fail(
            `"${returned[3]} owner's hand" disagrees with the count`,
            span
        );
    const descriptor = descriptorRule.run(match[2]!, ctx);
    if (!descriptor.ok) return descriptor;
    if ((descriptor.value.plural === true) !== count > 1)
        return fail("the count and the noun disagree in number", span);
    // CR 701.21a — only a permanent the caster controls is sacrificed, and the
    // return leg already said "you control": a second controller clause is
    // refused by the converter.
    const filter = permanentFilterFromDescriptor(descriptor.value);
    if (!filter.ok) return filter;
    const action = sacrifice !== null ? "sacrifice" : "return";
    return ok({
        id: `${action}-${match[1]}-${match[2]}`
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-"),
        description: body.charAt(0).toUpperCase() + body.slice(1),
        permanent: { action, filter: filter.value, count },
    });
}

/**
 * CR 118.9 — "You may cast [this object] without paying its mana cost" on a
 * two-sided board condition, each side the same singular controls clause an
 * intervening "if" reads.
 */
function readFreeCast(
    match: RegExpExecArray,
    span: string,
    ctx: RuleContext
): RuleResult<AlternativeCostIR> {
    const theirs = singularControlledFilter(match[1]!, span, ctx);
    if (!theirs.ok) return theirs;
    const mine = singularControlledFilter(match[2]!, span, ctx);
    if (!mine.ok) return mine;
    return ok({
        id: "cast-without-paying",
        description: "Cast without paying its mana cost",
        condition: {
            kind: "all",
            of: [
                { kind: "opponent-control", filter: theirs.value },
                { kind: "control", filter: mine.value },
            ],
        },
    });
}

export const alternativeCostSlot: Rule<SlotIR> = rule<SlotIR>(
    ALTERNATIVE_COST_SLOT,
    (span, ctx) => {
        const free = FREE_CAST.exec(span);
        if (free !== null) {
            const cost = readFreeCast(free, span, ctx);
            return cost.ok
                ? ok({ kind: "alternative-cost" as const, cost: cost.value })
                : cost;
        }
        const match = ALTERNATIVE_COST.exec(span);
        if (match === null)
            return fail(`does not match ${ALTERNATIVE_COST_SLOT}`, span);
        const pitch = readBody(match[1]!);
        if (pitch !== null)
            return ok({ kind: "alternative-cost" as const, cost: pitch });
        const leg = readPermanentLeg(match[1]!, span, ctx);
        return leg.ok
            ? ok({ kind: "alternative-cost" as const, cost: leg.value })
            : leg;
    }
);
