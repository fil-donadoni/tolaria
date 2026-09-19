/**
 * Shared sub-grammar: EFFECT SENTENCES (CR 113.3b, CR 608.2).
 *
 * One Oracle sentence → one `EffectSentenceIR`. The IR stays in the sentence's
 * own vocabulary ("pump", "bounce") rather than in the interpreter's, for the
 * reason `ir.ts` gives: "did we understand the sentence?" and "how does the
 * engine encode it?" are separate questions with separate failure modes, and
 * collapsing them means a lowering bug reads as a parse bug.
 *
 * ── What a sentence may NOT do here ────────────────────────────────────────
 *
 * Every rule below consumes a WHOLE sentence. There is no "leading verb wins"
 * dispatch and no optional trailing group: "Destroy target creature" and
 * "Destroy target creature at the beginning of the next end step" differ by a
 * clause that changes when the effect happens, and a grammar that matched the
 * first inside the second would be the competitor's largest documented misparse
 * bucket reproduced exactly.
 *
 * ── Anaphora ───────────────────────────────────────────────────────────────
 *
 * "It", "that creature", "that player" are refused, with ONE exception that is
 * not really anaphora at all: "It can't be regenerated." is a MODIFIER of the
 * destroy sentence it follows (CR 701.19c on regenerate), carrying no referent
 * of its own, and it is parsed as such — a modifier that finds no destroy in front of it fails
 * the line rather than being dropped.
 */

import type { TargetRequirement } from "../../../cards/types";
import type { KeywordIR } from "../ir";
import type { Phase } from "../../../gre/types";
import {
    fail,
    ok,
    rule,
    type FailureTrace,
    type Rule,
    subGrammar,
} from "../../rule";
import { keywordVocabulary } from "./keywordVocabulary";
import { durationRule, type DurationIR } from "./duration";
import { playerRefRule, type PlayerRefIR } from "./playerRef";
import { readNumberWord } from "./quantity";
import { isSelfPhrase } from "./cost";
import { SELF_MARKER } from "../../normalize";
import {
    controlsRule,
    kickedConditionRule,
    type ConditionIR,
    type KickedRefIR,
} from "./condition";
import { targetFilterRule } from "./targetFilter";
import { zoneRefRule, type ZoneRefIR } from "./zoneRef";
import { CREATURE_SUBTYPES } from "./subtypes";
import { createTokenRule, type CreateTokenIR } from "./tokenSpec";

export const EFFECT_CLAUSE = "effect clause";

/**
 * CR 107.3 — an effect's MAGNITUDE: a printed number, or the announced {X}.
 *
 * `X` is read by the GRAMMAR wherever a count word is read, and refused by the
 * LOWERING at every site whose source has no `{X}` pip to announce
 * (`lowerEffects.ts` — `lowerAmount`). The split is deliberate: whether the
 * word "X" appears is a fact about the sentence, whereas whether an X was
 * announced is a fact about the COST, which lives on the card and on the
 * ability, not in this span. Reading it here and judging it there keeps a
 * "deals X damage" line on a card with no {X} an honest `unparsed` rather than
 * a card that deals zero.
 */
export type AmountIR =
    | { readonly kind: "fixed"; readonly value: number }
    | { readonly kind: "x" };

/** A count word at an effect site: a cardinal, or CR 107.3's `X`. */
export function readAmount(word: string): AmountIR | null {
    if (word === "X") return { kind: "x" };
    const fixed = readNumberWord(word);
    return fixed === null ? null : { kind: "fixed", value: fixed };
}

/** Who or what a sentence acts on (CR 109.2, CR 115.1). */
export type SubjectIR =
    /** The object the ability is printed on (CR 109.2). */
    | { readonly kind: "self" }
    /** An announced target (CR 115.1) — object OR player. */
    | { readonly kind: "target"; readonly requirement: TargetRequirement }
    /** A player named without targeting (CR 109.5 — "you"). */
    | { readonly kind: "player"; readonly player: PlayerRefIR }
    /**
     * CR 400.7e / 608.2h — "that card": anaphora for the card a zone change
     * put somewhere. Read here, bound by the lowering SITE (a dies trigger,
     * issue #4127); a site that names no card refuses the line.
     */
    | { readonly kind: "that-card" };

export type EffectSentenceIR =
    | {
          readonly kind: "pump";
          readonly subject: SubjectIR;
          readonly power: number;
          readonly toughness: number;
          readonly duration: DurationIR;
      }
    | {
          /**
           * CR 613.1f — a keyword granted until end of turn.
           *
           * Carries the whole Mechanics Registry row rather than just the
           * name, because the name alone cannot answer the Guard A question
           * (#962): a grant of a keyword the engine has not implemented ships
           * a card whose effect is inert, exactly like a printed one. The
           * static slot's `keyword-grant` clause already keeps the row for
           * this reason (`lowerStatic.ts`), and censusing one grant site and
           * not the other is how "Target creature gains undying until end of
           * turn." reached `ready` promising a `planned` keyword.
           */
          readonly kind: "grant-ability";
          readonly subject: SubjectIR;
          readonly keyword: KeywordIR;
          readonly duration: DurationIR;
      }
    | {
          readonly kind: "deal-damage";
          readonly amount: AmountIR;
          readonly to: SubjectIR;
      }
    | {
          /**
           * CR 615.12 — "Damage can't be prevented this turn."
           *
           * A one-shot instruction with no subject at all: it names no source,
           * no recipient and no duration but the turn, which is precisely why
           * it lowers to the game-scoped `suppressDamagePrevention` Op rather
           * than to either narrower anti-prevention shape (`lockDamage` binds
           * ONE recipient, the `combat-damage-unpreventable` static binds ONE
           * source and combat only). It carries no fields because the printed
           * sentence carries none — matched as an EXACT span, so a wording
           * that scopes the clause ("Damage from creature sources can't be
           * prevented this turn") fails the card instead of compiling to the
           * unscoped reading.
           */
          readonly kind: "suppress-damage-prevention";
      }
    | {
          readonly kind: "draw";
          readonly player: PlayerRefIR;
          readonly count: AmountIR;
      }
    | {
          readonly kind: "destroy";
          readonly subject: SubjectIR;
          readonly cantBeRegenerated: boolean;
      }
    | {
          readonly kind: "tap-untap";
          readonly action: "tap" | "untap";
          readonly subject: SubjectIR;
      }
    | { readonly kind: "regenerate"; readonly subject: SubjectIR }
    | {
          readonly kind: "life";
          readonly action: "gain" | "lose";
          readonly player: PlayerRefIR;
          readonly amount: AmountIR;
      }
    | {
          readonly kind: "counters";
          readonly subject: SubjectIR;
          readonly counter: string;
          readonly count: AmountIR;
      }
    | {
          readonly kind: "move-zone";
          readonly subject: SubjectIR;
          readonly to: ZoneRefIR;
      }
    | ({
          /**
           * CR 111.1 — create one or more creature tokens whose
           * characteristics the sentence defines (CR 111.3). Read by the
           * `tokenSpec.ts` sub-grammar; the controller creates them
           * (CR 111.2), the only creator this form prints.
           */
          readonly kind: "create-token";
      } & CreateTokenIR)
    | {
          readonly kind: "discard-at-random";
          readonly player: PlayerRefIR;
          readonly count: AmountIR;
      }
    | {
          /**
           * CR 603.2 — "…, you may <effect>." The controller decides on
           * resolution and declining does NOTHING.
           *
           * A WRAPPER around one sentence rather than a flag on each member:
           * every effect the grammar already reads becomes optional at once,
           * the lowering has ONE place to emit the decision, and the inner
           * sentence is lowered by the SAME walk — so "you may tap target
           * creature" announces its target through the shared slot allocator
           * exactly as the non-optional sentence does.
           */
          readonly kind: "optional";
          /**
           * The inner clause AS PRINTED, which is what the player is asked.
           * The compiler has no better phrasing to offer a prompt than the
           * words the card itself uses, and inventing one would be a claim
           * about the card the Oracle text does not make (the argument
           * `lowerSpell.ts` makes for a mode's picker label).
           */
          readonly clause: string;
          readonly effect: EffectSentenceIR;
      }
    | {
          /**
           * CR 702.33e — "If this spell was kicked[ with its {A} kicker],
           * <effect>." A linked ability that does its work only if the kicker
           * cost it reads was paid as the spell was cast.
           *
           * A WRAPPER for the reason `optional` is one: every effect sentence
           * the grammar already reads becomes kicker-gated at once, and the
           * inner sentence is lowered by the SAME walk, which is how lowering
           * sees — and refuses — a target announced inside the gate
           * (CR 702.33g: such a target is chosen "only if that spell was
           * kicked", which a single card-level `targetRequirement` cannot say).
           */
          readonly kind: "kicked";
          readonly kicked: KickedRefIR;
          readonly effect: EffectSentenceIR;
      }
    | {
          /**
           * CR 701.20a / CR 401.4 — "Look at [or Reveal] the top N cards of
           * your library. Put <which> into your hand and the rest <where>."
           *
           * TWO printed sentences, one effect: the first names the window,
           * the second says where its cards go, and neither means anything
           * alone (CR 608.2c — later text modifies the meaning of earlier
           * text). Each is parsed as its own sentence ROLE and
           * `assembleSentences` folds them here, the way it folds "It can't be
           * regenerated." onto its destroy — so a window with no routing, or a
           * routing with no window in front of it, fails the line.
           */
          readonly kind: "look-distribute";
          /** CR 701.20a — "reveal" shows the window to every player. */
          readonly reveal: boolean;
          readonly count: AmountIR;
          readonly route: LibraryRouteIR;
      }
    | {
          /**
           * CR 401.4 — "Look at the top N cards of <player>'s library, then
           * put them back in any order." One sentence: no card leaves the
           * top of the library, the looker only re-arranges it.
           *
           * `looker` is who looks and orders. "you" at the head of the
           * sentence; "that-player" for the reply sentence Tahngarth's Glare
           * prints ("That player looks at the top three cards of your
           * library, then puts them back in any order"), whose referent is
           * the player whose library the sentence before it looked at. That
           * is the one piece of anaphora this sentence reads, and lowering
           * resolves it against the walk rather than here, where the previous
           * sentence is out of sight.
           */
          readonly kind: "look-reorder";
          readonly count: AmountIR;
          readonly library: PlayerRefIR;
          readonly looker: "you" | "that-player";
      }
    | {
          /**
           * CR 121.1 + CR 701.9a — "Draw N cards, then discard M cards": the
           * controller draws, then discards cards of their choice. One
           * sentence, two actions in printed order; the discard is a CHOICE
           * (never "at random", which is `discard-at-random`).
           */
          readonly kind: "loot";
          readonly draw: AmountIR;
          readonly discard: AmountIR;
      }
    | {
          /**
           * CR 608.2c — "<base>. If you control a <A> and a <B>, <upgraded>
           * instead." Two printed sentences, one effect: the second REPLACES
           * the first when every condition holds as the ability resolves, and
           * leaves it alone otherwise. `upgraded` is the base effect with only
           * its magnitude changed, sharing the base's subject objects — the
           * replacement acts on the SAME announced target (CR 601.2c: it was
           * chosen once, as the ability was put on the stack).
           *
           * Each condition is counted on its own, so one permanent that is
           * both colours satisfies both ("a blue permanent and a black
           * permanent" — a blue-black permanent is each of those).
           */
          readonly kind: "upgrade-if-controls";
          readonly conditions: readonly ConditionIR[];
          readonly base: EffectSentenceIR;
          readonly upgraded: EffectSentenceIR;
      };

/**
 * Where a looked-at window goes (CR 401.4), as the routing sentence prints it.
 *
 * `all-of-subtype` — "Put all <Subtype> cards revealed this way into your hand
 * and the rest on the bottom of your library in any order": every matching
 * card, no choice. `take` — "Put <N> of them into your hand and the rest
 * <rest>": the controller picks N.
 */
export type LibraryRouteIR =
    | { readonly kind: "all-of-subtype"; readonly subtype: string }
    | {
          readonly kind: "take";
          readonly count: AmountIR;
          readonly rest:
              | "bottom-any-order"
              | "bottom-random-order"
              | "graveyard";
      };

/** CR 602.5 — a clause restricting WHEN the ability may be activated. */
export type RestrictionIR =
    /** CR 602.5d — "Activate only as a sorcery." */
    | { readonly kind: "sorcery-only" }
    /** CR 602.5b — "Activate only once each turn." */
    | { readonly kind: "once-per-turn" }
    /** CR 602.5 — "Activate only during your turn." */
    | { readonly kind: "your-turn-only" }
    /** CR 602.5 — "Activate only during your upkeep." */
    | { readonly kind: "phase"; readonly phase: Phase }
    /** CR 602.1 — "Any player may activate this ability." */
    | { readonly kind: "any-player" };

/** A sentence that modifies the sentence before it rather than acting itself. */
export type ModifierIR = { readonly kind: "cant-be-regenerated" };

export type SentenceIR =
    | { readonly role: "effect"; readonly effect: EffectSentenceIR }
    | { readonly role: "restriction"; readonly restriction: RestrictionIR }
    | { readonly role: "modifier"; readonly modifier: ModifierIR }
    /** The window half of a `look-distribute` (see there). */
    | {
          readonly role: "library-look";
          readonly reveal: boolean;
          readonly count: AmountIR;
      }
    /** CR 401.4 — the routing half of a `look-distribute` (see there). */
    | { readonly role: "library-route"; readonly route: LibraryRouteIR }
    /**
     * CR 608.2c — "If you control a <A> and a <B>, <effect> instead": the
     * replacement half of an `upgrade-if-controls`, folded onto the effect in
     * front of it by `assembleSentences`. `body` is the replacement clause
     * WITHOUT "instead"; it is read against that effect, whose referents it
     * reuses ("that creature", an elided damage recipient).
     */
    | {
          readonly role: "instead";
          readonly conditions: readonly ConditionIR[];
          readonly body: string;
      };

/**
 * A parsed sentence LIST assembled into what an ability site actually carries.
 *
 * The third consumer is what made this shared: the activated slot, the
 * triggered slot and the spell slot all read the same `". "`-separated sentence
 * list, and all three have to fold the CR 701.19c "It can't be regenerated."
 * MODIFIER onto the destroy in front of it. Two copies had already drifted
 * apart only in their prose; a third would have made the fold a convention
 * rather than a rule.
 *
 * What still differs is the one thing that genuinely does: a CR 602.5
 * activation restriction is a sentence only an ACTIVATED ability can carry —
 * there is no activation to restrict on a trigger or on a spell. So the caller
 * either accepts restrictions (and inherits the ordering rule: a restriction
 * applies to the whole ability and is printed last, so an effect that follows
 * one is a sequence we have misread) or names the reason it refuses them.
 */
export type AssembledSentences =
    | {
          readonly ok: true;
          readonly effects: EffectSentenceIR[];
          readonly restrictions: RestrictionIR[];
      }
    | { readonly ok: false; readonly reason: string };

/**
 * The attribution sub-grammar of a line whose every sentence PARSED and whose
 * sentence list was then refused as a whole (issue #3822) — a restriction on a
 * spell, an effect after a restriction. The slot got further than any sentence
 * inside it could, so the trace outranks all of them: one step of progress per
 * sentence read, plus the list itself.
 */
export const SENTENCE_ASSEMBLY = "sentence assembly";

export function assemblyTrace(span: string, sentences: number): FailureTrace {
    return { path: [SENTENCE_ASSEMBLY], span, progress: sentences + 1 };
}

export function assembleSentences(
    sentences: readonly SentenceIR[],
    opts: {
        /** Set to REFUSE CR 602.5 restrictions, with this as the reason. */
        readonly rejectRestrictions?: string;
        /** What an empty effect list is called in the failure reason. */
        readonly site: string;
    }
): AssembledSentences {
    const effects: EffectSentenceIR[] = [];
    const restrictions: RestrictionIR[] = [];
    // CR 608.2c — a library window waits for the sentence that routes it.
    let window: Extract<SentenceIR, { role: "library-look" }> | null = null;
    for (const sentence of sentences) {
        if (window !== null) {
            if (sentence.role !== "library-route")
                return {
                    ok: false,
                    reason: "a library look is not followed by where its cards go",
                };
            const folded = foldLibraryRoute(window, sentence.route);
            if (typeof folded === "string")
                return { ok: false, reason: folded };
            effects.push(folded);
            window = null;
            continue;
        }
        if (sentence.role === "library-look") {
            if (restrictions.length > 0)
                return {
                    ok: false,
                    reason: "an effect sentence follows an activation restriction",
                };
            window = sentence;
            continue;
        }
        if (sentence.role === "library-route")
            return {
                ok: false,
                reason: "a library routing follows no look at the top of a library",
            };
        if (sentence.role === "restriction") {
            if (opts.rejectRestrictions !== undefined)
                return { ok: false, reason: opts.rejectRestrictions };
            restrictions.push(sentence.restriction);
            continue;
        }
        if (restrictions.length > 0)
            return {
                ok: false,
                reason: "an effect sentence follows an activation restriction",
            };
        if (sentence.role === "instead") {
            const previous = effects[effects.length - 1];
            if (previous === undefined)
                return {
                    ok: false,
                    reason: '"… instead" follows no effect it could replace',
                };
            const upgraded = readUpgrade(previous, sentence.body);
            if (typeof upgraded === "string")
                return { ok: false, reason: upgraded };
            effects[effects.length - 1] = {
                kind: "upgrade-if-controls",
                conditions: sentence.conditions,
                base: previous,
                upgraded,
            };
            continue;
        }
        if (sentence.role === "modifier") {
            const previous = effects[effects.length - 1];
            if (previous === undefined || previous.kind !== "destroy")
                return {
                    ok: false,
                    reason: '"It can\'t be regenerated." follows no destroy',
                };
            effects[effects.length - 1] = {
                ...previous,
                cantBeRegenerated: true,
            };
            continue;
        }
        effects.push(sentence.effect);
    }
    if (window !== null)
        return {
            ok: false,
            reason: "a library look is not followed by where its cards go",
        };
    if (effects.length === 0)
        return { ok: false, reason: `the ${opts.site} has no effect sentence` };
    return { ok: true, effects, restrictions };
}

/**
 * Pair a window with its routing, or name why the pair is not one form.
 *
 * Only the two pairings the corpus prints are one effect: "revealed this way"
 * reads back a REVEAL (CR 701.20a), and "<N> of them" picks from a private
 * LOOK. The crossed pairs are refused rather than lowered to whichever half
 * came first, because a reveal the routing does not mention and a routing that
 * names a reveal that never happened are both a sentence we have misread.
 */
function foldLibraryRoute(
    window: Extract<SentenceIR, { role: "library-look" }>,
    route: LibraryRouteIR
): EffectSentenceIR | string {
    if (route.kind === "all-of-subtype" && !window.reveal)
        return '"revealed this way" follows a look, not a reveal (CR 701.20a)';
    if (route.kind === "take" && window.reveal)
        return "a pick from a revealed window is not in this grammar";
    return {
        kind: "look-distribute",
        reveal: window.reveal,
        count: window.count,
        route,
    };
}

// ── Subjects ───────────────────────────────────────────────────────────────

/**
 * A subject phrase: the source, an announced target, or a named player.
 *
 * The three are disjoint by their opening words, so this is a cascade rather
 * than an `oneOf` — but each branch is still all-consuming (`isSelfPhrase` is
 * an exact table lookup; `targetFilterRule` and `playerRefRule` consume their
 * whole span).
 */
export const subjectRule: Rule<SubjectIR> = rule<SubjectIR>(
    "subject",
    (span, ctx) => {
        // A subject that OPENS its sentence is capitalised ("Target creature gets
        // …"), the same subject mid-sentence is not ("… deals 1 damage to target
        // creature"). Only the first letter differs, and only for the FUNCTION
        // words this grammar dispatches on — every capital that carries meaning (a
        // CR 205.3 subtype) sits later in the phrase and is left alone.
        const probe = uncapitalise(span);
        if (isSelfPhrase(probe)) return ok({ kind: "self" as const });
        if (probe === "that card") return ok({ kind: "that-card" as const });
        if (
            probe === "any target" ||
            probe.startsWith("target ") ||
            // CR 601.2c — "up to one target …" is the same announced slot with
            // a `{ min: 0, max: 1 }` count; `targetFilterRule` owns the head.
            probe.startsWith("up to one target ")
        ) {
            const requirement = targetFilterRule.run(probe, ctx);
            if (!requirement.ok) return requirement;
            return ok({
                kind: "target" as const,
                requirement: requirement.value,
            });
        }
        const player = playerRefRule.run(span, ctx);
        if (player.ok)
            return ok({ kind: "player" as const, player: player.value });
        return fail(`"${span}" is not a subject this grammar knows`, span);
    }
);

/** Lowercase a sentence-initial capital, leaving the rest of the span alone. */
export function uncapitalise(span: string): string {
    return span.length === 0 ? span : span[0]!.toLowerCase() + span.slice(1);
}

/**
 * The mirror: raise a sentence-initial letter (CR 113.3c).
 *
 * A trigger prints its effect clause lowercase ("…, draw a card") where a
 * spell or activated site prints the same sentence capitalised ("Draw a
 * card"). Only the sentence-initial letter differs, and only for the FUNCTION
 * words this grammar dispatches on, so the two casings are one sentence read
 * through one rule rather than two near-identical pattern tables.
 */
export function capitalise(span: string): string {
    return span.length === 0 ? span : span[0]!.toUpperCase() + span.slice(1);
}

/** CR 603.2's optional marker, as printed at a trigger's effect clause. */
const MAY_PREFIX = "you may ";

/**
 * Wrap a sentence rule so it also reads CR 603.2's "you may <effect>".
 *
 * A COMBINATOR over the caller's sentence rule rather than a branch inside
 * `sentenceRule`, because the marker is printed at trigger casing ("…, you may
 * draw a card") and each slot capitalises for itself: composing here keeps one
 * sentence table and lets a slot that has no optional shape stay unable to
 * read one.
 *
 * Fail-closed twice over (ADR 0105). An inner sentence the effect grammar
 * cannot parse fails the WHOLE span — the marker never licences a half-read
 * line — and a CR 602.5 restriction or a CR 701.19c modifier under "you may"
 * is a line we have misread rather than an optional effect, so it fails too.
 * There is no nesting: the inner rule is the caller's plain sentence, so
 * "you may you may draw a card" is not a sentence this grammar knows.
 */
export function optionalSentenceRule(
    inner: Rule<SentenceIR>
): Rule<SentenceIR> {
    return rule(`optional ${inner.label}`, (span, ctx) => {
        // The marker is a FUNCTION word at the head of its sentence, so it is
        // read at either casing — lowercase where a trigger's first clause
        // prints it ("…, you may draw a card"), capitalised where a following
        // sentence does ("… . You may gain 1 life"). Same probe the subject
        // rule uses, for the same reason: only the sentence-initial letter
        // differs, and only for the words this grammar dispatches on.
        const probe = uncapitalise(span);
        if (!probe.startsWith(MAY_PREFIX)) return inner.run(span, ctx);
        const clause = probe.slice(MAY_PREFIX.length);
        const parsed = inner.run(clause, ctx);
        if (!parsed.ok) return parsed;
        if (parsed.value.role !== "effect")
            return fail(
                `"you may" offers an effect, not a ${parsed.value.role}`,
                span
            );
        return ok({
            role: "effect" as const,
            effect: {
                kind: "optional" as const,
                clause,
                effect: parsed.value.effect,
            },
        });
    });
}

/**
 * Wrap a sentence rule so it also reads CR 702.33e's "If this spell was
 * kicked, <effect>".
 *
 * A combinator for the reason `optionalSentenceRule` is one: only the spell
 * site prints this shape (the permanent's "If this creature was kicked, it
 * enters with …" is an ENTRY rider, read by the static slot), so composing it
 * there keeps every other site unable to read a gate it has no kicker for.
 *
 * Fail-closed like its sibling: a head that reads as a kicked condition with a
 * tail the effect grammar cannot parse fails the whole span, and a restriction
 * or modifier behind the gate is a line we have misread. A span that does not
 * open on the condition is the inner rule's to read or refuse.
 */
export function kickedSentenceRule(inner: Rule<SentenceIR>): Rule<SentenceIR> {
    return rule(`kicked ${inner.label}`, (span, ctx) => {
        const comma = span.indexOf(", ");
        const head = comma === -1 ? null : uncapitalise(span.slice(0, comma));
        const condition =
            head === null ? null : kickedConditionRule.run(head, ctx);
        if (condition === null || !condition.ok) return inner.run(span, ctx);
        // CR 608.2h — "If this spell was kicked, it deals …": the clause's
        // own subject is the spell, the nearest antecedent the pronoun has
        // (`bindSourcePronoun`), and a spell's source is the spell itself.
        // Only a SPELL can be what "it" deals damage from; "…, it gains
        // flying" names the creature an earlier sentence targeted, so any
        // other verb behind a bound pronoun fails rather than granting the
        // ability to the spell.
        const tail = bindSourcePronoun(span.slice(comma + 2));
        const parsed = inner.run(capitalise(tail.span), ctx);
        if (!parsed.ok) return parsed;
        if (
            tail.bound &&
            (parsed.value.role !== "effect" ||
                parsed.value.effect.kind !== "deal-damage")
        )
            return fail(
                '"it" after a kicked condition is the spell only as a damage source',
                span
            );
        if (parsed.value.role !== "effect")
            return fail(
                `a kicked condition gates an effect, not a ${parsed.value.role}`,
                span
            );
        return ok({
            role: "effect" as const,
            effect: {
                kind: "kicked" as const,
                kicked: condition.value,
                effect: parsed.value.effect,
            },
        });
    });
}

/**
 * A sentence opening on the pronoun "It", with the pronoun already bound.
 *
 * CR 608.2h — "If an ability states that an object does something, it's the
 * object as it exists—or as it most recently existed—that does it". The
 * pronoun names an object; WHICH object is not a fact about the sentence but
 * about the text before it, so this sub-grammar never guesses: it binds only
 * what its CALLER — the site that printed the antecedent — says the pronoun
 * names, and a caller that binds nothing leaves "It" unread (the sentence
 * table has no entry for the word, so the line stays `unparsed`).
 *
 * The one referent any site binds today is the SOURCE, and the binding is
 * written as the source's own marker (`{self}`, CR 201.5), so "It deals 2
 * damage" and "{self} deals 2 damage" are ONE sentence read by one table —
 * `normalize.ts` makes the same substitution for the card's printed name.
 * Only the LEADING word is rebound: "Put a +1/+1 counter on target creature.
 * It gains flying" names the target, and a later sentence's "It" never
 * reaches this function.
 */
export function bindSourcePronoun(span: string): {
    readonly span: string;
    readonly bound: boolean;
} {
    const probe = uncapitalise(span);
    return probe.startsWith(SOURCE_PRONOUN)
        ? {
              span: `${SELF_MARKER} ${probe.slice(SOURCE_PRONOUN.length)}`,
              bound: true,
          }
        : { span, bound: false };
}

const SOURCE_PRONOUN = "it ";

/**
 * Wrap a sentence-LIST rule so a leading "It" is read as the source, and say
 * whether it was — the caller owns the antecedent check (`bindSourcePronoun`).
 */
export function sourcePronounListRule<T>(
    inner: Rule<T>
): Rule<{ readonly value: T; readonly boundPronoun: boolean }> {
    return rule(`source-pronoun ${inner.label}`, (span, ctx) => {
        const bound = bindSourcePronoun(span);
        const parsed = inner.run(bound.span, ctx);
        return parsed.ok
            ? ok({ value: parsed.value, boundPronoun: bound.bound })
            : parsed;
    });
}

/** A subject that must be a player (CR 102.1) — "you", "target player". */
function playerSubject(span: string, ctx: unknown): PlayerRefIR | null {
    const player = playerRefRule.run(span, ctx);
    return player.ok ? player.value : null;
}

// ── Sentence patterns ──────────────────────────────────────────────────────

const PUMP = /^(.+) gets ([+-]\d+)\/([+-]\d+) (.+)$/;
const DAMAGE = /^(.+) deals (\S+) damage to (.+)$/;
const DRAW_SELF = /^Draw (\S+) cards?$/;
const DRAW_PLAYER = /^(.+) draws (\S+) cards?$/;
const LIFE = /^(.+) (gain|gains|lose|loses) (\S+) life$/;
const COUNTERS = /^Put (\S+) (\S+) counters? on (.+)$/;
const DISCARD_RANDOM = /^(.+) discards (\S+) cards? at random$/;
/** CR 121.1 + CR 701.9a — "Draw a card, then discard a card". */
const LOOT = /^Draw (\S+) cards?, then discard (\S+) cards?$/;
/** CR 608.2c — "If you control <A> and <B>, <body> instead" (either order). */
const INSTEAD = /^If (you control .+?), (?:instead (.+)|(.+) instead)$/;

/** The window: "Look at [or Reveal] the top four cards of your library". */
const LIBRARY_LOOK = /^(Look at|Reveal) the top (\S+) cards of your library$/;
/** CR 401.4 — the one-sentence reorder, looked at by "you". */
const LIBRARY_REORDER =
    /^Look at the top (\S+) cards of (your|target player's|target opponent's) library, then put them back in any order$/;
/** CR 401.4 — the same reorder, looked at by the previous sentence's player. */
const LIBRARY_REORDER_THAT_PLAYER =
    /^That player looks at the top (\S+) cards of your library, then puts them back in any order$/;
/** The routing half, every matching card: "Put all Goblin cards revealed …". */
const ROUTE_ALL_OF_SUBTYPE =
    /^Put all (\S+) cards revealed this way into your hand and the rest on the bottom of your library in any order$/;
/** The routing half, a pick: "Put one of them into your hand and the rest …". */
const ROUTE_TAKE =
    /^Put (\S+) of (?:them|those cards) into your hand and the rest (on the bottom of your library in any order|on the bottom of your library in a random order|into your graveyard)$/;

const ROUTE_REST: ReadonlyMap<
    string,
    Extract<LibraryRouteIR, { kind: "take" }>["rest"]
> = new Map([
    ["on the bottom of your library in any order", "bottom-any-order"],
    ["on the bottom of your library in a random order", "bottom-random-order"],
    ["into your graveyard", "graveyard"],
]);

/** CR 615.12 — the printed sentence, whole, without its full stop. */
const SUPPRESS_DAMAGE_PREVENTION = "Damage can't be prevented this turn";

const KEYWORDS = keywordVocabulary();

/** Exact restriction sentences (CR 602.5). Both templatings are printed. */
const RESTRICTIONS: ReadonlyMap<string, RestrictionIR> = new Map<
    string,
    RestrictionIR
>([
    ["activate only as a sorcery", { kind: "sorcery-only" }],
    ["activate this ability only as a sorcery", { kind: "sorcery-only" }],
    ["activate only once each turn", { kind: "once-per-turn" }],
    ["activate this ability only once each turn", { kind: "once-per-turn" }],
    ["activate only during your turn", { kind: "your-turn-only" }],
    ["activate this ability only during your turn", { kind: "your-turn-only" }],
    ["activate only during your upkeep", { kind: "phase", phase: "UPKEEP" }],
    [
        "activate this ability only during your upkeep",
        { kind: "phase", phase: "UPKEEP" },
    ],
    ["any player may activate this ability", { kind: "any-player" }],
]);

/**
 * One sentence, without its full stop.
 *
 * Every branch below is entered on an exact keyword and then required to match
 * an ANCHORED pattern over the whole span, so an unrecognised trailing clause
 * fails the sentence instead of being ignored.
 */
export const sentenceRule: Rule<SentenceIR> = subGrammar(
    EFFECT_CLAUSE,
    rule<SentenceIR>(EFFECT_CLAUSE, (span, ctx) => {
        const restriction = RESTRICTIONS.get(span.toLowerCase());
        if (restriction !== undefined)
            return ok({ role: "restriction" as const, restriction });
        if (span === "It can't be regenerated")
            return ok({
                role: "modifier" as const,
                modifier: { kind: "cant-be-regenerated" as const },
            });

        if (INSTEAD.test(span)) return insteadRule.run(span, ctx);

        const library = libraryHalf(span);
        if (library !== null) return library;

        const effect = effectSentence(span, ctx);
        if (!effect.ok) return effect;
        return ok({ role: "effect" as const, effect: effect.value });
    })
);

/**
 * CR 608.2c — the replacement sentence: "If you control a <A> and a <B>,
 * <body> instead".
 *
 * Exactly TWO controls clauses, each read by the shared `controlsRule`: the
 * shape every printed card of this family has, and "and" between two
 * singular "you control a …" clauses is the only conjunction read here.
 */
export const insteadRule: Rule<SentenceIR> = rule<SentenceIR>(
    "instead if you control",
    (span, ctx) => {
        const match = span.match(INSTEAD);
        if (match === null) return fail('not an "… instead" sentence', span);
        const clauses = match[1]!
            .slice("you control ".length)
            .split(/ and (?=an? )/);
        if (clauses.length !== 2)
            return fail(
                '"instead" reads exactly two "you control" clauses',
                span
            );
        const conditions: ConditionIR[] = [];
        for (const clause of clauses) {
            const condition = controlsRule.run(`you control ${clause}`, ctx);
            if (!condition.ok) return condition;
            conditions.push(condition.value);
        }
        return ok({
            role: "instead" as const,
            conditions,
            body: match[2] ?? match[3]!,
        } satisfies SentenceIR);
    }
);

const UPGRADE_PUMP = /^that (\w+) gets ([+-]\d+)\/([+-]\d+) (.+)$/;
const UPGRADE_DAMAGE = /^(.+) deals (\S+) damage$/;
const UPGRADE_LIFE = /^(you|that player) (gain|gains|lose|loses) (\S+) life$/;
const UPGRADE_LOOT = /^draw (\S+) cards?, then discard (\S+) cards?$/;

/**
 * The replacement clause read AGAINST the effect it replaces (CR 608.2c).
 *
 * Each form changes only a magnitude and names the base effect's referent by
 * anaphora or ellipsis — "that creature gets +5/+5 …", "this enchantment
 * deals 3 damage" (to the same recipient), "that player loses 3 life", "you
 * gain 4 life", "draw two cards, then discard a card" — so the upgraded IR is
 * the base IR with the new magnitude, keeping the base's subject OBJECTS
 * (lowering reads that identity as "the same announced target"). A referent
 * the base does not have, a different action or a different duration is a
 * sentence we have misread, and fails the line.
 */
function readUpgrade(
    base: EffectSentenceIR,
    body: string
): EffectSentenceIR | string {
    switch (base.kind) {
        case "pump": {
            const m = body.match(UPGRADE_PUMP);
            if (m === null) return `"${body}" does not upgrade a pump`;
            if (
                base.subject.kind !== "target" ||
                typeof base.subject.requirement.type !== "string" ||
                base.subject.requirement.type.toLowerCase() !== m[1]
            )
                return `"that ${m[1]}" is not the pumped target`;
            const duration = durationRule.run(m[4]!, undefined);
            if (
                !duration.ok ||
                JSON.stringify(duration.value) !== JSON.stringify(base.duration)
            )
                return "the upgraded pump lasts a different duration";
            return { ...base, power: Number(m[2]), toughness: Number(m[3]) };
        }
        case "deal-damage": {
            const m = body.match(UPGRADE_DAMAGE);
            if (m === null || !isSelfPhrase(m[1]!))
                return `"${body}" does not upgrade the source's damage`;
            const amount = readAmount(m[2]!);
            if (amount === null) return `"${m[2]}" is not a damage amount`;
            return { ...base, amount };
        }
        case "life": {
            const m = body.match(UPGRADE_LIFE);
            if (m === null) return `"${body}" does not upgrade a life change`;
            const who = m[1] === "you" ? "you" : "target";
            if (base.player.kind !== who)
                return `"${m[1]}" is not the player the base effect named`;
            if (!m[2]!.startsWith(base.action))
                return "the upgrade changes gain to lose, or back";
            const amount = readAmount(m[3]!);
            if (amount === null) return `"${m[3]}" is not an amount`;
            return { ...base, amount };
        }
        case "loot": {
            const m = body.match(UPGRADE_LOOT);
            if (m === null) return `"${body}" does not upgrade a loot`;
            const draw = readAmount(m[1]!);
            const discard = readAmount(m[2]!);
            if (draw === null || discard === null)
                return "a loot needs two counts";
            return { ...base, draw, discard };
        }
        default:
            return `"… instead" cannot replace a ${base.kind}`;
    }
}

/**
 * The two halves of a CR 401.4 look-and-route (`look-distribute`), each a
 * sentence role `assembleSentences` pairs up. `null` = neither half's head.
 */
function libraryHalf(span: string) {
    const look = span.match(LIBRARY_LOOK);
    if (look !== null) {
        const count = readAmount(look[2]!);
        if (count === null) return fail(`"${look[2]}" is not a count`, span);
        return ok({
            role: "library-look" as const,
            reveal: look[1] === "Reveal",
            count,
        } satisfies SentenceIR);
    }
    const all = span.match(ROUTE_ALL_OF_SUBTYPE);
    if (all !== null) {
        // CR 205.3m — a creature type; anything else ("land", "creature")
        // is a card TYPE the filter would have to read differently.
        if (!CREATURE_SUBTYPES.has(all[1]!))
            return fail(`"${all[1]}" is not a creature type`, span);
        return ok({
            role: "library-route" as const,
            route: { kind: "all-of-subtype" as const, subtype: all[1]! },
        } satisfies SentenceIR);
    }
    const take = span.match(ROUTE_TAKE);
    if (take !== null) {
        const count = readAmount(take[1]!);
        if (count === null) return fail(`"${take[1]}" is not a count`, span);
        return ok({
            role: "library-route" as const,
            route: {
                kind: "take" as const,
                count,
                rest: ROUTE_REST.get(take[2]!)!,
            },
        } satisfies SentenceIR);
    }
    return null;
}

function effectSentence(span: string, ctx: unknown) {
    // ── pump (CR 613.4c, layer 7c) ─────────────────────────────────────────
    const pump = span.match(PUMP);
    if (pump !== null) {
        const subject = subjectRule.run(pump[1]!, ctx);
        if (!subject.ok) return subject;
        const duration = durationRule.run(pump[4]!, ctx);
        if (!duration.ok) return duration;
        return ok({
            kind: "pump" as const,
            subject: subject.value,
            power: Number(pump[2]),
            toughness: Number(pump[3]),
            duration: duration.value,
        } satisfies EffectSentenceIR);
    }

    // ── grant a keyword (CR 613.1f, layer 6) ───────────────────────────────
    const gainsAt = span.indexOf(" gains ");
    if (gainsAt !== -1 && !LIFE.test(span)) {
        const subject = subjectRule.run(span.slice(0, gainsAt), ctx);
        if (!subject.ok) return subject;
        const rest = span.slice(gainsAt + " gains ".length);
        const untilAt = rest.lastIndexOf(" until ");
        if (untilAt === -1)
            return fail("a granted ability needs a duration", span);
        const keyword = KEYWORDS.get(rest.slice(0, untilAt).toLowerCase());
        if (keyword === undefined)
            return fail(
                `"${rest.slice(0, untilAt)}" is not a Mechanics Registry keyword`,
                span
            );
        const duration = durationRule.run(rest.slice(untilAt + 1), ctx);
        if (!duration.ok) return duration;
        return ok({
            kind: "grant-ability" as const,
            subject: subject.value,
            keyword,
            duration: duration.value,
        } satisfies EffectSentenceIR);
    }

    // ── anti-prevention lock (CR 615.12) ───────────────────────────────────
    if (span === SUPPRESS_DAMAGE_PREVENTION)
        return ok({
            kind: "suppress-damage-prevention" as const,
        } satisfies EffectSentenceIR);

    // ── damage (CR 119.3) ──────────────────────────────────────────────────
    const damage = span.match(DAMAGE);
    if (damage !== null) {
        // CR 608.2 — the SOURCE of the damage. Grammar v0 reads only the
        // source's own name: "it deals" and "that creature deals" are anaphora
        // whose referent lives in another sentence.
        if (!isSelfPhrase(uncapitalise(damage[1]!)))
            return fail(
                `"${damage[1]}" is not a damage source this grammar knows`,
                span
            );
        const amount = readAmount(damage[2]!);
        if (amount === null)
            return fail(`"${damage[2]}" is not a damage amount`, span);
        const to = subjectRule.run(damage[3]!, ctx);
        if (!to.ok) return to;
        return ok({
            kind: "deal-damage" as const,
            amount,
            to: to.value,
        } satisfies EffectSentenceIR);
    }

    // ── loot: draw, then discard (CR 121.1 + CR 701.9a) ──────────────────────
    const loot = span.match(LOOT);
    if (loot !== null) {
        const draw = readAmount(loot[1]!);
        const discard = readAmount(loot[2]!);
        if (draw === null || discard === null)
            return fail("a loot needs two counts", span);
        return ok({
            kind: "loot" as const,
            draw,
            discard,
        } satisfies EffectSentenceIR);
    }

    // ── draw (CR 121.1) ────────────────────────────────────────────────────
    const drawSelf = span.match(DRAW_SELF);
    if (drawSelf !== null) {
        const count = readAmount(drawSelf[1]!);
        if (count === null)
            return fail(`"${drawSelf[1]}" is not a count`, span);
        return ok({
            kind: "draw" as const,
            player: { kind: "you" as const },
            count,
        } satisfies EffectSentenceIR);
    }
    const drawPlayer = span.match(DRAW_PLAYER);
    if (drawPlayer !== null) {
        const player = playerSubject(drawPlayer[1]!, ctx);
        if (player === null)
            return fail(`"${drawPlayer[1]}" is not a player`, span);
        const count = readAmount(drawPlayer[2]!);
        if (count === null)
            return fail(`"${drawPlayer[2]}" is not a count`, span);
        return ok({
            kind: "draw" as const,
            player,
            count,
        } satisfies EffectSentenceIR);
    }

    // ── destroy (CR 701.8a) ────────────────────────────────────────────────
    if (span.startsWith("Destroy ")) {
        const subject = subjectRule.run(span.slice("Destroy ".length), ctx);
        if (!subject.ok) return subject;
        return ok({
            kind: "destroy" as const,
            subject: subject.value,
            cantBeRegenerated: false,
        } satisfies EffectSentenceIR);
    }

    // ── tap and untap (CR 701.26a) ─────────────────────────────────────────
    for (const [verb, action] of [
        ["Tap ", "tap"],
        ["Untap ", "untap"],
    ] as const) {
        if (!span.startsWith(verb)) continue;
        const subject = subjectRule.run(span.slice(verb.length), ctx);
        if (!subject.ok) return subject;
        return ok({
            kind: "tap-untap" as const,
            action,
            subject: subject.value,
        } satisfies EffectSentenceIR);
    }

    // ── regenerate (CR 701.19a) ────────────────────────────────────────────
    if (span.startsWith("Regenerate ")) {
        const subject = subjectRule.run(span.slice("Regenerate ".length), ctx);
        if (!subject.ok) return subject;
        return ok({
            kind: "regenerate" as const,
            subject: subject.value,
        } satisfies EffectSentenceIR);
    }

    // ── life (CR 119.3) ────────────────────────────────────────────────────
    const life = span.match(LIFE);
    if (life !== null) {
        const player = playerSubject(life[1]!, ctx);
        if (player === null) return fail(`"${life[1]}" is not a player`, span);
        const amount = readAmount(life[3]!);
        if (amount === null) return fail(`"${life[3]}" is not an amount`, span);
        return ok({
            kind: "life" as const,
            action: life[2]!.startsWith("gain") ? "gain" : "lose",
            player,
            amount,
        } satisfies EffectSentenceIR);
    }

    // ── counters (CR 122.1) ────────────────────────────────────────────────
    const counters = span.match(COUNTERS);
    if (counters !== null) {
        const count = readAmount(counters[1]!);
        if (count === null)
            return fail(`"${counters[1]}" is not a count`, span);
        const subject = subjectRule.run(counters[3]!, ctx);
        if (!subject.ok) return subject;
        return ok({
            kind: "counters" as const,
            subject: subject.value,
            counter: counters[2]!,
            count,
        } satisfies EffectSentenceIR);
    }

    // ── zone change (CR 400.6) ─────────────────────────────────────────────
    if (span.startsWith("Return ")) {
        const toAt = span.lastIndexOf(" to ");
        if (toAt === -1) return fail("a return needs a destination zone", span);
        const subject = subjectRule.run(
            span.slice("Return ".length, toAt),
            ctx
        );
        if (!subject.ok) return subject;
        const zone = zoneRefRule.run(span.slice(toAt + " to ".length), ctx);
        if (!zone.ok) return zone;
        return ok({
            kind: "move-zone" as const,
            subject: subject.value,
            to: zone.value,
        } satisfies EffectSentenceIR);
    }

    // ── exile a card from a graveyard (CR 701.13a) ─────────────────────────
    if (span.startsWith("Exile ")) {
        const subject = subjectRule.run(span.slice("Exile ".length), ctx);
        if (!subject.ok) return subject;
        // Only a CARD in a graveyard, never a battlefield permanent: the
        // catalogue writes the graveyard case as `moveZone`/`to: "exile"` and
        // the battlefield case as the dedicated `exile` Op, and picking one for
        // both would encode half the corpus in the wrong shape.
        if (
            subject.value.kind !== "target" ||
            subject.value.requirement.zone !== "graveyard"
        )
            return fail(
                "exiling anything but a card in a graveyard is not in grammar v0",
                span
            );
        return ok({
            kind: "move-zone" as const,
            subject: subject.value,
            to: { zone: "exile" as const, owner: "any" as const },
        } satisfies EffectSentenceIR);
    }

    // ── look at the top of a library, put it back (CR 401.4) ──────────────
    const reorder = span.match(LIBRARY_REORDER);
    if (reorder !== null) {
        const count = readAmount(reorder[1]!);
        if (count === null) return fail(`"${reorder[1]}" is not a count`, span);
        // The possessive of a player phrase: "your" is "you"'s, the rest
        // drop their "'s" ("target opponent's" → "target opponent").
        const owner =
            reorder[2] === "your" ? "you" : reorder[2]!.replace(/'s$/, "");
        const library = playerSubject(owner, ctx);
        if (library === null)
            return fail(`"${reorder[2]}" is not a library owner`, span);
        return ok({
            kind: "look-reorder" as const,
            count,
            library,
            looker: "you" as const,
        } satisfies EffectSentenceIR);
    }
    const reorderThat = span.match(LIBRARY_REORDER_THAT_PLAYER);
    if (reorderThat !== null) {
        const count = readAmount(reorderThat[1]!);
        if (count === null)
            return fail(`"${reorderThat[1]}" is not a count`, span);
        return ok({
            kind: "look-reorder" as const,
            count,
            library: { kind: "you" as const },
            looker: "that-player" as const,
        } satisfies EffectSentenceIR);
    }

    // ── create tokens (CR 111.1) ───────────────────────────────────────────
    if (span.startsWith("Create ")) {
        const created = createTokenRule.run(span, ctx);
        if (!created.ok) return created;
        return ok({
            kind: "create-token" as const,
            ...created.value,
        } satisfies EffectSentenceIR);
    }

    // ── discard at random (CR 701.9a) ──────────────────────────────────────
    const discard = span.match(DISCARD_RANDOM);
    if (discard !== null) {
        const player = playerSubject(discard[1]!, ctx);
        if (player === null)
            return fail(`"${discard[1]}" is not a player`, span);
        const count = readAmount(discard[2]!);
        if (count === null) return fail(`"${discard[2]}" is not a count`, span);
        return ok({
            kind: "discard-at-random" as const,
            player,
            count,
        } satisfies EffectSentenceIR);
    }

    return fail("not an effect sentence this grammar knows", span);
}
