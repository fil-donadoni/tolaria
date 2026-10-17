import type { CardDefinition, Rarity } from "./types";
// The hand-written Set modules (issue #5615, ADR 0113 Amendment V). On the
// SERVER `./setModules` imports every Set statically; in a CLIENT build
// `vite.config.ts` aliases this exact relative specifier to
// `src/lib/catalogue/set-modules.browser.ts`, which installs a Set as one
// lazily imported chunk on demand — a game loads the Sets of its Definition
// Manifest, a whole-catalogue surface all of them. Keep this the only
// importer of `./setModules` — pinned by
// `scripts/__tests__/set-modules-client-seam.test.ts`.
import { setModuleSource } from "./setModules";
import {
    setLazyDefinitionSource,
    setPrintedBackFaceIndex,
    tryGetDefinition,
    getDefinition,
} from "./registry";
// A hand-written export is a `defineCard` factory (issue #4857); this is the
// one reader of it, and the only resolution path (issue #4860).
import { resolveCardExport } from "./defineCard";
import { modalBackFaceParentId } from "./modalDfc";
import { isTwinDefinitionId } from "./twinId";
import {
    type CompiledDefinitionIndex,
    type DefinitionIndexLookups,
    type HandWrittenDefinitionIndex,
    type HandWrittenExport,
    type NameEntry,
} from "./definitionIndex";
// The HAND-WRITTEN section of the Definition Index (issue #4856), written by
// `bun run catalogue:pack` (`scripts/lib/definition-index.ts`). Bundled on
// both sides: every hand-written definition is in both graphs.
import definitionIndexJson from "../../data/catalogue/definition-index.json";
// The packed decoder (issue #4165). The server reaches it through
// `./compiledPool`; the CLIENT through `registerCompiledShard` below, with the
// shards it fetched (issue #5616).
import { createBlockLookup, type PackedLookup } from "./packedCorpus";
import { shardIndexOf, type CompiledShard } from "./compiledShard";
import { parentIdOfTwin } from "./twinId";
// The packed corpus as a BUNDLED module. On the SERVER this is
// `data/catalogue/packed-corpus.json`; in a CLIENT build `vite.config.ts`
// aliases this exact relative specifier to an empty stub and the packed
// corpus arrives as a fetched asset instead (ADR 0113 Amendment IV, issue
// #4861). Keep it the only importer of `./compiledPool` — pinned by
// `scripts/__tests__/compiled-pool-client-seam.test.ts`. The corpus carries
// the COMPILED section of the Definition Index beside its rows.
import { packedCorpusLookup, packedServerCorpus } from "./compiledPool";

// ── The Definition Index (issue #4856, ADR 0113 Amendment IV) ───────────────
//
// At load this module reads the index and touches NO definition: every index
// below — Set membership, the name lookup and its twin-name keys, the
// choosable names, the printed back-face trigger lookup — is built from the
// generated index (`./definitionIndex`), and a definition is reached only when
// someone asks for it, through the lazy source installed at the end of this
// block. Pinned by `__tests__/catalogueLoadTouchesNoDefinition.test.ts`, which
// loads this module with every definition replaced by a throwing stub.
//
// A definition declared with `defineCard` (issue #4857) is not even BUILT at
// load: its Set module evaluates a factory, which runs on the first request
// (`handWrittenDefinition`).

// Both sections are read DEFENSIVELY: `catalogue:pack` imports this module,
// so a committed index of an older or partial shape (a merge that kept one
// side) must still load — for the generator, run by `land`'s resolver, to
// rewrite it. Reporting it stale is the freshness gate's job
// (`scripts/__tests__/catalogue-artifact.test.ts`), never a load-time throw.
const EMPTY_LOOKUPS: DefinitionIndexLookups = {
    twinNames: {},
    chooseableNames: {},
    backFaceTriggers: {},
};

const handWrittenIndex: HandWrittenDefinitionIndex = (() => {
    const raw = definitionIndexJson as unknown as
        | Partial<HandWrittenDefinitionIndex>
        | undefined;
    return {
        entries: raw?.entries ?? [],
        lookups: { ...EMPTY_LOOKUPS, ...raw?.lookups },
    };
})();

/** A COMPILED section of the Definition Index — the server's packed corpus,
 *  or the client's fetched index — read as defensively as the hand-written
 *  one. */
function readCompiledIndex(
    raw: Partial<CompiledDefinitionIndex> | null
): CompiledDefinitionIndex | null {
    if (raw === null) return null;
    return {
        ids: raw.ids ?? [],
        names: raw.names ?? [],
        setCodes: raw.setCodes ?? [],
        lookups: { ...EMPTY_LOOKUPS, ...raw.lookups },
    };
}

const handWrittenEntryById = new Map(
    handWrittenIndex.entries.map((entry) => [entry[0], entry])
);

/** Every hand-written Card ID. A compiled row for one of them never registers
 *  (ADR 0108 — `excludeHandWritten`). The collision is resolved at BUILD
 *  (ADR 0114 §2, issue #3052) — `scripts/catalogue-artifact.ts` excludes a
 *  hand-written oracle id at generation — so neither side's packed corpus
 *  holds one, and the skip in `addCompiled` has nothing left to drop. That it never does is asserted in the GATE
 *  (`scripts/__tests__/catalogue-artifact.test.ts`), never here: see
 *  `excludeHandWritten`'s own comment for why a module-load throw is the wrong
 *  place to notice a stale pool. */
const handWrittenIds: ReadonlySet<string> = new Set(
    handWrittenEntryById.keys()
);

const staleIndex = (what: string): Error =>
    new Error(
        `The Definition Index is stale: ${what}. Run: bun run catalogue:pack`
    );

/** The hand-written definition for `id`, read from the Set module export the
 *  index locates — the module's own object, unexpanded. A `defineCard`
 *  factory is called here, on this first request, and memoises what it
 *  builds (issue #4857): the same object for every later request.
 *
 *  `null` while the Set is not RESIDENT in this graph (a client that has
 *  loaded only its game's Sets, issue #5615): the same answer an unknown id
 *  gets — `tryGetDefinition` returns `null`, `getDefinition` throws `Card
 *  not found`. Nothing is memoised about the miss, so the next request after
 *  the Set is installed resolves. Not reading before the Set is resident is
 *  the gate's job (`src/lib/catalogue/definitionShards.ts`), the only
 *  guarantee there is. */
function handWrittenDefinition(id: string): CardDefinition | null {
    const entry = handWrittenEntryById.get(id);
    if (entry === undefined) return null;
    const [, name, setCode, exportName] = entry;
    const module = setModuleSource.resident(setCode);
    if (module === undefined) return null;
    const value = resolveCardExport(module[exportName]);
    if (value === undefined || value.id !== id) {
        throw staleIndex(`${name} (${id}) is not ${setCode}.${exportName}`);
    }
    return value;
}

/** The home Set of a HAND-WRITTEN definition — the Set module that declares
 *  it, read off the Definition Index — or `undefined` for every other id
 *  (compiled rows, tokens, a derived face). What the client's shard loader
 *  keys a definition's chunk on (issue #5615). */
export const handWrittenSetCodeOf = (id: string): string | undefined =>
    handWrittenEntryById.get(id)?.[2];

/** One installed piece of the compiled section of the Definition Index, and
 *  the packed rows behind it if it carries any:
 *  - the SERVER's bundled corpus, the whole index and every row, at load;
 *  - a CLIENT shard (issue #5616): one first-printing Set's index slice and
 *    rows, fetched when a game or a whole-catalogue surface needs it;
 *  - the CLIENT's compiled index alone (`lookup: null`), fetched on demand by
 *    a surface that lists or resolves NAMES (the name-a-card prompt, the
 *    strict Import deck, the debug name fields) without any definition. */
interface CompiledSection {
    readonly index: CompiledDefinitionIndex;
    readonly lookup: PackedLookup | null;
}

const compiledSections: CompiledSection[] = [];

/** A compiled id's place: `section * SECTION_ROW_SPAN + row`, ONE number per
 *  id rather than an object — at 35k cards a per-id object is ~1 MiB of
 *  client heap (issue #4861). A section holds fewer rows than the span. */
const SECTION_ROW_SPAN = 2 ** 20;
const compiledAt = new Map<string, number>();

const sectionOf = (at: number): CompiledSection =>
    compiledSections[Math.floor(at / SECTION_ROW_SPAN)]!;

/** The compiled definition for `id`, from the packed row of the section that
 *  placed it — the server's bundled corpus (issue #4168), a client shard
 *  (issue #5616). An id no installed section holds, or one only the
 *  client's rowless index knows (its shard is not resident), inflates
 *  nothing: `null`, the answer a non-resident hand-written card gets. */
function compiledDefinition(id: string): CardDefinition | null {
    const at = compiledAt.get(id);
    if (at === undefined) return null;
    return sectionOf(at).lookup?.lookup(id) ?? null;
}

/** A catalogue card's definition exactly as declared, unexpanded: the Set
 *  module's object, or the compiled row.
 *
 *  SWAP-BLIND for a hand-written card: it reads the module, never the
 *  registry Map, so the behavioural gold harness's swap
 *  (`convex/oracle/behavioural.ts`), which writes the Map, does not reach a
 *  card resolved here by NAME. Closed by
 *  `scripts/__tests__/card-test-seam-boundary.test.ts` (issue #3048), which
 *  forbids a per-card test from reaching `getCardByName`/`tryGetCardByName`
 *  as its subject — see `convex/oracle/behavioural.ts` § "Gap 1 disposition"
 *  (issue #3060). */
const rawCatalogueDefinition = (id: string): CardDefinition | null =>
    handWrittenDefinition(id) ?? compiledDefinition(id);

/** The compiled population, from the compiled index: installed at load on
 *  the server, a section at a time on the client. Read through
 *  {@link orderedCompiledIds}, in catalogue order. Stated
 *  POSITIVELY, never inferred from the registry, which is a LIVE map that
 *  grows during play — `maybeSynthesizeToken` and `registerTokenDefinition`
 *  write synthesized token definitions (CR 111.1) into it, and a consumer
 *  that enumerated it would pick those up as printed cards (issue #3054's
 *  search index did, offering `token:Soldier|Creature|…` in the deck
 *  builder). */
const compiledIds: string[] = [];
let compiledIdsSorted = true;

/** {@link compiledIds} in CATALOGUE ORDER — code-point id order, the order
 *  the server's corpus holds its rows in. A client installs its sections a
 *  shard at a time, in whatever order a game asks for them (issue #5616), so
 *  the order is restored on read, once per batch of arrivals, and every
 *  enumeration (`getAllCardNames`, `getAllCatalogueCards`, the registry's
 *  catalogue walk) sees the same sequence whatever the arrival order was. */
function orderedCompiledIds(): readonly string[] {
    if (!compiledIdsSorted) {
        compiledIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        compiledIdsSorted = true;
    }
    return compiledIds;
}

/** A compiled card's name and Set are read off its section's index row
 *  ({@link compiledAt}) rather than copied into per-id maps: on the client
 *  the index is the resident cost of the catalogue, and at 35k cards every
 *  per-id map is ~1 MiB of heap (issue #4861). */
const compiledNameOf = (id: string): string | undefined => {
    const at = compiledAt.get(id);
    return at === undefined
        ? undefined
        : sectionOf(at).index.names[at % SECTION_ROW_SPAN];
};

/** HAND-WRITTEN definitionId → home Set code (its module). A compiled
 *  card's Set — its first printing (issue #4363) — is its index row's. */
const definitionSetCode = new Map<string, string>();

const setCodeOf = (id: string): string | undefined => {
    const own = definitionSetCode.get(id);
    if (own !== undefined) return own;
    const at = compiledAt.get(id);
    const code =
        at === undefined
            ? undefined
            : sectionOf(at).index.setCodes[at % SECTION_ROW_SPAN];
    return code ? code : undefined;
};

/** Lowercase name → the id of the definition it names. The definition
 *  itself is resolved on lookup (`resolveNamed`).
 *
 *  Precedence: a hand-written card over a compiled one (ADR 0108) — the
 *  hand-written section is written at load, first, and a compiled name never
 *  displaces it; among hand-written keys first-write-wins, printed names
 *  before twin names. Among COMPILED keys the rule cannot be arrival order,
 *  because a client installs the compiled section a shard at a time, in
 *  whatever order its game asks for them (issue #5616): a printed name wins
 *  its key over a twin's, and between two twins the lower parent id wins —
 *  the id order the server's one corpus writes in, so every arrival order
 *  ends in the server's lookup ({@link addCompiledName}). Two printed names
 *  never meet: compiled names are unique, which
 *  `scripts/__tests__/catalogue-artifact.test.ts` asserts rather than
 *  assumes; hand-written names are unique by the generator's own refusal
 *  (`scripts/lib/definition-index.ts`).
 *
 *  The twin keys — CR 715.5 / 722.5 (ADR 0120): "if an effect instructs a
 *  player to choose a card name and the player wants to choose an adventurer
 *  card's ALTERNATIVE name, the player may do so"; CR 709.4a: a split card's
 *  half names; CR 712.19 (ADR 0122): a modal double-faced card's back-face
 *  name and its full `front // back` name — live in this LOOKUP only. Every
 *  enumerated population (deck legality, the Limited pool, `check:index`,
 *  `getAllCardNames`, the deck-builder search index) still sees exactly one
 *  card (CR 715.2c, 709.2). */
const nameIndex = new Map<string, string>();

/** definitionId → its choosable names, where they are not just its printed
 *  name (CR 715.5 / 709.4a / 712.19). */
const chooseableById = new Map<string, readonly string[]>();

/** A printed nonmodal back face's token id → the declaring card's id
 *  (CR 712.8e, issue #3249). */
const backFaceOwner = new Map<string, string>();

const ownEntries = <T>(record: Readonly<Record<string, T>>, key: string) =>
    Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

function addName([key, id]: NameEntry): void {
    if (!nameIndex.has(key)) nameIndex.set(key, id);
}

/** The id a definition's lookups are ordered by: a twin sorts at its
 *  parent, as the server's corpus (rows in id order, each row's twin keys
 *  right after its printed name) writes it. */
const rowIdOf = (id: string): string => parentIdOfTwin(id) ?? id;

/** A COMPILED name key joins the lookup, whatever order the shards arrive
 *  in. Who holds a key is read off the holder's id — a twin's id is a twin
 *  id, a hand-written card's row is in the hand-written index — rather than
 *  kept in a map beside the lookup. */
function addCompiledName([key, id]: NameEntry): void {
    const held = nameIndex.get(key);
    if (held !== undefined) {
        const heldRow = rowIdOf(held);
        // Hand-written, printed or twin (ADR 0108); or a compiled printed
        // name, which only another printed name could claim — and compiled
        // printed names are unique.
        if (handWrittenIds.has(heldRow) || !isTwinDefinitionId(held)) return;
        // A compiled twin holds it: a printed name takes it, a twin of a
        // lower row does.
        if (isTwinDefinitionId(id) && rowIdOf(id) >= heldRow) return;
    }
    nameIndex.set(key, id);
}

function addChooseable(id: string, names: readonly string[]): void {
    if (!chooseableById.has(id)) chooseableById.set(id, names);
}

/** First declaring card wins — in id order among COMPILED declarers, so a
 *  shard's arrival order cannot change the answer (issue #5616); a
 *  hand-written declarer, written at load, is never displaced. */
function addBackFaceOwner(tokenId: string, id: string): void {
    const held = backFaceOwner.get(tokenId);
    if (
        held === undefined ||
        (!handWrittenIds.has(held) && !handWrittenIds.has(id) && id < held)
    ) {
        backFaceOwner.set(tokenId, id);
    }
}

function addLookups(lookups: DefinitionIndexLookups): void {
    for (const [id, names] of Object.entries(lookups.chooseableNames)) {
        addChooseable(id, names);
    }
    for (const [tokenId, id] of Object.entries(lookups.backFaceTriggers)) {
        addBackFaceOwner(tokenId, id);
    }
}

/** One compiled card joins the populations. A compiled row for a hand-written
 *  card never does (ADR 0108 — the same rule `excludeHandWritten` states); a
 *  module-declared card wins its Set and its name. A card already known is
 *  not registered twice — but a section that carries its ROW takes over from
 *  one that only indexed it (the client's names index, then the card's
 *  shard): the name, the Set and the lookups are the same rows' either way. */
function addCompiled(
    id: string,
    at: number,
    name: string,
    twinNames: readonly NameEntry[]
): void {
    if (handWrittenIds.has(id)) return;
    const known = compiledAt.get(id);
    if (known !== undefined) {
        if (sectionOf(known).lookup === null && sectionOf(at).lookup !== null)
            compiledAt.set(id, at);
        return;
    }
    if (compiledIds.length > 0 && compiledIds[compiledIds.length - 1]! > id)
        compiledIdsSorted = false;
    compiledIds.push(id);
    compiledAt.set(id, at);
    addCompiledName([name.toLowerCase(), id]);
    for (const entry of twinNames) addCompiledName(entry);
}

for (const [id, name, setCode] of handWrittenIndex.entries) {
    definitionSetCode.set(id, setCode);
    addName([name.toLowerCase(), id]);
}
for (const [id] of handWrittenIndex.entries) {
    for (const entry of ownEntries(handWrittenIndex.lookups.twinNames, id) ??
        []) {
        addName(entry);
    }
}
addLookups(handWrittenIndex.lookups);

let expandedCatalogueCards: CardDefinition[] | null = null;

/** A compiled section joins the populations — its index read, no row
 *  touched — and `lookup`, when it has one, starts serving its rows.
 *  Returns how many compiled cards the catalogue did not know before. The
 *  precedences are arrival-order free ({@link addCompiledName},
 *  {@link addBackFaceOwner}), so sections may arrive in any order. */
function installCompiledSection(
    index: CompiledDefinitionIndex,
    lookup: PackedLookup | null
): number {
    const section = compiledSections.length;
    compiledSections.push({ index, lookup });
    const before = compiledIds.length;
    index.ids.forEach((id, row) =>
        addCompiled(
            id,
            section * SECTION_ROW_SPAN + row,
            index.names[row]!,
            ownEntries(index.lookups.twinNames, id) ?? []
        )
    );
    addLookups(index.lookups);
    // On the client this runs after module load, so a population memo taken
    // earlier would be missing every compiled row.
    expandedCatalogueCards = null;
    return compiledIds.length - before;
}

// The SERVER's compiled section, at load: the packed corpus's index, its rows
// read from the packed blocks on first request (issue #4168 retired the
// literal pool this used to fall back to). A client graph has no bundled
// corpus (`./compiledPool` is aliased to a stub) and installs its sections
// from what it fetches: `registerCompiledShard`, `registerCompiledIndex`.
const bundledIndex = readCompiledIndex(packedServerCorpus);
if (bundledIndex !== null && packedCorpusLookup !== null) {
    installCompiledSection(bundledIndex, packedCorpusLookup);
}

/** Every Card ID the catalogue serves, in catalogue order. */
function* catalogueIds(): Generator<string> {
    for (const [id] of handWrittenIndex.entries) yield id;
    yield* orderedCompiledIds();
}

// The lazy source (issue #4165, widened by issue #4856): a registry miss asks
// the hand-written modules first, then the compiled rows. Hand-written first
// keeps ADR 0108's precedence; the registry registers what it returns through
// `preloadDefinitions`, so twins and static-kind indexes are derived exactly
// as the eager preload derived them.
setLazyDefinitionSource(rawCatalogueDefinition, catalogueIds);
setPrintedBackFaceIndex((tokenId) => backFaceOwner.get(tokenId));

const installedShards = new Set<string>();
let compiledIndexInstalled = bundledIndex !== null;

/**
 * One CLIENT shard of the compiled corpus (issue #5616, ADR 0113 Amendment
 * VI): a first-printing Set's rows and its slice of the compiled index,
 * FETCHED by the main thread or the Bot worker
 * (`src/lib/catalogue/compiled-shards.ts`). Its index joins the populations,
 * as the server's whole section does at load; its rows are decoded a block at
 * a time on first request, against the dictionary every shard shares.
 *
 * `getDefinition` stays synchronous (ADR 0113 §1): a compiled card whose
 * shard is not resident answers `null`, as a hand-written card whose Set is
 * not; the gate and the board's hold install the shards a snapshot needs
 * before anything reads it.
 *
 * Returns how many compiled cards the catalogue did not know before; `0` for
 * a shard already installed, and on the server (its bundled section holds
 * every row already).
 */
export function registerCompiledShard(
    shard: CompiledShard,
    dictionaryOf: () => Uint8Array
): number {
    if (packedCorpusLookup !== null || installedShards.has(shard.key)) return 0;
    const added = installCompiledSection(
        shardIndexOf(shard),
        createBlockLookup(shard, dictionaryOf)
    );
    // Only once it is in: a throw above leaves the shard retryable.
    installedShards.add(shard.key);
    return added;
}

/**
 * The CLIENT's compiled Definition Index on its own, no row (issue #5616):
 * every compiled card's id, name, Set and lookups — what a surface that lists
 * or resolves NAMES reads (the name-a-card prompt's list, the strict Import
 * deck, the debug name fields), fetched only when one opens. A card it names
 * still answers `null` until its shard is resident, and its Set code says
 * which shard that is ({@link compiledShardKeyOf}).
 *
 * Once per graph; returns how many compiled cards joined.
 */
export function registerCompiledIndex(index: CompiledDefinitionIndex): number {
    if (compiledIndexInstalled) return 0;
    compiledIndexInstalled = true;
    return installCompiledSection(readCompiledIndex(index)!, null);
}

/** Whether every compiled card's name and Set are known in this graph: the
 *  server's bundled section, or the client's fetched index. */
export const isCompiledIndexInstalled = (): boolean => compiledIndexInstalled;

/** Whether the rows of client shard `key` are resident in this graph: it
 *  was installed, or this graph bundles every row (the server). */
export const isCompiledShardInstalled = (key: string): boolean =>
    packedCorpusLookup !== null || installedShards.has(key);

/** The client shard a COMPILED card's row lives in — its first-printing Set
 *  code, read off whichever installed section knows the card — or
 *  `undefined` for a card no installed section knows (a hand-written card, a
 *  token, a derived face, or a compiled card while neither its shard nor the
 *  compiled index is resident). */
export function compiledShardKeyOf(id: string): string | undefined {
    if (handWrittenIds.has(id) || !compiledAt.has(id)) return undefined;
    return setCodeOf(id);
}

/** Whether a compiled card's row can be decoded now: some installed section
 *  that knows it carries its row. */
export const isCompiledRowResident = (id: string): boolean => {
    const at = compiledAt.get(id);
    return at !== undefined && sectionOf(at).lookup !== null;
};

/** Every hand-written definition, walked from the Set modules' exports at
 *  CALL time — never at load. A `defineCard` factory is built by the walk
 *  (issue #4857): this is the catalogue-wide reader, and it asks for them all. The generator's input
 *  (`scripts/catalogue-artifact.ts`, which writes the Definition Index from
 *  it) and the eager walk the index is proven equal to.
 *
 *  Set modules in their declared order, each one's exports in CODE-UNIT order
 *  of their names — the order an ES module namespace object lists its exports
 *  in, made explicit because not every runtime this runs under materialises a
 *  real namespace (vitest's transform lists source order). One order
 *  everywhere, so the index the generator writes under bun is the walk a test
 *  compares it with. */
export function walkHandWrittenDefinitions(): HandWrittenExport[] {
    const walk: HandWrittenExport[] = [];
    for (const setCode of setModuleSource.codes) {
        // Every Set is resident on the server, the generator's only runtime;
        // a client graph walks what it has installed.
        const module = setModuleSource.resident(setCode);
        if (module === undefined) continue;
        const exports = Object.entries(module).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
        );
        for (const [exportName, value] of exports) {
            const definition = resolveCardExport(value);
            if (definition !== undefined) {
                walk.push({ setCode, exportName, definition });
            }
        }
    }
    return walk;
}

/** How many packed blocks this module graph has inflated: the observable a test bounds a request (issue #4165)
 *  or a client game load (issue #4861) by. */
export const packedCorpusInflations = (): number =>
    compiledSections.reduce(
        (sum, { lookup }) => sum + (lookup?.inflations() ?? 0),
        0
    );

/** What a name key resolves to: a TWIN through the registry (it is minted
 *  by `preloadDefinitions` when its parent is resolved, and expanded like any
 *  registered definition), a printed card as its catalogue declares it. */
const resolveNamed = (id: string): CardDefinition | null =>
    isTwinDefinitionId(id) ? tryGetDefinition(id) : rawCatalogueDefinition(id);

export const getCardByName = (name: string): CardDefinition => {
    const card = tryGetCardByName(name);
    if (!card) {
        throw new Error(`Card not found by name: ${name}`);
    }
    return card;
};

export const tryGetCardByName = (name: string): CardDefinition | null => {
    const id = nameIndex.get(name.toLowerCase());
    return id === undefined ? null : resolveNamed(id);
};

// The whole catalogue, not the hand-written half: a retired hand-written card
// (ADR 0114 §2, issue #4027) is still placeable through
// `tryGetPlaceableCardByName` below, and every consumer of this list treats
// it as the allow-list of names that CAN be placed — the LLM scenario
// generator's `scenarioAllowList` (`convex/debugScenarios.ts`), the debug
// `debugListCards` query (`convex/game.ts`), and the debug card-name
// autocomplete field. Narrowing it to hand-written-only would let the
// allow-list and the placement resolver disagree on exactly the cards this
// migration retires.
//
// Read from the Definition Index: the catalogue's names, with no definition
// built to read them (issue #4856).
export const getAllCardNames = (): string[] => [
    ...handWrittenIndex.entries.map(([, name]) => name),
    ...orderedCompiledIds().map((id) => compiledNameOf(id)!),
];

/** What the Definition Index alone says about a NAME (issue #4166):
 *  - `unknown` — no catalogue name carries it;
 *  - `twin` — it names a derived twin (an inset spell, a split half, a modal
 *    back face), whose characteristics only the definition holds;
 *  - `printed` — it names a printed card: its id, its printed name (the
 *    canonical casing) and whether the SUBMITTED spelling is one a player may
 *    CHOOSE (CR 709.4a — a split card's combined `left // right` key is a
 *    lookup, never a choice; CR 712.19 — either face of a modal card, not
 *    both). */
export type IndexedCardName =
    | { readonly kind: "unknown" }
    | { readonly kind: "twin" }
    | {
          readonly kind: "printed";
          readonly id: string;
          readonly name: string;
          readonly chooseable: boolean;
      };

/** Name-a-card validation's lookup: resolves a name through the name index
 *  and the index's choosable names, building no definition and so opening no
 *  packed block. The same verdict `tryGetCardByName` plus
 *  `hasName(def, def.name)` give, for a printed card. */
export const lookupCardNameInIndex = (name: string): IndexedCardName => {
    const id = nameIndex.get(name.toLowerCase());
    if (id === undefined) return { kind: "unknown" };
    if (isTwinDefinitionId(id)) return { kind: "twin" };
    const printed = handWrittenEntryById.get(id)?.[1] ?? compiledNameOf(id);
    if (printed === undefined) return { kind: "unknown" };
    const choosable = chooseableById.get(id) ?? [printed];
    return {
        kind: "printed",
        id,
        name: printed,
        chooseable:
            name.toLowerCase() === printed.toLowerCase() &&
            choosable.includes(printed),
    };
};

/** The id a NAME resolves to — exactly `tryGetCardByName(name)?.id`, read
 *  from the name index alone, so nothing is decoded to learn it (issue
 *  #4861): a whole-pool membership check (the cube pool) costs no block. */
export const catalogueIdByName = (name: string): string | null =>
    nameIndex.get(name.toLowerCase()) ?? null;

/** The name of definition `id` — exactly `tryGetDefinition(id)?.name`, but a
 *  catalogue card's is read from the Definition Index, decoding nothing
 *  (issue #4861). Only an id the index does not hold (a derived face, a
 *  token) is resolved through its definition. The existence check of every
 *  whole-pool reader — Draftability, scope listings, rating and profile
 *  validation — which would otherwise decode each card it only counts. */
export const resolveCardName = (id: string): string | null =>
    handWrittenEntryById.get(id)?.[1] ??
    compiledNameOf(id) ??
    tryGetDefinition(id)?.name ??
    null;

/** CR 715.4 / 715.2c — `tryGetCardByName` restricted to names that can be
 *  PLACED as a card: a printed catalogue card, never an inset spell's twin.
 *
 *  One twin IS a card in a zone: a modal double-faced card's back face, which
 *  a permanent can show on the battlefield (CR 712.8f). Its name resolves to
 *  the CARD that carries it — the front face's definition, which is what the
 *  card is in every other zone (CR 712.8a) and what a deck, a cube or a banlist
 *  row naming either face means. A caller that places it back face up asks the
 *  bare lookup which face was named (the scenario builder, issue #4767).
 *
 *  The exact complement of {@link getChooseableCardNames}. An Adventure exists
 *  only while its card is on the stack as one ("in every zone except the stack
 *  … an adventurer card has only its normal characteristics"), so any consumer
 *  that turns a NAME into a card living in a zone, a deck, a cube or a banlist
 *  must resolve through this and not through the bare lookup — otherwise a
 *  scenario spec, a cube list or a banlist row naming "Petty Theft" binds to an
 *  Instant that is in no enumerated population, has no card-index row and can
 *  never revert (PR #3302 review finding 5). Fail closed: unknown and
 *  not-placeable are the same `null`.
 *
 *  `tryGetCardByName` itself stays wide, because CR 715.5's name CHOICE is a
 *  legitimate consumer of the alternative name. */
export const tryGetPlaceableCardByName = (
    name: string
): CardDefinition | null => {
    const def = tryGetCardByName(name);
    if (!def) return null;
    if (!isTwinDefinitionId(def.id)) return def;
    const frontId = modalBackFaceParentId(def.id);
    return frontId ? (tryGetDefinition(frontId) ?? null) : null;
};

/** CR 715.5 / 722.5 — every card name a player may CHOOSE when an effect says
 *  "choose a card name": {@link getAllCardNames} plus every inset spell's
 *  alternative name ("if an effect instructs a player to choose a card name and
 *  the player wants to choose an adventurer card's alternative name, the player
 *  may do so").
 *
 *  A SECOND seam rather than a widening of `getAllCardNames`, and the split is
 *  the same one the lookups already make: `tryGetCardByName` resolves an inset
 *  name and every ENUMERATED population — deck legality, the Limited pool, the
 *  card index, the debug-scenario allow-list — does not, because CR 715.2c says
 *  an adventurer card is one card and none of those may see two. This one is
 *  the choice DOMAIN, which is exactly where 715.5 says the extra name belongs.
 *
 *  Its consumer is the client's `name-card` input, whose candidate list AND
 *  submit gate were built from `getAllCardNames()` — so the server accepted
 *  "Petty Theft" through `isLegalNamedCard` while the human's button stayed
 *  inert (PR #3302 review finding 4). */
export const getChooseableCardNames = (): string[] => {
    // The hand-written population's own names first — this seam WIDENS
    // `getAllCardNames`, and the client's candidate list is built by
    // difference against it.
    //
    // Read from the Definition Index (issue #4856): no definition is built.
    const names: string[] = [];
    for (const [id, name] of handWrittenIndex.entries) {
        names.push(...(chooseableById.get(id) ?? [name]));
    }
    // A COMPILED row contributes its FULL `chooseableNamesOf`, own printed
    // name included — `getAllCardNames` widened to `getAllCatalogueCards()`
    // in issue #4027 (a retired hand-written card is compiled-only and must
    // stay choosable), so a compiled row's own name is no longer absent from
    // that seam either. The two seams are widened TOGETHER on purpose: ADR
    // 0113 §2's asymmetric delivery (bundled on the server, fetched on the
    // client) means both sides build this same list from the compiled
    // population once hydrated, so the submit gate and the button's
    // candidate list still agree.
    for (const id of orderedCompiledIds())
        names.push(...(chooseableById.get(id) ?? [compiledNameOf(id)!]));
    return names;
};

// Re-use the registry's expandDefinition for the catalogue-level getAllCards,
// so keyword cards are expanded identically. Import the expansion from the
// registry seam — but `expandDefinition` is not exported. Instead, route
// through `getDefinition` to get the expanded version.

/** Every HAND-WRITTEN `CardDefinition`, in catalogue order. Routed through
 *  `getDefinition` (ADR 0054) so the catalogue and the `getDefinition`
 *  seam return the SAME (expanded) object for a keyword card.
 *
 *  SWAP-BLIND once memoized: `vitest.setup.node.ts` calls this in its freeze
 *  loop BEFORE the behavioural swap block runs, so `expandedAllCards` bakes
 *  in the hand-written population for the rest of that worker. Same
 *  disposition as the name lookup's — see `convex/oracle/behavioural.ts`
 *  § "Gap 1 disposition" (issue #3060). */
let expandedAllCards: CardDefinition[] | null = null;
export const getAllCards = (): CardDefinition[] => {
    if (!expandedAllCards)
        expandedAllCards = handWrittenIndex.entries.map(([id]) =>
            getDefinition(id)
        );
    return expandedAllCards;
};

/** Every card in the CATALOGUE — hand-written and compiled alike — expanded,
 *  and nothing else.
 *
 *  This is the population a catalogue-wide sweep wants, and the reason it is
 *  not `[...registeredDefinitions()]` is the comment on `compiledIds`
 *  above: the registry also holds runtime-synthesized tokens and the face-down
 *  sentinel (CR 708.2), neither of which is a printed card. It is not
 *  `getAllCards()` either — that is the HAND-WRITTEN half only (ADR 0108 §3),
 *  which is what made every compiled card read as *Unavailable* in the deck
 *  builder (issue #3054).
 *
 *  Memoised, and the memo is dropped when the client installs its compiled
 *  section after module load (`registerPackedCorpus`). */
export const getAllCatalogueCards = (): CardDefinition[] => {
    if (!expandedCatalogueCards)
        expandedCatalogueCards = [
            ...getAllCards(),
            ...orderedCompiledIds().map((id) => getDefinition(id)),
        ];
    return expandedCatalogueCards;
};

/** The hand-written definitions exactly as their set modules declare them —
 *  UNEXPANDED, unlike {@link getAllCards}.
 *
 *  The catalogue artifact generator (`scripts/catalogue-artifact.ts`, ADR 0113
 *  §2 / ADR 0114 §2) relocates these verbatim, and it needs the raw form for
 *  the same reason `convex/oracle/gold.ts`'s `TwinResult` documents: a
 *  relocated row is handed back to `preloadDefinitions`, which expands on
 *  read, and expanding an already-expanded definition injects an implicit
 *  keyword's triggers a second time. Relocation is a MOVE of the module's own
 *  bytes; expansion is the registry's job on the far side. */
export const getAllRawCards = (): readonly CardDefinition[] =>
    walkHandWrittenDefinitions().map((e) => e.definition);

/** A single printing of a card: its image-key print id and the set it was
 *  printed in. */
export interface CardPrinting {
    printId: string;
    setCode: string;
}

/** A Card Definition's own (first-printing) Set code — the one Set the
 *  registry knows without a printing list. Empty when unknown. */
export const getDefinitionSetCode = (definitionId: string): string =>
    setCodeOf(definitionId) ?? "";

export const isPrintedInSet = (cardId: string, setCode: string): boolean => {
    const def = tryGetDefinition(cardId);
    if (!def) return false;
    return setCodeOf(def.id) === setCode;
};

export const getAllSetCodes = (): string[] => {
    const codes = new Set<string>();
    for (const code of definitionSetCode.values()) codes.add(code);
    for (const id of orderedCompiledIds()) {
        const code = setCodeOf(id);
        if (code) codes.add(code);
    }
    return [...codes].sort();
};

export interface DeckCardMeta {
    cardId: string;
    setCode: string;
    rarity: Rarity;
    isBasic: boolean;
    /** The canonical `CardDefinition.name` (Scryfall oracle name), used by
     *  legality checks that join on name rather than set/id (issue #2695 —
     *  Premodern's Scryfall-legality gate; `convex/formats.ts`'s
     *  `checkOracleLegality`). OPTIONAL so the many hand-rolled `ResolveCard`
     *  test stubs across the repo (`convex/__tests__/formats*.test.ts`,
     *  `convex/limited/__tests__/*`, …) that predate this field keep
     *  type-checking unchanged; every REAL resolver (this function) always
     *  populates it. */
    name?: string;
}

export const resolveDeckCardMeta = (cardId: string): DeckCardMeta | null => {
    const def = tryGetDefinition(cardId);
    if (!def) return null;
    const isBasic = def.supertypes?.includes("Basic") ?? false;
    // The definition's OWN printing: a reprint's Set and Rarity live on its
    // `cardPrints` row (`makeResolveCardFromRows`, issue #5106), not here.
    return {
        cardId: def.id,
        name: def.name,
        setCode: setCodeOf(def.id) ?? "",
        rarity: def.rarity,
        isBasic,
    };
};

type DeckCardArg = { cardId: string; cardName: string; definitionId?: string };

/**
 * Fills a deck card entry's `definitionId` (Card Prints, ADR 0140/issue
 * #4117) when the caller omitted it, from the registry: right for a Card ID,
 * and for a Print ID it falls back to the id itself rather than dropping the
 * card, because the registry no longer knows printings (issue #4121). A write
 * that can reach the `cardPrints` rows resolves a printing there first
 * (`fillDefinitionIds`, `convex/cardPrintRows.ts`).
 */
export function withDefinitionId(card: DeckCardArg): Required<DeckCardArg> {
    if (card.definitionId) return card as Required<DeckCardArg>;
    return {
        ...card,
        definitionId: resolveDeckCardMeta(card.cardId)?.cardId ?? card.cardId,
    };
}
