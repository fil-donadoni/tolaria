// CR 702.178a — the client affordance for a battlefield ability behind "Max
// speed —". Driven through the REAL reducers: the server state goes through
// `projectPublicState`, `buildTriggerStateView` and `withManaLayers` build the
// viewer's view and mana boards from it (a dropped `speed` field would read as
// no speed and hide the ability forever), and the mana helpers weigh the gate
// through the engine's shared `maxSpeedGateOpen`.
//
// The server half is `convex/__tests__/maxSpeedBattlefieldAbility.test.ts`.
import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "@convex/cards/registry";
import type { CardDefinition } from "@convex/cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { projectPublicState } from "@convex/gameProjections";
import { compileCard } from "@convex/oracle/compile";
import type { CardInstance } from "../../types/game";
import {
    buildTriggerStateView,
    getActivatedManaMenuEntry,
    getManaChoices,
    getStackAbilities,
    hasManaAbility,
    withManaLayers,
} from "../card-utils";

const REMINDER =
    "Start your engines! (If you have no speed, it starts at 1. It increases once on each of your turns when an opponent loses life. Max speed is 4.)";

function compiled(
    oracle: Parameters<typeof compileCard>[0],
    id: string
): CardDefinition {
    const outcome = compileCard(oracle);
    if (outcome.state !== "ready")
        throw new Error(`${oracle.name} is ${outcome.state}`);
    return { ...outcome.definition, id } as CardDefinition;
}

const CATALYZER = compiled(
    {
        oracleId: "b4d970ed-f332-440c-8c2f-8a8a0191410b",
        name: "Endrider Catalyzer",
        manaCost: "{2}{R}",
        typeLine: "Creature — Human Warrior",
        oracleText: `${REMINDER}\nMax speed — {T}: Add {R}{R}.`,
        power: "3",
        toughness: "3",
        layout: "normal",
    },
    "test-9586-client-catalyzer"
);

const RACEWAY = compiled(
    {
        oracleId: "9586c000-0000-4000-8000-000000000001",
        name: "Muraganda Raceway",
        manaCost: "",
        typeLine: "Land",
        oracleText: `${REMINDER}\n{T}: Add {C}.\nMax speed — {T}: Add {C}{C}.`,
        layout: "normal",
    },
    "test-9586-client-raceway"
);

const SKYTECH = compiled(
    {
        oracleId: "9586c000-0000-4000-8000-000000000002",
        name: "Deviant Skytech",
        manaCost: "{1}{W}",
        typeLine: "Enchantment",
        oracleText:
            "Start your engines!\nWhen this enchantment enters, create two 1/1 colorless Thopter artifact creature tokens with flying.\nMax speed — Sacrifice this enchantment: Create two 1/1 colorless Thopter artifact creature tokens with flying.",
        layout: "normal",
    },
    "test-9586-client-skytech"
);

/** p1 controls `definition` as `src`; the viewer is p1. */
function view<T>(
    definition: CardDefinition,
    mine: number | undefined,
    read: (
        card: CardInstance,
        stateView: ReturnType<typeof buildTriggerStateView>,
        players: ReturnType<typeof withManaLayers>,
        phase: ReturnType<typeof projectPublicState>["phase"]
    ) => T,
    theirs?: number
): T {
    return withTemporaryDefinition(definition, () => {
        const state = makeState({
            turn: 5,
            players: [
                makePlayer("p1", {
                    ...(mine === undefined ? {} : { speed: mine }),
                    battlefield: [
                        makeInstance(definition.id, {
                            id: "src",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", theirs === undefined ? {} : { speed: theirs }),
            ],
        });
        const wire = projectPublicState(state, 1, "p1");
        const stateView = buildTriggerStateView(
            wire.players,
            wire.activePlayerId
        );
        const players = withManaLayers(
            wire.players,
            wire.activePlayerId,
            undefined,
            undefined
        );
        const card = wire.players[0]!.battlefield.find(
            (c) => c.id === "src"
        ) as CardInstance;
        return read(card, stateView, players, wire.phase);
    });
}

describe("a mana ability behind max speed — client affordance (CR 702.178a)", () => {
    const tappable = (mine: number | undefined, theirs?: number) =>
        view(
            CATALYZER,
            mine,
            (card, stateView, players) =>
                hasManaAbility(card, stateView, players),
            theirs
        );

    it("reads as a mana source at its controller's max speed", () => {
        expect(tappable(4)).toBe(true);
    });

    it("reads as no mana source below max speed", () => {
        expect(tappable(3)).toBe(false);
        expect(tappable(undefined)).toBe(false);
    });

    it("an opponent's max speed does not open it (CR 109.5)", () => {
        expect(tappable(1, 4)).toBe(false);
    });

    it("is no ability-menu entry below max speed", () => {
        expect(
            view(CATALYZER, 3, (card, stateView) =>
                getActivatedManaMenuEntry(card, stateView)
            )
        ).toBeNull();
        expect(
            view(CATALYZER, 4, (card, stateView) =>
                getActivatedManaMenuEntry(card, stateView)
            )?.id
        ).toBe(CATALYZER.activatedAbilities![0]!.id);
    });

    it("offers the land's gated amount as a second choice only at max speed", () => {
        const choices = (mine: number) =>
            view(RACEWAY, mine, (card, _view, players) =>
                getManaChoices(card, players)
            );
        expect(choices(4)).toEqual([{ C: 1 }, { C: 2 }]);
        expect(choices(3)).toBeNull();
    });
});

describe("a stack ability behind max speed — client affordance (CR 702.178a)", () => {
    const offered = (mine: number) =>
        view(SKYTECH, mine, (card, stateView, _players, phase) =>
            getStackAbilities(card, phase, true, stateView).map((a) => a.id)
        );

    it("offers it at its controller's max speed", () => {
        expect(offered(4)).toEqual([SKYTECH.activatedAbilities![0]!.id]);
    });

    it("hides it below max speed", () => {
        expect(offered(3)).toEqual([]);
    });
});
