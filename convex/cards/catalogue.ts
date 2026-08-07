import type { CardDefinition, CardPrint, Rarity } from "./types";
// All set modules — imported once, populated into the runtime registry on
// import (side-effect). This module is the heavyweight split-out from
// `index.ts`; only imported by the Convex backend and by client pages that
// need catalogue-wide functions (deck builder, lobby, draft lab).
import * as lea from "./sets/lea";
import * as leb from "./sets/leb";
import * as arn from "./sets/arn";
import * as atq from "./sets/atq";
import * as leg from "./sets/leg";
import * as drk from "./sets/drk";
import * as fem from "./sets/fem";
import * as ice from "./sets/ice";
import * as jou from "./sets/jou";
import * as unlimited from "./sets/2ed";
import * as revised from "./sets/3ed";
// Vintage Cube card-draw / card-advantage tranche (issue #674)
import * as lrw from "./sets/lrw";
import * as m11 from "./sets/m11";
import * as m12 from "./sets/m12";
import * as dft from "./sets/dft";
import * as dka from "./sets/dka";
import * as ulg from "./sets/ulg";
import * as voc from "./sets/voc";
import * as fifthDawn from "./sets/5dn";
import * as wth from "./sets/wth";
import * as tsp from "./sets/tsp";
import * as csp from "./sets/csp";
import * as ltc from "./sets/ltc";
import * as cn2 from "./sets/cn2";
import * as thb from "./sets/thb";
import * as fut from "./sets/fut";
import * as mh1 from "./sets/mh1";
import * as bro from "./sets/bro";
import * as c18 from "./sets/c18";
import * as sos from "./sets/sos";
import * as avr from "./sets/avr";
import * as pc2 from "./sets/pc2";
import * as dmu from "./sets/dmu";
import * as mkm from "./sets/mkm";
import * as ltr from "./sets/ltr";
import * as mh2 from "./sets/mh2";
import * as blc from "./sets/blc";
import * as tdm from "./sets/tdm";
import * as stx from "./sets/stx";
import * as mh3 from "./sets/mh3";
import * as chk from "./sets/chk";
import * as cmr from "./sets/cmr";
import * as ody from "./sets/ody";
import * as ema from "./sets/ema";
import * as usg from "./sets/usg";
import * as uds from "./sets/uds";
import * as plc from "./sets/plc";
import * as fin from "./sets/fin";
import * as mrd from "./sets/mrd";
import * as som from "./sets/som";
import * as m14 from "./sets/m14";
import * as exo from "./sets/exo";
import * as kld from "./sets/kld";
import * as wwk from "./sets/wwk";
import * as tmp from "./sets/tmp";
import * as mir from "./sets/mir";
import * as ths from "./sets/ths";
import * as isd from "./sets/isd";
import * as c19 from "./sets/c19";
import * as dsk from "./sets/dsk";
import * as sth from "./sets/sth";
import * as big from "./sets/big";
import * as gpt from "./sets/gpt";
import * as dis from "./sets/dis";
import * as rav from "./sets/rav";
import * as mid from "./sets/mid";
import * as apc from "./sets/apc";
import * as neo from "./sets/neo";
import * as bok from "./sets/bok";
import * as roe from "./sets/roe";
import * as lci from "./sets/lci";
import * as soc from "./sets/soc";
import * as por from "./sets/por";
import * as p02 from "./sets/p02";
import * as phpr from "./sets/phpr";
import * as ktk from "./sets/ktk";
import * as akh from "./sets/akh";
import * as aer from "./sets/aer";
import * as rtr from "./sets/rtr";
import * as c15 from "./sets/c15";
import * as afr from "./sets/afr";
import * as hou from "./sets/hou";
import * as ecl from "./sets/ecl";
import * as c17 from "./sets/c17";
import * as pip from "./sets/pip";
import * as emn from "./sets/emn";
import * as nem from "./sets/nem";
import * as fic from "./sets/fic";
import * as lcc from "./sets/lcc";
import * as m3c from "./sets/m3c";
import * as con from "./sets/con";
import * as shm from "./sets/shm";
import * as zen from "./sets/zen";
import * as ons from "./sets/ons";
import * as eld from "./sets/eld";
import * as vis from "./sets/vis";
import * as bbd from "./sets/bbd";
import * as khm from "./sets/khm";
import * as ptk from "./sets/ptk";
import * as mbs from "./sets/mbs";
import * as nph from "./sets/nph";
import * as mmq from "./sets/mmq";
import * as c14 from "./sets/c14";
import * as pls from "./sets/pls";
import * as dtk from "./sets/dtk";
import * as onc from "./sets/onc";
import * as spm from "./sets/spm";
import * as moc from "./sets/moc";
import * as dsc from "./sets/dsc";
import * as znr from "./sets/znr";
import * as woe from "./sets/woe";
import * as eoe from "./sets/eoe";
import * as tla from "./sets/tla";
import * as tmt from "./sets/tmt";
import * as tor from "./sets/tor";
import * as nec from "./sets/nec";
import * as c21 from "./sets/c21";
import * as rna from "./sets/rna";
import * as dom from "./sets/dom";
import * as eve from "./sets/eve";
import * as blb from "./sets/blb";
import * as clu from "./sets/clu";
import * as bng from "./sets/bng";
import * as one from "./sets/one";
import * as war from "./sets/war";
import * as mom from "./sets/mom";
import * as clb from "./sets/clb";
import * as c13 from "./sets/c13";
import * as vow from "./sets/vow";
import * as jud from "./sets/jud";
import * as m20 from "./sets/m20";
import * as ala from "./sets/ala";
import * as otj from "./sets/otj";
import * as hml from "./sets/hml";
import * as scg from "./sets/scg";
import * as fourthEdition from "./sets/4ed";
import * as beatdown from "./sets/btd";
import * as inv from "./sets/inv";
import * as all from "./sets/all";
import * as pcy from "./sets/pcy";
import * as iko from "./sets/iko";
import * as snc from "./sets/snc";
import * as j25 from "./sets/j25";
import * as soi from "./sets/soi";
import * as ncc from "./sets/ncc";
import * as arb from "./sets/arb";
import * as dmc from "./sets/dmc";
import * as dst from "./sets/dst";

import {
    preloadDefinitions,
    registerPrintAlias,
    tryGetDefinition,
    getDefinition,
} from "./registry";

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
    { code: "drk", exports: drk },
    { code: "fem", exports: fem },
    { code: "ice", exports: ice },
    { code: "jou", exports: jou },
    { code: "2ed", exports: unlimited },
    { code: "3ed", exports: revised },
    { code: "lrw", exports: lrw },
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

const definitionRegistry = new Map<string, CardDefinition>(
    allCards.map((card) => [card.id, card])
);

// Populate the runtime registry with all card definitions.
preloadDefinitions(allCards);

// Wire print-id → same-def-object lookups so `getDefinition(printId)` returns
// the SAME object reference as `getDefinition(definitionId)` — sharing the
// `expansionCache` (WeakMap) entry.
for (const print of allPrints) {
    const def = definitionRegistry.get(print.definitionId);
    if (!def) {
        throw new Error(
            `CardPrint ${print.printId} references unknown definitionId ${print.definitionId}`
        );
    }
    registerPrintAlias(print.printId, print.definitionId);
}

const nameRegistry = new Map<string, CardDefinition>(
    allCards.map((card) => [card.name.toLowerCase(), card])
);

export const getCardByName = (name: string): CardDefinition => {
    const card = nameRegistry.get(name.toLowerCase());
    if (!card) {
        throw new Error(`Card not found by name: ${name}`);
    }
    return card;
};

export const tryGetCardByName = (name: string): CardDefinition | null =>
    nameRegistry.get(name.toLowerCase()) ?? null;

export const getAllCardNames = (): string[] =>
    allCards.map((card) => card.name);

// Re-use the registry's expandDefinition for the catalogue-level getAllCards,
// so keyword cards are expanded identically. Import the expansion from the
// registry seam — but `expandDefinition` is not exported. Instead, route
// through `getDefinition` to get the expanded version.

/** All registered `CardDefinition`s in load order. Routed through
 *  `getDefinition` (ADR 0054) so the catalogue and the `getDefinition`
 *  seam return the SAME (expanded) object for a keyword card. */
let expandedAllCards: CardDefinition[] | null = null;
export const getAllCards = (): CardDefinition[] => {
    if (!expandedAllCards)
        expandedAllCards = allCards.map((c) => getDefinition(c.id));
    return expandedAllCards;
};

/** A single printing of a card: its image-key print id and the set it was
 *  printed in. */
export interface CardPrinting {
    printId: string;
    setCode: string;
}

export const getPrintingsForCard = (definitionId: string): CardPrinting[] => {
    const printings: CardPrinting[] = [
        {
            printId: definitionId,
            setCode: definitionSetCode.get(definitionId) ?? "",
        },
    ];
    for (const print of allPrints) {
        if (print.definitionId === definitionId) {
            printings.push({ printId: print.printId, setCode: print.setCode });
        }
    }
    return printings;
};

export const getPrintsForCard = (definitionId: string): string[] =>
    getPrintingsForCard(definitionId).map((p) => p.printId);

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

// printId → its own `CardPrint` (a reprint pins its set/rarity to THAT
// printing, which may differ from the home-set definition). Built once.
const printById = new Map<string, CardPrint>(
    allPrints.map((print) => [print.printId, print])
);

export interface DeckCardMeta {
    cardId: string;
    setCode: string;
    rarity: Rarity;
    isBasic: boolean;
}

export const resolveDeckCardMeta = (cardId: string): DeckCardMeta | null => {
    const def = tryGetDefinition(cardId);
    if (!def) return null;
    const isBasic = def.supertypes?.includes("Basic") ?? false;
    const print = printById.get(cardId);
    if (print) {
        return {
            cardId: def.id,
            setCode: print.setCode,
            rarity: print.rarity,
            isBasic,
        };
    }
    return {
        cardId: def.id,
        setCode: definitionSetCode.get(def.id) ?? "",
        rarity: def.rarity,
        isBasic,
    };
};
