// Issue #8426 — the graveyard target dialog's title and the target banner's
// source name, resolved by `PendingTarget.kind` off the PROJECTED board.
//
// The bug: both surfaces read the source's name from the hand alone, so every
// activated ability (Jace, Telepath Unbound −3; Emry), triggered ability
// (Gravedigger) and cast from graveyard or exile that targets a graveyard card
// was titled "spell".
//
// Every pending target here is raised by the engine's own path where one
// exists (`activateAbilityOnState`, `raiseTriggerTargetSelection`), and every
// assertion reads `projectPublicState`: a field the wire drops (a transformed
// face, a grant, the trigger's stack item) would fail here, not in a game.

import { describe, expect, it } from "vitest";
import type { PendingTarget, Player, StackItem } from "~/types/game";
import {
    pendingTargetSourceName,
    pendingTargetTitle,
    UNRESOLVED_TARGET_SOURCE,
} from "../pending-target-title";
import { projectPublicState } from "@convex/gameProjections";
import {
    getCardByName,
    getDefinition,
    withTemporaryDefinition,
} from "@convex/cards";
import type { CardDefinition } from "@convex/cards/types";
import { activateAbilityOnState } from "@convex/game";
import { raiseTriggerTargetSelection } from "@convex/gre/rules";
import { transformPermanent } from "@convex/gre/transform";
import type {
    CardInstanceState,
    GameState,
    StackItem as EngineStackItem,
} from "@convex/gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";

const JACE = getCardByName("Jace, Vryn's Prodigy");
const EMRY = getCardByName("Emry, Lurker of the Loch");
// `getDefinition` expands the compiled triggered abilities.
const GRAVEDIGGER = getDefinition(getCardByName("Gravedigger").id);
const BEARS = getCardByName("Grizzly Bears");
const BOLT = getCardByName("Lightning Bolt");
const ORNITHOPTER = getCardByName("Ornithopter");

const JACE_MINUS3 = JACE.backFace!.activatedAbilities!.find(
    (a) => a.id === "jace-telepath-unbound-minus3"
)!;

function gy(id: string, cardId: string, owner = "p1"): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "graveyard",
    });
}

function boardState(battlefield: CardInstanceState[]): GameState {
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield,
                graveyard: [
                    gy("bolt-a", BOLT.id),
                    gy("bolt-b", BOLT.id),
                    gy("thopter-a", ORNITHOPTER.id),
                    gy("thopter-b", ORNITHOPTER.id),
                    gy("bears-a", BEARS.id),
                    gy("bears-b", BEARS.id),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

/** The viewer's projected seat, stack and pending target. */
function project(state: GameState): {
    me: Player;
    stack: StackItem[];
    pendingTarget: PendingTarget;
} {
    const view = projectPublicState(state, 1, "p1");
    expect(view.pendingTarget).toBeDefined();
    return {
        me: view.players.find((p) => p.id === "p1") as unknown as Player,
        stack: (view.stack ?? []) as unknown as StackItem[],
        pendingTarget: view.pendingTarget as unknown as PendingTarget,
    };
}

function title(state: GameState): string {
    const { me, stack, pendingTarget } = project(state);
    return pendingTargetTitle(pendingTarget, me, stack);
}

function bannerName(state: GameState): string {
    const { me, stack, pendingTarget } = project(state);
    return pendingTargetSourceName(pendingTarget, me, stack);
}

describe("graveyard target title — activated ability (CR 602.2b, issue #8426)", () => {
    it("Jace, Telepath Unbound −3: the back face's full ability text", () => {
        const jace = makeInstance(JACE.id, {
            id: "jace",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = boardState([jace]);
        // CR 712.8e — the transformed permanent has only its back face's
        // characteristics: the −3 exists only there.
        transformPermanent(state, jace);
        expect(jace.transformed).toBe(true);
        jace.counters = { loyalty: 5 };

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "jace",
            abilityId: JACE_MINUS3.id,
        });

        expect(state.pendingTarget?.kind).toBe("ability");
        expect(title(state)).toBe(JACE_MINUS3.oracleText);
        // Out of scope: the banner keeps the source's name for an ability.
        expect(bannerName(state)).toBe("Jace, Telepath Unbound");
    });

    it("Emry's battlefield ability: its own text", () => {
        const emry = makeInstance(EMRY.id, {
            id: "emry",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = boardState([emry]);
        const ability = EMRY.activatedAbilities![0]!;

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "emry",
            abilityId: ability.id,
        });

        expect(state.pendingTarget?.zone).toBe("graveyard");
        expect(title(state)).toBe(ability.oracleText);
    });

    it("a GRANTED ability (CR 113.1a): the grant template's text", () => {
        const GRANTER_ID = "client-8426-granter";
        const GRANTED_ID = "client-8426-granted-return";
        const GRANTED_TEXT =
            "{T}: Return target creature card from your graveyard to your hand.";
        const granter: CardDefinition = {
            ...getCardByName("Grizzly Bears"),
            id: GRANTER_ID,
            name: "Client Test Granter",
            grantTemplates: [
                {
                    id: GRANTED_ID,
                    oracleText: GRANTED_TEXT,
                    cost: { tap: true },
                    useStack: true,
                    targetRequirement: {
                        type: "Creature",
                        count: 1,
                        zone: "graveyard",
                        controller: "you",
                    },
                    effects: [
                        {
                            op: "returnToHand",
                            target: { target: 0 },
                        },
                    ],
                },
            ],
        };
        withTemporaryDefinition(granter, () => {
            const bears = makeInstance(BEARS.id, {
                id: "bears",
                controllerId: "p1",
                ownerId: "p1",
                grantedActivatedAbilities: [
                    { sourceCardId: GRANTER_ID, abilityId: GRANTED_ID },
                ],
            });
            const state = boardState([bears]);

            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "bears",
                abilityId: GRANTED_ID,
            });

            expect(state.pendingTarget?.zone).toBe("graveyard");
            expect(title(state)).toBe(GRANTED_TEXT);
        });
    });
});

describe("graveyard target title — trigger (CR 603.3d, issue #8426)", () => {
    it("Gravedigger's ETB trigger: the trigger's text, never 'spell'", () => {
        const digger = makeInstance(GRAVEDIGGER.id, {
            id: "digger",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = boardState([digger]);
        const trigger = GRAVEDIGGER.triggeredAbilities![0]!;
        const item: EngineStackItem = {
            ...digger,
            id: "digger-trigger",
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: trigger.id,
            triggerSourceId: digger.id,
            targets: undefined,
        };
        state.stack.push(item);

        expect(raiseTriggerTargetSelection(state)).toBe(true);
        expect(state.pendingTarget?.kind).toBe("trigger");
        expect(title(state)).toBe(trigger.oracleText);
        expect(bannerName(state)).toBe("Gravedigger");
    });
});

describe("graveyard target title — cast (CR 601.2c, issue #8426)", () => {
    // The engine asks for targets before moving the card, although CR 601.2a
    // moves it to the stack first, so the source is found in graveyard or exile.
    for (const zone of ["graveyard", "exile"] as const) {
        it(`a cast from ${zone}: dialog and banner both name the card`, () => {
            const state = boardState([]);
            const spell = makeInstance(BOLT.id, {
                id: "cast-src",
                controllerId: "p1",
                ownerId: "p1",
                zone,
            });
            state.players[0]![zone].push(spell);
            state.pendingTarget = {
                playerId: "p1",
                cardInstanceId: "cast-src",
                targetType: "Creature",
                count: 1,
                zone: "graveyard",
                selected: [],
                kind: "cast",
            };

            expect(title(state)).toBe("Lightning Bolt");
            expect(bannerName(state)).toBe("Lightning Bolt");
        });
    }

    it("an unresolvable source still falls back", () => {
        const state = boardState([]);
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: "nowhere",
            targetType: "Creature",
            count: 1,
            zone: "graveyard",
            selected: [],
        };
        expect(title(state)).toBe(UNRESOLVED_TARGET_SOURCE);
    });
});
