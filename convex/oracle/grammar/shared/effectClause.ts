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
import { fail, ok, rule, type Rule } from "../../rule";
import { keywordVocabulary } from "../slots/keywordLine";
import { durationRule, type DurationIR } from "./duration";
import { playerRefRule, type PlayerRefIR } from "./playerRef";
import { readNumberWord } from "./quantity";
import { isSelfPhrase } from "./cost";
import { targetFilterRule } from "./targetFilter";
import { zoneRefRule, type ZoneRefIR } from "./zoneRef";

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
    | { readonly kind: "player"; readonly player: PlayerRefIR };

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
    | {
          readonly kind: "discard-at-random";
          readonly player: PlayerRefIR;
          readonly count: AmountIR;
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
    | { readonly role: "modifier"; readonly modifier: ModifierIR };

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
    for (const sentence of sentences) {
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
    if (effects.length === 0)
        return { ok: false, reason: `the ${opts.site} has no effect sentence` };
    return { ok: true, effects, restrictions };
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
        if (probe === "any target" || probe.startsWith("target ")) {
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
export const sentenceRule: Rule<SentenceIR> = rule<SentenceIR>(
    EFFECT_CLAUSE,
    (span, ctx) => {
        const restriction = RESTRICTIONS.get(span.toLowerCase());
        if (restriction !== undefined)
            return ok({ role: "restriction" as const, restriction });
        if (span === "It can't be regenerated")
            return ok({
                role: "modifier" as const,
                modifier: { kind: "cant-be-regenerated" as const },
            });

        const effect = effectSentence(span, ctx);
        if (!effect.ok) return effect;
        return ok({ role: "effect" as const, effect: effect.value });
    }
);

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
