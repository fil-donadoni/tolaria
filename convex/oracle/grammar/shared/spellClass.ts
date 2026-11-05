/**
 * CR 109.2 + CR 601.2f — a class of spells named in Oracle text ("Goblin spells
 * you cast", "Artifact, instant, and sorcery spells"), read by the frames that
 * talk about one: the static cost modifier, the cast permission and the
 * floating "this turn" reduction.
 */

import { fail, ok, type RuleResult } from "../../rule";
import type { CompiledSpellFilter } from "../../../cards/compiledStatics";
import type { CardType } from "../../../cards/types";
import { descriptorRule, type DescriptorIR } from "./targetFilter";

const SPELL_NOUN = " spells";

/**
 * The spell CLASSES a phrase names, as descriptor IR — one entry per
 * alternative, empty for the bare "spells".
 *
 * Shared by both frames that talk about a class of spells (the cost modifier
 * and the cast permission), because there is exactly one way to say it in
 * Oracle text and a second reader would be a second thing to drift. What the
 * two consumers do NOT share is the vocabulary they can honour: each keeps its
 * own field whitelist and its own projection below, fail-closed, because the
 * shapes they lower to are different (`CompiledSpellFilter` has no mana-value
 * field; `EffectCardFilter` has one and no `controller`).
 *
 * Reading "<x> spells" as "<x> cards" is not a trick: CR 109.2 — a spell is a
 * CARD on the stack, and "card" is the descriptor grammar's noun for an object
 * outside the battlefield, carrying exactly the vocabulary a spell has (types,
 * subtypes, colours, mana value) and none of the vocabulary it does not
 * (tapped, attacking). The noun is replaced IN PLACE rather than stripped off
 * the end, so a trailing qualifier survives: "creature spells with mana value
 * 3 or less" is a class phrase, not a class phrase with a tail nobody read —
 * the dropped-trailing-filter defect this grammar exists to refuse.
 *
 * A UNION is read as several alternatives ("creature and enchantment spells",
 * "Dragon spells and artifact spells"). Whether a union is expressible at all
 * is the consumer's question, not this one's.
 */
export function readSpellClasses(
    span: string
): RuleResult<readonly DescriptorIR[]> {
    if (span.toLowerCase() === "spells") return ok([]);
    // A list of three prints a serial comma ("Artifact, instant, and sorcery
    // spells"); a bare comma with no ", and " is no list and stays refused by
    // the descriptor.
    const parts = span.includes(", and ")
        ? span.split(/, and |, /)
        : span.split(" and ");
    if (!parts[parts.length - 1]!.includes(SPELL_NOUN))
        return fail(`"${span}" does not describe a class of spells`, span);
    const classes: DescriptorIR[] = [];
    for (const part of parts) {
        const at = part.indexOf(SPELL_NOUN);
        const asCards =
            at === -1
                ? `${part} cards`
                : `${part.slice(0, at)} cards${part.slice(at + SPELL_NOUN.length)}`;
        const descriptor = descriptorRule.run(asCards, undefined);
        if (!descriptor.ok) return descriptor;
        if (descriptor.value.plural !== true)
            return fail(
                `"${part}" does not name a CLASS of spells (CR 109.2)`,
                part
            );
        classes.push(descriptor.value);
    }
    return ok(classes);
}

/**
 * Read the head of a cost-modifier sentence into a spell filter (CR 601.2f).
 *
 * "Goblin spells you cast" → `{ subtypes: ["Goblin"], controller: "you" }`. A
 * bare "Spells" carries no filter at all and is accepted as the empty one: a
 * modifier that taxes every spell is a real card ("Spells cost {1} more to
 * cast"), which is why the "matches everything" refusal below applies only to
 * a phrase that NAMED a class and then projected to nothing.
 */
export function readSpellFilter(span: string): RuleResult<CompiledSpellFilter> {
    let head = span;
    let controller: "you" | "opponents" | undefined;
    if (head.endsWith(" you cast")) {
        controller = "you";
        head = head.slice(0, -" you cast".length);
    } else if (head.endsWith(" your opponents cast")) {
        controller = "opponents";
        head = head.slice(0, -" your opponents cast".length);
    }
    const withController = <T extends CompiledSpellFilter>(f: T): T =>
        controller === undefined ? f : { ...f, controller };

    const classes = readSpellClasses(head);
    if (!classes.ok) return classes;
    if (classes.value.length === 0) return ok(withController({}));
    // CR 601.2f — `CompiledSpellFilter` ANDs its fields and has no clause
    // list, so a UNION of two classes has no general encoding here. The one
    // union it CAN say is a union of bare card types ("Artifact and
    // enchantment spells"), because `types` is itself read as any-of
    // (`spellMatches`). Every other union is refused by name rather than
    // mis-lowered to whichever half came first.
    if (classes.value.length > 1) {
        const types = classes.value.map(bareCardType);
        if (types.some((t) => t === undefined))
            return fail(
                `a cost modifier over a UNION of spell classes is not expressible (CR 601.2f)`,
                span
            );
        return ok(withController({ types: types as CardType[] }));
    }
    const value = classes.value[0]!;
    for (const [field, present] of Object.entries(value)) {
        if (present === undefined) continue;
        if (
            [
                "types",
                "subtypes",
                "colors",
                "excludeTypes",
                "card",
                "plural",
            ].includes(field)
        )
            continue;
        return fail(
            `"${field}" is not expressible as a spell filter (CR 601.2f)`,
            field
        );
    }
    const filter: CompiledSpellFilter = {
        ...(value.types !== undefined ? { types: [...value.types] } : {}),
        ...(value.subtypes !== undefined
            ? { subtypes: [...value.subtypes] }
            : {}),
        ...(value.colors !== undefined ? { colors: [...value.colors] } : {}),
        ...(value.excludeTypes !== undefined
            ? { excludeTypes: [...value.excludeTypes] }
            : {}),
    };
    if (Object.keys(filter).length === 0)
        return fail("spell filter matches everything", span);
    return ok(withController(filter));
}

/** The ONE card type a class names when it names nothing else ("artifact"). */
function bareCardType(value: DescriptorIR): CardType | undefined {
    for (const [field, present] of Object.entries(value)) {
        if (present === undefined) continue;
        if (!["types", "card", "plural"].includes(field)) return undefined;
    }
    return value.types?.length === 1 ? value.types[0] : undefined;
}
