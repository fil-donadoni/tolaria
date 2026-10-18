// What the Brain worker makes resident before it answers (issue #5617, PRD
// #5602, ADR 0113 Amendment VII): the definitions it may reason about, through
// the ONE loader the page uses (`~/lib/catalogue/definitionShards`), never the
// whole catalogue.
//
// TWO SOURCES, one rule. The worker's MANIFEST is its deck knowledge — the
// Bot's own decklist, plus the human's at `expert` (`convex/gre/difficulty.ts`)
// — as Manifest entries (`gameReads.getSeatDeckKnowledge`), primed as soon as
// the driver has them so the install overlaps the game's setup. A REQUEST then
// names more: every card its public state carries (the human's permanents, a
// revealed card, a card fetched from outside the game) and the deck-knowledge
// ids it hands the search. Before a request is served every shard those ids
// need is installed (`~/lib/catalogue/residentFor`), so `handleBrainRequest`,
// which reads `getDefinition` SYNCHRONOUSLY, never searches against a
// half-resident catalogue (`.claude/rules/bot-development.md`: a bot deciding
// against missing cards is unshipped, not slow).
//
// ONE DOWNLOAD. The worker is a chunk of the page's own build
// (`scripts/lib/vite-brain-worker-chunk.ts`): a Set chunk or a compiled shard
// is the same URL in both graphs, and everything a request names is in the
// page's Definition Manifest (both maindecks) or on its board — so the worker
// re-reads the HTTP cache the page filled; it does not download a second copy.
import type { DefinitionManifestEntry } from "@convex/definitionManifestEntry";
import { publicStateDefinitionIds } from "~/lib/publicStateDefinitionIds";
import type { BrainRequest } from "./brain-request";

/** The worker's Manifest, posted by `primeBrain` (`./brain-client`) ahead of
 *  the consults that need it. */
export type BrainPrime = {
    kind: "prime";
    entries: readonly DefinitionManifestEntry[];
};

/** Everything the page posts to the Brain worker. */
export type BrainWorkerMessage = BrainRequest | BrainPrime;

export function isBrainPrime(
    message: BrainWorkerMessage
): message is BrainPrime {
    return (message as { kind?: unknown }).kind === "prime";
}

/** Every definition id a request makes the search read: the cards its public
 *  state carries, and the deck-knowledge ids it samples hidden zones from. */
export function requestDefinitionIds(
    request: Pick<BrainRequest, "state" | "deckKnowledge">
): string[] {
    const ids = new Set(publicStateDefinitionIds(request.state));
    for (const seat of request.deckKnowledge ?? []) {
        for (const id of seat.cardIds) ids.add(id);
    }
    return [...ids];
}
