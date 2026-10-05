import type { CardDefinition, CardPrint, Rarity } from "./types";
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
import * as unlimited from "./sets/2ed/index.cards";
import * as revised from "./sets/3ed/index.cards";
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
import * as ema from "./sets/ema/index.cards";
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
import * as soc from "./sets/soc/index.cards";
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
import * as fourthEdition from "./sets/4ed/index.cards";
import * as beatdown from "./sets/btd/index.cards";
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
    registerLazyPrintAlias,
    registerPrintAlias,
    setLazyDefinitionSource,
    tryGetDefinition,
    getDefinition,
} from "./registry";
// Compiled-card hydration seam (issue #2702) — see that module's header for
// the full contract. Registered into the SAME `registry` map hand-written
// cards use, so `getDefinition`/`tryGetDefinition` never distinguish the two.
import { excludeHandWritten } from "./compiledCatalogue";
import { insetSpellDefinitionId } from "./insetSpell";
import { chooseableNamesOf } from "./cardNames";
import {
    isModalDoubleFaced,
    modalBackFaceDefinitionId,
    modalBackFaceParentId,
} from "./modalDfc";
import {
    SPLIT_HALF_SIDES,
    SPLIT_NAME_SEPARATOR,
    splitHalfDefinitionId,
} from "./splitCard";
import { isTwinDefinitionId } from "./twinId";
// The pool as a BUNDLED module. On the SERVER this is
// `data/oracle-compiled-pool.json`; in a CLIENT build `vite.config.ts`
// aliases this exact relative specifier to an empty array and the rows arrive
// from the fetched artifact instead (ADR 0113 §2, issue #3053). Keep it the
// only importer of `./compiledPool` — pinned by
// `scripts/__tests__/compiled-pool-client-seam.test.ts`.
import { compiledReadyDefinitions, packedCorpusLookup } from "./compiledPool";

function isCardPrint(value: unknown): value is CardPrint {
    return (
        typeof value === "object" &&
        value !== null &&
        "printId" in value &&
        "definitionId" in value &&
        "setCode" in value
    );
}

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
    { code: "2ed", exports: unlimited },
    { code: "3ed", exports: revised },
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
    { code: "ema", exports: ema },
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
    { code: "soc", exports: soc },
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
    { code: "4ed", exports: fourthEdition },
    { code: "btd", exports: beatdown },
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

const allCards: CardDefinition[] = setModules.flatMap((m) =>
    Object.values(m.exports).filter(isCardDefinition)
);

const allPrints: CardPrint[] = setModules.flatMap((m) =>
    Object.values(m.exports).filter(isCardPrint)
);

// definitionId → home set code (the module the CardDefinition is declared in).
const definitionSetCode = new Map<string, string>();
for (const m of setModules) {
    for (const value of Object.values(m.exports)) {
        if (isCardDefinition(value)) definitionSetCode.set(value.id, m.code);
    }
}

// Populate the runtime registry with all card definitions.
preloadDefinitions(allCards);

// Compiled-card hydration (issue #2702). The collision between a compiled row
// and a hand-written definition for the same print id is resolved at BUILD
// (ADR 0114 §2, issue #3052) — `scripts/catalogue-artifact.ts` excludes a
// hand-written oracle id at generation and `scripts/catalogue-artifact.ts`
// merges the two populations into one artifact — so on the server this filter
// has nothing left to drop. That it never does is asserted in the GATE
// (`scripts/__tests__/catalogue-artifact.test.ts`), never here: see
// `excludeHandWritten`'s own comment for why a module-load throw is the wrong
// place to notice a stale pool.
const handWrittenIds = new Set(allCards.map((c) => c.id));

// Compiled names join the SAME lookup debug scenarios use
// (`tryGetCardByName` — `convex/debugScenarios.ts`), so a compiled `ready`
// card is reachable by name exactly like a hand-written one (issue #2702
// acceptance criterion). A hand-written card always wins its name key: it is
// seeded here first and `registerCompiledDefinitions` never overwrites an
// entry — the same precedence the previous `[...compiled, ...allCards]` Map
// construction expressed by write order.
//
// Among COMPILED rows the precedence is inverted, and that is not a hidden
// equivalence: the old construction let the LAST row with a given name win,
// first-write-wins makes it the FIRST. It is only safe because compiled names
// are unique, which `scripts/__tests__/catalogue-artifact.test.ts` asserts
// rather than assumes — a duplicate there would make the two shapes disagree.
//
// SWAP-BLIND: a module-load `const`, never rewritten by `preloadDefinitions`
// (`registry.ts`) — the behavioural gold harness's swap
// (`convex/oracle/behavioural.ts`) writes the registry Map, not this Map, so
// a card test resolving its subject here would read the hand-written
// definition even while the twin is registered. Closed by
// `scripts/__tests__/card-test-seam-boundary.test.ts` (issue #3048), which
// forbids a per-card test from reaching `getCardByName`/`tryGetCardByName`
// as its subject — see `convex/oracle/behavioural.ts` § "Gap 1 disposition"
// (issue #3060) for the full argument.
const nameRegistry = new Map<string, CardDefinition>(
    allCards.map((card) => [card.name.toLowerCase(), card])
);

/** Every `[nameKey, definition]` pair a card contributes to the name
 *  registry BESIDE its own printed name — an inset spell's alternative name
 *  (CR 715.5 / 722.5), a split card's two half names (CR 709.4a), and a modal
 *  double-faced card's back-face name plus its full `front // back` name.
 *
 *  The twin is looked up rather than rebuilt: `preloadDefinitions` registered
 *  it, so a name resolves to the SAME object every other def-derived reader
 *  sees. A half whose twin failed to hydrate contributes nothing — fail
 *  closed, so a resolvable name always names a real definition. */
function twinNameEntries(
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
    // CR 712.19 (ADR 0122) — "if an effect instructs a player to choose a card
    // name, the player may choose the name of either face of a double-faced
    // card but not both." The card's own name is its FRONT face's (CR 712.8a)
    // and is already in the registry; the modal BACK face's has to resolve
    // here or the name-choice button offers a name `tryGetCardByName` — the
    // server's own submit gate — then refuses. Naming "Soporific Springs"
    // names the LAND face, not the instant that carries it.
    if (isModalDoubleFaced(card)) {
        const twin = tryGetDefinition(modalBackFaceDefinitionId(card.id));
        if (twin) {
            entries.push([twin.name.toLowerCase(), twin]);
            // The printed "front // back" spelling (Scryfall's, and so a deck
            // list's or a Bot Finding's) names the CARD, not a face: CR 712.8a
            // gives it its front face's characteristics everywhere a list is
            // read from, so the key resolves to `card` itself (issue #4767).
            entries.push([
                `${card.name}${SPLIT_NAME_SEPARATOR}${twin.name}`.toLowerCase(),
                card,
            ]);
        }
    }
    return entries;
}

// CR 715.5 / 722.5 (ADR 0120) — "if an effect instructs a player to choose a
// card name and the player wants to choose an adventurer card's ALTERNATIVE
// name, the player may do so." So the inset half's name resolves here, to the
// registered TWIN: naming "Petty Theft" must name the Adventure, not the
// creature that carries it.
//
// The name registry alone, never `allCards`: this map is a LOOKUP, and every
// enumerated population — deck legality, the Limited pool, `check:index`,
// `getAllCardNames`, the deck-builder search index — is built from `allCards`
// or `getAllCatalogueCards()` and so still sees exactly one card (CR 715.2c).
// A printed name always wins the key, the same first-write-wins precedence
// compiled rows get below.
for (const card of allCards) {
    for (const [key, twin] of twinNameEntries(card)) {
        if (nameRegistry.has(key)) continue;
        nameRegistry.set(key, twin);
    }
}

// The compiled rows this graph actually registered, kept because the runtime
// registry is NOT a usable stand-in for "the catalogue's cards": it is a LIVE
// map that grows during play. `maybeSynthesizeToken` and
// `registerTokenDefinition` write synthesized token definitions (CR 111.1)
// into it on any main-thread engine run or board render, and a consumer that
// enumerated the registry would pick those up as if they were printed cards —
// issue #3054's search index did exactly that, and the deck builder would then
// offer `token:Soldier|Creature|…` as an addable card, non-deterministically by
// navigation order. So the catalogue population is stated POSITIVELY here and
// never inferred from the map.
const compiledRegistered: CardDefinition[] = [];
let expandedCatalogueCards: CardDefinition[] | null = null;

/**
 * Register compiled definitions into the runtime registry — the ONE seam
 * both halves of ADR 0113 §2's asymmetric delivery go through.
 *
 * The server calls it once at module load, below, with the bundled pool
 * (`./compiledPool`). The client calls it from the loading gate with the rows
 * it FETCHED (`src/lib/catalogueArtifact.ts`, issue #3053), where the same
 * `excludeHandWritten` filter drops the artifact's relocated hand-written
 * rows in favour of the module the engine actually runs.
 *
 * Idempotent by construction: `preloadDefinitions` is a keyed write and the
 * name map never overwrites. Returns how many rows it actually registered, so
 * a caller can assert the fetch was not a no-op.
 */
export function registerCompiledDefinitions(
    rows: readonly CardDefinition[]
): number {
    const fresh = excludeHandWritten(rows, handWrittenIds);
    preloadDefinitions(fresh);
    for (const card of fresh) {
        // A compiled row's home Set joins the hand-written modules' map, so
        // `getPrintingsForCard`, `getAllSetCodes`, `isPrintedInSet` and
        // `resolveDeckCardMeta` answer for both populations from one source
        // (issue #4363). Never overwrites: a module-declared card wins.
        if (card.setCode !== undefined && !definitionSetCode.has(card.id)) {
            definitionSetCode.set(card.id, card.setCode);
        }
        const key = card.name.toLowerCase();
        if (!nameRegistry.has(key)) nameRegistry.set(key, card);
        // CR 715.5 / 709.4a — the same half-name keys the hand-written loop
        // above seeds, for a COMPILED adventurer or split row.
        // `preloadDefinitions` has already registered their twins.
        for (const [key, twin] of twinNameEntries(card)) {
            if (nameRegistry.has(key)) continue;
            nameRegistry.set(key, twin);
        }
    }
    compiledRegistered.push(...fresh);
    // The CLIENT calls this after module load (from the loading gate), so a
    // population memo taken earlier would be missing every compiled row.
    expandedCatalogueCards = null;
    wirePrintAliases(rows.length > 0);
    return fresh.length;
}

// printId -> whether `registerPrintAlias` has already run for it — tracked
// separately from the registry because `registerPrintAlias` itself throws on
// a repeat call, and `wirePrintAliases` re-scans EVERY print on EVERY
// `registerCompiledDefinitions` call (below).
const aliasedPrintIds = new Set<string>();

/**
 * Wire print-id → same-def-object lookups so `getDefinition(printId)`
 * returns the SAME object reference as `getDefinition(definitionId)` —
 * sharing the `expansionCache` (WeakMap) entry.
 *
 * Re-run on every `registerCompiledDefinitions` call, not just once at module
 * load (ADR 0114 §2, issue #4027): on the SERVER the bundled pool is the
 * whole compiled population and one pass resolves everything. On the CLIENT
 * `./compiledPool` is aliased to an empty array (ADR 0113 §2) — module load
 * calls this with NOTHING, so a retired card's reprint (definitionId now
 * served only by its compiled twin) cannot resolve yet, and must not throw:
 * the loading gate's later call, with the rows it FETCHED
 * (`src/lib/catalogueArtifact.ts`), is what actually hydrates it. Only a call
 * that hydrated real rows (`hydrated`) — the server's one call, or the
 * client's fetch-gate call — can conclude a leftover definitionId is
 * genuinely broken rather than merely not-yet-hydrated.
 */
function wirePrintAliases(hydrated: boolean): CardPrint[] {
    const unresolved: CardPrint[] = [];
    for (const print of allPrints) {
        if (aliasedPrintIds.has(print.printId)) continue;
        const def = tryGetDefinition(print.definitionId);
        if (!def) {
            unresolved.push(print);
            continue;
        }
        registerPrintAlias(print.printId, print.definitionId);
        aliasedPrintIds.add(print.printId);
    }
    if (hydrated && unresolved.length > 0) {
        const first = unresolved[0]!;
        throw new Error(
            `CardPrint ${first.printId} references unknown definitionId ${first.definitionId}`
        );
    }
    return unresolved;
}

// Issue #4165 (PRD #4161) — the packed fallback, behind `PACKED_CORPUS_LOOKUP`
// (`./compiledPool`, off by default; the lookup is built there, behind the
// client alias). Off: the compiled pool is preloaded at
// module load, exactly as it always was. On: NOTHING compiled is preloaded —
// that per-request evaluation is the cost PRD #4161 removes — and
// `getDefinition` resolves a compiled id from the packed corpus on first
// lookup, one block at a time. A print whose definition lives only there is
// wired lazily too, so loading this module inflates no block at all.
//
// With the switch on, the catalogue-wide populations fed from the compiled rows
// (`compiledRegistered`, the name map, `definitionSetCode`) stay empty of them:
// giving each of those a disposition is the enumerator slice of PRD #4161.
// The client never takes this branch — its alias exports the switch `false`.
if (packedCorpusLookup === null) {
    registerCompiledDefinitions(compiledReadyDefinitions);
} else {
    // Wired BEFORE the source is installed, so the resolution pass reads the
    // resident map only; what it cannot resolve is a compiled-only definition.
    for (const print of wirePrintAliases(false)) {
        registerLazyPrintAlias(print.printId, print.definitionId);
    }
    setLazyDefinitionSource(packedCorpusLookup.lookup);
}

/** How many packed blocks this module graph has inflated — `0` with the switch
 *  off. The observable the full-path test bounds a request by (issue #4165). */
export const packedCorpusInflations = (): number =>
    packedCorpusLookup?.inflations() ?? 0;

export const getCardByName = (name: string): CardDefinition => {
    const card = nameRegistry.get(name.toLowerCase());
    if (!card) {
        throw new Error(`Card not found by name: ${name}`);
    }
    return card;
};

export const tryGetCardByName = (name: string): CardDefinition | null =>
    nameRegistry.get(name.toLowerCase()) ?? null;

// `getAllCatalogueCards()`, not `allCards`: a retired hand-written card
// (ADR 0114 §2, issue #4027) is still placeable through
// `tryGetPlaceableCardByName` below, and every consumer of this list treats
// it as the allow-list of names that CAN be placed — the LLM scenario
// generator's `scenarioAllowList` (`convex/debugScenarios.ts`), the debug
// `debugListCards` query (`convex/game.ts`), and the debug card-name
// autocomplete field. Narrowing it to hand-written-only would let the
// allow-list and the placement resolver disagree on exactly the cards this
// migration retires.
export const getAllCardNames = (): string[] =>
    getAllCatalogueCards().map((card) => card.name);

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
    const names: string[] = [];
    for (const card of allCards) names.push(...chooseableNamesOf(card));
    // A COMPILED row contributes its FULL `chooseableNamesOf`, own printed
    // name included — `getAllCardNames` widened to `getAllCatalogueCards()`
    // in issue #4027 (a retired hand-written card is compiled-only and must
    // stay choosable), so a compiled row's own name is no longer absent from
    // that seam either. The two seams are widened TOGETHER on purpose: ADR
    // 0113 §2's asymmetric delivery (bundled on the server, fetched on the
    // client) means both sides build this same list from `compiledRegistered`
    // once hydrated, so the submit gate and the button's candidate list still
    // agree.
    for (const card of compiledRegistered) {
        names.push(...chooseableNamesOf(card));
    }
    return names;
};

// Re-use the registry's expandDefinition for the catalogue-level getAllCards,
// so keyword cards are expanded identically. Import the expansion from the
// registry seam — but `expandDefinition` is not exported. Instead, route
// through `getDefinition` to get the expanded version.

/** All registered `CardDefinition`s in load order. Routed through
 *  `getDefinition` (ADR 0054) so the catalogue and the `getDefinition`
 *  seam return the SAME (expanded) object for a keyword card.
 *
 *  SWAP-BLIND once memoized: `vitest.setup.node.ts` calls this in its freeze
 *  loop BEFORE the behavioural swap block runs, so `expandedAllCards` bakes
 *  in the hand-written population for the rest of that worker. Same
 *  disposition as `nameRegistry` above — see `convex/oracle/behavioural.ts`
 *  § "Gap 1 disposition" (issue #3060). */
let expandedAllCards: CardDefinition[] | null = null;
export const getAllCards = (): CardDefinition[] => {
    if (!expandedAllCards)
        expandedAllCards = allCards.map((c) => getDefinition(c.id));
    return expandedAllCards;
};

/** Every card in the CATALOGUE — hand-written and compiled alike — expanded,
 *  and nothing else.
 *
 *  This is the population a catalogue-wide sweep wants, and the reason it is
 *  not `[...registeredDefinitions()]` is the comment on `compiledRegistered`
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
            ...compiledRegistered.map((c) => getDefinition(c.id)),
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
export const getAllRawCards = (): readonly CardDefinition[] => allCards;

/** A single printing of a card: its image-key print id and the set it was
 *  printed in. */
export interface CardPrinting {
    printId: string;
    setCode: string;
}

/** The print ids the hand-written `CardPrint` records alias onto
 *  `definitionId` — the ALIAS's own contents, for the tests that pin its
 *  wiring (`packedCorpusLookup`, `limitedSeatStore`). Not a printing list:
 *  every consumer of printings reads the `cardPrints` table (issue #5106),
 *  and this goes with the alias in issue #4121. */
export const getAliasedPrintIds = (definitionId: string): string[] =>
    allPrints
        .filter((print) => print.definitionId === definitionId)
        .map((print) => print.printId);

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
    for (const print of allPrints) codes.add(print.setCode);
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
 * #4117) when the caller omitted it — `cardId` here is the chosen PRINTING,
 * exactly the same overload `resolveDeckCardMeta` already unwinds to build a
 * Game's Library. So every write through `userDecks`/`presetDecks` ends up
 * with `definitionId` set, whether or not the client (deck builder, Limited
 * Auto-Build, deck import, …) was updated to send one — the field never
 * needs its OWN migration across every caller of those mutations. A `cardId`
 * the registry cannot resolve (a withdrawn/renamed printing) falls back to
 * itself rather than dropping the card.
 */
export function withDefinitionId(card: DeckCardArg): Required<DeckCardArg> {
    if (card.definitionId) return card as Required<DeckCardArg>;
    return {
        ...card,
        definitionId: resolveDeckCardMeta(card.cardId)?.cardId ?? card.cardId,
    };
}
