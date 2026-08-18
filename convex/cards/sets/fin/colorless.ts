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
// cost. `entersTappedUnless` reads `LandEntryStateView.turn` directly — a
// field whose doc comment (`cards/types.ts`) was already written FOR this
// exact clause ("Starting Town's 'first, second, or third turn of the game'
// reads it directly").
export const startingTown: CardDefinition = {
    id: "fc7d1912-7e27-49ef-bd98-375d975a42b0",
    name: "Starting Town",
    rarity: "rare",
    oracleText:
        "This land enters tapped unless it's your first, second, or third turn of the game.\n{T}: Add {C}.\n{T}, Pay 1 life: Add one mana of any color.",
    types: ["Land"],
    subtypes: ["Town"],
    // CR 614.1c self-conditional replacement — "your first, second, or
    // third turn of the game" is the CONTROLLER's OWN turn ordinal, not the
    // raw global `GameState.turn` counter (issue #1871). `turn` increments
    // once per player-turn in a fixed seat rotation (`advanceTurn`,
    // `gre/phases.ts`; CR 103.1 — "the game's default turn order begins with
    // the starting player and proceeds clockwise"): turn 1 = players[0]'s
    // first turn, turn 2 = players[1]'s first turn, turn 3 = players[0]'s
    // second turn, … — the exact convention `LandEntryStateView.turn`'s own
    // doc comment (`cards/types.ts`) already spells out. Comparing `view.turn
    // <= 3` directly conflated that global counter with the controller's own
    // ordinal: correct only for the player occupying `players[0]`, and even
    // then wrong from their 3rd turn on (global turn 5).
    //
    // `LandEntryStateView` carries no per-player turn count (`turnsTaken`
    // lives on the full `GameState.players[i]`, not this frontend-safe view)
    // and no `activePlayerId`, so the controller's ordinal is reconstructed
    // here from `view.turn` plus the controller's seat index in
    // `view.players`, under that same fixed-rotation convention — mirroring
    // how `abandonedAirTemple` (`sets/tla/colorless.ts`) threads
    // `controllerId` through `view.players.find(...)` for its own
    // `entersTappedUnless`. Simplification carried over unchanged from the
    // original code: an extra turn (CR 500.7) is not modeled — the rotation
    // is assumed strictly alternating by seat.
    entersTappedUnless: (view, controllerId) => {
        const seatCount = view.players.length;
        const seatIndex = view.players.findIndex((p) => p.id === controllerId);
        if (seatIndex < 0 || seatCount === 0) return false;
        const seatTurn = seatIndex + 1;
        if (view.turn < seatTurn) return false;
        const offsetFromSeatTurn = view.turn - seatTurn;
        if (offsetFromSeatTurn % seatCount !== 0) return false;
        const ownTurnOrdinal = offsetFromSeatTurn / seatCount + 1;
        return ownTurnOrdinal <= 3;
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
