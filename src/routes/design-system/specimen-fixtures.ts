// Shared fixtures for the /admin/design-system overlay specimens (issue #4419
// board dialogs, issue #4420 cast pickers — slices of the `check:ui` census
// debt issue #4402). Every value here is INERT: the specimens take the handles
// as opaque strings and only spend them in a mutation no walk fires.
import type { Id } from "@convex/_generated/dataModel";
import type { CardInstance, Player } from "~/types/game";

/** A specimen game handle. Opaque to every dialog below: they forward it to a
 *  mutation, and no walk presses a control that fires one. */
export const GAME_ID = "specimen-game" as unknown as Id<"games">;
export const ME = "me";
export const OPP = "opp";

/** Real print ids, taken from the `mono-red-burn` preset (`convex/deckPresets.ts`)
 *  — a catalogue entry with art on every deployment the lane walks, so the
 *  card tiles inside these dialogs are the real `CardImage`, not a grey box
 *  that would read as a passing measurement of nothing. */
export const PRINT = {
    bolt: "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
    goblin: "b4eb3db3-6a7c-488a-9433-d5d1d3133816",
    hillGiant: "0ddb98e8-13fe-4786-83f7-b72c56db135a",
    minotaur: "78a9088f-8755-47cb-aa93-51d992ccab90",
    mountain: "eace2c85-976c-425e-9800-5a6ccbd91b56",
} as const;

export function card(
    id: string,
    printId: string,
    zone: CardInstance["zone"],
    overrides: Partial<CardInstance> = {}
): CardInstance {
    return {
        id,
        card: { id: printId },
        controllerId: ME,
        ownerId: ME,
        zone,
        isTapped: false,
        ...overrides,
    };
}

const HAND: CardInstance[] = [
    card("h1", PRINT.bolt, "hand"),
    card("h2", PRINT.goblin, "hand"),
    card("h3", PRINT.mountain, "hand"),
];

const GRAVEYARD: CardInstance[] = [
    card("g1", PRINT.hillGiant, "graveyard"),
    card("g2", PRINT.minotaur, "graveyard"),
    card("g3", PRINT.bolt, "graveyard"),
];

const BATTLEFIELD: CardInstance[] = [
    card("b1", PRINT.goblin, "battlefield", {
        types: ["Creature"],
        power: 1,
        toughness: 1,
    }),
    card("b2", PRINT.hillGiant, "battlefield", {
        types: ["Creature"],
        power: 3,
        toughness: 3,
    }),
];

function player(id: string, name: string, bgColor: string): Player {
    return {
        id,
        name,
        bgColor,
        life: 20,
        hand: [...HAND],
        library: [],
        graveyard: [...GRAVEYARD],
        exile: [],
        battlefield: id === ME ? [...BATTLEFIELD] : [],
        manaPool: {},
    };
}

export const PLAYERS: Player[] = [
    player(ME, "You", "#7f1d1d"),
    player(OPP, "Rival", "#1e3a8a"),
];

/** The `GameContext` the three context-reading dialogs need
 *  (`ControllerPhaseList`, `ManualGameOverDialog`, `SideboardingDialog`). Same
 *  shape `makeManualGameContext` builds for the Manual Board: a complete,
 *  well-formed, inert value — `useGameContext` throws without one. */
export const GAME_CONTEXT = {
    gameId: GAME_ID,
    playerId: ME,
    activePlayerId: ME,
    priorityPlayerId: ME,
    phase: "PRECOMBAT_MAIN" as const,
    turn: 4,
    engineTurn: 7,
    stackCount: 0,
    stackItems: [],
    allPlayers: PLAYERS,
    showAllCards: false,
    debugAllActions: false,
    onSwitchGame: () => {},
};
