/**
 * Issue #4856 (PRD #4849) — every lookup the catalogue now derives from the
 * Definition Index answers exactly what the EAGER walk over the definitions
 * answered before it, for every card of the catalogue.
 *
 * `eagerCatalogue` below is the pre-#4856 load-time code of `catalogue.ts`,
 * kept verbatim in shape (same walk, same twin lookups through the registry,
 * same precedence) and run here against the live definitions: the reference
 * the index-backed catalogue is compared with, pointwise.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
    getAllCardNames,
    getAllCards,
    getAllCatalogueCards,
    getAllSetCodes,
    getChooseableCardNames,
    getDefinitionSetCode,
    tryGetCardByName,
    walkHandWrittenDefinitions,
} from "../catalogue";
import { packedCorpusLookup, packedServerCorpus } from "../compiledPool";
import { chooseableNamesOf } from "../cardNames";
import { backFaceTriggerTokenId } from "../definitionIndex";
import { insetSpellDefinitionId } from "../insetSpell";
import { isModalDoubleFaced, modalBackFaceDefinitionId } from "../modalDfc";
import { expandDefinition, getDefinition, tryGetDefinition } from "../registry";
import {
    SPLIT_HALF_SIDES,
    SPLIT_NAME_SEPARATOR,
    splitHalfDefinitionId,
} from "../splitCard";
import type { CardDefinition } from "../types";

/** The compiled population, every row read through the SAME memoised lookup
 *  the catalogue serves compiled rows from — so a row here is the very object
 *  `getDefinition` expands, as the literal pool's rows were before issue
 *  #4168 retired it. */
const compiledRows = packedServerCorpus!.ids.map(
    (id) => packedCorpusLookup!.lookup(id)!
);

/** The pre-#4856 `twinNameEntries`, verbatim: twins looked up in the
 *  registry, a half whose twin did not hydrate contributing nothing. */
function eagerTwinNameEntries(
    card: CardDefinition
): Array<[string, CardDefinition]> {
    const entries: Array<[string, CardDefinition]> = [];
    const inset = card.insetSpell;
    if (inset) {
        const twin = tryGetDefinition(
            insetSpellDefinitionId(card.id, inset.kind)
        );
        if (twin) entries.push([inset.name.toLowerCase(), twin]);
    }
    if (card.splitHalves) {
        for (const side of SPLIT_HALF_SIDES) {
            const twin = tryGetDefinition(splitHalfDefinitionId(card.id, side));
            if (twin) entries.push([twin.name.toLowerCase(), twin]);
        }
    }
    if (isModalDoubleFaced(card)) {
        const twin = tryGetDefinition(modalBackFaceDefinitionId(card.id));
        if (twin) {
            entries.push([twin.name.toLowerCase(), twin]);
            entries.push([
                `${card.name}${SPLIT_NAME_SEPARATOR}${twin.name}`.toLowerCase(),
                card,
            ]);
        }
    }
    return entries;
}

/** The pre-#4856 module-load indexes, rebuilt from the definitions. */
function eagerCatalogue() {
    const walk = walkHandWrittenDefinitions();
    const allCards = walk.map((e) => e.definition);
    const definitionSetCode = new Map<string, string>();
    for (const e of walk) definitionSetCode.set(e.definition.id, e.setCode);
    const nameRegistry = new Map<string, CardDefinition>(
        allCards.map((card) => [card.name.toLowerCase(), card])
    );
    for (const card of allCards) {
        for (const [key, twin] of eagerTwinNameEntries(card)) {
            if (!nameRegistry.has(key)) nameRegistry.set(key, twin);
        }
    }
    for (const card of compiledRows) {
        if (card.setCode !== undefined && !definitionSetCode.has(card.id)) {
            definitionSetCode.set(card.id, card.setCode);
        }
        const key = card.name.toLowerCase();
        if (!nameRegistry.has(key)) nameRegistry.set(key, card);
        for (const [twinKey, twin] of eagerTwinNameEntries(card)) {
            if (!nameRegistry.has(twinKey)) nameRegistry.set(twinKey, twin);
        }
    }
    const population = [...allCards, ...compiledRows];
    // `printedBackFaceTriggers`' scan over the printed definitions: the first
    // card whose nonmodal back face carries triggers, per token id.
    const backFaceOwner = new Map<string, CardDefinition>();
    for (const def of population) {
        const tokenId = backFaceTriggerTokenId(def);
        if (tokenId !== undefined && !backFaceOwner.has(tokenId)) {
            backFaceOwner.set(tokenId, def);
        }
    }
    return {
        allCards,
        population,
        definitionSetCode,
        nameRegistry,
        backFaceOwner,
        names: population.map((c) => c.name),
        chooseable: population.flatMap((c) => chooseableNamesOf(c)),
    };
}

const eager = eagerCatalogue();

describe("the Definition Index answers what the eager walk answered (issue #4856)", () => {
    it("serves the same catalogue: every Card ID, the same object, expanded the same way", () => {
        expect(getAllCards().map((d) => d.id)).toEqual(
            eager.allCards.map((d) => d.id)
        );
        expect(getAllCatalogueCards().map((d) => d.id)).toEqual(
            eager.population.map((d) => d.id)
        );
        const differs = eager.population.filter(
            (raw) => getDefinition(raw.id) !== expandDefinition(raw)
        );
        expect(differs.map((d) => `${d.name} (${d.id})`)).toEqual([]);
    });

    it("resolves every name key to the same definition", () => {
        expect(eager.nameRegistry.size).toBeGreaterThan(6000);
        const differs: string[] = [];
        for (const [key, want] of eager.nameRegistry) {
            const got = tryGetCardByName(key);
            if (got !== want) differs.push(`${key} → ${got?.id} ≠ ${want.id}`);
        }
        expect(differs).toEqual([]);
    });

    it("knows no name the eager walk did not", () => {
        // Every name the index can introduce: the printed names, the
        // choosable names (a superset of every twin's name), and each modal
        // card's full `front // back` spelling.
        const candidates = new Set(
            eager.chooseable.map((n) => n.toLowerCase())
        );
        for (const def of eager.population) {
            for (const name of chooseableNamesOf(def)) {
                candidates.add(
                    `${def.name}${SPLIT_NAME_SEPARATOR}${name}`.toLowerCase()
                );
            }
        }
        const extra = [...candidates].filter(
            (key) =>
                tryGetCardByName(key) !== null && !eager.nameRegistry.has(key)
        );
        expect(extra).toEqual([]);
    });

    it("gives every card the same Set, and the catalogue the same Sets", () => {
        const differs = eager.population.filter(
            (d) =>
                getDefinitionSetCode(d.id) !==
                (eager.definitionSetCode.get(d.id) ?? "")
        );
        expect(differs.map((d) => d.name)).toEqual([]);
        expect(getAllSetCodes()).toEqual(
            [...new Set(eager.definitionSetCode.values())].sort()
        );
    });

    it("lists the same card names and the same choosable names, in order", () => {
        expect(getAllCardNames()).toEqual(eager.names);
        expect(getChooseableCardNames()).toEqual(eager.chooseable);
    });
});

describe("a fresh module graph (issue #4856)", () => {
    // FRESH, because in this worker the setup's freeze walk made every
    // hand-written card resident — and residency would answer for an index
    // that does not. The order of the tests below matters: the first one
    // reads the graph exactly as loading left it.
    let fresh: typeof import("../index");
    beforeAll(async () => {
        vi.resetModules();
        try {
            fresh = await import("../index");
        } finally {
            // The next file in this worker (`isolate: false`) must not
            // inherit this graph from the module cache.
            vi.resetModules();
        }
    }, 120_000);

    it("loading makes no catalogue card resident", () => {
        const catalogue = new Set(eager.population.map((d) => d.id));
        const resident = [...fresh.residentDefinitionIds()].filter((id) =>
            catalogue.has(id)
        );
        expect(resident).toEqual([]);
    });

    it("decodes a printed back face's token id with the declaring card's own triggers (CR 712.8e)", () => {
        expect(eager.backFaceOwner.size).toBeGreaterThan(0);
        const rawOwners = new Map(
            [
                ...fresh.walkHandWrittenDefinitions().map((e) => e.definition),
                ...compiledRows,
            ].map((def) => [def.id, def])
        );
        for (const [tokenId, owner] of eager.backFaceOwner) {
            const resident = new Set(fresh.residentDefinitionIds());
            expect(resident.has(owner.id)).toBe(false);
            const decoded = fresh.tryGetDefinition(tokenId);
            expect(decoded?.triggeredAbilities?.[0]).toBe(
                rawOwners.get(owner.id)!.backFace!.triggeredAbilities![0]
            );
        }
    });

    it("enumerates every catalogue card through registeredDefinitions, resolved or not", () => {
        const enumerated = new Set(
            [...fresh.registeredDefinitions()].map((d) => d.id)
        );
        const missing = eager.population.filter((d) => !enumerated.has(d.id));
        expect(missing.map((d) => d.name)).toEqual([]);
    });
});
