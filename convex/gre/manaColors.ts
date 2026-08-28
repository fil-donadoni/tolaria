// Leaf-level mana colour constants (CR 105.1 / 305.6), split out of
// `gre/constants.ts` to break an import cycle: `gre/constants.ts` needs
// `gre/layers.ts` (issue #927 — `getEffectivePower`/`getEffectiveToughness`
// for board-conditional mana abilities), and `gre/layers.ts` already needs
// `cards/colors.ts` (`getColorsFromCost`, CR 613.1d layer 5), which in turn
// read these two constants off `gre/constants.ts` — a cycle that breaks
// module init (`MANA_COLORS` reads as `undefined` inside `colors.ts` at
// import time). Moving the constants to this dependency-free leaf severs the
// cycle; `gre/constants.ts` re-exports both so every existing
// `from "../gre/constants"` import site is unaffected.
import type { Color, ManaSubstitutionBreadth } from "../cards/types";

/** All six mana colors in canonical order. */
export const MANA_COLORS = ["W", "U", "B", "R", "G", "C"] as const;

// ─── "Spend mana as though it were mana of any …" (CR 609.4b) ────────────────
//
// CR 609.4b — "If an effect allows a player to spend mana 'as though it were
// mana of any [type or color],' this affects only how the player may pay a
// cost. It doesn't change that cost, and it doesn't change what mana was
// actually spent to pay that cost." So the permission is expressed as ordinary
// `{from,to}` substitution PAIRS over the existing six-wide mana vocabulary —
// never as a payment-layer wildcard, and never as a cost rewrite. Every
// affordability / payment / auto-tap path already honours those pairs.

/** The mana types that may be a substitution TARGET under `breadth`: all six
 *  under "any-type" (CR 106.1b — six types, colorless included), the five
 *  colours under "any-color" (CR 105.1). */
function substitutionTargets(
    breadth: ManaSubstitutionBreadth
): readonly Color[] {
    return breadth === "any-type"
        ? MANA_COLORS
        : MANA_COLORS.filter((c) => c !== "C");
}

/** Every `{from,to}` pair a "you may spend mana as though it were mana of any
 *  <breadth>" permission authorises (CR 609.4b). `from` is any of the six mana
 *  types a pool can hold — the permission speaks of the mana being SPENT, and
 *  colorless mana spent as though it were red is exactly what it allows; `to`
 *  is what that mana may be spent AS, and is where the two breadths diverge
 *  (`substitutionTargets`).
 *
 *  Identity pairs are omitted: paying a requirement with its own colour needs
 *  no permission, so `{from: "R", to: "R"}` would be inert noise in every
 *  consumer.
 *
 *  This is the ONLY enumeration of these pairs — a consumer wanting the
 *  permission asks for its breadth, never for a hand-built pair list. */
export function substitutionsForBreadth(
    breadth: ManaSubstitutionBreadth
): { from: Color; to: Color }[] {
    const out: { from: Color; to: Color }[] = [];
    for (const from of MANA_COLORS) {
        for (const to of substitutionTargets(breadth)) {
            if (from === to) continue;
            out.push({ from, to });
        }
    }
    return out;
}

/** Intrinsic mana abilities for basic land subtypes (CR 305.6). */
export const LAND_SUBTYPE_MANA: Record<string, Color> = {
    Plains: "W",
    Island: "U",
    Swamp: "B",
    Mountain: "R",
    Forest: "G",
};

// ─── Guild-hybrid pips in a NORMALIZED cost (CR 202.1a / 107.4e, issue #1738) ─
//
// `ManaCost.hybrid` declares guild-hybrid pips as colour PAIRS (issue #1338).
// `normalizeManaCost` folds each pip into the normalized cost under a composite
// key — `"R/W"`, both colours in `MANA_COLORS` order — so the payment layer sees
// the pip instead of dropping it. Every consumer that reads `cost[color]` /
// `cost.X` is untouched by design: a composite key is neither a colour nor the
// generic slot, and the coverage/payment functions handle it explicitly between
// the (forced) coloured requirements and the (fully flexible) generic tail.
//
// These three helpers are the ONLY place the key format is known — no call site
// does ad-hoc `"/"` splitting.

/** The ten printed guild-hybrid symbols in their OFFICIAL spelling — five
 *  allied pairs walking the WUBRG cycle, then five enemy pairs (CR 107.4e).
 *  This is the authority for the key's colour order, NOT `MANA_COLORS`: three
 *  pairs (`{R/W}`, `{G/W}`, `{G/U}`) are printed against WUBRG order, and the
 *  symbol assets (`public/img/symbols/R_W.svg`) are named after the printed
 *  spelling — keying them the other way around renders a broken image. */
const HYBRID_PIP_SPELLING: readonly (readonly [Color, Color])[] = [
    ["W", "U"],
    ["U", "B"],
    ["B", "R"],
    ["R", "G"],
    ["G", "W"],
    ["W", "B"],
    ["U", "R"],
    ["B", "G"],
    ["R", "W"],
    ["G", "U"],
];

/** Canonical normalized-cost key for a guild-hybrid pip (CR 202.1a). Colour
 *  order is irrelevant on the printed symbol (`{R/W}` === `{W/R}`), so the key
 *  is normalized to the PRINTED spelling — two spellings of the same pip must
 *  never produce two different keys, and the one they collapse to must be the
 *  one the symbol assets and oracle text use. A pair outside the printed ten
 *  (a same-colour or otherwise unprinted combination) falls back to
 *  `MANA_COLORS` order so the key stays deterministic. */
export function hybridCostKey(a: Color, b: Color): string {
    for (const [first, second] of HYBRID_PIP_SPELLING) {
        if ((a === first && b === second) || (a === second && b === first)) {
            return `${first}/${second}`;
        }
    }
    return MANA_COLORS.indexOf(a) <= MANA_COLORS.indexOf(b)
        ? `${a}/${b}`
        : `${b}/${a}`;
}

/** Parses a normalized-cost key back into its colour pair, or `null` when the
 *  key is not a hybrid pip (a plain colour key, `"X"`, …). */
export function parseHybridCostKey(key: string): [Color, Color] | null {
    const slash = key.indexOf("/");
    if (slash < 0) return null;
    const a = key.slice(0, slash);
    const b = key.slice(slash + 1);
    const colors = MANA_COLORS as readonly string[];
    if (!colors.includes(a) || !colors.includes(b)) return null;
    return [a as Color, b as Color];
}

/** Every hybrid pip owed by a normalized cost, EXPANDED one entry per pip (a
 *  `"R/W": 2` key yields two `["R","W"]` pairs) and emitted in deterministic
 *  key order — the payment layer assigns a colour per pip, not per key. */
export function normalizedHybridPips(
    cost: Record<string, number>
): [Color, Color][] {
    const pips: [Color, Color][] = [];
    for (const key of Object.keys(cost).sort()) {
        const pair = parseHybridCostKey(key);
        if (!pair) continue;
        const count = cost[key] ?? 0;
        for (let i = 0; i < count; i++) pips.push([pair[0], pair[1]]);
    }
    return pips;
}

/** Structural shape of a CR 609.4b mana substitution ("all Forests tap for
 *  black"). Declared here rather than imported so this leaf stays dependency
 *  free; `gre/state.ts`'s `ManaSubstitution` is assignable to it. */
type ManaSubstitutionLike = { from: string; to: string };

/** Pool colours that may pay a given guild-hybrid pip (CR 202.1a + CR 609.4b):
 *  either printed colour, plus any colour a live substitution turns INTO one of
 *  them (a black-substituted Forest pays the `{B}` half of a `{B/G}` pip). */
function hybridPipPayableColors(
    pip: readonly [Color, Color],
    substitutions: readonly ManaSubstitutionLike[]
): string[] {
    const colors = new Set<string>([pip[0], pip[1]]);
    for (const sub of substitutions) {
        if (sub.to === pip[0] || sub.to === pip[1]) colors.add(sub.from);
    }
    return [...colors];
}

/** Assigns one pool colour to every guild-hybrid pip (CR 202.1a), returning the
 *  amount spent per colour — or `null` when no assignment exists.
 *
 *  This is a bipartite matching between pips and pool colours (each colour has
 *  `pool[c]` slots), NOT a per-pip greedy: greedily spending the first payable
 *  colour can strand a later pip whose only other option was just consumed —
 *  `{W/R}{W/U}` against `{R}{W}` is payable, but a greedy that pays the first
 *  pip with W has nothing left for the second. Kuhn's augmenting-path search
 *  (with colour capacities) is exact and bounded by ≤6 colours × the handful of
 *  pips a real cost carries.
 *
 *  WHICH colour each pip spends never changes what the GENERIC portion can
 *  afford — generic accepts any colour, so only the remaining TOTAL matters —
 *  which is why coverage can settle the pips independently and then check the
 *  generic against the leftover sum. */
export function assignHybridPips(
    manaPool: Record<string, number>,
    pips: readonly (readonly [Color, Color])[],
    substitutions: readonly ManaSubstitutionLike[] = []
): Record<string, number> | null {
    if (pips.length === 0) return {};
    const options = pips.map((pip) =>
        hybridPipPayableColors(pip, substitutions)
    );
    // `assigned[i]` = the pool colour paying pip i; `spent[c]` = slots used.
    const assigned: (string | undefined)[] = new Array(pips.length);
    const spent: Record<string, number> = {};

    const tryAssign = (pip: number, seen: Set<string>): boolean => {
        for (const color of options[pip]) {
            if (seen.has(color)) continue;
            seen.add(color);
            if ((spent[color] ?? 0) < (manaPool[color] ?? 0)) {
                spent[color] = (spent[color] ?? 0) + 1;
                assigned[pip] = color;
                return true;
            }
            // Colour exhausted — try to rehouse a pip already using it.
            for (let other = 0; other < pips.length; other++) {
                if (assigned[other] !== color) continue;
                assigned[other] = undefined;
                spent[color] = (spent[color] ?? 0) - 1;
                if (tryAssign(other, seen)) {
                    spent[color] = (spent[color] ?? 0) + 1;
                    assigned[pip] = color;
                    return true;
                }
                // Rehousing failed — restore and keep looking.
                assigned[other] = color;
                spent[color] = (spent[color] ?? 0) + 1;
            }
        }
        return false;
    };

    for (let i = 0; i < pips.length; i++) {
        if (!tryAssign(i, new Set())) return null;
    }
    return spent;
}
