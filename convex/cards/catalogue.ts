import type { CardDefinition, Rarity } from "./types";
// All set modules — imported once, populated into the runtime registry on
// import (side-effect). This module is the heavyweight split-out from
// `index.ts`; only imported by the Convex backend and by client pages that
// need catalogue-wide functions (deck builder, lobby, draft lab).
import * as lea from "./sets/lea/index.cards";
import * as leb from "./sets/leb/index.cards";
import * as arn from "./sets/arn/index.cards";
import * as atq from "./sets/atq/index.cards";
import * as leg from "./sets/leg/index.cards";
import * as lgn from "./sets/lgn/index.cards";
import * as drk from "./sets/drk/index.cards";
import * as fem from "./sets/fem/index.cards";
import * as ice from "./sets/ice/index.cards";
import * as jou from "./sets/jou/index.cards";
// Vintage Cube card-draw / card-advantage tranche (issue #674)
import * as lrw from "./sets/lrw/index.cards";
import * as m10 from "./sets/m10/index.cards";
import * as m11 from "./sets/m11/index.cards";
import * as m12 from "./sets/m12/index.cards";
import * as dft from "./sets/dft/index.cards";
import * as dka from "./sets/dka/index.cards";
import * as ulg from "./sets/ulg/index.cards";
import * as voc from "./sets/voc/index.cards";
import * as fifthDawn from "./sets/5dn/index.cards";
import * as wth from "./sets/wth/index.cards";
import * as tsp from "./sets/tsp/index.cards";
import * as csp from "./sets/csp/index.cards";
import * as ltc from "./sets/ltc/index.cards";
import * as cns from "./sets/cns/index.cards";
import * as cn2 from "./sets/cn2/index.cards";
import * as thb from "./sets/thb/index.cards";
import * as fut from "./sets/fut/index.cards";
import * as mh1 from "./sets/mh1/index.cards";
import * as bro from "./sets/bro/index.cards";
import * as c18 from "./sets/c18/index.cards";
import * as sos from "./sets/sos/index.cards";
import * as avr from "./sets/avr/index.cards";
import * as pc2 from "./sets/pc2/index.cards";
import * as dmu from "./sets/dmu/index.cards";
import * as mkm from "./sets/mkm/index.cards";
import * as ltr from "./sets/ltr/index.cards";
import * as mh2 from "./sets/mh2/index.cards";
import * as blc from "./sets/blc/index.cards";
import * as tdm from "./sets/tdm/index.cards";
import * as stx from "./sets/stx/index.cards";
import * as mh3 from "./sets/mh3/index.cards";
import * as chk from "./sets/chk/index.cards";
import * as cmr from "./sets/cmr/index.cards";
import * as ody from "./sets/ody/index.cards";
import * as usg from "./sets/usg/index.cards";
import * as uds from "./sets/uds/index.cards";
import * as plc from "./sets/plc/index.cards";
import * as fin from "./sets/fin/index.cards";
import * as mrd from "./sets/mrd/index.cards";
import * as som from "./sets/som/index.cards";
import * as m14 from "./sets/m14/index.cards";
import * as exo from "./sets/exo/index.cards";
import * as kld from "./sets/kld/index.cards";
import * as wwk from "./sets/wwk/index.cards";
import * as tmp from "./sets/tmp/index.cards";
import * as mir from "./sets/mir/index.cards";
import * as ths from "./sets/ths/index.cards";
import * as isd from "./sets/isd/index.cards";
import * as c19 from "./sets/c19/index.cards";
import * as dsk from "./sets/dsk/index.cards";
import * as sth from "./sets/sth/index.cards";
import * as big from "./sets/big/index.cards";
import * as gpt from "./sets/gpt/index.cards";
import * as dis from "./sets/dis/index.cards";
import * as rav from "./sets/rav/index.cards";
import * as mid from "./sets/mid/index.cards";
import * as apc from "./sets/apc/index.cards";
import * as neo from "./sets/neo/index.cards";
import * as bok from "./sets/bok/index.cards";
import * as roe from "./sets/roe/index.cards";
import * as lci from "./sets/lci/index.cards";
import * as por from "./sets/por/index.cards";
import * as p02 from "./sets/p02/index.cards";
import * as phpr from "./sets/phpr/index.cards";
import * as ktk from "./sets/ktk/index.cards";
import * as akh from "./sets/akh/index.cards";
import * as aer from "./sets/aer/index.cards";
import * as rtr from "./sets/rtr/index.cards";
import * as c15 from "./sets/c15/index.cards";
import * as afr from "./sets/afr/index.cards";
import * as hou from "./sets/hou/index.cards";
import * as ecl from "./sets/ecl/index.cards";
import * as c17 from "./sets/c17/index.cards";
import * as pip from "./sets/pip/index.cards";
import * as emn from "./sets/emn/index.cards";
import * as nem from "./sets/nem/index.cards";
import * as fic from "./sets/fic/index.cards";
import * as lcc from "./sets/lcc/index.cards";
import * as m3c from "./sets/m3c/index.cards";
import * as con from "./sets/con/index.cards";
import * as shm from "./sets/shm/index.cards";
import * as zen from "./sets/zen/index.cards";
import * as ons from "./sets/ons/index.cards";
import * as ori from "./sets/ori/index.cards";
import * as eld from "./sets/eld/index.cards";
import * as vis from "./sets/vis/index.cards";
import * as bbd from "./sets/bbd/index.cards";
import * as khm from "./sets/khm/index.cards";
import * as ptk from "./sets/ptk/index.cards";
import * as mbs from "./sets/mbs/index.cards";
import * as nph from "./sets/nph/index.cards";
import * as mmq from "./sets/mmq/index.cards";
import * as c14 from "./sets/c14/index.cards";
import * as pls from "./sets/pls/index.cards";
import * as dtk from "./sets/dtk/index.cards";
import * as onc from "./sets/onc/index.cards";
import * as spm from "./sets/spm/index.cards";
import * as moc from "./sets/moc/index.cards";
import * as dsc from "./sets/dsc/index.cards";
import * as znr from "./sets/znr/index.cards";
import * as woe from "./sets/woe/index.cards";
import * as eoe from "./sets/eoe/index.cards";
import * as tla from "./sets/tla/index.cards";
import * as tmt from "./sets/tmt/index.cards";
import * as tor from "./sets/tor/index.cards";
import * as nec from "./sets/nec/index.cards";
import * as c21 from "./sets/c21/index.cards";
import * as rna from "./sets/rna/index.cards";
import * as dom from "./sets/dom/index.cards";
import * as eve from "./sets/eve/index.cards";
import * as blb from "./sets/blb/index.cards";
import * as clu from "./sets/clu/index.cards";
import * as bng from "./sets/bng/index.cards";
import * as one from "./sets/one/index.cards";
import * as war from "./sets/war/index.cards";
import * as mom from "./sets/mom/index.cards";
import * as clb from "./sets/clb/index.cards";
import * as c13 from "./sets/c13/index.cards";
import * as vow from "./sets/vow/index.cards";
import * as jud from "./sets/jud/index.cards";
import * as m20 from "./sets/m20/index.cards";
import * as ala from "./sets/ala/index.cards";
import * as otj from "./sets/otj/index.cards";
import * as hml from "./sets/hml/index.cards";
import * as scg from "./sets/scg/index.cards";
import * as inv from "./sets/inv/index.cards";
import * as all from "./sets/all/index.cards";
import * as pcy from "./sets/pcy/index.cards";
import * as iko from "./sets/iko/index.cards";
import * as snc from "./sets/snc/index.cards";
import * as j25 from "./sets/j25/index.cards";
import * as soi from "./sets/soi/index.cards";
import * as ncc from "./sets/ncc/index.cards";
import * as arb from "./sets/arb/index.cards";
import * as dmc from "./sets/dmc/index.cards";
import * as dst from "./sets/dst/index.cards";

import {
    preloadDefinitions,
    setLazyDefinitionSource,
    setPrintedBackFaceIndex,
    tryGetDefinition,
    getDefinition,
} from "./registry";
// Compiled-card hydration seam (issue #2702) — see that module's header for
// the full contract. Registered into the SAME `registry` map hand-written
// cards use, so `getDefinition`/`tryGetDefinition` never distinguish the two.
import { excludeHandWritten } from "./compiledCatalogue";
import { chooseableNamesOf } from "./cardNames";
import { modalBackFaceParentId } from "./modalDfc";
import { isTwinDefinitionId } from "./twinId";
import {
    backFaceTriggerTokenId,
    twinNameEntriesOf,
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
// The pool as a BUNDLED module. On the SERVER this is
// `data/oracle-compiled-pool.json`; in a CLIENT build `vite.config.ts`
// aliases this exact relative specifier to an empty array and the rows arrive
// from the fetched artifact instead (ADR 0113 §2, issue #3053). Keep it the
// only importer of `./compiledPool` — pinned by
// `scripts/__tests__/compiled-pool-client-seam.test.ts`. The packed corpus
// beside it carries the COMPILED section of the Definition Index.
import {
    compiledReadyDefinitions,
    packedCorpusLookup,
    packedServerCorpus,
} from "./compiledPool";

function isCardDefinition(value: unknown): value is CardDefinition {
    return (
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        "name" in value &&
        "types" in value
    );
}

// Set modules paired with their lowercase set code.
const setModules: { code: string; exports: Record<string, unknown> }[] = [
    { code: "lea", exports: lea },
    { code: "leb", exports: leb },
    { code: "arn", exports: arn },
    { code: "atq", exports: atq },
    { code: "leg", exports: leg },
    { code: "lgn", exports: lgn },
    { code: "drk", exports: drk },
    { code: "fem", exports: fem },
    { code: "ice", exports: ice },
    { code: "jou", exports: jou },
    { code: "lrw", exports: lrw },
    { code: "m10", exports: m10 },
    { code: "m11", exports: m11 },
    { code: "m12", exports: m12 },
    { code: "dft", exports: dft },
    { code: "dka", exports: dka },
    { code: "ulg", exports: ulg },
    { code: "voc", exports: voc },
    { code: "5dn", exports: fifthDawn },
    { code: "wth", exports: wth },
    { code: "tsp", exports: tsp },
    { code: "csp", exports: csp },
    { code: "ltc", exports: ltc },
    { code: "cns", exports: cns },
    { code: "cn2", exports: cn2 },
    { code: "thb", exports: thb },
    { code: "fut", exports: fut },
    { code: "mh1", exports: mh1 },
    { code: "bro", exports: bro },
    { code: "sos", exports: sos },
    { code: "avr", exports: avr },
    { code: "pc2", exports: pc2 },
    { code: "dmu", exports: dmu },
    { code: "mkm", exports: mkm },
    { code: "ltr", exports: ltr },
    { code: "mh2", exports: mh2 },
    { code: "blc", exports: blc },
    { code: "tdm", exports: tdm },
    { code: "stx", exports: stx },
    { code: "mh3", exports: mh3 },
    { code: "chk", exports: chk },
    { code: "ody", exports: ody },
    { code: "usg", exports: usg },
    { code: "uds", exports: uds },
    { code: "plc", exports: plc },
    { code: "fin", exports: fin },
    { code: "mrd", exports: mrd },
    { code: "som", exports: som },
    { code: "m14", exports: m14 },
    { code: "exo", exports: exo },
    { code: "kld", exports: kld },
    { code: "wwk", exports: wwk },
    { code: "tmp", exports: tmp },
    { code: "mir", exports: mir },
    { code: "ths", exports: ths },
    { code: "isd", exports: isd },
    { code: "c19", exports: c19 },
    { code: "dsk", exports: dsk },
    { code: "sth", exports: sth },
    { code: "big", exports: big },
    { code: "gpt", exports: gpt },
    { code: "dis", exports: dis },
    { code: "rav", exports: rav },
    { code: "mid", exports: mid },
    { code: "apc", exports: apc },
    { code: "neo", exports: neo },
    { code: "bok", exports: bok },
    { code: "roe", exports: roe },
    { code: "lci", exports: lci },
    { code: "por", exports: por },
    { code: "p02", exports: p02 },
    { code: "phpr", exports: phpr },
    { code: "ktk", exports: ktk },
    { code: "akh", exports: akh },
    { code: "aer", exports: aer },
    { code: "rtr", exports: rtr },
    { code: "c15", exports: c15 },
    { code: "afr", exports: afr },
    { code: "hou", exports: hou },
    { code: "ecl", exports: ecl },
    { code: "c17", exports: c17 },
    { code: "pip", exports: pip },
    { code: "emn", exports: emn },
    { code: "nem", exports: nem },
    { code: "fic", exports: fic },
    { code: "lcc", exports: lcc },
    { code: "m3c", exports: m3c },
    { code: "con", exports: con },
    { code: "shm", exports: shm },
    { code: "zen", exports: zen },
    { code: "ons", exports: ons },
    { code: "ori", exports: ori },
    { code: "eld", exports: eld },
    { code: "vis", exports: vis },
    { code: "bbd", exports: bbd },
    { code: "khm", exports: khm },
    { code: "ptk", exports: ptk },
    { code: "mbs", exports: mbs },
    { code: "nph", exports: nph },
    { code: "c18", exports: c18 },
    { code: "mmq", exports: mmq },
    { code: "c14", exports: c14 },
    { code: "pls", exports: pls },
    { code: "dtk", exports: dtk },
    { code: "onc", exports: onc },
    { code: "spm", exports: spm },
    { code: "moc", exports: moc },
    { code: "dsc", exports: dsc },
    { code: "znr", exports: znr },
    { code: "woe", exports: woe },
    { code: "eoe", exports: eoe },
    { code: "tla", exports: tla },
    { code: "tmt", exports: tmt },
    { code: "tor", exports: tor },
    { code: "nec", exports: nec },
    { code: "c21", exports: c21 },
    { code: "rna", exports: rna },
    { code: "dom", exports: dom },
    { code: "eve", exports: eve },
    { code: "blb", exports: blb },
    { code: "clu", exports: clu },
    { code: "bng", exports: bng },
    { code: "one", exports: one },
    { code: "war", exports: war },
    { code: "mom", exports: mom },
    { code: "clb", exports: clb },
    { code: "c13", exports: c13 },
    { code: "vow", exports: vow },
    { code: "jud", exports: jud },
    { code: "m20", exports: m20 },
    { code: "ala", exports: ala },
    { code: "otj", exports: otj },
    { code: "hml", exports: hml },
    { code: "scg", exports: scg },
    { code: "inv", exports: inv },
    { code: "all", exports: all },
    { code: "pcy", exports: pcy },
    { code: "iko", exports: iko },
    { code: "snc", exports: snc },
    { code: "j25", exports: j25 },
    { code: "soi", exports: soi },
    { code: "cmr", exports: cmr },
    { code: "ncc", exports: ncc },
    { code: "arb", exports: arb },
    { code: "dmc", exports: dmc },
    { code: "dst", exports: dst },
];

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
// The definitions are still BUILT eagerly — every Set module evaluates its
// object literals when imported. What changed is that nothing here needs them
// at load; making them factories is the next slice of PRD #4849.

const setModuleByCode = new Map(setModules.map((m) => [m.code, m.exports]));

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

/** The COMPILED section: the packed corpus's index on the server, `null` in a
 *  client graph, whose compiled rows arrive from the fetched artifact. */
const compiledIndex: CompiledDefinitionIndex | null = (() => {
    const raw = packedServerCorpus as Partial<CompiledDefinitionIndex> | null;
    if (raw === null) return null;
    return {
        ids: raw.ids ?? [],
        names: raw.names ?? [],
        setCodes: raw.setCodes ?? [],
        lookups: { ...EMPTY_LOOKUPS, ...raw.lookups },
    };
})();

const handWrittenEntryById = new Map(
    handWrittenIndex.entries.map((entry) => [entry[0], entry])
);

/** Every hand-written Card ID. A compiled row for one of them never registers
 *  (ADR 0108 — `excludeHandWritten`). The collision is resolved at BUILD
 *  (ADR 0114 §2, issue #3052) — `scripts/catalogue-artifact.ts` excludes a
 *  hand-written oracle id at generation — so on the server the filter has
 *  nothing left to drop. That it never does is asserted in the GATE
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
 *  index locates — the module's own object, unexpanded. */
function handWrittenDefinition(id: string): CardDefinition | null {
    const entry = handWrittenEntryById.get(id);
    if (entry === undefined) return null;
    const [, name, setCode, exportName] = entry;
    const value = setModuleByCode.get(setCode)?.[exportName];
    if (!isCardDefinition(value) || value.id !== id) {
        throw staleIndex(`${name} (${id}) is not ${setCode}.${exportName}`);
    }
    return value;
}

const bundledCompiledRow = new Map(
    (compiledIndex?.ids ?? []).map((id, row) => [id, row])
);

/** The compiled definition the SERVER bundles for `id`: the packed corpus's
 *  row with the switch on (issue #4165), else the literal pool's — the same
 *  row index, because both renderings are `merge.serverRows` in order. An id
 *  the index does not hold inflates nothing. */
function bundledCompiledDefinition(id: string): CardDefinition | null {
    const row = bundledCompiledRow.get(id);
    if (row === undefined) return null;
    if (packedCorpusLookup !== null) return packedCorpusLookup.lookup(id);
    const def = compiledReadyDefinitions[row];
    if (def?.id !== id) throw staleIndex(`compiled row ${row} is not ${id}`);
    return def;
}

/** Compiled rows registered at runtime — the CLIENT's fetched artifact
 *  (`registerCompiledDefinitions`). */
const fetchedCompiled = new Map<string, CardDefinition>();

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
    handWrittenDefinition(id) ??
    bundledCompiledDefinition(id) ??
    fetchedCompiled.get(id) ??
    null;

/** The compiled population, in catalogue order: the bundled index's rows at
 *  load (server), then rows registered at runtime (client). Stated
 *  POSITIVELY, never inferred from the registry, which is a LIVE map that
 *  grows during play — `maybeSynthesizeToken` and `registerTokenDefinition`
 *  write synthesized token definitions (CR 111.1) into it, and a consumer
 *  that enumerated it would pick those up as printed cards (issue #3054's
 *  search index did, offering `token:Soldier|Creature|…` in the deck
 *  builder). */
const compiledIds: string[] = [];
const compiledNames: string[] = [];
const compiledIdSet = new Set<string>();
const compiledNameById = new Map<string, string>();

/** definitionId → home Set code: a hand-written card's module, a compiled
 *  row's first printing (issue #4363). */
const definitionSetCode = new Map<string, string>();

/** Lowercase name → the id of the definition it names. The definition
 *  itself is resolved on lookup (`resolveNamed`).
 *
 *  Precedence is first-write-wins, in the order the eager catalogue wrote:
 *  hand-written printed names, then hand-written twin names, then each
 *  compiled row's printed name followed by its own twin names. So a printed
 *  name always wins its key over a twin's, and a hand-written card over a
 *  compiled one (ADR 0108). Among compiled rows first-write-wins is only safe
 *  because compiled names are unique, which
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

function addChooseable(id: string, names: readonly string[]): void {
    if (!chooseableById.has(id)) chooseableById.set(id, names);
}

function addBackFaceOwner(tokenId: string, id: string): void {
    if (!backFaceOwner.has(tokenId)) backFaceOwner.set(tokenId, id);
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
 *  card never does (ADR 0108 — the same rule `excludeHandWritten` states for
 *  a fetched row); a module-declared card wins its Set and its name; a row
 *  already registered is not registered twice. */
function addCompiled(
    id: string,
    name: string,
    setCode: string | undefined,
    twinNames: readonly NameEntry[]
): void {
    if (handWrittenIds.has(id) || compiledIdSet.has(id)) return;
    compiledIdSet.add(id);
    compiledIds.push(id);
    compiledNames.push(name);
    compiledNameById.set(id, name);
    if (setCode && !definitionSetCode.has(id))
        definitionSetCode.set(id, setCode);
    addName([name.toLowerCase(), id]);
    for (const entry of twinNames) addName(entry);
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

if (compiledIndex !== null) {
    compiledIndex.ids.forEach((id, row) =>
        addCompiled(
            id,
            compiledIndex.names[row]!,
            compiledIndex.setCodes[row],
            ownEntries(compiledIndex.lookups.twinNames, id) ?? []
        )
    );
    addLookups(compiledIndex.lookups);
}

/** Every Card ID the catalogue serves, in catalogue order. */
function* catalogueIds(): Generator<string> {
    for (const [id] of handWrittenIndex.entries) yield id;
    yield* compiledIds;
}

// The lazy source (issue #4165, widened by issue #4856): a registry miss asks
// the hand-written modules first, then the bundled compiled rows. Hand-written
// first keeps ADR 0108's precedence; the registry registers what it returns
// through `preloadDefinitions`, so twins and static-kind indexes are derived
// exactly as the eager preload derived them.
setLazyDefinitionSource(
    (id) => handWrittenDefinition(id) ?? bundledCompiledDefinition(id),
    catalogueIds
);
setPrintedBackFaceIndex((tokenId) => backFaceOwner.get(tokenId));

let expandedCatalogueCards: CardDefinition[] | null = null;

/**
 * Register compiled definitions into the runtime registry — the CLIENT's half
 * of ADR 0113 §2's asymmetric delivery: it calls this from the loading gate
 * with the rows it FETCHED (`src/lib/catalogueArtifact.ts`, issue #3053),
 * where `excludeHandWritten` drops the artifact's relocated hand-written rows
 * in favour of the module the engine actually runs. The server registers
 * nothing here: its compiled rows are served lazily from the Definition
 * Index above.
 *
 * Idempotent by construction: `preloadDefinitions` is a keyed write and the
 * populations never take a row twice. Returns how many rows it registered, so
 * a caller can assert the fetch was not a no-op.
 */
export function registerCompiledDefinitions(
    rows: readonly CardDefinition[]
): number {
    const fresh = excludeHandWritten(rows, handWrittenIds);
    preloadDefinitions(fresh);
    for (const card of fresh) {
        if (!bundledCompiledRow.has(card.id)) {
            fetchedCompiled.set(card.id, card);
        }
        // The same entries the generator derives for a bundled row
        // (`./definitionIndex`), derived here from the row in hand.
        addCompiled(card.id, card.name, card.setCode, twinNameEntriesOf(card));
        const chooseable = chooseableNamesOf(card);
        if (chooseable.length !== 1 || chooseable[0] !== card.name) {
            addChooseable(card.id, chooseable);
        }
        const tokenId = backFaceTriggerTokenId(card);
        if (tokenId !== undefined) addBackFaceOwner(tokenId, card.id);
    }
    // The CLIENT calls this after module load (from the loading gate), so a
    // population memo taken earlier would be missing every compiled row.
    expandedCatalogueCards = null;
    return fresh.length;
}

/** Every hand-written definition, walked from the Set modules' exports at
 *  CALL time — never at load. The generator's input
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
    for (const m of setModules) {
        const exports = Object.entries(m.exports).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
        );
        for (const [exportName, value] of exports) {
            if (isCardDefinition(value)) {
                walk.push({ setCode: m.code, exportName, definition: value });
            }
        }
    }
    return walk;
}

/** How many packed blocks this module graph has inflated — `0` with the switch
 *  off. The observable the full-path test bounds a request by (issue #4165). */
export const packedCorpusInflations = (): number =>
    packedCorpusLookup?.inflations() ?? 0;

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
    ...compiledNames,
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
    const printed =
        handWrittenEntryById.get(id)?.[1] ?? compiledNameById.get(id);
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
    compiledIds.forEach((id, i) =>
        names.push(...(chooseableById.get(id) ?? [compiledNames[i]!]))
    );
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
 *  Memoised, and the memo is dropped by `registerCompiledDefinitions` because
 *  the client registers its rows after module load. */
export const getAllCatalogueCards = (): CardDefinition[] => {
    if (!expandedCatalogueCards)
        expandedCatalogueCards = [
            ...getAllCards(),
            ...compiledIds.map((id) => getDefinition(id)),
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
    definitionSetCode.get(definitionId) ?? "";

export const isPrintedInSet = (cardId: string, setCode: string): boolean => {
    const def = tryGetDefinition(cardId);
    if (!def) return false;
    return definitionSetCode.get(def.id) === setCode;
};

export const getAllSetCodes = (): string[] => {
    const codes = new Set<string>();
    for (const code of definitionSetCode.values()) codes.add(code);
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
        setCode: definitionSetCode.get(def.id) ?? "",
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
