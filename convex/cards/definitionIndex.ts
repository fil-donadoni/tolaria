// The DEFINITION INDEX (issue #4856, PRD #4849, ADR 0113 Amendment IV) — its
// shape and the derivations it carries. CONTEXT.md § Definition Index: the
// small, generated, eagerly loaded table of every Card Definition the runtime
// can serve, and the only part of the catalogue built at load.
//
// It is written ahead of time by `bun run catalogue:pack`
// (`scripts/catalogue-artifact.ts`) in two sections, split along the same seam
// ADR 0113 §2 splits the definitions themselves:
//
//   - the HAND-WRITTEN section, `data/catalogue/definition-index.json`, which
//     both the server and the client bundle — every hand-written definition
//     is in both graphs;
//   - the COMPILED section, carried inside the packed server corpus
//     (`data/catalogue/packed-corpus.json`, issue #4164) beside the name index
//     it already had — server only, behind the `./compiledPool` seam the
//     client build aliases away, because the client's compiled rows arrive
//     from the fetched artifact and register at runtime.
//
// Every catalogue-wide index `catalogue.ts` used to compute by walking the
// definitions at load — the name lookup, the twin-name keys, Set membership,
// the choosable names, the printed back-face trigger lookup — is derived HERE,
// by the generator, from the definitions; at load the catalogue reads the
// result and touches no definition.
//
// Pure: no JSON import, no module-load work. The generator imports it to
// write the index, the catalogue to read it, the client's compiled hydration
// (`registerCompiledDefinitions`) to derive the same entries for a fetched row.
import type { CardDefinition } from "./types";
import { chooseableNamesOf } from "./cardNames";
import { backFaceAsTokenSpec } from "./backFaceSpec";
import { insetSpellTwinDefinition } from "./insetSpell";
import { modalBackTwinDefinition } from "./modalDfc";
import {
    SPLIT_HALF_SIDES,
    SPLIT_NAME_SEPARATOR,
    splitHalfTwinDefinition,
} from "./splitCard";
import { tokenDefinitionId } from "./registry";

/** A `[nameKey, definitionId]` pair: a lowercase name the catalogue's name
 *  lookup resolves, and the id of the definition it resolves to. */
export type NameEntry = readonly [nameKey: string, definitionId: string];

/** The lookups derived from one population's definitions. Keyed by the
 *  contributing definition's id, sparse: a card with nothing to add (the
 *  overwhelming majority) has no key. */
export interface DefinitionIndexLookups {
    /** The name keys a definition contributes BESIDE its own printed name:
     *  an inset spell's alternative name (CR 715.5), a split card's half
     *  names (CR 709.4a), a modal double-faced card's back-face name and its
     *  full `front // back` name (CR 712.19, CR 712.8a). See
     *  {@link twinNameEntriesOf}. */
    readonly twinNames: Readonly<Record<string, readonly NameEntry[]>>;
    /** `chooseableNamesOf(def)` wherever it is not just `[def.name]`
     *  (CR 715.5 / 709.4a / 712.19). */
    readonly chooseableNames: Readonly<Record<string, readonly string[]>>;
    /** A PRINTED nonmodal back face's content-derived token id → the id of
     *  the card that declares it, for every back face carrying triggered
     *  abilities (CR 712.8e, issue #3249). First declaring card wins. */
    readonly backFaceTriggers: Readonly<Record<string, string>>;
}

/** One hand-written definition: its Card ID, name, home Set, and its locator
 *  — the export of that Set's module (`sets/<set>/index.cards`) that holds
 *  it. */
export type HandWrittenIndexEntry = readonly [
    id: string,
    name: string,
    setCode: string,
    exportName: string,
];

/** One hand-written export, as the catalogue's call-time walk yields it
 *  (`walkHandWrittenDefinitions`) — the generator's input. */
export interface HandWrittenExport {
    readonly setCode: string;
    readonly exportName: string;
    readonly definition: CardDefinition;
}

/** The hand-written section: every hand-written definition in catalogue load
 *  order (Set module order, then export order), plus its lookups. */
export interface HandWrittenDefinitionIndex {
    readonly entries: readonly HandWrittenIndexEntry[];
    readonly lookups: DefinitionIndexLookups;
}

/** The compiled section, carried by the packed server corpus beside its
 *  `names` (`./packedCorpus` § `PackedCorpus`): row `i` of the corpus is
 *  `ids[i]`, named `names[i]`, from Set `setCodes[i]` (`""` when the row
 *  declares none). Its locator is implicit — the row index, which is the
 *  packed block `floor(i / blockRows)` and, while it ships, the literal
 *  pool's row `i` too: both renderings are `merge.serverRows`, in order. */
export interface CompiledDefinitionIndex {
    readonly ids: readonly string[];
    readonly names: readonly string[];
    readonly setCodes: readonly string[];
    readonly lookups: DefinitionIndexLookups;
}

/**
 * Every `[nameKey, definitionId]` pair `def` contributes to the catalogue's
 * name lookup BESIDE its own printed name.
 *
 * Derived from the same twin derivations `preloadDefinitions` registers
 * (`registry.ts`), so a key is emitted exactly when its twin exists — fail
 * closed: a resolvable name always names a real definition.
 *
 * - CR 715.5 / 722.5 (ADR 0120) — an adventurer's alternative name resolves
 *   to the inset TWIN: naming "Petty Theft" names the Adventure.
 * - CR 709.4a (ADR 0121) — each split half's name resolves to its half.
 * - CR 712.19 (ADR 0122) — a modal double-faced card's BACK face name
 *   resolves to the back twin; its printed `front // back` spelling names the
 *   CARD, which CR 712.8a gives its front face's characteristics (issue
 *   #4767).
 */
export function twinNameEntriesOf(def: CardDefinition): NameEntry[] {
    const entries: NameEntry[] = [];
    const inset = def.insetSpell;
    if (inset) {
        const twin = insetSpellTwinDefinition(def);
        if (twin) entries.push([inset.name.toLowerCase(), twin.id]);
    }
    for (const side of SPLIT_HALF_SIDES) {
        const half = splitHalfTwinDefinition(def, side);
        if (half) entries.push([half.name.toLowerCase(), half.id]);
    }
    const modalBack = modalBackTwinDefinition(def);
    if (modalBack) {
        entries.push([modalBack.name.toLowerCase(), modalBack.id]);
        entries.push([
            `${def.name}${SPLIT_NAME_SEPARATOR}${modalBack.name}`.toLowerCase(),
            def.id,
        ]);
    }
    return entries;
}

/** CR 712.8e — the content-derived token id of `def`'s printed NONMODAL back
 *  face when that face carries triggered abilities, else `undefined`: the id a
 *  transformed permanent presents, under which `registry.ts`'s token decode
 *  looks the real ability objects back up (issue #3249). */
export function backFaceTriggerTokenId(
    def: CardDefinition
): string | undefined {
    const backFace = def.backFace;
    if (!backFace?.triggeredAbilities?.length) return undefined;
    if (backFace.kind === "modal") return undefined;
    return tokenDefinitionId(backFaceAsTokenSpec(backFace));
}

/** The lookups of one population, in its own order. */
export function buildIndexLookups(
    defs: readonly CardDefinition[]
): DefinitionIndexLookups {
    const twinNames: Record<string, NameEntry[]> = {};
    const chooseableNames: Record<string, string[]> = {};
    const backFaceTriggers: Record<string, string> = {};
    for (const def of defs) {
        const twins = twinNameEntriesOf(def);
        if (twins.length > 0) twinNames[def.id] = twins;
        const chooseable = chooseableNamesOf(def);
        if (chooseable.length !== 1 || chooseable[0] !== def.name) {
            chooseableNames[def.id] = chooseable;
        }
        const tokenId = backFaceTriggerTokenId(def);
        if (
            tokenId !== undefined &&
            !Object.prototype.hasOwnProperty.call(backFaceTriggers, tokenId)
        ) {
            backFaceTriggers[tokenId] = def.id;
        }
    }
    return { twinNames, chooseableNames, backFaceTriggers };
}
