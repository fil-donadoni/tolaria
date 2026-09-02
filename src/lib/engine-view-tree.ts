import {
    computeEngineViewBadge,
    type EngineViewBadge,
} from "~/lib/engine-view-badge";
import type {
    ActivatedAbility,
    CardDefinition,
    EffectOp,
    SpellMode,
    TriggeredAbility,
} from "@convex/cards/types";

/**
 * The Engine View tree (issue #2704, PRD #2693, ADR 0103 §9) — "how the engine
 * read this card", derived PURELY from the `CardDefinition` the registry
 * already hands the client (`tryGetDefinition`, ADR 0046).
 *
 * Three properties this module is built around, each of them a constraint the
 * issue states outright:
 *
 * 1. **No engine logic in the client.** Nothing here interprets, simulates or
 *    evaluates anything. It reads fields off a definition and names them. A
 *    chip says `amount: 3`, never "deals 3" — the moment this file starts
 *    explaining what an Op WOULD do it becomes a second, drifting
 *    implementation of `gre/effects/interpreter.ts`.
 * 2. **Hand-written and compiled definitions are indistinguishable.** A
 *    compiled `ready` card (`convex/cards/compiledCatalogue.ts`) is a plain
 *    `CardDefinition` registered through the same seam, so it walks through
 *    this builder on exactly the same path — there is deliberately no
 *    `source: "compiled"` branch anywhere below.
 * 3. **Nothing is silently dropped.** Chips are derived by ENUMERATING a
 *    node's own keys and subtracting the ones the walk consumes structurally
 *    ({@link STRUCTURAL_KEYS}), rather than by listing the keys worth showing.
 *    `convex/cards/types.ts` grows a field most weeks; an allow-list would
 *    render a card's new clause invisible while looking perfectly healthy,
 *    which is the exact failure mode `engine-view-badge.catalogue.test.ts`
 *    was written for one field census earlier.
 */

/** What KIND of construct a node is — the badge on its left, and the whole
 *  vocabulary the tree speaks. One per real construct on a `CardDefinition`;
 *  the six from the visual reference (`prototype/identity-v4`,
 *  `identity-engine-panel.tsx`) plus the three the definition shape forces:
 *  structured continuous effects, modal options and the back face. */
export type EngineNodeKind =
    /** A keyword static ability — a `staticAbilities[]` string (CR 702). */
    | "KW"
    /** A structured continuous effect — a `staticEffects[]` entry, applied by
     *  the layer system (`gre/layers.ts`, CR 611/613). Distinct from `KW`:
     *  one is a keyword the engine knows by name, the other is data. */
    | "STA"
    /** A target requirement announced at cast/activation (CR 601.2c). */
    | "TGT"
    /** One Effect Script Op (ADR 0045/0046). */
    | "EFF"
    /** A triggered ability (CR 603). */
    | "TRG"
    /** An activated ability (CR 602). */
    | "ACT"
    /** One option of a modal spell or ability (CR 700.2). */
    | "MOD"
    /** A hand-written TypeScript body — `resolve()` / `resolveSteps[]` / a
     *  mana-ability `effect` closure. The escape hatch of ADR 0045, and the
     *  only node the tree cannot look inside. */
    | "RES"
    /** The back face of a double-faced card (CR 712). */
    | "FACE";

/** One `key: value` parameter chip under a node's heading. `value` is already
 *  rendered to a string — see {@link formatChipValue}. */
export type EngineChip = { key: string; value: string };

export type EngineNode = {
    /** Stable path key (`trg.0.eff.1`) — the React key, and the reason the
     *  tree never needs an array index as one. */
    path: string;
    kind: EngineNodeKind;
    label: string;
    chips: EngineChip[];
    children: EngineNode[];
};

export type EngineViewTree = {
    cardId: string;
    cardName: string;
    /** The same badge the slot's chip renders, from the same single authority
     *  (`computeEngineViewBadge`) — never re-derived here, so the chip and the
     *  tree can never disagree about whether a card is protocol. */
    badge: EngineViewBadge;
    nodes: EngineNode[];
    /** How many resolution BODIES the card carries, and how many of those the
     *  engine reads as data. `declarative < total` means part of this card is
     *  hand-written TypeScript the tree cannot show you. A card with no body
     *  at all (a vanilla creature) reports `{ declarative: 0, total: 0 }` —
     *  the bar renders nothing rather than a vacuous 100%. */
    coverage: { declarative: number; total: number };
};

/** Keys the walk consumes STRUCTURALLY — it recurses into them, or renders
 *  them as their own node — so repeating them as a chip would print the same
 *  information twice, once uselessly flattened.
 *
 *  `id` and `oracleText` are here for a different reason: they are the node's
 *  own identity/label, already rendered by the heading. */
const STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
    "op",
    "effects",
    "then",
    "else",
    "modes",
    "resolve",
    "resolveSteps",
    "targetRequirement",
    "additionalTargetRequirements",
    "staticEffects",
    "staticAbilities",
    "activatedAbilities",
    "triggeredAbilities",
    "grantTemplates",
    "triggeredGrantTemplates",
    "delayedTriggers",
    "chapterAbilities",
    "backFace",
    "id",
    "oracleText",
    "kind",
]);

/** Longest a single chip value may render before it is elided. A chip is a
 *  glance-able parameter, not a serialisation: past this the overlay's narrow
 *  column wraps a `PermanentFilter` into a paragraph and the tree stops being
 *  scannable. The report text (`renderEngineTreeText`) uses the same chips on
 *  purpose — what the player saw is what the maintainer receives. */
const MAX_CHIP_LENGTH = 72;

function truncate(value: string): string {
    return value.length > MAX_CHIP_LENGTH
        ? `${value.slice(0, MAX_CHIP_LENGTH - 1)}…`
        : value;
}

/** Renders one chip value. Total by construction — every JS value has a
 *  rendering, because the input is a card definition field whose type this
 *  module deliberately does not enumerate (see property 3 in the header).
 *
 *  A FUNCTION renders as `fn`, never as its source: `applies` / `condition` on
 *  a `staticEffects[]` entry and the mana-ability `effect` closure are real
 *  fields a card carries, and printing `(target, source, ctx) => …` into an
 *  overlay tells a player nothing while breaking the layout. `fn` is the
 *  honest reading — "this part is code, not data" — and it is exactly what the
 *  `RES` node says at the body level. */
function formatChipValue(value: unknown, depth = 0): string {
    if (value === null || value === undefined) return "—";
    if (typeof value === "function") return "fn";
    if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    )
        return String(value);
    if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        if (depth >= 2) return `[${value.length}]`;
        return value.map((v) => formatChipValue(v, depth + 1)).join(", ");
    }
    if (typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) return "{}";
        if (depth >= 2) return "{…}";
        // `{ target: 0 }` is the Effect Script's positional reference to an
        // announced target (ADR 0045) and reads far better as `target #0` than
        // as `target: 0`, which looks like a count.
        if (entries.length === 1 && entries[0][0] === "target")
            return `target #${formatChipValue(entries[0][1], depth + 1)}`;
        return entries
            .map(([k, v]) => `${k}: ${formatChipValue(v, depth + 1)}`)
            .join(" · ");
    }
    /* c8 ignore next -- symbol/bigint cannot occur in a JSON-shaped definition */
    return String(value);
}

/** Every own key of `source` that the walk did not consume, as chips. Keys are
 *  taken in declaration order (V8 preserves insertion order for string keys),
 *  which is the order the card author wrote them — the closest thing the
 *  definition has to a reading order. */
function chipsFrom(
    source: object,
    extraSkip: readonly string[] = []
): EngineChip[] {
    const skip = new Set([...STRUCTURAL_KEYS, ...extraSkip]);
    return Object.entries(source as Record<string, unknown>)
        .filter(([key, value]) => !skip.has(key) && value !== undefined)
        .map(([key, value]) => ({
            key,
            value: truncate(formatChipValue(value)),
        }));
}

/** One site on a definition that can carry a resolution body. Structural, for
 *  the same reason `preview-body.ts`'s `ResolutionSite` is: the four nominal
 *  shapes (card, mode, activated, triggered) are read identically here. */
type BodySite = {
    resolve?: unknown;
    resolveSteps?: unknown[];
    effect?: unknown;
    effects?: readonly EffectOp[];
    modes?: readonly SpellMode[];
};

/** True when this site's body is hand-written TypeScript rather than data.
 *
 *  The `typeof === "function"` test on `effect` is load-bearing and means the
 *  opposite thing on the two owners of that overloaded name: on an
 *  `ActivatedAbility` it is the mana-ability CLOSURE (Black Lotus, every dual
 *  land), while on a `CardDefinition` it is `EffectShorthand`, a declarative
 *  registry key. Same field, opposite verdicts — see `preview-body.ts`'s
 *  `hasHandWrittenBody`, which this mirrors deliberately rather than importing:
 *  that one answers a question about the WHOLE card, this one about one site. */
function isHandWritten(site: BodySite): boolean {
    return (
        typeof site.resolve === "function" ||
        typeof site.effect === "function" ||
        (Array.isArray(site.resolveSteps) && site.resolveSteps.length > 0)
    );
}

/** Mutable accumulator for {@link EngineViewTree.coverage}, threaded through
 *  the walk so the ratio counts the bodies the tree ACTUALLY rendered rather
 *  than a second, independently-drifting census of the same definition. */
type Coverage = { declarative: number; total: number };

/** Effect Script Ops as nodes, recursing into every nesting shape the DSL
 *  admits (ADR 0045/0046): a plain list, `if`'s `then`/`else` branches, a
 *  `choice`/modal Op's `modes[]`, and the inline bodies of `forEach` /
 *  `delayedTrigger` / `reflexiveTrigger` — all keyed `effects`.
 *
 *  `then`/`else` become named GROUP nodes rather than being concatenated into
 *  the parent's children: an `if` whose two branches merge into one flat list
 *  reads as a card that does both, which is the opposite of what it does. */
function opNodes(
    effects: readonly EffectOp[] | undefined,
    path: string
): EngineNode[] {
    if (!effects) return [];
    return effects.map((op, i) => {
        const nested = op as unknown as {
            op?: string;
            effects?: EffectOp[];
            then?: EffectOp[];
            else?: EffectOp[];
            modes?: { label?: string; effects?: EffectOp[] }[];
        };
        const here = `${path}.${i}`;
        const children: EngineNode[] = [
            ...opNodes(nested.effects, `${here}.eff`),
        ];
        for (const branch of ["then", "else"] as const) {
            const ops = nested[branch];
            if (!ops?.length) continue;
            children.push({
                path: `${here}.${branch}`,
                kind: "EFF",
                label: branch,
                chips: [],
                children: opNodes(ops, `${here}.${branch}`),
            });
        }
        (nested.modes ?? []).forEach((mode, m) => {
            children.push({
                path: `${here}.mode.${m}`,
                kind: "MOD",
                label: mode.label ?? `mode ${m + 1}`,
                chips: [],
                children: opNodes(mode.effects, `${here}.mode.${m}`),
            });
        });
        return {
            path: here,
            kind: "EFF",
            label: nested.op ?? "op",
            chips: chipsFrom(op),
            children,
        } satisfies EngineNode;
    });
}

/** The target requirements announced by one site (CR 601.2c) — the primary one
 *  plus each `additionalTargetRequirements[]` entry, which are INDEPENDENT
 *  groups chosen in order and referenced positionally by the Effect Script.
 *  Numbered `target #N` accordingly, so a chip reading `to: target #1` in a
 *  sibling node has something to point at. */
function targetNodes(
    site: {
        targetRequirement?: object;
        additionalTargetRequirements?: object[];
    },
    path: string
): EngineNode[] {
    const groups = [
        ...(site.targetRequirement ? [site.targetRequirement] : []),
        ...(site.additionalTargetRequirements ?? []),
    ];
    return groups.map((group, i) => ({
        path: `${path}.tgt.${i}`,
        kind: "TGT" as const,
        label: `target #${i}`,
        chips: chipsFrom(group),
        children: [],
    }));
}

/** Names WHICH hand-written escape hatch a site took (ADR 0045). The three are
 *  not interchangeable to whoever has to fix the card, and "protocol card" on
 *  its own does not say which one to open. */
function handWrittenLabel(site: BodySite): string {
    if (typeof site.effect === "function") return "mana ability — effect()";
    if (typeof site.resolve === "function") return "hand-written resolve()";
    return `hand-written resolveSteps[${site.resolveSteps?.length ?? 0}]`;
}

/** One site's resolution body as nodes, and its contribution to coverage.
 *
 *  Modes come FIRST because a modal site's own body is never run: the chosen
 *  mode's is (CR 700.2, `CardDefinition.modes`). Each mode is a body site in
 *  its own right and counts separately, so a spell with one DSL mode and one
 *  `resolve()` mode honestly reports 1/2. */
function bodyNodes(site: BodySite, path: string, cov: Coverage): EngineNode[] {
    if (site.modes?.length) {
        return site.modes.map((mode, i) => ({
            path: `${path}.mode.${i}`,
            kind: "MOD" as const,
            label: mode.label || `mode ${i + 1}`,
            chips: chipsFrom(mode, ["label"]),
            children: [
                ...targetNodes(mode, `${path}.mode.${i}`),
                ...bodyNodes(mode, `${path}.mode.${i}`, cov),
            ],
        }));
    }
    if (isHandWritten(site)) {
        cov.total += 1;
        return [
            {
                path: `${path}.res`,
                kind: "RES",
                label: handWrittenLabel(site),
                chips: [],
                children: [],
            },
        ];
    }
    // The declarative `EffectShorthand` registry key (`effectRegistry.ts`) —
    // one registered primitive standing in for the whole body. Data, so it
    // counts as covered, but it is NOT an Effect Script and must not be
    // labelled as one.
    if (site.effect !== undefined) {
        cov.total += 1;
        cov.declarative += 1;
        const shorthand = site.effect;
        return [
            {
                path: `${path}.shorthand`,
                kind: "EFF",
                label:
                    typeof shorthand === "string"
                        ? shorthand
                        : "effect (shorthand)",
                chips:
                    typeof shorthand === "object" && shorthand !== null
                        ? chipsFrom(shorthand)
                        : [],
                children: [],
            },
        ];
    }
    if (site.effects?.length) {
        cov.total += 1;
        cov.declarative += 1;
        return opNodes(site.effects, `${path}.eff`);
    }
    return [];
}

/** A triggered or activated ability as one node: its parameters as chips, its
 *  targets and body as children. `label` names the ability's kind and, for a
 *  granted template, says so — a `grantTemplates[]` entry is an ability this
 *  card hands to ANOTHER permanent (Splinter Twin, Zombie Master), and reading
 *  it as one of the card's own is how Urza's Saga once measured as `DSL · 5`. */
function abilityNode(
    ability: TriggeredAbility | ActivatedAbility,
    kind: "TRG" | "ACT",
    label: string,
    path: string,
    cov: Coverage
): EngineNode {
    return {
        path,
        kind,
        label,
        chips: chipsFrom(ability),
        children: [
            ...targetNodes(ability, path),
            ...bodyNodes(ability as BodySite, path, cov),
        ],
    };
}

/**
 * Reads a `CardDefinition` as the tree the Engine View renders.
 *
 * Node order follows how a player READS the card, not how `types.ts` declares
 * it: keywords, then continuous effects, then the spell's own targets and
 * body, then its abilities (triggered before activated, own before granted),
 * then delayed triggers, then the back face.
 *
 * `chapterAbilities[]` (Sagas, CR 714) is deliberately absent: `expandDefinition`
 * (`convex/cards/registry.ts`) desugars it into `triggeredAbilities[]` before any
 * registry lookup returns, so the chapters are already covered — reading the raw
 * field too would render every chapter twice.
 */
export function buildEngineViewTree(def: CardDefinition): EngineViewTree {
    const cov: Coverage = { declarative: 0, total: 0 };
    const nodes: EngineNode[] = [];

    (def.staticAbilities ?? []).forEach((keyword, i) => {
        nodes.push({
            path: `kw.${i}`,
            kind: "KW",
            label: keyword,
            chips: [],
            children: [],
        });
    });

    (def.staticEffects ?? []).forEach((effect, i) => {
        nodes.push({
            path: `sta.${i}`,
            kind: "STA",
            label: effect.kind,
            chips: chipsFrom(effect),
            children: [],
        });
    });

    nodes.push(...targetNodes(def, "card"));
    nodes.push(...bodyNodes(def as BodySite, "card", cov));

    (def.triggeredAbilities ?? []).forEach((ability, i) => {
        nodes.push(abilityNode(ability, "TRG", "triggered", `trg.${i}`, cov));
    });
    (def.triggeredGrantTemplates ?? []).forEach((ability, i) => {
        nodes.push(
            abilityNode(ability, "TRG", "granted triggered", `tgrant.${i}`, cov)
        );
    });
    (def.activatedAbilities ?? []).forEach((ability, i) => {
        nodes.push(abilityNode(ability, "ACT", "activated", `act.${i}`, cov));
    });
    (def.grantTemplates ?? []).forEach((ability, i) => {
        nodes.push(
            abilityNode(ability, "ACT", "granted activated", `agrant.${i}`, cov)
        );
    });
    (def.delayedTriggers ?? []).forEach((trigger, i) => {
        nodes.push(
            abilityNode(
                trigger as unknown as TriggeredAbility,
                "TRG",
                "delayed trigger",
                `dtrg.${i}`,
                cov
            )
        );
    });

    if (def.backFace) {
        const face = def.backFace;
        const children: EngineNode[] = [];
        (face.staticAbilities ?? []).forEach((keyword, i) => {
            children.push({
                path: `face.kw.${i}`,
                kind: "KW",
                label: keyword,
                chips: [],
                children: [],
            });
        });
        (face.activatedAbilities ?? []).forEach((ability, i) => {
            children.push(
                abilityNode(ability, "ACT", "activated", `face.act.${i}`, cov)
            );
        });
        nodes.push({
            path: "face",
            kind: "FACE",
            label: face.name,
            chips: chipsFrom(face, ["name"]),
            children,
        });
    }

    return {
        cardId: def.id,
        cardName: def.name,
        badge: computeEngineViewBadge(def),
        nodes,
        coverage: cov,
    };
}

/** The tree as plain text, one node per line, two spaces per depth — the form
 *  that travels in a "Report a problem" issue body
 *  (`~/lib/engine-view-report.ts`). Deliberately the same nodes and the same
 *  chips the overlay shows: a maintainer reading the report sees what the
 *  player saw, not a second rendering that might differ. */
export function renderEngineTreeText(tree: EngineViewTree): string {
    const lines: string[] = [];
    const walk = (nodes: readonly EngineNode[], depth: number) => {
        for (const node of nodes) {
            const pad = "  ".repeat(depth);
            const chips = node.chips
                .map((chip) => `${chip.key}: ${chip.value}`)
                .join(" · ");
            lines.push(
                `${pad}${node.kind} ${node.label}${chips ? ` — ${chips}` : ""}`
            );
            walk(node.children, depth + 1);
        }
    };
    walk(tree.nodes, 0);
    return lines.join("\n");
}
