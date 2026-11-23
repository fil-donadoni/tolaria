// Pondering: the Brain grows its tree while the human decides (issue #10472,
// ADR 0185 Amendment I, slice 2 of `docs/research/brain-pondering-tree-reuse.md`
// § 5).
//
// The Worker keeps the tree its last consult grew (issue #10470). When the
// game reaches a decision of the HUMAN's, the client posts a PONDER: the
// Bot's own projection of that position and the decisions played since the
// last consult, as tree keys. This module walks the kept tree to the human's
// decision — the subtree under the Bot's move — and grows it from there, from
// the Bot's point of view (`createPonderSearch`). The next consult names the
// same path and more; it continues from the subtree under the move the human
// actually played, as slice 1 does, with the pondered visits in it.
//
// The kept tree's ROOT becomes the human's decision: the rest of the old tree
// is no longer reachable from where the game is. Its `prefix` remembers the
// path from the last consult to it, so the consult's walk starts past it.
// Anything the walk cannot follow — another game, a step the tree never took,
// an observation the Bot made (`continueKeptTree`'s drops), a node some world
// handed to the Bot — ponders a FRESH tree at the human's decision instead:
// pondering never guesses where the game is, it only loses the old visits.
//
// Hidden information is slice 1's: the subtree under the human's move only
// collected visits in worlds where that move was legal (note § 3).
//
// Pure: no clock of its own (the caller hands one in), no module state. The
// SCHEDULING — slices, yields, the stops — is the Worker's
// (`src/lib/ai/brain-ponder.ts`).

import type { PublicGameState } from "../../gameProjections";
import type { DeckKnowledgeBySeat } from "../deckKnowledge";
import { actedSeatFor } from "../expectedInput";
import {
    adoptPonderRoot,
    createPonderSearch,
    forEachTreeNode,
    freshNode,
    type Node,
} from "../search";
import type { TreeKeeper } from "./brainRequest";
import { projectedToGameState } from "./stateAdapter";
import {
    continueKeptTree,
    openPonderLedger,
    type ConsultPathStep,
    type PonderLedger,
} from "./treeReuse";

/** The page's request to ponder the human's decision. Plain data, for the
 *  `postMessage` hop. */
export type BrainPonder = {
    kind: "ponder";
    /** The BOT's projection of the human's decision point — never the
     *  human's: the tree is grown from what the Bot may know. */
    state: PublicGameState;
    botId: string;
    /** The knowledge of the consult the kept tree was grown with. */
    deckKnowledge?: DeckKnowledgeBySeat;
    /** The game, and every decision since the last consult. */
    reuse: { gameId: string; steps: ConsultPathStep[] };
    /** Seeds the ponder's own rng stream; omitted, one is drawn. */
    seed?: number;
    /** The page runs on a phone or tablet: the Worker applies the lower node
     *  cap. Pondering itself runs there too (the owner's ruling of
     *  2026-11-22). */
    mobile?: boolean;
};

/** The page's request to stop pondering (a hidden page). */
export type BrainPonderStop = { kind: "ponder-stop" };

export function isBrainPonder(message: unknown): message is BrainPonder {
    return (message as { kind?: unknown } | null)?.kind === "ponder";
}

export function isBrainPonderStop(
    message: unknown
): message is BrainPonderStop {
    return (message as { kind?: unknown } | null)?.kind === "ponder-stop";
}

/** One ponder under way. */
export type PonderSession = {
    /** Run up to `iterations` more, stopping early when `stop()` says so;
     *  the iterations run. Nothing runs once the tree is no longer the
     *  keeper's (a consult took it). `now`, when given, times the slice into
     *  the ledger. */
    slice: (
        iterations: number,
        stop?: () => boolean,
        now?: () => number
    ) => number;
    /** The nodes the pondered tree holds — what the node cap reads. */
    nodes: () => number;
    /** Whether the tree is still the keeper's to grow. */
    live: () => boolean;
    /** Whether the ponder continued a kept subtree (else it is fresh). */
    continued: boolean;
};

/** Start pondering the human's decision `message.state`: re-root the
 *  keeper's tree there (or a fresh one) and hand back the session that grows
 *  it, or `null` when there is nothing to ponder — the position is the
 *  Bot's to answer (a consult is coming), or nobody's. Never throws on a
 *  position it cannot ponder; a throw from the projection adapter is the
 *  caller's to swallow (`null` is then the same answer). */
export function startPonder(
    message: BrainPonder,
    keeper: TreeKeeper
): PonderSession | null {
    const { state, botId, deckKnowledge, reuse } = message;
    const position = projectedToGameState(state, deckKnowledge, botId);
    // The Bot answers here — for its own seat, or one it controls (CR 723.5):
    // that is a consult's decision, never a ponder's.
    if (actedSeatFor(position, botId) !== null) return null;

    const catalogue = keeper.catalogue();
    const previous = keeper.kept;
    const sameSeat =
        !!previous &&
        previous.gameId === reuse.gameId &&
        previous.botId === botId;
    const continued = previous
        ? continueKeptTree(
              previous,
              { gameId: reuse.gameId, botId, catalogue },
              reuse.steps,
              state,
              true
          )
        : null;
    const adopted =
        continued && "node" in continued
            ? adoptPonderRoot(continued.node)
            : null;
    const root: Node = adopted ?? freshNode();
    const ledger: PonderLedger = adopted
        ? (previous!.ponder ?? openPonderLedger(adopted))
        : {
              // A fresh tree: every visit in it is pondered. The counts since
              // the last consult carry over within the same game and seat.
              iterations: sameSeat ? (previous!.ponder?.iterations ?? 0) : 0,
              ms: sameSeat ? (previous!.ponder?.ms ?? 0) : 0,
              before: new WeakMap(),
          };
    const search = createPonderSearch(
        position,
        botId,
        message.seed ?? (Math.random() * 0x100000000) | 0,
        root,
        deckKnowledge
    );
    if (!search) return null;
    const kept = {
        gameId: reuse.gameId,
        botId,
        catalogue,
        root,
        projection: state,
        prefix: reuse.steps,
        ponder: ledger,
    };
    keeper.kept = kept;
    const live = () => keeper.kept === kept;
    return {
        continued: adopted !== null,
        live,
        slice(iterations, stop, now) {
            if (!live()) return 0;
            const start = now?.();
            const ran = search.run(iterations, stop);
            ledger.iterations += ran;
            if (now && start !== undefined) {
                ledger.ms += Math.max(0, now() - start);
            }
            return ran;
        },
        nodes() {
            let count = 0;
            forEachTreeNode(root, () => {
                count++;
            });
            return count;
        },
    };
}
