// MH3 — colorless cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3"` resolves through mh3/index.ts.
// Lands and colorless artifacts (no coloured cost) live here. Cards with a
// coloured colour identity go to their matching colour file.
//
// Reference: set code mh3, Modern Horizons 3.

import type { CardDefinition, LandEntryStateView } from "../../types";

// Shifting Woodland — Land.
// "This land enters tapped unless you control a Forest.
//  {T}: Add {G}.
//  Delirium — {2}{G}{G}: This land becomes a copy of target permanent card in
//  your graveyard until end of turn. Activate only if there are four or more
//  card types among cards in your graveyard."
//
// TODO (tracked-by: #2766): Delirium copy ability — {2}{G}{G}: This land
// becomes a copy of target permanent card in your graveyard until end of
// turn. Activate only if delirium.
//
// NARROWED 2026-08-25 (#1841 audit): the old wording ("blocked on
// copy-from-graveyard infrastructure and the 'becomes a copy' semantics for
// non-creature permanents") overstated it. The copy engine ships —
// `convex/gre/copy.ts` implements CR 707 copiable values with `applyCopy` /
// `revertCopy` / `presentedDefId`, and it is card-type agnostic (it swaps
// `card.id` and overwrites types/subtypes/P-T/staticAbilities). Four narrower
// things are missing: a copiable-values path whose SOURCE is a graveyard card
// rather than a battlefield instance; an Op wrapping `applyCopy` at all (the
// copy family is `resolve()`-only today, and this is an ACTIVATED ability); a
// duration-scoped revert; and the delirium activation gate.
export const shiftingWoodland: CardDefinition = {
    id: "059164e1-894d-4586-9800-e60d6fbd6eb6",
    rarity: "rare",
    name: "Shifting Woodland",
    oracleText:
        "This land enters tapped unless you control a Forest.\n{T}: Add {G}.\nDelirium — {2}{G}{G}: This land becomes a copy of target permanent card in your graveyard until end of turn. Activate only if there are four or more card types among cards in your graveyard.",
    types: ["Land"],
    subtypes: ["Forest"],
    entersTappedUnless(
        view: LandEntryStateView,
        controllerId: string
    ): boolean {
        for (const player of view.players) {
            if (player.id !== controllerId) continue;
            return player.battlefield.some((p) =>
                p.subtypes.includes("Forest")
            );
        }
        return false;
    },
};
