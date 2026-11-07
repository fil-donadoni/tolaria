// A modal triggered ability declaring a `ModeSelection`, shared by the engine,
// Bot and client suites of CR 700.2 / 603.3c. Printed order is the point: `gain`
// has no target, `tap` and `untap` target one creature each, and a tap followed
// by an untap of the same creature only leaves it untapped when the instances
// run in that order.

import { withTemporaryDefinitionAsync } from "../../cards/registry";
import type {
    AbilityMode,
    CardDefinition,
    ModeSelection,
} from "../../cards/types";
import { grizzlyBears } from "../../cards/sets/lea/green.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { GameState, StackItem } from "../state";

export const MODES: AbilityMode[] = [
    {
        id: "gain",
        label: "You gain 2 life",
        oracleText: "You gain 2 life.",
        effects: [{ op: "gainLife", player: "controller", amount: 2 }],
    },
    {
        id: "tap",
        label: "Tap target creature",
        oracleText: "Tap target creature.",
        targetRequirement: { type: ["Creature"], count: 1 },
        effects: [{ op: "tapUntap", action: "tap", target: { target: 0 } }],
    },
    {
        id: "untap",
        label: "Untap target creature",
        oracleText: "Untap target creature.",
        targetRequirement: { type: ["Creature"], count: 1 },
        effects: [{ op: "tapUntap", action: "untap", target: { target: 0 } }],
    },
    {
        id: "draw",
        label: "Draw a card",
        oracleText: "Draw a card.",
        effects: [{ op: "draw", player: "controller", count: 1 }],
    },
];

export const CHOOSE_THREE: ModeSelection = { min: 3, max: 3 };

const releases: (() => void)[] = [];

/** Ends every card {@link modalTriggerCard} served. Each suite using it calls this
 *  in `afterEach`: the bot projects share a worker, where an entry left behind
 *  would reach every check that walks registered definitions. */
export async function releaseModalTriggerCards(): Promise<void> {
    const pending = releases.splice(0).reverse();
    pending.forEach((release) => release());
    await Promise.resolve();
}

/** Serves a card whose one trigger carries `modes` / `selection` until
 *  {@link releaseModalTriggerCards}; its id is derived from them so no two shapes
 *  share a registry row. */
export function modalTriggerCard(
    selection: ModeSelection | undefined,
    modes: AbilityMode[] = MODES
): string {
    const id = `test-modal-trigger-${JSON.stringify(selection ?? null)}-${modes
        .map((m) => m.id)
        .join("-")}`;
    const definition = {
        id,
        name: id,
        rarity: "rare",
        manaCost: { X: 1 },
        types: ["Enchantment"],
        triggeredAbilities: [
            {
                id: "modal",
                event: "PERMANENT_ENTERED",
                oracleText: "Whenever a permanent enters, choose modes.",
                modes,
                ...(selection ? { modeSelection: selection } : {}),
            },
        ],
    } as CardDefinition;
    void withTemporaryDefinitionAsync(
        definition,
        () => new Promise<void>((release) => releases.push(release))
    );
    return id;
}

export function bear(id: string, controllerId: string, isTapped = false) {
    return makeInstance(grizzlyBears().id, {
        id,
        controllerId,
        ownerId: controllerId,
        isTapped,
    });
}

export function modalBoard(
    cardId: string,
    battlefield: Partial<Record<"p1" | "p2", ReturnType<typeof bear>[]>> = {}
): { state: GameState; trig: StackItem } {
    const library = Array.from({ length: 3 }, (_, i) =>
        makeInstance(grizzlyBears().id, {
            id: `lib-${i}`,
            ownerId: "p1",
            zone: "library",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: battlefield.p1 ?? [], library }),
            makePlayer("p2", { battlefield: battlefield.p2 ?? [] }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    const trig: StackItem = {
        id: "trig",
        card: { id: cardId },
        controllerId: "p1",
        ownerId: "p1",
        castById: "p1",
        zone: "stack",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        triggeredAbilityId: "modal",
        triggerSourceId: "source",
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: "source",
            controllerId: "p1",
            types: ["Enchantment"],
        } as StackItem["triggerEvent"],
    };
    state.stack.push(trig);
    return { state, trig };
}
