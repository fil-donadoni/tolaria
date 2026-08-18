// FIN — colorless cards, split by colour per ADR 0043. The registry's
// `import * as fin from "./sets/fin"` resolves through fin/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Starting Town — "This land enters tapped unless it's your first, second,
// or third turn of the game.\n{T}: Add {C}.\n{T}, Pay 1 life: Add one mana of
// any color." UN-STOPPED (issue #1306, re-audit of the #675-era stub, parent
// PRD #620): the stub's original blocker — this engine's tap-mana fast path
// resolving only a card's FIRST `{T}` ability — no longer holds.
// `getManaTapOptionsDetailed` (`convex/gre/constants.ts`) now unions options
// across EVERY `activatedAbilities` entry (Urborg/Mana Battery/storage-land
// support added since #675), and `tapUntap` resolves a submitted
// `manaChoiceIndex` against that SAME unified list via `resolveManaTapChoice`,
// carrying the CHOSEN ability's own `cost.life` through
// `applyManaAbilityLifeCost`. So two independently-activatable `{T}`
// abilities with DIFFERENT costs is exactly what the engine already supports
// — no per-manaChoice-conditional-cost primitive needed after all: the free
// `{T}: Add {C}` and the `{T}, Pay 1 life: Add one mana of any color` are
// simply two separate `activatedAbilities` entries, each carrying its own
// cost. `entersTappedUnless` reads `LandEntryStateView.activePlayerId` +
// each player's `turnsTaken` directly — see the field-level fix below.
export const startingTown: CardDefinition = {
    id: "fc7d1912-7e27-49ef-bd98-375d975a42b0",
    name: "Starting Town",
    rarity: "rare",
    oracleText:
        "This land enters tapped unless it's your first, second, or third turn of the game.\n{T}: Add {C}.\n{T}, Pay 1 life: Add one mana of any color.",
    types: ["Land"],
    subtypes: ["Town"],
    // CR 614.1c self-conditional replacement — "your first, second, or
    // third turn of the game" is the CONTROLLER's OWN turn ordinal (CR
    // 500.1), NOT the raw global `GameState.turn` counter. A prior version of
    // this predicate (issue #1871, first pass) reconstructed the ordinal from
    // `view.turn` plus the controller's seat index in `view.players`, under a
    // fixed strictly-alternating-seat assumption. That reconstruction is
    // inverted PERMANENTLY by the first extra turn either player takes (CR
    // 500.7 — Time Walk/Time Warp ship in this repo,
    // `sets/lea/blue.ts`/`sets/tmp/blue.ts`) or any skipped turn (CR
    // 614.10): both desynchronize `turn` from strict per-seat alternation, so
    // the seat-parity arithmetic silently starts answering the wrong seat's
    // question (review finding on issue #1871's first PR).
    //
    // Fixed by reading the controller's own ordinal DIRECTLY instead of
    // reconstructing it: `PlayerState.turnsTaken` (CR 500.1, maintained by
    // `advanceTurn`, `gre/phases.ts`) is exact across both extra turns and
    // skips, and `GameState.activePlayerId` says whose turn it currently is.
    // `LandEntryStateView` now carries both (`cards/types.ts`) purely as
    // extra optional fields read off the same `GameState` every call site
    // already passes (`shouldEnterTapped`, `gre/state.ts`) — no new producer,
    // no wire projection change (the sole call site hands the full
    // `GameState` through, never a slimmed client-side view; see that
    // interface's doc comment for the off-turn / unknown-field fallback
    // contract). `view.activePlayerId !== controllerId` covers the flash
    // case (a land entering during an opponent's turn, or any turn that
    // isn't the controller's) — CR 614.1c fails closed to tapped there, same
    // as before.
    entersTappedUnless: (view, controllerId) => {
        if (view.activePlayerId !== controllerId) return false;
        const own = view.players.find((p) => p.id === controllerId);
        return (own?.turnsTaken ?? 0) <= 3;
    },
    activatedAbilities: [
        {
            id: "starting-town-colorless",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
        {
            id: "starting-town-any-color",
            oracleText: "{T}, Pay 1 life: Add one mana of any color.",
            cost: { tap: true, life: 1 },
            useStack: false,
            effect: (ctx) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};
