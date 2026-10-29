// The SERVER's Set modules (issue #5615, PRD #5602): every hand-written Set
// imported statically, once, at load. This module is the one importer of a
// Set module in the engine (`scripts/__tests__/vite-card-sets-dev-bundle.test.ts`).
//
// WHY A MODULE OF ITS OWN. `catalogue.ts` used to hold these imports. A
// client graph must not: a game downloads only the Sets of its Definition
// Manifest, so `vite.config.ts` aliases the specifier `./setModules` — written
// by `catalogue.ts` and by nothing else — to the browser seam
// (`src/lib/catalogue/set-modules.browser.ts`), which installs a Set as one
// lazily imported chunk on demand. The same technique as `./compiledPool`;
// pinned by `scripts/__tests__/set-modules-client-seam.test.ts`.
//
// The Convex bundler does not know the `@convex` alias, so the specifier is
// relative — and the alias is sound only while this file's importer spells it
// exactly `./setModules`.
//
// Importing a Set evaluates its `defineCard` factories, which build nothing
// (issue #4857): the catalogue touches no definition at load
// (`__tests__/catalogueLoadTouchesNoDefinition.test.ts`).
import type { SetModuleExports, SetModuleSource } from "./setModuleSource";
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
import * as fra from "./sets/fra/index.cards";
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
import * as hob from "./sets/hob/index.cards";
import * as msh from "./sets/msh/index.cards";
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

/** Set modules paired with their lowercase Set code, in catalogue order. The
 *  dev server's Set bundle reads this list off the import lines above
 *  (`scripts/lib/vite-card-sets-dev-bundle.ts`). */
const setModules: { code: string; exports: SetModuleExports }[] = [
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
    { code: "fra", exports: fra },
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
    { code: "hob", exports: hob },
    { code: "msh", exports: msh },
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

const byCode = new Map(setModules.map((m) => [m.code, m.exports]));

/** Every Set resident from load; `install` resolves at once. */
export const setModuleSource: SetModuleSource = {
    codes: setModules.map((m) => m.code),
    resident: (code) => byCode.get(code),
    install: (code) => {
        const exports = byCode.get(code);
        return exports === undefined
            ? Promise.reject(new Error(`Unknown Set module: ${code}`))
            : Promise.resolve(exports);
    },
};
