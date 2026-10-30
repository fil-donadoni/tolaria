// Shared fixture for the filtered cast-from-top-of-library tests (issue #7205):
// the app-suite `libraryTopCastFilter.test.ts` and the bot-suite
// `libraryTopCastFilter.bot.test.ts` (an application test may not import a
// bot-only module, `bot-suite-boundary.test.ts`), so the board lives here once.

import { getCardByName } from "../../cards";
import {
    withTemporaryDefinition,
    withTemporaryDefinitionAsync,
} from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition } from "../../cards/types";
import type { CardInstanceState, GameState } from "../state";

export const CITADEL = getCardByName("Bolas's Citadel");
const ORNITHOPTER = getCardByName("Ornithopter");
export const GRIZZLY_BEARS = getCardByName("Grizzly Bears");
export const STAND_DELIVER = getCardByName("Stand // Deliver");
const FOREST = getCardByName("Forest").id;
const ISLAND = getCardByName("Island").id;
const PLAINS = getCardByName("Plains").id;
const HILL_GIANT = getCardByName("Hill Giant").id;

const FIVE_COLORS = ["W", "U", "B", "R", "G"] as const;

/** A Mystic Forge-shaped permission: artifact OR colorless, printed cost. */
export const FORGE: CardDefinition = {
    ...CITADEL,
    id: "test-artifact-or-colorless-forge",
    name: "Test Forge",
    castsSpellsFromTopOfLibrary: {
        spellFilter: {
            any: [{ types: "Artifact" }, { excludeColors: [...FIVE_COLORS] }],
        },
    },
};

/** A COLOURED artifact ({U} Ornithopter): covered by the "artifact" clause
 *  alone. */
export const BLUE_ARTIFACT: CardDefinition = {
    ...ORNITHOPTER,
    id: "test-blue-ornithopter",
    name: "Test Blue Ornithopter",
    manaCost: { U: 1 },
};

/** A COLOURLESS non-artifact ({2} Grizzly Bears): covered by the "colorless"
 *  clause alone (CR 202.2b). */
export const COLORLESS_BEAR: CardDefinition = {
    ...GRIZZLY_BEARS,
    id: "test-colorless-bear",
    name: "Test Colorless Bear",
    manaCost: { generic: 2 },
};

/** A permission covering only WHITE spells — the axis that splits Stand
 *  ({W}) from Deliver ({2}{U}). */
export const WHITE_ONLY: CardDefinition = {
    ...CITADEL,
    id: "test-white-only-permission",
    name: "Test White Permission",
    castsSpellsFromTopOfLibrary: { spellFilter: { colors: "W" } },
};

const TEST_DEFS = [FORGE, BLUE_ARTIFACT, COLORLESS_BEAR, WHITE_ONLY];

export function withDefs<T>(fn: () => T): T {
    return TEST_DEFS.reduceRight<() => T>(
        (inner, def) => () => withTemporaryDefinition(def, inner),
        fn
    )();
}

export function withDefsAsync<T>(fn: () => Promise<T>): Promise<T> {
    return TEST_DEFS.reduceRight<() => Promise<T>>(
        (inner, def) => () => withTemporaryDefinitionAsync(def, inner),
        fn
    )();
}

const own = (cardId: string, id: string, zone?: string) =>
    makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        ...(zone ? { zone: zone as CardInstanceState["zone"] } : {}),
    });

/** p1 controls `permissionIds` (in battlefield order) plus two each of
 *  Forest / Island / Plains — enough mana for every printed cost here, so a
 *  refused cast is refused by the permission, never by affordability — with
 *  `topCardId` on top of their library. p2 has a Hill Giant (Stand's target). */
export function board(permissionIds: string[], topCardId: string): GameState {
    const lands = [FOREST, ISLAND, PLAINS].flatMap((land, i) => [
        own(land, `land-${i}-a`),
        own(land, `land-${i}-b`),
    ]);
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    ...permissionIds.map((id, i) => own(id, `permission-${i}`)),
                    ...lands,
                ],
                library: [own(topCardId, "top", "library")],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(HILL_GIANT, {
                        id: "giant",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}
