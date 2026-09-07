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
 *  Exhaustive over the union by construction (`Record<StaticEffect["kind"], …>`,
 *  so a new kind that ships without a row is a `tsc` error rather than a
 *  silently independent effect — ADR 0115's consequence list).
 *
 *  Each row is the union of what any predicate of that kind could read WITHIN
 *  ITS OWN LAYER; clause (a) makes every other characteristic irrelevant, since
 *  an effect in another layer can never be depended on. The consequence of a
 *  wide row is not a wrong order but NO order: two effects that read each
 *  other's writes are mutually dependent, and CR 613.8b sends a dependency loop
 *  straight back to timestamp order, which is what this engine did before
 *  613.8 existed. A declaration narrows its own row with `reads`
 *  (`DependencyReads`, `cards/types.ts`) when it needs a real edge.
 *
 *  The CR 611.3 rules-modifying kinds read nothing because they are not in the
 *  layer system at all (ADR 0082 decision 2) and never reach this module; their
 *  rows exist only so the record stays total. */
export const STATIC_EFFECT_READS: Record<
    StaticEffect["kind"],
    readonly ContinuousCharacteristic[]
> = {
    // --- Layer 2 (CR 613.1b) ------------------------------------------------
    // A control-changing predicate can read the target's CURRENT controller
    // ("gain control of each creature an opponent controls"), which is the one
    // thing layer 2 writes.
    "control-change": ["controller"],

    // --- Layer 4 (CR 613.1d) ------------------------------------------------
    // Layer 4 writes three families and its predicates read all three: card
    // types (`ctx.isCreature`, `target.types.includes("Land")`), subtypes
    // (`IS_FOREST_OR_SAPROLING`) and supertypes (`IS_NONBASIC_LAND`).
    "type-add": ["types", "subtypes", "supertypes"],
    "type-remove": ["types", "subtypes", "supertypes"],
    "subtype-set": ["types", "subtypes", "supertypes"],
    "subtype-add": ["types", "subtypes", "supertypes"],
    "supertype-set": ["types", "subtypes", "supertypes"],

    // --- Layer 5 (CR 613.1e) ------------------------------------------------
    "color-grant": ["colors"],

    // --- Layer 6 (CR 613.1f) ------------------------------------------------
    // An ability-matters predicate reads abilities, which is all layer 6
    // writes ("creatures with flying lose flying").
    "keyword-grant": ["abilities"],
    "keyword-remove": ["abilities"],
    "ability-loss": ["abilities"],
    "activated-grant": ["abilities"],
    "triggered-grant": ["abilities"],

    // --- Layer 7 (CR 613.4) -------------------------------------------------
    // A P/T-matters predicate reads P/T ("creatures with power 2 or less get
    // +1/+1"). Sublayers are separate groups, so a 7c buff can never be
    // depended on by a 7b set in the first place.
    "pt-cda": ["pt"],
    "pt-set": ["pt"],
    "pt-buff": ["pt"],

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

/** Which characteristic family an entry WRITES — CR 613.8a clause (b) seen from
 *  the other side, and the free half of the relation: one family per payload,
 *  and clause (a) guarantees the two entries being compared are in the same
 *  layer, so no cross-layer pair is ever asked. */
function writesOf(
    entry: ContinuousEffect,
    template: DependencyTemplate | undefined
): ContinuousCharacteristic | undefined {
    if (entry.payload.kind !== "template") {
        switch (entry.payload.kind) {
            case "control-change":
                return "controller";
            case "text-change":
                return "text";
            case "type-change":
                return "types";
            case "subtype-change":
                return "subtypes";
            case "supertype-change":
                return "supertypes";
            case "color-change":
                return "colors";
            case "keyword-grant":
            case "keyword-remove":
            case "ability-loss":
            case "activated-grant":
            case "triggered-grant":
                return "abilities";
            case "pt-set":
            case "pt-modify":
            case "pt-switch":
                return "pt";
        }
    }
    const kind = template?.effect.kind;
    switch (kind) {
        case "control-change":
            return "controller";
        case "type-add":
        case "type-remove":
            return "types";
        case "subtype-set":
        case "subtype-add":
            return "subtypes";
        case "supertype-set":
            return "supertypes";
        case "color-grant":
            return "colors";
        case "keyword-grant":
        case "keyword-remove":
        case "ability-loss":
        case "activated-grant":
        case "triggered-grant":
            return "abilities";
        case "pt-cda":
        case "pt-set":
        case "pt-buff":
            return "pt";
        default:
            return undefined;
    }
}

/** CR 613.8a clause (b), the READ half for one entry.
 *
 *  A TEMPLATE entry reads what its declaration says (`reads`) or what its kind
 *  says by default. An INLINE entry — CR 611.2c residue of a resolved spell,
 *  whose affected set was frozen when it began and whose payload is data rather
 *  than a closure — genuinely reads NOTHING: neither "what it applies to" nor
 *  "what it does to them" can change under another effect, so on the literal
 *  reading it can be the target of a dependency but never a dependent.
 *
 *  It is nevertheless given the same default as the effects around it, and that
 *  is a deliberate OVER-declaration. Taking the literal reading here would make
 *  every undeclared template effect in the layer depend on every inline one, in
 *  one direction, on no evidence: the asymmetry alone would produce the edge.
 *  A one-directional phantom edge REORDERS — CR 613.9's own example shows two
 *  independent effects still ordering by timestamp, with the later one winning —
 *  so it is not free (this is the case ADR 0115 decision 2 names, met in
 *  practice). Reading its own family instead makes an undeclared pair MUTUALLY
 *  dependent, and CR 613.8b sends a loop straight back to timestamp order: an
 *  undeclared effect can fail to be ordered by dependency, never be ordered
 *  wrongly by it.
 *
 *  `rules-text` rides on every TEMPLATE entry: the effect exists because its
 *  source's rules text generates it, so anything destroying that rules text
 *  destroys the effect — CR 613.8a's EXISTENCE limb. It is implicit rather than
 *  declarable, being a fact about provenance and not about the predicate. An
 *  inline entry does not carry it: its source is gone, and CR 611.2a keeps the
 *  effect alive without it.
 */
function readsOf(
    entry: ContinuousEffect,
    template: DependencyTemplate | undefined,
    writes: ContinuousCharacteristic | undefined
): readonly ContinuousCharacteristic[] {
    if (entry.payload.kind !== "template") {
        return writes === undefined ? [] : [writes];
    }
    if (!template) return [];
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

/** CR 305.7 — "If an effect sets a land's subtype to one or more of the basic
 *  land types ... It loses all abilities generated from its rules text". The
 *  one way one layer-4 effect can end another's EXISTENCE, and the reason
 *  Urborg, Tomb of Yawgmoth depends on Blood Moon while Blood Moon depends on
 *  nothing.
 *
 *  Asked of a SPECIFIC permanent rather than declared, because the computed
 *  form of a subtype set (`subtypesFor`, Illusionary Terrain) chooses its
 *  replacement per target: Conspiracy sets a creature's subtypes and destroys no
 *  rules text; Magus of the Moon sets a land's to Mountain and destroys all of
 *  it. Two predicate evaluations on the LIVE board — not a speculative
 *  re-derivation on a hypothetical one. */
function destroysRulesTextOf(
    entry: ContinuousEffect,
    template: DependencyTemplate | undefined,
    victim: PermanentView,
    ctx: StaticEffectContext
): boolean {
    // CR 305.7 is a rule about LANDS. A subtype set on anything else leaves its
    // rules text alone.
    if (!victim.types.includes("Land")) return false;
    const replacement = subtypeReplacementFor(entry, template, victim, ctx);
    if (replacement === undefined) return false;
    // "to one or more of the basic land types" — a set naming no basic land
    // type (Conspiracy's chosen creature type) is not CR 305.7's effect.
    return replacement.some((subtype) => BASIC_LAND_SUBTYPES.includes(subtype));
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
    reads: readonly ContinuousCharacteristic[];
    writes: ContinuousCharacteristic | undefined;
    /** The permanent whose rules text generates this effect, when it has one —
     *  the victim CR 305.7 is asked about. */
    rulesTextSource: PermanentView | undefined;
    cda: boolean;
};

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
    if (b.writes !== undefined && a.reads.includes(b.writes)) return true;
    // Clause (b), the EXISTENCE limb (CR 305.7).
    if (!a.rulesTextSource || !a.reads.includes("rules-text")) return false;
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
    // A group in which nothing declares a read set and nothing can destroy
    // rules text (CR 305.7) has, by construction, only SYMMETRIC edges: every
    // kind in a layer defaults to reading that layer's own write families, so
    // every pair is mutually dependent and CR 613.8b hands the whole group back
    // to the timestamp order the caller already produced. Proving that here
    // rather than computing it keeps the cost off layer 7, whose derivation
    // every state-based-action sweep asks of every creature.
    let asymmetric = false;
    for (let i = 0; i < group.length && !asymmetric; i++) {
        asymmetric =
            declaresReads(group[i], templates[i]) ||
            canDestroyRulesText(group[i], templates[i]);
    }
    if (!asymmetric) return [...group];

    const nodes: DependencyNode[] = group.map((entry, i) => {
        const template = templates[i];
        const writes = writesOf(entry, template);
        return {
            entry,
            template,
            reads: readsOf(entry, template, writes),
            writes,
            rulesTextSource:
                entry.payload.kind === "template"
                    ? template?.source
                    : undefined,
            cda: entry.characteristicDefining,
        };
    });

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

/** Whether this entry could END another effect's existence through CR 305.7 —
 *  a subtype REPLACEMENT, which is the only payload the rule speaks about. The
 *  cheap half of {@link destroysRulesTextOf}, asked of no particular victim, so
 *  a group can be shown symmetric without evaluating a single predicate. */
function canDestroyRulesText(
    entry: ContinuousEffect,
    template: DependencyTemplate | undefined
): boolean {
    if (entry.payload.kind !== "template") {
        return entry.payload.kind === "subtype-change" && !!entry.payload.set;
    }
    return template?.effect.kind === "subtype-set";
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
