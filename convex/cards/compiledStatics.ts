/**
 * JSON-pure continuous-static descriptors — the seam the Oracle compiler emits
 * a `staticEffects[]` entry through (issue #2700, PRD #2693).
 *
 * ── Why a descriptor rather than a `StaticEffect` ─────────────────────────
 *
 * Every `StaticEffect` kind a static line lowers to carries a REQUIRED
 * predicate: `StaticPTBuff.applies`, `StaticKeywordGrant.applies`,
 * `StaticCostModifier.appliesToSpell` (CR 611.2 — a continuous effect has to
 * decide, per object, whether that object is affected). The Oracle compiler
 * emits JSON and only JSON: `CompiledDefinition` removes every function-valued
 * field from the type, and gate 5 (`oracle/gates.ts`) fails any definition that
 * does not survive a JSON round trip unchanged. So a compiled card cannot hold
 * a static effect directly — it holds a DESCRIPTOR of one, and this module
 * rebuilds the real effect at the registry seam.
 *
 * This is the same shape {@link CompiledTriggeredAbility} uses for a compiled
 * trigger (`cards/compiledTriggers.ts`, issue #2698) and {@link
 * TokenStaticEffectKey} uses for a token's own continuous ability
 * (`cards/tokenStaticEffects.ts`, issue #2364): a small, censused, JSON-pure
 * shape resolved into the SAME structures a hand-written card declares.
 * Reusing `matchesPermanentFilter` for the predicate rather than re-deriving a
 * matcher here is what makes a compiled card and a hand-written one the same
 * object — the property the gold harness measures (`oracle/gold.ts`).
 *
 * ── The predicate reads a VIEW, so the filter vocabulary is narrower ───────
 *
 * `StaticPTBuff.applies` receives a {@link PermanentView}, which carries no
 * `staticAbilities` and no live supertype array. A `PermanentFilter` field this
 * module cannot feed honestly would fail CLOSED inside the matcher (matching
 * nothing) — silently, and on the wrong side: an anthem that buffs nobody looks
 * exactly like an anthem nobody triggered. So the vocabulary is checked at
 * LOWERING time instead ({@link STATIC_FILTER_FIELDS}), where an unfeedable
 * field refuses the card. Supertypes are the one field the view can answer
 * indirectly — `StaticEffectContext.hasSupertype` reads the definition — so
 * they are materialised below rather than refused.
 */

import { matchesPermanentFilter } from "./filters";
import type { PermanentFilter } from "./filters";
import type {
    CardDefinition,
    CardSupertype,
    CardType,
    Color,
    ManaCost,
    PermanentView,
    StaticEffect,
    StaticEffectContext,
} from "./types";

/**
 * `PermanentFilter` fields a descriptor may carry.
 *
 * Exported because the compiler's lowering is what enforces it (see the header)
 * and a second hand-written copy of this list is a second thing to drift.
 * Every member is answerable from a `PermanentView` plus a
 * `StaticEffectContext`; `requireAbility` / `excludeAbility` are the notable
 * absentees, since the view carries no `staticAbilities` at all.
 */
export const STATIC_FILTER_FIELDS: ReadonlySet<string> = new Set([
    "types",
    "excludeTypes",
    "subtypes",
    "excludeSubtypes",
    "supertypes",
    "excludeSupertypes",
    "colors",
    "controllerRelation",
    "tapped",
    "isAttacking",
    "isBlocking",
    "excludeSource",
]);

/** CR 205.4a — the whole supertype vocabulary, materialised per predicate call. */
const SUPERTYPES: readonly CardSupertype[] = [
    "Basic",
    "Legendary",
    "Snow",
    "World",
];

/**
 * What a compiled cost modifier applies to (CR 601.2f).
 *
 * A spell is not a permanent, so `PermanentFilter` is the wrong vocabulary: it
 * would offer `tapped` and `isAttacking` for an object on the stack. This is
 * the subset that means something about a spell — its types, its subtypes, its
 * colours, and whose it is — and nothing else.
 */
export interface CompiledSpellFilter {
    readonly types?: readonly CardType[];
    readonly subtypes?: readonly string[];
    readonly colors?: readonly Color[];
    /** CR 601.2f — "spells you cast" / "spells your opponents cast". */
    readonly controller?: "you" | "opponents";
}

/** The continuous static effects the compiler can emit (CR 611). Closed. */
export type CompiledStaticEffect =
    /** CR 613.1e layer 7c — "<filter> get +N/+N". */
    | {
          readonly kind: "pt-buff";
          readonly filter: PermanentFilter;
          readonly power: number;
          readonly toughness: number;
      }
    /** CR 613.1f layer 6 — "<filter> have <keyword>". */
    | {
          readonly kind: "keyword-grant";
          readonly filter: PermanentFilter;
          readonly keyword: string;
      }
    /** CR 601.2f — "<spells> cost {N} more/less to cast". */
    | {
          readonly kind: "cost-modifier";
          readonly spells: CompiledSpellFilter;
          /** Generic mana added to the cost. Exclusive with `reduction`. */
          readonly increase?: number;
          /** Generic mana removed from the cost. Exclusive with `increase`. */
          readonly reduction?: number;
      };

/**
 * One descriptor's filter as a live predicate.
 *
 * The `MatchablePermanent` is assembled from the view rather than passed
 * through, because the two shapes name the same facts differently
 * (`isTapped` / `tapped`) and because two of them — colours and supertypes —
 * are only reachable through the context. `staticAbilities` is `[]` and stays
 * `[]`: the view has none, and a filter that would read it is refused at
 * lowering time (see the header).
 */
function filterMatches(
    filter: PermanentFilter,
    target: PermanentView,
    source: PermanentView,
    ctx: StaticEffectContext
): boolean {
    return matchesPermanentFilter(
        {
            id: target.id,
            types: target.types,
            subtypes: target.subtypes,
            supertypes: SUPERTYPES.filter((s) => ctx.hasSupertype(target, s)),
            staticAbilities: [],
            controllerId: target.controllerId,
            isToken: target.isToken,
            power: target.power,
            toughness: target.toughness,
            colors: ctx.getColors(target),
            isTapped: target.isTapped,
            isAttacking: target.isAttacking,
            isBlocking: target.isBlocking,
        },
        filter,
        {
            selfInstanceId: source.id,
            selfControllerId: source.controllerId,
        }
    );
}

/**
 * A spell filter as a live predicate (CR 601.2f).
 *
 * `card` is the SPELL — the object on the stack whose cost is being computed —
 * and `effectSource` is the permanent carrying the modifier, which is what
 * "you cast" is relative to (CR 109.5). An absent `effectSource` with a
 * controller clause fails CLOSED: without a source there is no "you", and a
 * modifier that taxed every player because it could not tell them apart is
 * strictly worse than one that taxes nobody.
 */
function spellMatches(
    spells: CompiledSpellFilter,
    card: PermanentView,
    ctx: StaticEffectContext,
    effectSource: PermanentView | undefined
): boolean {
    if (spells.types !== undefined) {
        if (!spells.types.some((t) => card.types.includes(t))) return false;
    }
    if (spells.subtypes !== undefined) {
        if (!spells.subtypes.some((s) => card.subtypes.includes(s)))
            return false;
    }
    if (spells.colors !== undefined) {
        const colors = ctx.getColors(card);
        if (!spells.colors.some((c) => colors.includes(c))) return false;
    }
    if (spells.controller !== undefined) {
        if (effectSource === undefined) return false;
        const same = card.controllerId === effectSource.controllerId;
        if (spells.controller === "you" ? !same : same) return false;
    }
    return true;
}

/** CR 601.2f — a generic-only cost delta, as the engine's `ManaCost`. */
function generic(amount: number): ManaCost {
    return { X: amount };
}

/** One descriptor → the real continuous effect. */
export function resolveCompiledStatic(
    descriptor: CompiledStaticEffect
): StaticEffect {
    switch (descriptor.kind) {
        case "pt-buff": {
            const filter = descriptor.filter;
            return {
                kind: "pt-buff",
                applies: (target, source, ctx) =>
                    filterMatches(filter, target, source, ctx),
                power: descriptor.power,
                toughness: descriptor.toughness,
            };
        }
        case "keyword-grant": {
            const filter = descriptor.filter;
            return {
                kind: "keyword-grant",
                applies: (target, source, ctx) =>
                    filterMatches(filter, target, source, ctx),
                keyword: descriptor.keyword,
            };
        }
        case "cost-modifier": {
            const spells = descriptor.spells;
            return {
                kind: "cost-modifier",
                appliesToSpell: (card, ctx, effectSource) =>
                    spellMatches(spells, card, ctx, effectSource),
                ...(descriptor.increase !== undefined
                    ? { costIncrease: generic(descriptor.increase) }
                    : {}),
                ...(descriptor.reduction !== undefined
                    ? { costReduction: generic(descriptor.reduction) }
                    : {}),
            };
        }
        default: {
            const never: never = descriptor;
            throw new Error(
                `compiled static: no factory for ${JSON.stringify(never)}`
            );
        }
    }
}

/**
 * ADR 0054 seam — rebuild every compiled descriptor into a real static effect,
 * and REMOVE the descriptor field from the expanded definition.
 *
 * Removing it is not tidiness, for the reason `expandCompiledTriggers` gives:
 * the expanded definition is what every engine read sees (`getDefinition`) and
 * what the gold harness compares against a hand-written card, so a leftover
 * descriptor would read as a compiler defect on every static card.
 */
export function expandCompiledStatics(base: CardDefinition): CardDefinition {
    const descriptors = base.compiledStaticEffects;
    if (descriptors === undefined || descriptors.length === 0) return base;
    const expanded: CardDefinition = {
        ...base,
        staticEffects: [
            ...(base.staticEffects ?? []),
            ...descriptors.map(resolveCompiledStatic),
        ],
    };
    delete expanded.compiledStaticEffects;
    return expanded;
}
