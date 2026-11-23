// Tree reuse across the Bot's consults (issue #10470, ADR 0185, slice 1 of
// `docs/research/brain-pondering-tree-reuse.md` § 5).
//
// The Brain Worker keeps the tree its last search grew. The next consult says
// what was played since — the Bot's own move first, then every decision of
// either seat until the Bot decides again — as TREE KEYS, the keys the search
// itself stores those moves under (`treeKeyOf`, read on each deciding seat's
// own view). This module walks them from the kept root and hands the search
// the node reached, or says why the tree is dropped. A dropped tree is
// today's behaviour exactly: a fresh root.
//
// THE DROPS, every one of them a fresh tree, never a guess:
//   - `context` — another game, another seat, another catalogue (the
//     definitions resident in the Worker changed, so a world the tree was
//     grown in may name cards that read differently now);
//   - `no-path` — the consult could not say what was played (a step it could
//     not name, a Bot action that is no move, a rejected submission), or said
//     nothing at all: the Bot's own move is always the first step;
//   - `mismatch` — a step the tree never took, a step by the seat that did not
//     decide that node, or a node reached that is not the Bot's decision;
//   - `observation` — the path crossed an observation the Bot makes: a card
//     whose identity the Bot did not see at the old root and sees now, that
//     neither a fresh object (a token, a copy) nor a card the opponent showed
//     by its own move explains — the Bot's draw, a reveal, a random discard.
//     The tree has no chance nodes: a node after the Bot's draw pools every
//     world's draw, and the Bot now knows which card it drew. A card the
//     opponent cast or played from its hand is NOT an observation: an
//     opponent's edge only collects visits in worlds where that move was
//     legal, so the subtree under it already holds only the worlds where the
//     opponent held the card (note § 3).
//
// Pure and deterministic: no clock, no randomness, no module state. The
// keeper — where the tree lives between consults — is the Worker's
// (`brainRequest.ts`).

import type { PublicGameState } from "../../gameProjections";
import { PLACEHOLDER_CARD_ID } from "../constants";
import { forEachTreeNode, rootVisits, type Node } from "../search";

/** One decision played since the last consult: which seat made it, and the
 *  tree key of the move (`treeKeyOf`, on that seat's own view). `shows` names
 *  the card instance the move brought out of the seat's hand (a cast, a land,
 *  an activation from hand): a card the opponent showed by its own decision,
 *  never an observation (see the header). */
export type ConsultPathStep = { seat: string; key: string; shows?: string };

/** What a consult says about tree reuse. `steps: null` — the client could not
 *  name what was played since; the kept tree is dropped, and the tree this
 *  consult grows is kept for the next one. */
export type ConsultReuse = {
    gameId: string;
    steps: ConsultPathStep[] | null;
};

/** The tree the Worker keeps between two consults. */
export type KeptTree = {
    gameId: string;
    botId: string;
    /** The Worker's catalogue identity when the tree was grown. */
    catalogue: string;
    root: Node;
    /** The Bot's projection the tree was grown from — what the Bot saw. */
    projection: PublicGameState;
    /** A PONDERED tree's place on the path (issue #10472): the steps from
     *  the last consult to the human's decision `root` stands for. The next
     *  consult's steps start with them, and only the rest is walked. Absent
     *  on a tree a consult grew: its root IS the last consult's. */
    prefix?: readonly ConsultPathStep[];
    /** What pondering has grown since the last consult. */
    ponder?: PonderLedger;
};

/** Pondering since the last consult (issue #10472): the iterations and
 *  wall-clock time it took, and each node's root visits BEFORE the first
 *  ponder — so the consult can tell the visits pondering grew from the ones
 *  the last consult left. A node pondering opened reads 0. */
export type PonderLedger = {
    iterations: number;
    ms: number;
    before: WeakMap<Node, number>;
};

export type TreeDrop = "context" | "no-path" | "mismatch" | "observation";

export type TreeContinuation = { node: Node } | { dropped: TreeDrop };

/** Walk `steps` from `root` in a tree searched for `botId`: the node the
 *  game moved into, or `null` when a step is none the tree took, or was made
 *  at that node by the other seat. A node the Bot decides holds its edges in
 *  `children`, each chosen by the Bot; a node the opponent decides holds its
 *  children under the option-set views' shared registry (`childNodes`,
 *  issue #8939). */
export function walkKeptTree(
    root: Node,
    steps: readonly ConsultPathStep[],
    botId: string
): Node | null {
    let node = root;
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (step.seat === botId) {
            const edge = node.children.get(step.key);
            if (!edge || edge.mover !== botId) return null;
            node = edge.node;
            continue;
        }
        if (!node.optionViews) return null;
        const child = node.childNodes?.get(step.key);
        if (!child) return null;
        node = child;
    }
    return node;
}

/** Every card instance whose identity the projection shows its viewer, by
 *  instance id: the definition id it reads as. A face-down card reads as its
 *  sentinel, a hidden one is `null` or a placeholder and is left out. Read
 *  generically — any `{ id, card: { id } }` object anywhere in the state — so
 *  a zone added to the projection later (a peek, a revealed hand card, a
 *  library card known on top) is read without this list growing. */
export function visibleIdentities(state: PublicGameState): Map<string, string> {
    const seen = new Map<string, string>();
    const walk = (value: unknown): void => {
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) walk(value[i]);
            return;
        }
        if (value === null || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        // An ability on the stack is no card: it never sat in a hidden zone.
        if (record.abilityId !== undefined) return;
        if (record.triggeredAbilityId !== undefined) return;
        const card = record.card as { id?: unknown } | null | undefined;
        if (
            typeof record.id === "string" &&
            card &&
            typeof card === "object" &&
            typeof card.id === "string" &&
            card.id !== PLACEHOLDER_CARD_ID
        ) {
            seen.set(record.id, card.id);
        }
        for (const key in record) walk(record[key]);
    };
    walk(state.players);
    walk(state.stack);
    walk(state.pendingTriggerBatch);
    return seen;
}

/** Whether `id` names an object created after `before` (a
 *  token, a copy): instance ids are allocated in order (`allocInstanceId`),
 *  so an id past the old counter cannot have sat in a hidden zone then. */
function isFreshObject(before: PublicGameState, id: string): boolean {
    const counter = before.nextInstanceId;
    const n = Number(id);
    return typeof counter === "number" && Number.isInteger(n) && n > counter;
}

/** Whether going from `before` to `after` the Bot OBSERVED something the
 *  tree could not have held apart: a card whose identity `before` did not
 *  show it and `after` does, that is neither a fresh object nor in `shown`
 *  (cards the opponent brought out of its hand by its own move). See the
 *  module header. */
export function crossesObservation(
    before: PublicGameState,
    after: PublicGameState,
    shown: ReadonlySet<string>
): boolean {
    const old = visibleIdentities(before);
    let observed = false;
    visibleIdentities(after).forEach((definition, id) => {
        if (observed || old.get(id) === definition) return;
        if (shown.has(id) || isFreshObject(before, id)) return;
        observed = true;
    });
    return observed;
}

/** Whether two steps name the same decision. */
function sameStep(a: ConsultPathStep, b: ConsultPathStep): boolean {
    return a.seat === b.seat && a.key === b.key && a.shows === b.shows;
}

/** `steps` past a pondered tree's `prefix`, or `null` when they do not
 *  start with it: the game left the path the ponder stood on. */
function pastPrefix(
    kept: KeptTree,
    steps: readonly ConsultPathStep[]
): readonly ConsultPathStep[] | null {
    const prefix = kept.prefix ?? [];
    if (steps.length < prefix.length) return null;
    for (let i = 0; i < prefix.length; i++) {
        if (!sameStep(prefix[i], steps[i])) return null;
    }
    return steps.slice(prefix.length);
}

/** Where the consult at `projection` continues from, given the tree kept
 *  after the last one: the node reached, or why the tree is dropped. The
 *  node is not yet a root — `adoptKeptRoot` (search.ts) makes it one, and
 *  may still refuse it. `steps` are every decision since the last CONSULT;
 *  a pondered tree walks only those past its `prefix` (issue #10472).
 *
 *  `ponder` — the walk is a PONDER's, to the human's decision it grows
 *  (issue #10472): an empty path is no drop there, it is the same decision
 *  pondered again. */
export function continueKeptTree(
    kept: KeptTree,
    context: { gameId: string; botId: string; catalogue: string },
    steps: readonly ConsultPathStep[] | null,
    projection: PublicGameState,
    ponder = false
): TreeContinuation {
    if (
        kept.gameId !== context.gameId ||
        kept.botId !== context.botId ||
        kept.catalogue !== context.catalogue
    ) {
        return { dropped: "context" };
    }
    if (!steps || (!ponder && steps.length === 0)) {
        return { dropped: "no-path" };
    }
    const rest = pastPrefix(kept, steps);
    if (!rest) return { dropped: "mismatch" };
    const shown = new Set<string>();
    for (let i = 0; i < rest.length; i++) {
        const step = rest[i];
        if (step.seat !== context.botId && step.shows) shown.add(step.shows);
    }
    if (crossesObservation(kept.projection, projection, shown)) {
        return { dropped: "observation" };
    }
    const node = walkKeptTree(kept.root, rest, context.botId);
    return node ? { node } : { dropped: "mismatch" };
}

/** A fresh ponder ledger for a tree about to be pondered from `root`: every
 *  node's root visits now, before pondering adds any (issue #10472). */
export function openPonderLedger(root: Node): PonderLedger {
    const before = new WeakMap<Node, number>();
    forEachTreeNode(root, (node) => before.set(node, rootVisits(node)));
    return { iterations: 0, ms: 0, before };
}

/** The root visits pondering grew at `node`, read BEFORE the consult adopts
 *  it as its root (adoption may drop denied edges): what it holds now less
 *  what it held before the first ponder. */
export function ponderedVisits(ledger: PonderLedger, node: Node): number {
    return Math.max(0, rootVisits(node) - (ledger.before.get(node) ?? 0));
}
