/**
 * The HAND-WRITTEN section of the Definition Index (issue #4856, PRD #4849,
 * ADR 0113 Amendment IV) — its generator, its serialization and its guard.
 * The shape and the derivations are `convex/cards/definitionIndex.ts`; the
 * compiled section rides the packed corpus (`./packed-corpus.ts`).
 *
 * Written by `bun run catalogue:pack` beside the packed corpus, read by
 * `convex/cards/catalogue.ts` at load in place of the walk over every Set
 * module's exports that used to build the catalogue's indexes there.
 *
 * Deterministic: the walk visits Set modules in the catalogue's declared order
 * and each module's exports in their namespace order, and nothing reads a
 * clock, a random source or the file system. One entry per line, so a card
 * added or renamed is a one-line diff.
 */
import {
    buildIndexLookups,
    type HandWrittenDefinitionIndex,
    type HandWrittenExport,
    type HandWrittenIndexEntry,
} from "../../convex/cards/definitionIndex";

/** Beside the packed corpus, under a name the client's `catalogue-*.json`
 *  glob does not match. `data/catalogue/` is in `.prettierignore`. */
export const DEFINITION_INDEX_PATH = "data/catalogue/definition-index.json";

/**
 * The hand-written section from the walk. Throws on a Card ID or a name two
 * definitions share: the eager catalogue let the LAST module win either key,
 * the index lets none — a duplicate is a broken catalogue, not an order to
 * reproduce.
 */
export function buildHandWrittenIndex(
    walk: readonly HandWrittenExport[]
): HandWrittenDefinitionIndex {
    const byId = new Map<string, HandWrittenExport>();
    const byName = new Map<string, HandWrittenExport>();
    for (const e of walk) {
        const id = e.definition.id;
        const name = e.definition.name.toLowerCase();
        const sameId = byId.get(id);
        if (sameId) {
            throw new Error(
                `Card ID ${id} is declared twice: ${sameId.setCode}.${sameId.exportName} and ${e.setCode}.${e.exportName}`
            );
        }
        const sameName = byName.get(name);
        if (sameName) {
            throw new Error(
                `"${e.definition.name}" names two hand-written definitions: ${sameName.setCode}.${sameName.exportName} and ${e.setCode}.${e.exportName}`
            );
        }
        byId.set(id, e);
        byName.set(name, e);
    }
    const entries: HandWrittenIndexEntry[] = walk.map((e) => [
        e.definition.id,
        e.definition.name,
        e.setCode,
        e.exportName,
    ]);
    return {
        entries,
        lookups: buildIndexLookups(walk.map((e) => e.definition)),
    };
}

/** The committed bytes: one entry per line, newline-terminated. */
export function serializeDefinitionIndex(
    index: HandWrittenDefinitionIndex
): string {
    const entries = index.entries.map((e) => JSON.stringify(e)).join(",\n");
    return (
        `{"entries":[\n${entries}\n],\n` +
        `"lookups":${JSON.stringify(index.lookups)}}\n`
    );
}
