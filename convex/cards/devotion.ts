// Devotion (CR 700.5) — the one counter, shared by `SpellContext.getDevotion`
// (`gre/state.ts`) and every `StaticEffectContext.getDevotion`.

import { getInstanceManaCost } from "./registry";
import type { Color, StaticEffectStateView } from "./types";

/** Devotion (CR 700.5, issue #2070) — the number of mana symbols of `color`
 *  among the mana costs of permanents `controllerId` controls: coloured pips
 *  + `phyrexian[color]` pips (CR 105.2 — still a coloured symbol) + ONE per
 *  `hybrid` pair CONTAINING `color` (a `[U,R]` pair counts toward devotion to
 *  BOTH blue and red). Generic, `{X}`/`xFactor`, and a permanent with no mana
 *  cost (token, land) contribute 0. Scanned by CONTROLLER, mirroring
 *  `countDomain`'s CR 110.4 convention (a stolen permanent counts for its
 *  controller). Reads each permanent's live mana cost through
 *  `getInstanceManaCost` (`cards/registry.ts`) — the SAME single authority
 *  the layer-5 colour system (`getManaValue` above) and every other
 *  mana-value / cost-derived-colour reader share, so a `manaCostOverride`
 *  (CR 707.2's "except it has no mana cost", an Eternalize/Embalm token)
 *  correctly contributes 0 here too. Lives in its own module rather than beside
 *  `countDomain` (`cards/types.ts`) because it needs the registry lookup
 *  `countDomain` doesn't — `cards/types.ts` is a deliberately dependency-free
 *  leaf — and outside `gre/` because the client-safe static contexts
 *  (`ATTACK_RESTRICTION_CTX`, `CAST_RESTRICTION_CTX`) read it too. Backs the tenth
 *  `EffectValue` grammar member (`{ devotion: { of, color } }`,
 *  `SpellContext.getDevotion`, Thassa's Oracle) and the static-effect
 *  `StaticEffectContext.getDevotion` (a God's "as long as your devotion ...
 *  is less than N" gate). `colors` is one colour or a PAIR: CR 700.5's
 *  two-colour sentence counts the mana symbols "that are [color 1],
 *  [color 2], or both colors" — each symbol ONCE, so a `[R,G]` hybrid pip
 *  adds one to devotion to red and green, never two. */
export function countDevotion(
    state: StaticEffectStateView,
    controllerId: string,
    colors: Color | readonly Color[]
): number {
    const colorList: readonly Color[] =
        typeof colors === "string" ? [colors] : colors;
    let total = 0;
    const playerList = state.players;
    for (let i = 0; i < playerList.length; i++) {
        const player = playerList[i];
        const permanentList = player.battlefield;
        for (let j = 0; j < permanentList.length; j++) {
            const permanent = permanentList[j];
            if (permanent.controllerId !== controllerId) continue;
            const cost = getInstanceManaCost(permanent);
            if (!cost) continue;
            for (let c = 0; c < colorList.length; c++) {
                const color = colorList[c];
                total += (cost[color] ?? 0) + (cost.phyrexian?.[color] ?? 0);
            }
            const pipList = cost.hybrid ?? [];
            for (let k = 0; k < pipList.length; k++) {
                const pip = pipList[k];
                if (colorList.some((color) => pip.includes(color))) total += 1;
            }
            // CR 700.5 — a `{2/W}` pip is one white mana symbol.
            const pipList2 = cost.hybridGeneric ?? [];
            for (let k = 0; k < pipList2.length; k++) {
                const pip = pipList2[k];
                if (colorList.includes(pip.color)) total += 1;
            }
        }
    }
    return total;
}
