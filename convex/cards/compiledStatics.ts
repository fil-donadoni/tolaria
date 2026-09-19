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
import { AURA_AFFECTS_HOST } from "./types";
import type {
    CardDefinition,
    CardSupertype,
    CardType,
    Color,
    ManaCost,
    PermanentView,
    StaticCastPermission,
    StaticEffect,
    StaticEffectContext,
    StaticEffectStateView,
    StaticKeywordGrant,
} from "./types";
import type { CompiledControlsCondition } from "./compiledTriggers";

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

/**
 * The subset a MATERIALISED effect may filter on — narrower, because the two
 * kinds have opposite evaluation models and only one of them is re-read.
 *
 * `pt-buff` is recomputed at every stat read, so a filter over a permanent's
 * MUTABLE combat/tap state answers freshly each time. `keyword-grant` is not:
 * `beginApplyingStaticEffects` (`gre/state.ts`) writes the keyword into the
 * target's `staticAbilities` ONCE, when the source or the target enters the
 * battlefield, and the only later sweep (`recomputeContinuousEffects`) re-runs
 * an effect solely when it declares `dependsOnCounters` or is a
 * `keyword-grant` carrying a `condition` — neither of which a compiled
 * descriptor sets.
 *
 * So "Attacking creatures you control have double strike" evaluated at
 * materialisation time asks whether anything was attacking when the enchantment
 * entered — always no — and nothing re-asks at DECLARE_ATTACKERS. The grant is
 * inert, silently, on a card that reads as `ready`. Refused at lowering
 * instead; the `pt-buff` twins of those cards (Orcish Oriflamme) are correct
 * and stay accepted, which is exactly why the split is per-kind rather than a
 * blanket removal.
 */
export const MATERIALISED_FILTER_FIELDS: ReadonlySet<string> = new Set(
    [...STATIC_FILTER_FIELDS].filter(
        (field) => !["tapped", "isAttacking", "isBlocking"].includes(field)
    )
);

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

/**
 * WHICH permanents a set-scoped descriptor applies to (CR 611.3a — "whatever
 * its text indicates").
 *
 * Two answers, as a real XOR: a `filter` over the battlefield ("Creatures you
 * control"), or `appliesTo: "host"` — the ONE permanent the source is attached
 * to (CR 303.4b: "The object or player an Aura is attached to is called
 * enchanted"). The host is not a filter over characteristics at all: it is an
 * identity read off the source's `attachedTo`, which is why it is its own arm
 * rather than a `PermanentFilter` field no other consumer could honour. It
 * rebuilds into `AURA_AFFECTS_HOST`, the predicate every hand-written Aura
 * declares, so a compiled Aura and a hand-written one are the same object.
 */
export type CompiledStaticScope =
    | { readonly filter: PermanentFilter; readonly appliesTo?: never }
    | { readonly appliesTo: "host"; readonly filter?: never }
    /** CR 201.5 — "This creature gets …": the permanent itself. */
    | { readonly appliesTo: "self"; readonly filter?: never }
    | CompiledKickedSelfScope;

/**
 * The permanent ITSELF, gated on its own kicker (CR 702.33e/f, issue #3864) —
 * "If this creature was kicked[ with its {A} kicker], it enters with … and with
 * <keyword>" (Duskwalker, the Apocalypse Volvers).
 *
 * CR 614.1c: the ability the permanent "enters with" is part of how it enters,
 * so from that instant it is simply one of the permanent's own abilities —
 * which is what a self-scoped continuous grant models. The gate reads a fact
 * FIXED as the spell was cast (CR 601.2b) and snapshotted onto the permanent
 * the instant it entered (`wasKicked` / `kickerPayments`, `finalizeSpellResolution`),
 * and cleared on every CR 400.7 zone change, so it answers the same at every
 * re-derivation and a reanimated copy reads unkicked. It is the predicate the
 * hand-written catalogue writes as a closure (`target.id === source.id &&
 * target.wasKicked === true`), made JSON.
 *
 * Modelled as the permanent's OWN static grant, exactly as the hand-written
 * closure is — not as an effect timestamped at entry. The two part only where
 * a layer-6 ability-loss effect (Humility) is already on the battlefield, or
 * the permanent later becomes a copy of something else: there the grant goes
 * with the permanent's abilities, where a CR 613.7 timestamp would keep it.
 *
 * `kickerId` absent: any kicker paid ("if this creature was kicked"). Present:
 * that ONE kicker's payment record (CR 702.33f — "with its {1}{U} kicker").
 */
export interface CompiledKickedSelfScope {
    readonly appliesTo: "self-if-kicked";
    readonly kickerId?: string;
    readonly filter?: never;
}

/** The continuous static effects the compiler can emit (CR 611). Closed.
 *
 *  Every member's `kind` is the kind of the `StaticEffect` it rebuilds into —
 *  `cards/registry.ts`'s layer prechecks read the descriptor's `kind` as that
 *  answer, so a descriptor whose kind named something else would drop its
 *  card out of a layer walk silently. */
export type CompiledStaticEffect =
    /** CR 613.4c layer 7c — "<filter> get +N/+N" / "Enchanted creature gets
     *  +N/+N". */
    | ({
          readonly kind: "pt-buff";
          readonly power: number;
          readonly toughness: number;
          /** CR 611.3a — "… as long as you control a <descriptor>": the buff
           *  exists only while the SOURCE's controller controls a match. The
           *  same JSON condition a compiled trigger's intervening-if carries
           *  (`CompiledControlsCondition`), read here off the layer view. */
          readonly condition?: CompiledControlsCondition;
      } & CompiledStaticScope)
    /** CR 613.1f layer 6 — "<filter> have <keyword>" / "Enchanted creature
     *  has <keyword>". */
    | ({
          readonly kind: "keyword-grant";
          readonly keyword: string;
      } & CompiledStaticScope)
    /** CR 613.1b layer 2 — "You control enchanted creature." The host only:
     *  no printed control-change sentence names a SET this way. */
    | { readonly kind: "control-change"; readonly appliesTo: "host" }
    /**
     * CR 613.1f / 113.1a layer 6 — 'Enchanted creature has "<ability>"'. The
     * granted ability itself is JSON already (an `ActivatedAbility` on the
     * card's own `grantTemplates[]`, read by id), so the descriptor carries
     * only the recipient half.
     */
    | ({
          readonly kind: "activated-grant";
          readonly abilityId: string;
      } & (
          | { readonly appliesTo: "host"; readonly filter?: never }
          | CompiledKickedSelfScope
      ))
    /**
     * CR 508.1c — "Enchanted creature can't attack." / CR 509.1b — "…can't
     * block." Unconditional, so the rebuilt predicate is a constant `false`.
     *
     * No scope field, and deliberately: the engine collects these from a
     * creature's OWN definition and from every permanent ATTACHED to it
     * (`collectAttackRestrictions` / `collectBlockRestrictions`,
     * `gre/combat.ts`), so the host is the only creature an Aura's copy can
     * ever restrict. A scope field here would be a claim the engine does not
     * read. The compiler emits one only on an Aura (`oracle/lower.ts`).
     */
    | {
          readonly kind: "attack-restriction" | "block-restriction";
          readonly id: string;
          readonly oracleText: string;
      }
    /** CR 601.2f — "<spells> cost {N} more/less to cast". */
    | {
          readonly kind: "cost-modifier";
          readonly spells: CompiledSpellFilter;
          /** Generic mana added to the cost. Exclusive with `reduction`. */
          readonly increase?: number;
          /** Generic mana removed from the cost. Exclusive with `increase`. */
          readonly reduction?: number;
      }
    /**
     * CR 601.3 / 118.9 — "<grantee> may cast <class> spells [without paying
     * their mana costs] [as though they had flash]" (issue #3268).
     *
     * The one member that is its own engine effect verbatim rather than a
     * descriptor OF one, and the reason is the reason this module exists said
     * backwards: `StaticCastPermission` carries no predicate at all. Its
     * `filter` is a declarative `EffectCardFilter` read by
     * `handCardMatchesFilter` at cast time (`gre/castPermissions.ts`), so
     * there is nothing to rebuild and nothing a JSON emitter has to leave
     * behind. Re-declaring the same six fields here would only create a shape
     * that could drift from the one the engine reads.
     */
    | StaticCastPermission;

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
/**
 * CR 611.3a / 109.5 — "as long as you control a <descriptor>", read off the
 * layer view: at least `atLeast` permanents on the SOURCE controller's
 * battlefield match, through the same `filterMatches` (live colours via
 * `ctx.getColors`) every compiled static predicate uses.
 */
function controlsHolds(
    condition: CompiledControlsCondition,
    source: PermanentView,
    state: StaticEffectStateView,
    ctx: StaticEffectContext
): boolean {
    let matched = 0;
    for (const player of state.players)
        for (const permanent of player.battlefield) {
            if (permanent.controllerId !== source.controllerId) continue;
            if (!filterMatches(condition.filter, permanent, source, ctx))
                continue;
            matched += 1;
            if (matched >= condition.atLeast) return true;
        }
    return false;
}

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

/** CR 118.7a — a generic-only cost delta, as the engine's `ManaCost`. */
function generic(amount: number): ManaCost {
    return { X: amount };
}

/** A descriptor's scope as the `applies` predicate its effect declares. */
function scopePredicate(
    scope: CompiledStaticScope
): StaticKeywordGrant["applies"] {
    if (scope.appliesTo === "host") return AURA_AFFECTS_HOST;
    if (scope.appliesTo === "self")
        return (target, source) => target.id === source.id;
    if (scope.appliesTo === "self-if-kicked") {
        const kickerId = scope.kickerId;
        return (target, source) =>
            target.id === source.id &&
            (kickerId === undefined
                ? target.wasKicked === true
                : (target.kickerPayments?.[kickerId] ?? 0) >= 1);
    }
    const filter = scope.filter;
    return (target, source, ctx) => filterMatches(filter, target, source, ctx);
}

/** One descriptor → the real continuous effect. */
export function resolveCompiledStatic(
    descriptor: CompiledStaticEffect
): StaticEffect {
    switch (descriptor.kind) {
        case "pt-buff": {
            const condition = descriptor.condition;
            return {
                kind: "pt-buff",
                applies: scopePredicate(descriptor),
                power: descriptor.power,
                toughness: descriptor.toughness,
                ...(condition !== undefined
                    ? {
                          condition: (source, state, ctx) =>
                              controlsHolds(condition, source, state, ctx),
                      }
                    : {}),
            };
        }
        case "keyword-grant":
            return {
                kind: "keyword-grant",
                applies: scopePredicate(descriptor),
                keyword: descriptor.keyword,
            };
        case "control-change":
            return { kind: "control-change", applies: AURA_AFFECTS_HOST };
        case "activated-grant":
            return {
                kind: "activated-grant",
                applies: scopePredicate(descriptor),
                abilityId: descriptor.abilityId,
            };
        case "attack-restriction":
            return {
                kind: "attack-restriction",
                id: descriptor.id,
                predicate: () => false,
                oracleText: descriptor.oracleText,
            };
        case "block-restriction":
            return {
                kind: "block-restriction",
                id: descriptor.id,
                // CR 509.1b — the restriction is on the enchanted creature AS
                // a blocker; the attacker side restricts who may block IT.
                side: "blocker",
                predicate: () => false,
                oracleText: descriptor.oracleText,
            };
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
        // CR 601.3 — already the engine's own effect (see the union member):
        // returned unchanged rather than reassembled field by field, so a
        // field added to `StaticCastPermission` reaches the engine without an
        // edit here that could be forgotten.
        case "cast-permission":
            return descriptor;
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
