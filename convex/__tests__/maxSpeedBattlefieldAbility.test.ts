// Max speed on the battlefield (CR 702.178a): "Max speed — [Ability]" means
// "As long as your speed is 4, this object has '[Ability].'" Both printed forms
// lower to `requiresMaxSpeed` and are read here through the server's real
// entry points:
//
//  1. MANA — "Max speed — {T}: Add {R}{R}." (Endrider Catalyzer) and the land
//     printing an ungated "{T}: Add {C}." beside "Max speed — {T}: Add {C}{C}."
//     (Muraganda Raceway). A mana ability never reaches
//     `activationPreconditionViolation`; the tap mutation (`tapUntap`), the
//     payment tap (`tapSourceIntoPayment`) and the option list every planner
//     reads (`getManaTapOptionsDetailed`) gate it themselves.
//  2. NON-MANA — "Max speed — Sacrifice this enchantment: Create two 1/1 …"
//     (Deviant Skytech), through the activation mutation body.
//
// The grammar half is `convex/oracle/__tests__/maxSpeed.test.ts`, the Bot half
// `convex/gre/__tests__/maxSpeedBattlefield.bot.test.ts`, the client half
// `src/lib/__tests__/max-speed-battlefield.test.ts`.
import { describe, expect, it } from "vitest";
import {
    activateAbilityOnState,
    tapSourceIntoPayment,
    tapUntap,
} from "../game";
import type { CardDefinition } from "../cards/types";
import {
    withTemporaryDefinition,
    withTemporaryDefinitionAsync,
} from "../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";
import { compileCard } from "../oracle/compile";
import { getManaTapOptions, manaGateBattlefields } from "../gre/constants";
import type { GameState } from "../gre/state";
import type { Id } from "../_generated/dataModel";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "./gameMutationHarness.fixture";

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
    "test-9586-catalyzer"
);

const RACEWAY = compiled(
    {
        oracleId: "9586a000-0000-4000-8000-000000000001",
        name: "Muraganda Raceway",
        manaCost: "",
        typeLine: "Land",
        oracleText: `${REMINDER}\n{T}: Add {C}.\nMax speed — {T}: Add {C}{C}.`,
        layout: "normal",
    },
    "test-9586-raceway"
);

const SKYTECH = compiled(
    {
        oracleId: "9586a000-0000-4000-8000-000000000002",
        name: "Deviant Skytech",
        manaCost: "{1}{W}",
        typeLine: "Enchantment",
        oracleText:
            "Start your engines!\nWhen this enchantment enters, create two 1/1 colorless Thopter artifact creature tokens with flying.\nMax speed — Sacrifice this enchantment: Create two 1/1 colorless Thopter artifact creature tokens with flying.",
        layout: "normal",
    },
    "test-9586-skytech"
);

const GAME_ID = "game-1" as Id<"games">;

type TapUntapArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    manaChoiceIndex?: number;
};

/** p1 controls `definition` as `src`, untapped and not summoning sick; p1 is
 *  the active player with priority in its main phase. */
function board(
    definition: CardDefinition,
    p1Speed: number | undefined,
    p2Speed?: number
): GameState {
    return makeState({
        turn: 5,
        players: [
            makePlayer("p1", {
                ...(p1Speed === undefined ? {} : { speed: p1Speed }),
                battlefield: [
                    makeInstance(definition.id, {
                        id: "src",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", p2Speed === undefined ? {} : { speed: p2Speed }),
        ],
    });
}

async function tap(
    definition: CardDefinition,
    p1Speed: number | undefined,
    manaChoiceIndex?: number
): Promise<GameState["players"][number]["manaPool"]> {
    return withTemporaryDefinitionAsync(definition, async () => {
        const stub = makeMutationCtx("p1", [
            gameStateSeed(board(definition, p1Speed)),
        ]);
        await runMutation<TapUntapArgs, void>(
            tapUntap as unknown as Handler<TapUntapArgs, void>,
            stub.ctx,
            {
                gameId: GAME_ID,
                playerId: "p1",
                cardInstanceId: "src",
                ...(manaChoiceIndex === undefined ? {} : { manaChoiceIndex }),
            }
        );
        return stub.state().players[0]!.manaPool;
    });
}

describe("a mana ability behind max speed — the tap mutation (CR 702.178a)", () => {
    it("adds its mana at its controller's max speed", async () => {
        expect((await tap(CATALYZER, 4)).R).toBe(2);
    });

    it("is no mana ability below max speed", async () => {
        await expect(tap(CATALYZER, 3)).rejects.toThrow();
        await expect(tap(CATALYZER, undefined)).rejects.toThrow();
    });

    it("leaves the land's ungated ability the only tap below max speed", async () => {
        const pool = await tap(RACEWAY, 3);
        expect(pool.C).toBe(1);
    });

    it("offers the gated second ability at max speed", async () => {
        const pool = await tap(RACEWAY, 4, 1);
        expect(pool.C).toBe(2);
    });

    // Below max speed the land has ONE mana ability, so the submitted index
    // names nothing to choose between: the ungated {C} is what it taps for.
    it("never adds the gated ability's mana below max speed", async () => {
        const pool = await tap(RACEWAY, 3, 1);
        expect(pool.C).toBe(1);
    });
});

describe("a mana ability behind max speed — the payment tap and the option list (CR 702.178a)", () => {
    function payWith(p1Speed: number | undefined) {
        return withTemporaryDefinition(CATALYZER, () => {
            const state = board(CATALYZER, p1Speed);
            const player = state.players[0]!;
            tapSourceIntoPayment(
                state,
                player,
                player.battlefield[0]!,
                undefined,
                []
            );
            return player.manaPool.R;
        });
    }

    it("the payment tap adds its mana only at max speed", () => {
        expect(payWith(4)).toBe(2);
        expect(() => payWith(3)).toThrow();
    });

    // CR 109.5 — "your" speed is the permanent's controller's.
    function optionCount(p1Speed: number | undefined, p2Speed?: number) {
        return withTemporaryDefinition(CATALYZER, () => {
            const state = board(CATALYZER, p1Speed, p2Speed);
            const card = state.players[0]!.battlefield[0]!;
            return getManaTapOptions(card, "p1", manaGateBattlefields(state))
                .length;
        });
    }

    it("the option list every planner reads holds it only at max speed", () => {
        expect(optionCount(4)).toBe(1);
        expect(optionCount(3)).toBe(0);
    });

    it("an opponent's max speed does not open it", () => {
        expect(optionCount(1, 4)).toBe(0);
    });
});

describe("a non-mana battlefield ability behind max speed (CR 702.178a)", () => {
    const ability = SKYTECH.activatedAbilities![0]!;

    function activate(p1Speed: number | undefined): GameState {
        return withTemporaryDefinition(SKYTECH, () => {
            const state = board(SKYTECH, p1Speed);
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "src",
                abilityId: ability.id,
            });
            return state;
        });
    }

    it("the activation mutation refuses it below max speed", () => {
        expect(() => activate(3)).toThrow(
            "Ability cannot be activated right now"
        );
    });

    it("the activation mutation accepts it at max speed", () => {
        const state = activate(4);
        expect(state.players[0]!.battlefield.some((c) => c.id === "src")).toBe(
            false
        );
    });
});
