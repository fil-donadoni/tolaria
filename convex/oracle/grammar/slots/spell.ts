/**
 * Slot: instant and sorcery spell text (CR 113.3a).
 *
 * The one slot with no permanent behind it. An instant or sorcery has no
 * object on the battlefield to hang an ability on: its whole text is an
 * instruction carried out on resolution and then gone (CR 608.2n). So where
 * the activated slot lowers to an `ActivatedAbility` and the triggered slot to
 * a trigger descriptor, this one lowers onto the CARD — `effects[]`,
 * `targetRequirement`, `modes[]`, `additionalCosts`, `flashback`.
 *
 * ── Nothing here is a catch-all ────────────────────────────────────────────
 *
 * This is the slot a permissive compiler would make its fallback: "the card is
 * a sorcery, so whatever is left is spell text". That is precisely the shape
 * `rule.ts` and `grammar/router.ts` exist to forbid, and it would be worse
 * here than anywhere else, because a spell's text has no second surface to
 * contradict it — a half-read activated ability at least still costs mana to
 * activate, whereas a half-read sorcery simply does the wrong thing once and
 * is gone. So every line below is matched by an anchored, all-consuming rule
 * and the slot fails like every other.
 *
 * ── Four printed shapes, told apart by `oneOf` and not by order ────────────
 *
 * An instant or sorcery prints four kinds of line, and each is a rule of its
 * own rather than a branch of one:
 *
 *   1. the effect sentences themselves                    (CR 113.3a)
 *   2. a modal "Choose one —" bullet list                 (CR 700.2)
 *   3. "As an additional cost to cast this spell, …"      (CR 601.2f / 118.8)
 *   4. "Flashback [cost]"                                 (CR 702.34a)
 *
 * They are combined with `oneOf`, not with a prefix cascade. The four openings
 * are disjoint today, so a cascade would behave identically and cost less —
 * but `oneOf` is what makes that DISJOINTNESS a checked property instead of an
 * assumption: a fifth shape that overlaps an existing one fails the card
 * loudly, where a cascade would silently pick whichever rule was written
 * first. Slot order is presentational for the same reason the router's is.
 *
 * ── The modal line is a GROUP, not a line ──────────────────────────────────
 *
 * CR 700.2 prints a modal spell as an introductory clause plus a bulleted
 * list, which Scryfall newline-separates; `grammar/lineGroups.ts` reattaches
 * the bullets before routing. The parts are recovered here by splitting on
 * that separator — a split, so coverage is structural exactly as it is in
 * `listOf` (`parts.join(sep) === span`).
 *
 * ── The head decides the ARITY ─────────────────────────────────────────────
 *
 * Every printed head changes how many modes the caster announces, not what any
 * mode does, so a head lowers to a `ModeSelection` (absent = exactly one) or it
 * is refused: a head read as "choose one" would ship a spell that does less
 * than it says. `readModalHead` admits only the heads that have a golden
 * fixture; "Choose two —", "Choose one or both —", "Choose one or more —" stay
 * refused until a rule claims them.
 */

import {
    PERMANENT_TYPES,
    type Color,
    type ManaCost,
    type ModeSelection,
    type PermanentFilter,
} from "../../../cards/types";
import {
    fail,
    listOf,
    ok,
    oneOf,
    rule,
    terminated,
    type Rule,
    type RuleContext,
    type RuleResult,
} from "../../rule";
import { readManaCost } from "../../manaCost";
import { readNumberWord } from "../shared/quantity";
import type { ParseContext } from "../../types";
import type { Phase } from "../../../gre/types";
import { controlsRule } from "../shared/condition";
import { activationCostRule, type CostAtomIR } from "../shared/cost";
import {
    announcedTargetPronounRule,
    assembleSentences,
    assemblyTrace,
    comparativeSentenceRule,
    giftSentenceRule,
    kickedSentenceRule,
    sentenceRule,
    type SentenceIR,
} from "../shared/effectClause";
import {
    leadingGateSentenceRule,
    trailingGateSentenceRule,
} from "../shared/verbFrames";
import { BULLET, GROUP_SEPARATOR, PAWPRINT_MODE_LINE } from "../lineGroups";
import type { FlashbackCostIR, SlotIR, SpellModeIR } from "../ir";

export const SPELL_SLOT = "spell";

// ── 1. Plain spell text (CR 113.3a) ────────────────────────────────────────

/** The sentence list every ability site shares, assembled for a SPELL. */
function readSentences(
    sentences: readonly SentenceIR[]
):
    | { ok: true; effects: SpellModeIR["effects"] }
    | { ok: false; reason: string } {
    // CR 602.5 — a spell is cast, not activated, so there is no activation to
    // restrict; "Activate only as a sorcery." on a sorcery is a line misread.
    const assembled = assembleSentences(sentences, {
        site: "spell",
        rejectRestrictions:
            "an activation restriction (CR 602.5) has no meaning on a spell",
    });
    return assembled.ok
        ? { ok: true, effects: assembled.effects }
        : { ok: false, reason: assembled.reason };
}

/**
 * CR 702.33e — a spell sentence may be gated on the spell having been kicked
 * ("If this spell was kicked, draw two cards."). Composed HERE and not into
 * the shared sentence rule: "this spell" names an object only a spell site
 * has, and the kicker a gate reads is lowered from the card's own kicker line
 * (`lower.ts`), which no ability site sees. The trailing cast gate ("Draw a
 * card if an opponent has cast a blue spell this turn.") sits inside it: the
 * corpus prints it on spells alone, and so does the leading gate ("If you
 * control a Rabbit, scry 2."). The gift clauses (CR 702.174k) are the
 * spell's own promise, read off its gift line in the same way.
 */
const spellSentence: Rule<SentenceIR> = giftSentenceRule(
    kickedSentenceRule(
        leadingGateSentenceRule(
            comparativeSentenceRule(
                trailingGateSentenceRule(
                    announcedTargetPronounRule(sentenceRule)
                )
            )
        )
    )
);

const plainSpell: Rule<SlotIR> = terminated(
    ".",
    rule<SlotIR>("spell text", (span, ctx) => {
        const parsed = listOf("effect sentences", ". ", spellSentence).run(
            span,
            ctx
        );
        if (!parsed.ok) return parsed;
        const read = readSentences(parsed.value);
        if (!read.ok)
            return fail(
                read.reason,
                span,
                assemblyTrace(span, parsed.value.length)
            );
        return ok({ kind: "spell" as const, effects: read.effects });
    })
);

// ── 2. Modal spell text (CR 700.2) ─────────────────────────────────────────

/** "Choose one —": the absent `ModeSelection`, exactly one mode. */
const CHOOSE_ONE_HEAD = "Choose one —";

/** CR 700.2d — a fixed count of three, the same mode allowed more than once. */
const CHOOSE_THREE_REPEATS_HEAD =
    "Choose three. You may choose the same mode more than once.";

/**
 * "Choose one. If you control a Wizard as you cast this spell, you may choose
 * two instead." The "may" makes the holding count a RANGE of one to two, and
 * "as you cast" reads the board at announcement (CR 601.2b), which is where
 * `ModeSelection.when` is evaluated.
 */
const CONTROLS_MAY_CHOOSE_TWO_HEAD =
    /^Choose one\. If (you control .+) as you cast this spell, you may choose two instead\.$/;

/**
 * CR 700.2i / 107.18 — "Choose up to five {P} worth of modes. You may choose
 * the same mode more than once." The number is a {P} BUDGET, not a count: the
 * chosen modes' summed pawprints may not exceed it (`pawprintBudget`), and the
 * count's ceiling is the budget itself, every mode costing at least one {P}.
 * The repeat sentence is part of the head: without it the list would be
 * distinct modes, a form nothing prints and this rule does not read.
 *
 * CR 700.2i lets the controller choose "any number of modes", zero among
 * them; the announcement requires at least one (`min: 1`), as every modal
 * announcement does — the one simplification, a cast that would do nothing.
 */
const PAWPRINT_BUDGET_HEAD =
    /^Choose up to (\S+) \{P\} worth of modes\. You may choose the same mode more than once\.$/;

/** How a mode list prints its modes: bullets (CR 700.2) or pawprints (CR 700.2i). */
type ModeMarker = "bullet" | "pawprint";

/** The cardinality a modal head prints; `selection` absent = exactly one. */
function readModalHead(
    head: string,
    span: string,
    ctx: RuleContext
): RuleResult<{
    readonly selection?: ModeSelection;
    readonly marker?: ModeMarker;
}> {
    if (head === CHOOSE_ONE_HEAD) return ok({});
    const pawprint = head.match(PAWPRINT_BUDGET_HEAD);
    if (pawprint !== null) {
        const budget = readNumberWord(pawprint[1]!);
        if (budget === null || budget < 1)
            return fail(`"${pawprint[1]}" is not a {P} budget`, span);
        return ok({
            selection: {
                min: 1,
                max: budget,
                repeats: true,
                pawprintBudget: budget,
            },
            marker: "pawprint" as const,
        });
    }
    if (head === CHOOSE_THREE_REPEATS_HEAD)
        return ok({ selection: { min: 3, max: 3, repeats: true } });
    const conditional = head.match(CONTROLS_MAY_CHOOSE_TWO_HEAD);
    if (conditional === null)
        return fail(`"${head}" is not a modal head this grammar reads`, span);
    const controls = controlsRule.run(conditional[1]!, ctx);
    if (!controls.ok) return controls;
    return ok({
        selection: {
            min: 1,
            max: 1,
            when: {
                condition: { controls: controls.value.filter },
                min: 1,
                max: 2,
            },
        },
    });
}

/**
 * CR 700.2 — the bullet lines of a modal text, read as modes. Shared by the
 * modal spell and the modal triggered ability: a mode is the same sentence list
 * wherever its list is printed.
 */
export function readModeBullets(
    bullets: readonly string[],
    span: string,
    ctx: RuleContext
): RuleResult<SpellModeIR[]> {
    return readModeLines(bullets, "bullet", span, ctx);
}

/**
 * CR 700.2 / 700.2i — the mode lines of a modal text, each stripped of its
 * marker: "• " for a bulleted list, "{P}… — " for a pawprint list, whose
 * symbol count is the mode's weight. A list never mixes the two: a bullet
 * under a pawprint head (or the reverse) is refused, since the head's budget
 * or count would then misjudge a mode.
 */
function readModeLines(
    lines: readonly string[],
    marker: ModeMarker,
    span: string,
    ctx: RuleContext
): RuleResult<SpellModeIR[]> {
    // CR 700.2 — a mode list with fewer than two modes is not a choice; it is
    // a line whose bullets we failed to group.
    if (lines.length < 2)
        return fail("a modal spell needs at least two modes (CR 700.2)", span);

    const modes: SpellModeIR[] = [];
    for (const line of lines) {
        let body: string;
        let pawprints: number | undefined;
        if (marker === "bullet") {
            if (!line.startsWith(`${BULLET} `))
                return fail(`"${line}" is not a mode line`, span);
            body = line.slice(`${BULLET} `.length);
        } else {
            const paw = line.match(PAWPRINT_MODE_LINE);
            if (paw === null)
                return fail(`"${line}" is not a pawprint mode line`, span);
            // CR 107.18 — each {P} is three characters.
            pawprints = paw[1]!.length / "{P}".length;
            body = line.slice(paw[0].length);
        }
        const parsed = terminated(
            ".",
            listOf(
                "effect sentences",
                ". ",
                announcedTargetPronounRule(sentenceRule)
            )
        ).run(body, ctx);
        // The head and every mode read before this one are progress the
        // failure made: credited, so the gap names this mode's clause rather
        // than tying with a sentence reading that failed at the head.
        if (!parsed.ok)
            return parsed.trace === undefined
                ? parsed
                : {
                      ...parsed,
                      trace: {
                          ...parsed.trace,
                          progress: parsed.trace.progress + modes.length + 1,
                      },
                  };
        const read = readSentences(parsed.value);
        if (!read.ok)
            return fail(
                read.reason,
                span,
                assemblyTrace(body, parsed.value.length)
            );
        modes.push({
            // Without its full stop: `SpellModeIR.text` is the phrase, and the
            // lowering puts the stop back for the mode's `oracleText` while the
            // picker `label` wants it off. `terminated` above has already
            // proven the stop is there.
            text: body.slice(0, -1),
            effects: read.effects,
            ...(pawprints !== undefined ? { pawprints } : {}),
        });
    }
    // CR 700.2 — two modes printed identically would give the caster a choice
    // with no content, and is far likelier to mean the line was misgrouped.
    const texts = new Set(modes.map((m) => m.text));
    if (texts.size !== modes.length)
        return fail("a modal spell prints the same mode twice", span);
    return ok(modes);
}

const modalSpell: Rule<SlotIR> = rule<SlotIR>("modal spell", (span, ctx) => {
    const parts = span.split(GROUP_SEPARATOR);
    const head = readModalHead(parts[0]!, span, ctx);
    if (!head.ok) return head;
    const modes = readModeLines(
        parts.slice(1),
        head.value.marker ?? "bullet",
        span,
        ctx
    );
    if (!modes.ok) return modes;
    return ok({
        kind: "spell-modal" as const,
        modes: modes.value,
        ...(head.value.selection !== undefined
            ? { selection: head.value.selection }
            : {}),
    });
});

// ── 3. Additional costs (CR 601.2f / 118.8) ────────────────────────────────

const ADDITIONAL_COST_HEAD = "As an additional cost to cast this spell, ";

/**
 * "As an additional cost to cast this spell, [cost]."
 *
 * The cost half is the SAME sub-grammar an activation cost uses (CR 118.1
 * draws no distinction between the costs a spell and an ability may have), so
 * "sacrifice a creature", "discard a card" and "pay 3 life" are read here for
 * free. What is NOT free is the lowering: `CardDefinition.additionalCosts`
 * carries a strictly narrower vocabulary than `ActivatedAbility["cost"]`, and
 * `lowerSpell.ts` refuses every atom outside it rather than dropping it.
 *
 * The sentence is printed lowercase after the comma ("… , sacrifice a
 * creature"), where the cost atoms are written capitalised at an activation
 * site ("Sacrifice a creature: …"). Same atom, same rule, one capital —
 * re-capitalised here exactly as the triggered slot re-capitalises its tail.
 */
const additionalCostLine: Rule<SlotIR> = rule<SlotIR>(
    "additional cost",
    (span, ctx) => {
        if (!span.startsWith(ADDITIONAL_COST_HEAD))
            return fail("not an additional-cost line", span);
        const body = span.slice(ADDITIONAL_COST_HEAD.length);
        const parsed = terminated(
            ".",
            rule("additional cost atoms", (costSpan, costCtx) =>
                activationCostRule.run(
                    costSpan.charAt(0).toUpperCase() + costSpan.slice(1),
                    costCtx
                )
            )
        ).run(body, ctx);
        if (!parsed.ok) return parsed;
        return ok({ kind: "additional-cost" as const, cost: parsed.value });
    }
);

// ── 4. Flashback (CR 702.34a) ──────────────────────────────────────────────

const FLASHBACK_MANA = /^Flashback (\{.+\})$/;
const FLASHBACK_DASH_HEAD = "Flashback—";

/**
 * "Flashback {4}{R}" and "Flashback—Sacrifice a Mountain."
 *
 * Two printed shapes for one keyword (CR 702.34a): a bare mana cost, or an em
 * dash introducing a cost that has a non-mana component. The dashed form ends
 * in a full stop and the bare one does not — a typographic fact about how
 * Wizards prints the two, consumed structurally either way.
 *
 * The keyword-line slot cannot reach either: `Flashback` there is an exact
 * table lookup against the Mechanics Registry, and neither spelling IS the
 * name. That is the parameterised-keyword refusal working as designed
 * (`slots/keywordLine.ts`), and it is why this shape needs a rule at all.
 */
const flashbackLine: Rule<SlotIR> = rule<SlotIR>("flashback", (span, ctx) => {
    const bare = span.match(FLASHBACK_MANA);
    if (bare !== null) {
        const mana = readManaCost(bare[1]!);
        return mana.ok
            ? ok({
                  kind: "flashback" as const,
                  cost: { mana: mana.cost } satisfies FlashbackCostIR,
              })
            : fail(mana.reason, mana.fragment);
    }
    if (!span.startsWith(FLASHBACK_DASH_HEAD))
        return fail("not a flashback line", span);
    const parsed = terminated(".", activationCostRule).run(
        span.slice(FLASHBACK_DASH_HEAD.length),
        ctx
    );
    if (!parsed.ok) return parsed;
    const out: {
        mana?: ManaCost;
        sacrifice?: PermanentFilter;
        life?: number;
        exileXFromGraveyard?: { color?: Color };
        discard?: { count: number };
    } = {};
    for (const atom of parsed.value.atoms as readonly CostAtomIR[]) {
        if (atom.kind === "mana") {
            out.mana = atom.mana;
            continue;
        }
        // CR 702.34a flashback — of `FlashbackCost`'s two non-mana components, a CR 701.21a
        // sacrifice filter is the one this grammar can reach: the shared cost
        // sub-grammar has no exile-from-HAND atom, so `exileFromHand` has no
        // atom that could lower into it. Every other atom the shared cost
        // grammar can read has nowhere to go on the flashback cast path, and
        // an unpaid cost is an unbounded bug (see `shared/cost.ts`).
        if (atom.kind === "sacrifice-other" && atom.count === 1) {
            // `excludeSource` is resolved on activation costs only: refuse it.
            if (atom.filter.excludeSource === true)
                return fail(
                    "a flashback sacrifice excluding the source has no encoding",
                    span
                );
            out.sacrifice = atom.filter;
            continue;
        }
        // CR 702.34a / 119.4 — "Pay N life" (Deep Analysis): the flashback
        // cast path charges it with the mana, and refuses a cast the caster's
        // life total cannot cover (`FlashbackCost.life`).
        if (atom.kind === "pay-life") {
            out.life = atom.amount;
            continue;
        }
        // CR 702.34a / 107.3a — "Exile X blue cards from your graveyard"
        // (Flash of Insight): the cast path announces X and exiles that many.
        if (atom.kind === "exile-x-from-graveyard") {
            out.exileXFromGraveyard =
                atom.color === undefined ? {} : { color: atom.color };
            continue;
        }
        // CR 702.34a flashback, CR 701.9a discard — "Discard a card" (Twinned Vision): the cast
        // path joins it to the cast's one hand-cost picker. Exactly the printed
        // form — one card, any card; a typed or counted discard is a
        // neighbour no corpus flashback prints, refused.
        if (
            atom.kind === "discard" &&
            atom.count === 1 &&
            Object.keys(atom.filter).length === 0
        ) {
            out.discard = { count: 1 };
            continue;
        }
        return fail(
            `"${atom.kind}" is not a flashback cost component in grammar v0`,
            span
        );
    }
    return ok({
        kind: "flashback" as const,
        cost: out satisfies FlashbackCostIR,
    });
});

// ── 5. The casting window (CR 601.3) ───────────────────────────────────────

/**
 * CR 506.1 — the combat phase's steps, in order. A second combat damage step
 * (first strike, CR 510.4) is still a step of combat.
 */
const COMBAT_STEPS: readonly Phase[] = [
    "BEGINNING_OF_COMBAT",
    "DECLARE_ATTACKERS",
    "DECLARE_BLOCKERS",
    "FIRST_STRIKE_DAMAGE",
    "COMBAT_DAMAGE",
    "END_OF_COMBAT",
];

/**
 * CR 509.1 / 509.2 — blockers are declared as the declare blockers step
 * begins, before any player gets priority, so every priority window from that
 * step to the end of combat is "after blockers are declared".
 */
const AFTER_BLOCKERS_STEPS: readonly Phase[] = COMBAT_STEPS.slice(
    COMBAT_STEPS.indexOf("DECLARE_BLOCKERS")
);

/** Exact casting-window sentences, with the steps each one admits. */
const CAST_WINDOWS: ReadonlyMap<string, readonly Phase[]> = new Map([
    ["Cast this spell only during combat.", COMBAT_STEPS],
    [
        "Cast this spell only during combat after blockers are declared.",
        AFTER_BLOCKERS_STEPS,
    ],
]);

/**
 * CR 601.3 — "Cast this spell only during combat [after blockers are
 * declared]." A prohibition on beginning to cast the spell outside the
 * window, never an instruction it carries out on resolution. Anchored on the
 * whole line: "… before blockers are declared", "… on your turn" and every
 * other window stay refused under their own keys.
 */
const castWindowLine: Rule<SlotIR> = rule<SlotIR>("cast window", (span) => {
    const phases = CAST_WINDOWS.get(span);
    return phases === undefined
        ? fail("not a casting-window line", span)
        : ok({ kind: "cast-window" as const, phases: [...phases] });
});

// ── The slot ───────────────────────────────────────────────────────────────

const PERMANENT_TYPE_SET = new Set<string>(PERMANENT_TYPES);

const spellBody: Rule<SlotIR> = oneOf("spell line", [
    plainSpell,
    modalSpell,
    additionalCostLine,
    flashbackLine,
    castWindowLine,
]);

/**
 * CR 113.3a — spell text belongs to a card with no permanent side.
 *
 * The guard is the exact mirror of the activated slot's: that one refuses a
 * non-permanent because a cost that taps or sacrifices the source has no
 * meaning on an instant, and this one refuses a PERMANENT because a
 * permanent's text box holds abilities (CR 113.3b–d), not an instruction that
 * resolves once. Without it "Draw a card." would be read as spell text on a
 * creature that plainly does not say that, and every keyword-less permanent in
 * the corpus would become an ambiguity or a wrong reading.
 */
export const spellSlot: Rule<SlotIR> = rule<SlotIR>(SPELL_SLOT, (span, ctx) => {
    const context = ctx as ParseContext;
    if (context.typeLine.types.some((t) => PERMANENT_TYPE_SET.has(t)))
        return fail(
            "spell text on a permanent is not in grammar v0 (CR 113.3a)",
            span
        );
    return spellBody.run(span, ctx);
});
