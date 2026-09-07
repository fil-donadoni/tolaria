// CR 613.8 — the dependency system, the part of the layer system that overrides
// timestamp order. ADR 0115 is the design record; issue #2068 is the work.
//
// CR 613.8a defines the relation:
//
//   An effect is said to "depend on" another if (a) it's applied in the same
//   layer (and, if applicable, sublayer) as the other effect; (b) applying the
//   other would change the text or the existence of the first effect, what it
//   applies to, or what it does to any of the things it applies to; and (c)
//   neither effect is from a characteristic-defining ability or both effects
//   are from characteristic-defining abilities.
//
// Clause (b) is the only hard half, and it is answered DECLARATIVELY here: an
// edge is `writes(B) ∩ reads(A) ≠ ∅` within one layer, read from static
// metadata, never "apply B, re-derive A and diff the result". The write set is
// free — it is the entry's payload kind, and clause (a) narrows it hard, since
// each layer writes one family of characteristics and nothing crosses layers.
// The read set is declared: a table keyed on `StaticEffect["kind"]` whose
// exhaustiveness `tsc` enforces, plus the per-declaration `reads` override
// (`cards/types.ts`) for a predicate narrower than its kind's default.
//
// CR 613.8c — "After each effect is applied, the order of remaining effects is
// reevaluated" — is discharged as VACUOUS, and that is a documented
// APPROXIMATION rather than a faithful implementation (ADR 0115 decision 3). An
// edge read from static metadata cannot change under application, so the graph
// is fixed and there is nothing to re-evaluate. A dependency that exists only on
// a board mid-application is invisible to this system; the guard against that is
// the oracle in `__tests__/dependency.test.ts`, which implements CR 613.8a
// literally and is asserted to agree with this table on every acceptance board.

import type {
    ContinuousCharacteristic,
    ContinuousRead,
    PermanentView,
    StaticEffect,
    StaticEffectContext,
} from "../cards/types";
import { BASIC_LAND_SUBTYPES } from "../cards/types";
import type { ContinuousEffect } from "./continuousEffects";

/** The live source and `StaticEffect` behind a TEMPLATE entry. Structurally the
 *  `DerivedTemplate` every layer module already keeps beside its entries, named
 *  here so this module never has to look either up itself. */
export type DependencyTemplate = {
    source: PermanentView;
    effect: StaticEffect;
};

/** What a caller must be able to answer about an entry. One function, because
 *  each layer resolves a template differently (a derived entry has its closure
 *  in hand; a stored one names its source by id) and none of that belongs
 *  here. */
export type DependencyContext = {
    /** CR 613.7 — the layer's OWN comparator, used for every tie CR 613.8b
     *  hands back to the timestamp system: between ready groups, and inside a
     *  dependency loop. Never a fresh `a.timestamp - b.timestamp` — layer 6
     *  wraps the registry comparator so that removals precede grants at an
     *  equal timestamp, and losing that tie-break would make the walk disagree
     *  with `grantOutrankedByAbilityLoss`. */
    compare: (a: ContinuousEffect, b: ContinuousEffect) => number;
    /** The template behind `entry`, or `undefined` for an inline payload. */
    template: (entry: ContinuousEffect) => DependencyTemplate | undefined;
    ctx: StaticEffectContext;
};

/** CR 613.8a clause (b), the READ half — the default per `StaticEffect` kind.
 *
 *  Exhaustive over the union by construction (`Record<StaticEffect["kind"], …>`),
 *  so a new kind that ships without a row is a `tsc` error rather than a
 *  silently independent effect — ADR 0115's consequence list.
 *
 *  Every row is EMPTY, and that is the argued position rather than a stub. ADR
 *  0115 decision 1 proposed a per-kind default that "over-declares by
 *  construction, being the union of what any predicate of that kind could
 *  read". Building it showed why decision 2's warning — keep the table tight,
 *  never generous — swallows decision 1: a wide row does not merely add
 *  harmless edges.
 *
 *  The reason is that reads and writes are not symmetric. Within layer 4 the
 *  catalogue's predicates read a counter (Cyclopean Tomb), an Aura host (Evil
 *  Presence), the PRINTED type line (Blood Moon), the live card types (Yavimaya,
 *  Cradle of Growth) and the live subtypes (Life and Limb) — no union is both
 *  narrow enough to be safe and wide enough to be right. Give them all
 *  {types, subtypes, supertypes} and Cyclopean Tomb, whose predicate reads a
 *  mire counter and nothing else, is made to wait for Blood Moon, which reads
 *  neither: a ONE-DIRECTIONAL phantom edge, and CR 613.9's first example is the
 *  proof that order is observable between independent effects ("applying them in
 *  timestamp order means the one that was generated last wins").
 *
 *  So a kind asserts nothing about its predicates and a DECLARATION asserts
 *  everything (`reads`, `DependencyReads` in `cards/types.ts`). An undeclared
 *  effect participates in no applies-limb edge, which leaves it exactly where CR
 *  613.7 put it: an undeclared effect can fail to be ordered by dependency,
 *  never be ordered wrongly by it. The EXISTENCE limb needs no declaration at
 *  all — it is a fact about provenance, not about a predicate — so CR 305.7 goes
 *  on ordering Urborg, Tomb of Yawgmoth behind Blood Moon whether or not either
 *  card ever says a word about its reads.
 *
 *  The CR 611.3 rules-modifying kinds are empty for a second, independent
 *  reason: they are not in the layer system at all (ADR 0082 decision 2) and
 *  never reach this module.
 */
export const STATIC_EFFECT_READS: Record<
    StaticEffect["kind"],
    readonly ContinuousRead[]
> = {
    // --- CR 613 layers 2-7 --------------------------------------------------
    "control-change": [],
    "type-add": [],
    "type-remove": [],
    "subtype-set": [],
    "subtype-add": [],
    "supertype-set": [],
    "color-grant": [],
    "keyword-grant": [],
    "keyword-remove": [],
    "ability-loss": [],
    "activated-grant": [],
    "triggered-grant": [],
    "pt-cda": [],
    "pt-set": [],
    "pt-buff": [],
    // --- CR 611.3, outside the layer system ---------------------------------
    "attack-restriction": [],
    "declared-attack-restriction": [],
    "declared-block-restriction": [],
    "block-restriction": [],
    "combat-declaration-cap": [],
    "global-attack-restriction": [],
    "attack-sacrifice-tax": [],
    "attack-mana-tax": [],
    "attack-requirement": [],
    "block-requirement": [],
    "landwalk-negation": [],
    "enters-tapped-restriction": [],
    "untap-restriction": [],
    "hand-size-override": [],
    "cost-modifier": [],
    "additional-cost": [],
    "mana-substitution": [],
    "permanent-guard": [],
    "player-guard": [],
    "combat-damage-prevention": [],
    "combat-damage-unpreventable": [],
    "cast-restriction": [],
    "cast-timing-lock": [],
};

/** CR 604.3 — the `StaticEffect` kinds that generate a CHARACTERISTIC-DEFINING
 *  ability, which CR 613.8a clause (c) makes a dependency barrier: a dependency
 *  exists only when neither effect is from a CDA or both are.
 *
 *  One kind qualifies today. `dependency.test.ts` pins this set against the
 *  layer-2-to-6 kind tables, so the day a CDA kind lands in one of them — CR
 *  702.73 Changeling defines subtypes in layer 4 and is `status: "planned"` in
 *  the Mechanics Registry — the guard reds instead of clause (c) failing open
 *  and silently, which is what a comment asserting "no layer-2-6 kind is a CDA"
 *  would have done. */
export const CDA_STATIC_EFFECT_KINDS: ReadonlySet<StaticEffect["kind"]> =
    new Set<StaticEffect["kind"]>(["pt-cda"]);

/** What an entry WRITES — CR 613.8a clause (b) seen from the other side, and
 *  the free half of the relation: one characteristic family per payload, and
 *  clause (a) guarantees the two entries being compared are in the same layer,
 *  so no cross-layer pair is ever asked.
 *
 *  `values` narrows the family to what this entry actually puts there, when that
 *  is statically knowable. `undefined` means ANY value, and it is the honest
 *  answer for a whole-line REPLACEMENT (which removes values it cannot name) and
 *  for a computed output (`subtypesFor`, Illusionary Terrain), both of which can
 *  change a value any predicate of the family reads. */
type ContinuousWrite = {
    characteristic: ContinuousCharacteristic;
    values?: readonly string[];
};

function writesOf(
    entry: ContinuousEffect,
    template: DependencyTemplate | undefined
): ContinuousWrite | undefined {
    if (entry.payload.kind !== "template") {
        const payload = entry.payload;
        switch (payload.kind) {
            case "control-change":
                return { characteristic: "controller" };
            case "text-change":
                return { characteristic: "text" };
            case "type-change":
                return {
                    characteristic: "types",
                    // A `set` replaces the whole line, so it can strip a type it
                    // does not name: ANY value.
                    ...(payload.set
                        ? {}
                        : {
                              values: [
                                  ...(payload.add ?? []),
                                  ...(payload.remove ?? []),
                              ],
                          }),
                };
            case "subtype-change":
                return {
                    characteristic: "subtypes",
                    ...(payload.set ? {} : { values: payload.add ?? [] }),
                };
            case "supertype-change":
                return {
                    characteristic: "supertypes",
                    values: [...(payload.add ?? []), ...(payload.remove ?? [])],
                };
            case "color-change":
                return {
                    characteristic: "colors",
                    ...(payload.set ? {} : { values: payload.add ?? [] }),
                };
            case "keyword-grant":
                return {
                    characteristic: "abilities",
                    values: [payload.keyword],
                };
            case "keyword-remove":
                return {
                    characteristic: "abilities",
                    values: [payload.keyword],
                };
            case "ability-loss":
            case "activated-grant":
            case "triggered-grant":
                return { characteristic: "abilities" };
            case "pt-set":
            case "pt-modify":
            case "pt-switch":
                return { characteristic: "pt" };
        }
    }
    const effect = template?.effect;
    switch (effect?.kind) {
        case "control-change":
            return { characteristic: "controller" };
        case "type-add":
        case "type-remove":
            return { characteristic: "types", values: effect.types };
        case "subtype-add":
            return { characteristic: "subtypes", values: effect.subtypes };
        case "subtype-set":
            // CR 205.1a — a replacement, so any subtype can disappear.
            return { characteristic: "subtypes" };
        case "supertype-set":
            return {
                characteristic: "supertypes",
                values: [...(effect.add ?? []), ...(effect.remove ?? [])],
            };
        case "color-grant":
            return { characteristic: "colors", values: effect.colors };
        case "keyword-grant":
            return { characteristic: "abilities", values: [effect.keyword] };
        case "keyword-remove":
            return { characteristic: "abilities", values: [effect.keyword] };
        case "ability-loss":
        case "activated-grant":
        case "triggered-grant":
            return { characteristic: "abilities" };
        case "pt-cda":
        case "pt-set":
        case "pt-buff":
            return { characteristic: "pt" };
        default:
            return undefined;
    }
}

/** CR 613.8a clause (b) — does what `write` puts on the board intersect what
 *  `read` looks for? The family must match; the VALUES need only overlap when
 *  both sides know theirs. */
function intersects(read: ContinuousRead, write: ContinuousWrite): boolean {
    const characteristic =
        typeof read === "string" ? read : read.characteristic;
    if (characteristic !== write.characteristic) return false;
    if (typeof read === "string" || write.values === undefined) return true;
    return write.values.some((value) => read.values.includes(value));
}

/** CR 613.8a clause (b), the READ half for one entry.
 *
 *  A TEMPLATE entry reads what its declaration says, or — undeclared — what its
 *  kind's row says, which is nothing (see {@link STATIC_EFFECT_READS}).
 *
 *  An INLINE entry reads NOTHING, and here the literal reading and the safe one
 *  agree. CR 611.2c freezes the affected set of a resolution-generated effect
 *  when it begins and its payload is data rather than a closure, so neither
 *  "what it applies to" nor "what it does to them" can change under another
 *  effect: it can be the TARGET of a dependency but never a dependent (ADR 0115,
 *  the structural asymmetry).
 *
 *  `rules-text` rides on every TEMPLATE entry: the effect exists because its
 *  source's rules text generates it, so anything destroying that rules text
 *  destroys the effect — CR 613.8a's EXISTENCE limb. It is implicit rather than
 *  declarable, being a fact about provenance and not about the predicate. An
 *  inline entry does not carry it: its source is gone, and CR 611.2a keeps the
 *  effect alive without one.
 */
function readsOf(
    entry: ContinuousEffect,
    template: DependencyTemplate | undefined
): readonly ContinuousRead[] {
    if (entry.payload.kind !== "template" || !template) return [];
    const declared =
        template.effect.reads ?? STATIC_EFFECT_READS[template.effect.kind];
    return [...declared, "rules-text"];
}

/** Whether this entry's read set was DECLARED rather than defaulted. The only
 *  thing that can make a group's edges asymmetric, alongside CR 305.7 — so a
 *  group with neither is provably one dependency loop, which CR 613.8b resolves
 *  to the timestamp order the caller already produced. */
function declaresReads(
    entry: ContinuousEffect,
    template: DependencyTemplate | undefined
): boolean {
    return (
        entry.payload.kind === "template" &&
        template?.effect.reads !== undefined
    );
}

/** CR 613.8a's EXISTENCE limb: would applying `entry` take away the rules text
 *  that generates `victim`'s own continuous effect?
 *
 *  Two rules answer yes, one per layer that can express the question:
 *
 *  - CR 305.7 (layer 4) — "If an effect sets a land's subtype to one or more of
 *    the basic land types ... It loses all abilities generated from its rules
 *    text". This is why Urborg, Tomb of Yawgmoth depends on Blood Moon while
 *    Blood Moon depends on nothing.
 *  - CR 613.1f (layer 6) — an effect that removes ALL abilities. Applying
 *    Humility to Lord of Atlantis destroys the ability granting islandwalk, so
 *    the grant depends on Humility and is applied after it, which is to say
 *    never. A single-keyword removal is NOT this: it takes a keyword away from
 *    the objects it applies to and leaves the granting ability intact.
 *
 *  Asked of a SPECIFIC permanent rather than declared, because the computed form
 *  of a subtype set (`subtypesFor`, Illusionary Terrain) chooses its replacement
 *  per target: Conspiracy sets a creature's subtypes and destroys no rules text;
 *  Magus of the Moon sets a land's to Mountain and destroys all of it. Two
 *  predicate evaluations on the LIVE board — not a speculative re-derivation on
 *  a hypothetical one. */
function destroysRulesTextOf(
    entry: ContinuousEffect,
    template: DependencyTemplate | undefined,
    victim: PermanentView,
    ctx: StaticEffectContext
): boolean {
    if (removesAllAbilitiesFrom(entry, template, victim, ctx)) return true;
    // CR 305.7 is a rule about LANDS. A subtype set on anything else leaves its
    // rules text alone.
    if (!victim.types.includes("Land")) return false;
    const replacement = subtypeReplacementFor(entry, template, victim, ctx);
    if (replacement === undefined) return false;
    // "to one or more of the basic land types" — a set naming no basic land
    // type (Conspiracy's chosen creature type) is not CR 305.7's effect.
    return replacement.some((subtype) => BASIC_LAND_SUBTYPES.includes(subtype));
}

/** CR 613.1f — whether `entry` strips EVERY ability from `victim`. */
function removesAllAbilitiesFrom(
    entry: ContinuousEffect,
    template: DependencyTemplate | undefined,
    victim: PermanentView,
    ctx: StaticEffectContext
): boolean {
    if (entry.payload.kind !== "template") {
        if (entry.payload.kind !== "ability-loss") return false;
        return (
            entry.affected.kind === "predicate" ||
            entry.affected.instanceIds.includes(victim.id)
        );
    }
    if (!template) return false;
    const effect = template.effect;
    if (effect.kind !== "ability-loss") return false;
    return effect.applies(victim, template.source, ctx);
}

/** The subtypes `entry` would REPLACE `victim`'s with, or `undefined` when it
 *  replaces nothing (a different payload, or a predicate that does not match).
 *  Both forms of `subtype-set` are covered: the fixed-output form gates on
 *  `applies` and yields its literal, the computed form asks `subtypesFor`
 *  (ADR 0050). */
function subtypeReplacementFor(
    entry: ContinuousEffect,
    template: DependencyTemplate | undefined,
    victim: PermanentView,
    ctx: StaticEffectContext
): readonly string[] | undefined {
    if (entry.payload.kind !== "template") {
        const payload = entry.payload;
        if (payload.kind !== "subtype-change" || !payload.set) return undefined;
        return entry.affected.kind === "instances" &&
            !entry.affected.instanceIds.includes(victim.id)
            ? undefined
            : payload.set;
    }
    if (!template) return undefined;
    const effect = template.effect;
    if (effect.kind !== "subtype-set") return undefined;
    if (effect.subtypesFor) {
        return effect.subtypesFor(victim, template.source, ctx) ?? undefined;
    }
    if (!effect.applies?.(victim, template.source, ctx)) return undefined;
    return effect.subtypes;
}

/** One node of a layer's dependency graph. */
type DependencyNode = {
    entry: ContinuousEffect;
    template: DependencyTemplate | undefined;
    reads: readonly ContinuousRead[];
    writes: ContinuousWrite | undefined;
    /** The permanent whose rules text generates this effect, when it has one —
     *  the victim CR 305.7 is asked about. */
    rulesTextSource: PermanentView | undefined;
    cda: boolean;
};

/** CR 613.8a for ONE pair of entries, clause (a) included — the relation this
 *  module runs on, exposed so the ORACLE can be held against it rather than
 *  against a hand-written answer key (ADR 0115 decision 4). A test asserting
 *  what it already believes proves nothing; the oracle's job is to disagree
 *  with this function when the declared table is wrong. */
export function continuousEffectDependsOn(
    a: ContinuousEffect,
    b: ContinuousEffect,
    context: Pick<DependencyContext, "template" | "ctx">
): boolean {
    if (groupKeyOf(a) !== groupKeyOf(b)) return false;
    return dependsOn(nodeOf(a, context), nodeOf(b, context), context.ctx);
}

/** One graph node, built from an entry and the caller's template resolver. */
function nodeOf(
    entry: ContinuousEffect,
    context: Pick<DependencyContext, "template">
): DependencyNode {
    const template = context.template(entry);
    return {
        entry,
        template,
        reads: readsOf(entry, template),
        writes: writesOf(entry, template),
        rulesTextSource:
            entry.payload.kind === "template" ? template?.source : undefined,
        cda: entry.characteristicDefining,
    };
}

/** CR 613.8a — does `a` depend on `b`? Clause (a) is the caller's (both nodes
 *  come from one layer/sublayer group); clauses (b) and (c) are here. */
function dependsOn(
    a: DependencyNode,
    b: DependencyNode,
    ctx: StaticEffectContext
): boolean {
    // Clause (c) — a dependency exists only when neither effect is from a
    // characteristic-defining ability or both are.
    if (a.cda !== b.cda) return false;
    // Clause (b), "what it applies to" / "what it does to them".
    const write = b.writes;
    if (write && a.reads.some((read) => intersects(read, write))) return true;
    // Clause (b), the EXISTENCE limb (CR 305.7, CR 613.1f).
    if (!a.rulesTextSource) return false;
    return destroysRulesTextOf(b.entry, b.template, a.rulesTextSource, ctx);
}

/** CR 613.8 — `entries` in the order the layer system applies them.
 *
 *  Entries must already be in the caller's own order: this function reorders
 *  WITHIN each (layer, sublayer) group and never across groups, so a caller
 *  that sorted by layer first (layers 2-5 walk 2 -> 3 -> 4 -> 5 in one pass)
 *  keeps that arrangement.
 *
 *  Groups of one — overwhelmingly the common case — cost a `length` check.
 */
export function orderByDependency(
    entries: readonly ContinuousEffect[],
    context: DependencyContext
): ContinuousEffect[] {
    if (entries.length < 2) return [...entries];
    const ordered: ContinuousEffect[] = [];
    let index = 0;
    while (index < entries.length) {
        const start = index;
        const key = groupKeyOf(entries[start]);
        while (index < entries.length && groupKeyOf(entries[index]) === key) {
            index++;
        }
        const group = entries.slice(start, index);
        ordered.push(
            ...(group.length < 2 ? group : orderGroup(group, context))
        );
    }
    return ordered;
}

/** CR 613.8a clause (a) — "the same layer (and, if applicable, sublayer)". */
function groupKeyOf(entry: ContinuousEffect): string {
    return `${entry.layer}/${entry.sublayer ?? ""}`;
}

/** The whole algorithm, on ONE layer/sublayer group (ADR 0115 decision 6):
 *
 *  1. Tarjan over the dependency graph, condensing every dependency LOOP into a
 *     strongly connected component — CR 613.8b's "if several dependent effects
 *     form a dependency loop, then this rule is ignored and the effects in the
 *     dependency loop are applied in timestamp order". "This rule is ignored"
 *     applies to the effects INSIDE the loop only, so only the edges within a
 *     component are dropped; an effect outside a loop that depends on a loop
 *     member still waits for it.
 *  2. Kahn over the EFFECTS — not over the components. CR 613.8b's first two
 *     sentences are per-effect: an effect waits "until just after all of those
 *     effects have been applied", and effects that could apply simultaneously go
 *     "in timestamp order relative to each other". Emitting a whole component
 *     before starting the next would keep two INDEPENDENT effects from
 *     interleaving by timestamp, which is CR 613.9's example ("applying them in
 *     timestamp order means the one that was generated last wins") and the
 *     behaviour of this engine before 613.8 existed.
 *
 *  "Timestamp order" is the caller's comparator throughout, never a raw
 *  timestamp subtraction: layer 6's puts a removal before a grant at an equal
 *  stamp, and that tie-break is what makes the walk agree with
 *  `grantOutrankedByAbilityLoss`.
 */
function orderGroup(
    group: readonly ContinuousEffect[],
    context: DependencyContext
): ContinuousEffect[] {
    const templates = group.map((entry) => context.template(entry));
    // A group in which nothing declares a read set and nothing can end another
    // effect's existence has NO edges at all: the applies-limb needs a declared
    // read (every kind's default row is empty) and the existence limb needs a
    // subtype replacement or a total ability removal. Proving that with two
    // field reads per entry, rather than building the graph and discovering it,
    // keeps the cost off layer 7 — the derivation every state-based-action
    // sweep asks of every creature.
    let asymmetric = false;
    for (let i = 0; i < group.length && !asymmetric; i++) {
        asymmetric =
            declaresReads(group[i], templates[i]) ||
            canDestroyRulesText(group[i], templates[i]);
    }
    if (!asymmetric) return [...group];

    const nodes: DependencyNode[] = group.map((entry) =>
        nodeOf(entry, context)
    );

    // `edges[a]` = the nodes `a` depends on, i.e. the ones it waits for.
    const edges: number[][] = nodes.map(() => []);
    let anyEdge = false;
    for (let a = 0; a < nodes.length; a++) {
        for (let b = 0; b < nodes.length; b++) {
            if (a === b) continue;
            if (!dependsOn(nodes[a], nodes[b], context.ctx)) continue;
            edges[a].push(b);
            anyEdge = true;
        }
    }
    // CR 613.8's "sometimes": no dependency in this layer, so the timestamp
    // system stands unchanged.
    if (!anyEdge) return [...group];

    // CR 613.8b's loop clause — an edge inside a component is ignored.
    const component = tarjan(edges);
    const pending = nodes.map((_, a) =>
        edges[a].reduce(
            (count, b) => count + (component[a] === component[b] ? 0 : 1),
            0
        )
    );
    const blocks: number[][] = nodes.map(() => []);
    for (let a = 0; a < edges.length; a++) {
        for (const b of edges[a]) {
            if (component[a] === component[b]) continue;
            blocks[b].push(a);
        }
    }

    const remaining = new Set<number>(nodes.map((_, i) => i));
    const result: number[] = [];
    while (remaining.size > 0) {
        // Among the effects whose dependencies have all been applied, the
        // earliest by the layer's own comparator (CR 613.8b, second sentence).
        let pick: number | undefined;
        for (const candidate of remaining) {
            if (pending[candidate] > 0) continue;
            if (
                pick === undefined ||
                context.compare(nodes[candidate].entry, nodes[pick].entry) < 0
            ) {
                pick = candidate;
            }
        }
        // Unreachable: a condensation is acyclic, so some effect is always
        // ready. Falling back to the comparator rather than looping forever
        // keeps a future graph-construction bug from hanging a read.
        if (pick === undefined) {
            const rest = [...remaining];
            rest.sort((x, y) =>
                context.compare(nodes[x].entry, nodes[y].entry)
            );
            result.push(...rest);
            break;
        }
        remaining.delete(pick);
        result.push(pick);
        for (const blocked of blocks[pick]) pending[blocked]--;
    }
    return applyExistence(result, nodes, context.ctx);
}

/** CR 613.8a's EXISTENCE limb, carried through to its consequence: an effect
 *  whose source's rules text has already been destroyed by an earlier-applied
 *  effect in this layer does not exist, so it is not applied at all.
 *
 *  CR 305.7 — "It loses all abilities generated from its rules text" — is why
 *  Blood Moon beats Urborg, Tomb of Yawgmoth at either timestamp rather than
 *  merely being applied before it. Ordering alone would leave the land a
 *  Mountain AND a Swamp, because Urborg's own effect would still be waiting
 *  behind Blood Moon's. The dependency decides that Blood Moon goes first; this
 *  is what "first" then means.
 *
 *  Scoped to the layer, like every other clause of CR 613.8a. A source's
 *  effects in OTHER layers are not suppressed here: that is CR 305.7 applied to
 *  a source's whole rules text, a rule about ability removal rather than about
 *  ordering, and this engine's gap in it predates the dependency system.
 */
function applyExistence(
    order: readonly number[],
    nodes: readonly DependencyNode[],
    ctx: StaticEffectContext
): ContinuousEffect[] {
    const destroyed = new Set<string>();
    const applied: ContinuousEffect[] = [];
    for (const index of order) {
        const node = nodes[index];
        if (node.rulesTextSource && destroyed.has(node.rulesTextSource.id)) {
            continue;
        }
        applied.push(node.entry);
        // Marked AFTER this entry is applied, so an effect that destroys the
        // rules text of its OWN source still applies once: the CR never lets an
        // effect un-apply itself.
        for (const other of nodes) {
            const victim = other.rulesTextSource;
            if (!victim || destroyed.has(victim.id)) continue;
            if (destroysRulesTextOf(node.entry, node.template, victim, ctx)) {
                destroyed.add(victim.id);
            }
        }
    }
    return applied;
}

/** Whether this entry could END another effect's existence at all — a subtype
 *  REPLACEMENT (CR 305.7) or a total ability removal (CR 613.1f). The cheap half
 *  of {@link destroysRulesTextOf}, asked of no particular victim, so a group can
 *  be shown edge-free without evaluating a single predicate. */
function canDestroyRulesText(
    entry: ContinuousEffect,
    template: DependencyTemplate | undefined
): boolean {
    if (entry.payload.kind !== "template") {
        return (
            entry.payload.kind === "ability-loss" ||
            (entry.payload.kind === "subtype-change" && !!entry.payload.set)
        );
    }
    const kind = template?.effect.kind;
    return kind === "subtype-set" || kind === "ability-loss";
}

/** Tarjan's strongly connected components, iterative so a deep graph cannot
 *  blow the stack on a hot derivation path. Returns one component index per
 *  node; indices come out in reverse topological order, which this module does
 *  not rely on — Kahn re-derives the order it needs. */
function tarjan(edges: readonly number[][]): number[] {
    const size = edges.length;
    const index = new Array<number>(size).fill(-1);
    const low = new Array<number>(size).fill(0);
    const onStack = new Array<boolean>(size).fill(false);
    const component = new Array<number>(size).fill(-1);
    const stack: number[] = [];
    let nextIndex = 0;
    let nextComponent = 0;

    for (let root = 0; root < size; root++) {
        if (index[root] !== -1) continue;
        // Each frame is a node plus how far through its edge list we are.
        const frames: { node: number; edge: number }[] = [
            { node: root, edge: 0 },
        ];
        index[root] = low[root] = nextIndex++;
        stack.push(root);
        onStack[root] = true;
        while (frames.length > 0) {
            const frame = frames[frames.length - 1];
            if (frame.edge < edges[frame.node].length) {
                const next = edges[frame.node][frame.edge++];
                if (index[next] === -1) {
                    index[next] = low[next] = nextIndex++;
                    stack.push(next);
                    onStack[next] = true;
                    frames.push({ node: next, edge: 0 });
                } else if (onStack[next]) {
                    low[frame.node] = Math.min(low[frame.node], index[next]);
                }
                continue;
            }
            frames.pop();
            const parent = frames[frames.length - 1];
            if (parent) {
                low[parent.node] = Math.min(low[parent.node], low[frame.node]);
            }
            if (low[frame.node] === index[frame.node]) {
                for (;;) {
                    const member = stack.pop()!;
                    onStack[member] = false;
                    component[member] = nextComponent;
                    if (member === frame.node) break;
                }
                nextComponent++;
            }
        }
    }
    return component;
}
