import type {
    ActivatedAbility,
    AiCombatHint,
    CardDefinition,
    CardPrint,
    CardSupertype,
    CardType,
    Color,
    ManaCost,
    Rarity,
    StaticEffect,
} from "./types";
import { cantBeEnchantedSelfGuard } from "./types";
// CR 114 (issue #1221) — side-effect import so the emblem registry
// (`convex/cards/emblems.ts`) is populated whenever the card catalogue loads.
import "./emblems";
import { expandFadingVanishing } from "./abilities/fadingVanishing";
import { expandKeywordTriggers } from "./abilities/keywordTriggers";
import { setCardManaCostLookup } from "./manaCostLookup";
import { setCardSupertypeLookup } from "./supertypeLookup";
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
// Vintage Cube card-draw / card-advantage tranche (issue #674) — cross-set
// home sets routed to earliest paper printing (ADR 0041).
import * as lrw from "./sets/lrw";
import * as m11 from "./sets/m11";
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
// Issue #674 remaining tranche — additional cross-set home sets.
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
// Effect Script tracer bullet (ADR 0045, issue #800) — first DSL-only card
// (Lava Spike), home set routed to earliest paper printing (ADR 0041).
import * as chk from "./sets/chk";
import * as cmr from "./sets/cmr";
// Effect Script forEach construct (ADR 0045, issue #807) — Innocent Blood,
// the first choice-inside-forEach DSL card.
import * as ody from "./sets/ody";
// Vintage Cube mana ramp / rocks / dorks / fixing tranche (issue #675,
// ADR 0041) — new cross-set home sets routed to earliest paper printing.
import * as ema from "./sets/ema";
import * as usg from "./sets/usg";
// Powder Keg homed in its real Urza's Destiny printing (issue #1027).
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
// Stub-only home sets for this tranche's stop-and-issue cards (issue #675) —
// no active CardDefinition yet, wired anyway per ADR 0043 (every set
// directory is registered, even one whose only content is tracked stubs).
import * as sth from "./sets/sth";
import * as big from "./sets/big";
import * as gpt from "./sets/gpt";
import * as dis from "./sets/dis";
import * as rav from "./sets/rav";
// Vintage Cube FREE targeted-removal tranche (issue #676) — additional
// cross-set home sets routed to earliest paper printing (ADR 0041).
import * as mid from "./sets/mid";
import * as apc from "./sets/apc";
import * as neo from "./sets/neo";
import * as bok from "./sets/bok";
import * as roe from "./sets/roe";
import * as lci from "./sets/lci";
import * as soc from "./sets/soc";
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
// Cube FREE: tutors / library search (issue #677) — new cross-set home sets
// for the fetchland / tutor tranche, routed to earliest paper printing
// (ADR 0041). wwk/mir/ecl/exo already imported above (shared with #675/#676).
import * as zen from "./sets/zen";
import * as ons from "./sets/ons";
import * as eld from "./sets/eld";
import * as vis from "./sets/vis";
import * as bbd from "./sets/bbd";
import * as khm from "./sets/khm";
import * as ptk from "./sets/ptk";
import * as mbs from "./sets/mbs";
// Cube CAP: Phyrexian mana (issue #696) — New Phyrexia home set.
import * as nph from "./sets/nph";
// Cube FREE: graveyard recursion (issue #680) — new cross-set home sets,
// routed to earliest paper printing (ADR 0041). Most are sparse — a single
// tracked stub each, blocked on a capability this issue doesn't add
// (mmq/c14 carry the tranche's two active new-home-set cards).
import * as mmq from "./sets/mmq";
import * as c14 from "./sets/c14";
// Planeshift home set — Flametongue Kavu routed to its original paper
// printing (ADR 0041) rather than the c14 reprint.
import * as pls from "./sets/pls";
import * as dtk from "./sets/dtk";
import * as onc from "./sets/onc";
import * as spm from "./sets/spm";
import * as moc from "./sets/moc";
import * as dsc from "./sets/dsc";
// Cube FREE: +1/+1 counters matter (issue #681) — new cross-set home sets
// routed to earliest paper printing (ADR 0041). 10 of the 14 cards in this
// tranche are stop-and-issue stubs (tolaria#917); every home set is wired
// per ADR 0043 even where its only content is a tracked stub. `moc` is
// shared with the #680 tranche above — imported once.
import * as znr from "./sets/znr";
import * as woe from "./sets/woe";
import * as eoe from "./sets/eoe";
import * as tla from "./sets/tla";
import * as tmt from "./sets/tmt";
import * as tor from "./sets/tor";
import * as nec from "./sets/nec";
import * as c21 from "./sets/c21";
// Cube FREE: ETB / dies / attack triggers (issue #679). tla/znr shared with
// the #681 tranche above — imported once.
import * as eve from "./sets/eve";
import * as blb from "./sets/blb";
import * as clu from "./sets/clu";
import * as bng from "./sets/bng";
import * as one from "./sets/one";
import * as war from "./sets/war";
// Cube FREE: mass removal / sweepers (issue #685) — 4 new cross-set home
// sets routed to earliest paper printing (ADR 0041), each holding only a
// tracked stop-and-issue stub (#924/#925/#926/#778); every home set is
// wired per ADR 0043 regardless. `plc`/`sos`/`fin` are shared with earlier
// tranches above — imported once (`fin` also carries a #927 stub).
import * as mom from "./sets/mom";
import * as clb from "./sets/clb";
import * as c13 from "./sets/c13";
import * as vow from "./sets/vow";
// Cube FREE: evasion / protection statics (issue #684) — new cross-set home
// sets routed to earliest paper printing (ADR 0041).
import * as jud from "./sets/jud";
import * as m20 from "./sets/m20";
// Cube FREE: edict / discard / hand disruption (issue #682) — new cross-set
// home sets routed to earliest paper printing (ADR 0041). Every home set is
// wired per ADR 0043 even where its only content is a tracked stub (ala:
// Tidehollow Sculler, otj: Caustic Bronco — see issue #931).
import * as ala from "./sets/ala";
import * as otj from "./sets/otj";
// Cube FREE: counterspells (issue #683) — new cross-set home set for Memory
// Lapse (its earliest paper printing, Homelands, per ADR 0041). mkm/sos/rav/
// c15/mh2 already imported above (shared with earlier tranches).
import * as hml from "./sets/hml";
import * as scg from "./sets/scg";
// Premodern-legal reprint box sets (issue #980) — reprint-only modules that
// carry a CardPrint into a Premodern-legal set so earlier definitions become
// deck-legal in Premodern.
import * as fourthEdition from "./sets/4ed";
import * as beatdown from "./sets/btd";
// Premodern utility-land hoser (issue #998) — Tsabo's Web's home set is its
// earliest paper printing, Invasion (ADR 0041).
import * as inv from "./sets/inv";
// Cube CAP: Free pitch — alternative-cost (CR 118.9) pitch spells (issue #690 /
// #1003). New cross-set home sets routed to earliest paper printing (ADR 0041):
// Alliances (Force of Will, Pyrokinesis), Prophecy (Foil).
import * as all from "./sets/all";
import * as pcy from "./sets/pcy";
// Cycling CAP (CR 702.29, issue #689): IKO + SNC Triomes (colorless taplands).
import * as iko from "./sets/iko";
import * as snc from "./sets/snc";
import * as j25 from "./sets/j25";
import * as soi from "./sets/soi";
// Per-source exile linkage + discard trigger (issue #791) — Currency Converter's
// earliest paper printing is New Capenna Commander (ncc, ADR 0041).
import * as ncc from "./sets/ncc";

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

// Set modules paired with their lowercase set code. The code is the home set
// of every `CardDefinition` declared in that module (e.g. Beta-original cards
// live in `leb` with home set "leb"); `CardPrint` entries carry their own
// `setCode` and may point at a definition from another module.
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
    // Vintage Cube card-draw tranche (issue #674).
    { code: "lrw", exports: lrw },
    { code: "m11", exports: m11 },
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
    // Issue #674 remaining tranche.
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
    // Effect Script tracer bullet (ADR 0045, issue #800).
    { code: "chk", exports: chk },
    // Effect Script forEach construct (ADR 0045, issue #807).
    { code: "ody", exports: ody },
    // Vintage Cube mana ramp / rocks / dorks / fixing tranche (issue #675).
    { code: "ema", exports: ema },
    { code: "usg", exports: usg },
    // Powder Keg's real home set (Urza's Destiny), Premodern-legal (issue #1027).
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
    // Sevinne's Reclamation's home set (Flashback CAP, issue #693).
    { code: "c19", exports: c19 },
    { code: "dsk", exports: dsk },
    { code: "sth", exports: sth },
    { code: "big", exports: big },
    { code: "gpt", exports: gpt },
    { code: "dis", exports: dis },
    { code: "rav", exports: rav },
    // Vintage Cube FREE targeted-removal tranche (issue #676).
    { code: "mid", exports: mid },
    { code: "apc", exports: apc },
    { code: "neo", exports: neo },
    { code: "bok", exports: bok },
    { code: "roe", exports: roe },
    { code: "lci", exports: lci },
    // Vintage Cube residue tranche (issue #1302, parent PRD #620) — new home
    // set, currently stub-only (Staff of the Storyteller, tracked-by #1345).
    { code: "soc", exports: soc },
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
    // Cube FREE: tutors / library search (issue #677). wwk/mir/ecl/exo already
    // registered above (shared with the #675/#676 tranches).
    { code: "zen", exports: zen },
    { code: "ons", exports: ons },
    { code: "eld", exports: eld },
    { code: "vis", exports: vis },
    { code: "bbd", exports: bbd },
    { code: "khm", exports: khm },
    { code: "ptk", exports: ptk },
    { code: "mbs", exports: mbs },
    { code: "nph", exports: nph },
    // Cube FREE: token makers (issue #678).
    { code: "c18", exports: c18 },
    // Cube FREE: graveyard recursion (issue #680) — new cross-set home sets.
    { code: "mmq", exports: mmq },
    { code: "c14", exports: c14 },
    { code: "pls", exports: pls },
    { code: "dtk", exports: dtk },
    { code: "onc", exports: onc },
    { code: "spm", exports: spm },
    { code: "moc", exports: moc },
    { code: "dsc", exports: dsc },
    // Cube FREE: +1/+1 counters matter (issue #681). `moc` shared with #680
    // above — registered once.
    { code: "znr", exports: znr },
    { code: "woe", exports: woe },
    { code: "eoe", exports: eoe },
    { code: "tla", exports: tla },
    { code: "tmt", exports: tmt },
    { code: "tor", exports: tor },
    { code: "nec", exports: nec },
    { code: "c21", exports: c21 },
    // Cube FREE: ETB / dies / attack triggers (issue #679). tla/znr shared
    // with the #681 tranche above — registered once.
    { code: "eve", exports: eve },
    { code: "blb", exports: blb },
    { code: "clu", exports: clu },
    { code: "bng", exports: bng },
    { code: "one", exports: one },
    { code: "war", exports: war },
    // Cube FREE: mass removal / sweepers (issue #685). plc/sos/fin shared
    // with earlier tranches above — registered once (fin's #927 stub rides
    // along with it).
    { code: "mom", exports: mom },
    { code: "clb", exports: clb },
    { code: "c13", exports: c13 },
    { code: "vow", exports: vow },
    // Cube FREE: evasion / protection statics (issue #684).
    { code: "jud", exports: jud },
    { code: "m20", exports: m20 },
    // Cube FREE: edict / discard / hand disruption (issue #682).
    { code: "ala", exports: ala },
    { code: "otj", exports: otj },
    // Cube FREE: counterspells (issue #683) — new home set for Memory Lapse.
    { code: "hml", exports: hml },
    // Stifle — "counter target activated or triggered ability" (issue #679
    // Tishana's Tidebinder gap: the `spellStackKind: "ability"` stack-object
    // kind + countering a triggered ability on the stack).
    { code: "scg", exports: scg },
    // Premodern-legal reprint box sets (issue #980).
    { code: "4ed", exports: fourthEdition },
    { code: "btd", exports: beatdown },
    // Premodern utility-land hoser — Tsabo's Web (issue #998).
    { code: "inv", exports: inv },
    { code: "all", exports: all },
    { code: "pcy", exports: pcy },
    // Cycling CAP (CR 702.29, issue #689): IKO + SNC Triomes.
    { code: "iko", exports: iko },
    { code: "snc", exports: snc },
    // Landfall CAP (issue #694): home sets for tracked stubs blocked on other
    // capabilities — Scythecat Cub (#1189), Tireless Tracker (#1191). No active
    // cards yet; scaffolded so the stubs live under their earliest-print set.
    { code: "j25", exports: j25 },
    { code: "soi", exports: soi },
    // Draw-replacement launch cards (issue #1265, PRD #779, ADR 0061) — home
    // sets are each card's earliest paper printing (ADR 0041): Hullbreacher
    // (Commander Legends). Leovold, Emissary of Trest is in the cn2 set
    // (Conspiracy: Take the Crown), already registered above.
    { code: "cmr", exports: cmr },
    // Per-source exile linkage + discard trigger (issue #791) — Currency
    // Converter (New Capenna Commander).
    { code: "ncc", exports: ncc },
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

/** Combined lookup: every `CardDefinition.id` plus every `CardPrint.printId`
 *  resolves to the same underlying definition. Built once at module load. */
const registry = new Map<string, CardDefinition>(definitionRegistry);

for (const print of allPrints) {
    const def = definitionRegistry.get(print.definitionId);
    if (!def) {
        throw new Error(
            `CardPrint ${print.printId} references unknown definitionId ${print.definitionId}`
        );
    }
    if (registry.has(print.printId)) {
        throw new Error(`Duplicate card id: ${print.printId}`);
    }
    registry.set(print.printId, def);
}

// ADR 0046 — Single registry seam. `getDefinition`/`tryGetDefinition` are the
// ONLY definition-resolution path for the engine, game mutations, projections,
// and the frontend (via `src/lib/card-utils.ts`'s public boundary). No
// consumer imports `convex/cards/sets/*` directly — enforced by the
// `no-restricted-imports` rule in `eslint.config.js` (CI-checked via
// `bun run lint`). Today this wraps the in-code `registry` Map below, built
// once from the statically-imported set modules; later it can become a
// cache + DB read (ADR 0046) without any consumer noticing, because the
// return type never changes shape.
//
// Hydration-at-entry: the `registry` Map is populated once, synchronously, at
// module evaluation time — i.e. once per cold Convex isolate, before any
// mutation runs. Every mutation entry point therefore sees an already-hydrated,
// in-memory map and reads it synchronously. This is why the GRE never goes
// async because of the registry: `getDefinition`/`tryGetDefinition` return a
// `CardDefinition` directly, never a `Promise`, and every one of their ~300
// call sites across `convex/gre/**` relies on that synchronous contract. If a
// future DB-backed registry needs an async fetch, it must still resolve into
// this same in-memory map BEFORE the GRE runs (at the mutation entry point,
// per ADR 0046) — the seam's signature must stay synchronous.
// ADR 0054 — implicit keyword expansion. `fading N` / `vanishing N` cards
// declare only the keyword string; the seam injects the enter-with-counters
// entry and the synthesized upkeep/sacrifice triggers. Memoized by definition
// identity (a base def is expanded at most once) so the ~300 `getDefinition`
// call sites pay the parse cost only on the first read of each card. The memo
// keys on the raw registry/token object, so tokens (`maybeSynthesizeToken`,
// `createTokenCopyOf`) expand through the same seam as printed cards.
const expansionCache = new WeakMap<CardDefinition, CardDefinition>();
const expandDefinition = (base: CardDefinition): CardDefinition => {
    const cached = expansionCache.get(base);
    if (cached) return cached;
    // ADR 0054 — chained keyword expansions. Each is a no-op unless its keyword
    // string is present, so order is irrelevant. Exalted/Prowess (issue #699)
    // inject triggered abilities from a bare `staticAbilities` string.
    const expanded = expandKeywordTriggers(expandFadingVanishing(base));
    expansionCache.set(base, expanded);
    return expanded;
};

export const getDefinition = (cardId: string): CardDefinition => {
    const card = registry.get(cardId) ?? maybeSynthesizeToken(cardId);
    if (!card) {
        throw new Error(`Card not found: ${cardId}`);
    }
    return expandDefinition(card);
};

/** Non-throwing variant. Returns null when the id isn't in the registry — used
 *  by subsystems that operate best-effort (layer system, test fixtures). */
export const tryGetDefinition = (cardId: string): CardDefinition | null => {
    const card = registry.get(cardId) ?? maybeSynthesizeToken(cardId);
    return card ? expandDefinition(card) : null;
};

// Break the set-module ↔ registry import cycle: inject a manaCost lookup into
// the (cycle-free) colors module so set runtime code can derive an opponent
// permanent's colours from its slim `{ id }` reference (Jihad — CR 202.2).
setCardManaCostLookup((cardId) => tryGetDefinition(cardId)?.manaCost);
// CR 205.4a — inject the printed-supertype lookup so snow-matters predicates
// resolve live snow status off a slim `{ id }` reference (cycle-free).
setCardSupertypeLookup((cardId) => tryGetDefinition(cardId)?.supertypes);

/** Registers a synthetic `CardDefinition` for a token (CR 111, 707.1).
 *  Tokens have no Scryfall print — their definition is derived from the
 *  effect that creates them. Idempotent: calling twice with the same id
 *  is a no-op so multiple `createToken` invocations share one entry. */
export const registerTokenDefinition = (def: CardDefinition): void => {
    if (registry.has(def.id)) return;
    registry.set(def.id, def);
};

/** Sentinel definition id for a face-down permanent (CR 708.2): a 2/2
 *  colourless nameless vanilla creature with no abilities. A face-down
 *  instance's `card.id` is swapped to this id (the real id is retained in
 *  `CardInstanceState.faceDownOf` for the turn-up), so every def-derived
 *  characteristic reader — colours, abilities, static effects — sees the
 *  vanilla 2/2 automatically. Registered in the lookup map only, NOT a set
 *  export, so it never enters the card pool or the catalogue guard tests. */
export const FACE_DOWN_CARD_ID = "face-down:2-2-vanilla";
registry.set(FACE_DOWN_CARD_ID, {
    id: FACE_DOWN_CARD_ID,
    name: "Face-down creature",
    // Rarity is a property of a printing (CR 206); a face-down permanent is
    // not a printed object, so its sentinel def carries a nominal "common".
    rarity: "common",
    manaCost: {},
    types: ["Creature"],
    power: 2,
    toughness: 2,
    // CR 708.9 / ADR 0013 — turn-up replacements. These ride the sentinel def
    // so EVERY face-down permanent inherits them automatically (the engine
    // collects replacement effects from a permanent's presented card def, which
    // for a face-down permanent is this sentinel). The moment a face-down
    // creature would deal damage, be dealt damage, or become tapped, it is
    // turned face up first and the original event proceeds against its real
    // self. Turn-up clears the face-down marker, so each effect fires at most
    // once (on the next event the permanent presents its real def, not this
    // one). Implemented in #124.
    replacementEffects: [
        {
            // Would DEAL damage → turn up, then deal damage with real power.
            id: "face-down-turnup-deal-damage",
            oracleText:
                "If this creature would deal damage, turn it face up, then it deals that damage.",
            eventKind: "damage",
            appliesTo: (event, self) =>
                event.kind === "damage" && event.sourceInstanceId === self.id,
            replace: (event, ctx) => {
                const { power } = ctx.turnSelfFaceUp();
                if (event.kind !== "damage") return { kind: "modified", event };
                return {
                    kind: "modified",
                    event: { ...event, amount: power },
                };
            },
        },
        {
            // Would BE DEALT damage → turn up, then damage applies vs real
            // toughness (lethal is checked against effective toughness later).
            id: "face-down-turnup-be-dealt-damage",
            oracleText:
                "If this creature would be dealt damage, turn it face up, then the damage is dealt.",
            eventKind: "damage",
            appliesTo: (event, self) =>
                event.kind === "damage" &&
                event.target.type === "permanent" &&
                event.target.id === self.id,
            replace: (event, ctx) => {
                ctx.turnSelfFaceUp();
                return { kind: "modified", event };
            },
        },
        {
            // Would become TAPPED → turn up, then it becomes tapped.
            id: "face-down-turnup-tap",
            oracleText:
                "If this creature would become tapped, turn it face up, then it becomes tapped.",
            eventKind: "tap",
            appliesTo: (event, self) =>
                event.kind === "tap" && event.cardInstanceId === self.id,
            replace: (event, ctx) => {
                ctx.turnSelfFaceUp();
                return { kind: "modified", event };
            },
        },
    ],
});

/** Lazy synthesis of a token CardDefinition from a content-derived id
 *  (e.g. `token:Wasp|Artifact,Creature|Insect||1|1||flying`). Server-side
 *  registrations from `createToken` cover the canonical case, but the
 *  client bundle has a separate registry — when a projected token instance
 *  references an id we don't know, parse the parts back into a definition
 *  on demand and memoize it. Returns null for non-token ids. */
function maybeSynthesizeToken(cardId: string): CardDefinition | null {
    if (!cardId.startsWith("token:")) return null;
    const body = cardId.slice("token:".length);
    const parts = body.split("|");
    if (parts.length < 8) return null;
    const [
        name,
        typesRaw,
        subtypesRaw,
        supertypesRaw,
        powerRaw,
        toughnessRaw,
        colorsRaw,
        staticAbilitiesRaw,
        imagePrintIdRaw,
        // CR 611 — static-effect kinds present on the token (see
        // `tokenDefinitionId`). Trailing 10th segment; empty / absent for
        // tokens without continuous effects (back-compat with the pre-Tetravus
        // 9-segment ids, which have no trailing effects segment).
        staticEffectsRaw,
        // CR 707.2 (issue #1191) — the token's activated abilities
        // (Investigate's Clue), URI-escaped JSON (see `tokenDefinitionId`).
        // Trailing 11th segment; empty / absent for tokens without activated
        // abilities (back-compat with pre-#1191 10-segment ids).
        activatedAbilitiesRaw,
    ] = parts;
    const types = typesRaw.split(",").filter(Boolean) as CardType[];
    const subtypes = subtypesRaw.split(",").filter(Boolean);
    const supertypes = supertypesRaw.split(",").filter(Boolean) as
        | CardSupertype[]
        | [];
    const power = powerRaw === "" ? undefined : Number(powerRaw);
    const toughness = toughnessRaw === "" ? undefined : Number(toughnessRaw);
    const colors = colorsRaw.split("").filter(Boolean) as Color[];
    const staticAbilities = staticAbilitiesRaw.split(",").filter(Boolean);
    const imagePrintId =
        imagePrintIdRaw && imagePrintIdRaw.length > 0
            ? imagePrintIdRaw
            : undefined;
    // Rebuild any continuous static effects encoded in the id. Each closure
    // predicate is reconstructed from a named factory (the closure can't ride
    // the serialized id) — currently only Tetravite's "can't be enchanted"
    // self-guard. Deterministic so server registration and post-round-trip
    // rehydration produce an identical def (CR 611).
    const staticEffectKinds = (staticEffectsRaw ?? "")
        .split(",")
        .filter(Boolean);
    const staticEffects: StaticEffect[] = staticEffectKinds.includes(
        "permanent-guard"
    )
        ? [cantBeEnchantedSelfGuard()]
        : [];
    // Rebuild activated abilities encoded in the id (issue #1191). These are
    // plain data (a token's `EffectTokenSpec.activatedAbilities` are DSL-only
    // — no closures), so unlike `staticEffects` above they round-trip through
    // JSON directly with no named-factory reconstruction step.
    const activatedAbilities: ActivatedAbility[] | undefined =
        activatedAbilitiesRaw && activatedAbilitiesRaw.length > 0
            ? (JSON.parse(
                  decodeURIComponent(activatedAbilitiesRaw)
              ) as ActivatedAbility[])
            : undefined;
    const manaCost: ManaCost = {};
    for (const c of colors) manaCost[c] = (manaCost[c] ?? 0) + 1;
    const def: CardDefinition = {
        id: cardId,
        name,
        // Tokens are not printed objects, so they have no real rarity (CR 206);
        // a nominal "common" satisfies the required field.
        rarity: "common",
        manaCost,
        types,
        ...(subtypes.length > 0 ? { subtypes } : {}),
        ...(supertypes.length > 0 ? { supertypes } : {}),
        power,
        toughness,
        ...(staticAbilities.length > 0 ? { staticAbilities } : {}),
        ...(imagePrintId ? { imagePrintId } : {}),
        ...(staticEffects.length > 0 ? { staticEffects } : {}),
        ...(activatedAbilities && activatedAbilities.length > 0
            ? { activatedAbilities }
            : {}),
    };
    registry.set(cardId, def);
    return def;
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

/** Non-throwing variant of `getCardByName`. Returns null when no card with that
 *  name (case-insensitive) is registered — used by the decklist importer to
 *  collect unresolved names instead of aborting on the first miss. */
export const tryGetCardByName = (name: string): CardDefinition | null =>
    nameRegistry.get(name.toLowerCase()) ?? null;

export const getAllCardNames = (): string[] =>
    allCards.map((card) => card.name);

/** Reads the mana cost off a `CardInstanceState`-shaped object. Production
 *  stores only `{id}` in `instance.card` and relies on the registry; legacy
 *  test fixtures inline the cost on the same field. Tries embedded first so
 *  fixtures keep working, then falls back to the registry lookup. */
export function getInstanceManaCost(instance: {
    card: Record<string, unknown>;
}): ManaCost | undefined {
    const embedded = (instance.card as { manaCost?: ManaCost }).manaCost;
    if (embedded) return embedded;
    const id = (instance.card as { id?: string }).id;
    return id ? (tryGetDefinition(id)?.manaCost ?? undefined) : undefined;
}

/** Reads the AI valuation override off a `CardInstanceState`-shaped object
 *  (ADR 0018). Production stores only `{id}` in `instance.card` and relies on
 *  the registry's `aiValue`; legacy test fixtures may inline it on the same
 *  field. Tries embedded first so fixtures keep working, then falls back to the
 *  registry. Returns undefined when the card has no override. */
export function getInstanceAiValue(instance: {
    card: Record<string, unknown>;
}): number | undefined {
    const embedded = (instance.card as { aiValue?: number }).aiValue;
    if (embedded !== undefined) return embedded;
    const id = (instance.card as { id?: string }).id;
    return id ? (tryGetDefinition(id)?.aiValue ?? undefined) : undefined;
}

/** Reads the AI combat hint off a `CardInstanceState`-shaped object (ADR 0021,
 *  issue #229). Production stores only `{id}` in `instance.card` and relies on
 *  the registry; test fixtures may inline it on the same field. Tries embedded
 *  first so fixtures keep working, then falls back to the registry. Returns
 *  undefined when the card declares no combat hint. */
export function getInstanceAiCombatHint(instance: {
    card: Record<string, unknown>;
}): AiCombatHint | undefined {
    const embedded = (instance.card as { aiCombatHint?: AiCombatHint })
        .aiCombatHint;
    if (embedded !== undefined) return embedded;
    const id = (instance.card as { id?: string }).id;
    return id ? (tryGetDefinition(id)?.aiCombatHint ?? undefined) : undefined;
}

/** All registered `CardDefinition`s in load order. Reprints are not included
 *  — each `CardPrint` resolves to the same definition, so callers iterating
 *  cards-as-data (deck builder index, card catalog) should consume this and
 *  use `getPrintsForCard` to enumerate printings.
 *
 *  Routed through `expandDefinition` (ADR 0054) so the catalogue and the
 *  `getDefinition` seam return the SAME (expanded) object for a keyword card
 *  like Blastoderm — the registry-seam identity invariant
 *  (`registrySeam.test.ts`) depends on it. Memoized: the WeakMap makes each
 *  element stable, and this pins the array wrapper too. */
let expandedAllCards: CardDefinition[] | null = null;
export const getAllCards = (): CardDefinition[] => {
    if (!expandedAllCards) expandedAllCards = allCards.map(expandDefinition);
    return expandedAllCards;
};

/** A single printing of a card: its image-key print id and the set it was
 *  printed in. */
export interface CardPrinting {
    printId: string;
    setCode: string;
}

/** All known printings of a card (the original definition plus every reprint),
 *  ordered with the original print first. Used by the deck builder UI to let the
 *  player pick which edition to include — `[0]` is the default (the original
 *  `CardDefinition`). */
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

/** All known print ids of a card, original first. Thin wrapper over
 *  `getPrintingsForCard` for callers that only need the ids. */
export const getPrintsForCard = (definitionId: string): string[] =>
    getPrintingsForCard(definitionId).map((p) => p.printId);

/** True if the card with this definition id was originally printed in
 *  `setCode` — i.e. its home set (the module it is declared in) matches.
 *  Reprints in other sets do not change the home set, so this answers
 *  "originally printed in [set]" (Golgothian Sylex — "each nontoken permanent
 *  originally printed in Antiquities is sacrificed"). Accepts either a
 *  definition id or a reprint print id (resolved to its definition first).
 *  Unknown ids return false. */
export const isPrintedInSet = (cardId: string, setCode: string): boolean => {
    const def = tryGetDefinition(cardId);
    if (!def) return false;
    return definitionSetCode.get(def.id) === setCode;
};

/** Every set code in the catalogue (home sets + reprint sets), sorted. Drives
 *  the deck builder's set filter. */
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

/** The deck-construction metadata a Format validator (`convex/formats.ts`,
 *  ADR 0036) keys on for a single deck-card id: the SET it was printed in, its
 *  printed RARITY, and whether it is a Basic land. A deck card id is either a
 *  reprint `printId` (its set/rarity come from that `CardPrint`) or the original
 *  `definitionId` (its set is the home set, its rarity the definition's). Both
 *  resolve to the same definition for the Basic check. `null` for an id absent
 *  from the registry (e.g. a removed card) so the validator can flag it. */
export interface DeckCardMeta {
    /** The CANONICAL definition id (`CardDefinition.id`) this deck-card id maps
     *  to. Every reprint `printId` of a card resolves to the SAME `cardId`, so a
     *  Format validator can count copies / apply restricted/banned budgets "by
     *  Card ID across printings" (ADR 0036) by grouping on this value, not the
     *  raw deck-card id. */
    cardId: string;
    setCode: string;
    rarity: Rarity;
    isBasic: boolean;
}

export const resolveDeckCardMeta = (cardId: string): DeckCardMeta | null => {
    const def = tryGetDefinition(cardId);
    if (!def) return null;
    const isBasic = def.supertypes?.includes("Basic") ?? false;
    // A reprint id pins to its own printing; otherwise it is the original
    // definition, whose set is the home set and whose rarity is the definition's.
    // `def.id` is the canonical key shared by every printing of the card, so the
    // Format validators can count "by Card ID across printings" (ADR 0036).
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
