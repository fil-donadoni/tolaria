// "Planeswalkers you control …" statics (issue #7199) — Sanctum Lurker,
// Avatar of Burgeoning Echoes.
//
// 1. A GRANTED loyalty ability ("Planeswalkers you control have '[+2]: …'"):
//    an `activated-grant` whose template carries `cost.loyalty`. CR 613.1f puts
//    it on the walker in layer 6; from there it is a loyalty ability like a
//    printed one — CR 606.3's timing and once-per-turn allowance (shared with
//    the walker's printed abilities), CR 606.4's cost paid on the RECIPIENT.
// 2. The CR 704.5i exemption ("… aren't put into their owners' graveyards for
//    having 0 loyalty"): a `permanent-guard` with `survivesZeroLoyalty`, read
//    live by `checkZeroLoyaltySBA` (CR 611.3a — not locked in).
//
// The client half (mutation → wire → `getStackAbilities`) is
// `src/lib/__tests__/walker-granted-loyalty-ability.fullpath.test.ts`.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards";
import { syncLayer6 } from "../layer6";
import { activateAbilityOnState } from "../activation";
import { enumerateMoves } from "../moves";
import { resolveTopOfStack, type GameState } from "../state";
import { checkStateBasedActions } from "../sba";
import { projectPublicState } from "../../gameProjections";
import {
    GRANTED_MINUS10,
    GRANTED_PLUS2,
    WALKER_STATICS,
    bear,
    liliana,
    walkerBoard,
    walkerStaticsSource,
} from "./planeswalkerStatics.fixture";

const onBattlefield = (state: GameState, playerIdx: number, id: string) =>
    state.players[playerIdx]!.battlefield.find((c) => c.id === id);

const offered = (state: GameState) =>
    enumerateMoves(state, "p1").flatMap((m) =>
        m.kind === "activate-ability" && m.cardInstanceId === "pw"
            ? [m.abilityId]
            : []
    );

describe("granted loyalty ability (CR 613.1f / 606, issue #7199)", () => {
    it("is offered on a walker you control and pays its +2 on the walker (CR 606.4)", () => {
        withTemporaryDefinition(WALKER_STATICS, () => {
            const state = walkerBoard({
                mine: [walkerStaticsSource(), liliana("pw", "p1", 3)],
            });
            syncLayer6(state);
            expect(offered(state)).toContain(GRANTED_PLUS2);

            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "pw",
                abilityId: GRANTED_PLUS2,
            });
            expect(onBattlefield(state, 0, "pw")!.counters?.loyalty).toBe(5);
            expect(state.stack).toHaveLength(1);

            resolveTopOfStack(state);
            expect(state.players.map((p) => p.life)).toEqual([21, 19]);
        });
    });

    it("spends the walker's one activation for the turn, printed abilities included (CR 606.3)", () => {
        withTemporaryDefinition(WALKER_STATICS, () => {
            const state = walkerBoard({
                mine: [walkerStaticsSource(), liliana("pw", "p1", 3)],
            });
            syncLayer6(state);
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "pw",
                abilityId: GRANTED_PLUS2,
            });
            resolveTopOfStack(state);
            state.priorityPlayerId = "p1";

            expect(offered(state)).toEqual([]);
            expect(() =>
                activateAbilityOnState(state, {
                    playerId: "p1",
                    cardInstanceId: "pw",
                    abilityId: "liliana-veil-plus1",
                })
            ).toThrow(/already been activated/);
        });
    });

    it("is not granted to an opponent's walker, and leaves with its source", () => {
        withTemporaryDefinition(WALKER_STATICS, () => {
            const state = walkerBoard({
                mine: [walkerStaticsSource(), liliana("pw", "p1", 3)],
                theirs: [liliana("their-pw", "p2", 3)],
            });
            syncLayer6(state);
            const abilityIds = (id: string, idx: number) =>
                (
                    onBattlefield(state, idx, id)!.grantedActivatedAbilities ??
                    []
                ).map((g) => g.abilityId);
            expect(abilityIds("pw", 0)).toEqual([
                GRANTED_PLUS2,
                GRANTED_MINUS10,
            ]);
            expect(abilityIds("their-pw", 1)).toEqual([]);

            state.players[0]!.battlefield =
                state.players[0]!.battlefield.filter((c) => c.id !== "statics");
            syncLayer6(state);
            expect(offered(state)).not.toContain(GRANTED_PLUS2);
            // Still a live menu: the printed ability survives the source.
            expect(offered(state)).toContain("liliana-veil-plus1");
        });
    });

    it("refuses a granted −N the walker cannot pay, offers it once it can, and asks for its target (CR 606.6)", () => {
        withTemporaryDefinition(WALKER_STATICS, () => {
            const poor = walkerBoard({
                mine: [
                    walkerStaticsSource(),
                    liliana("pw", "p1", 3),
                    bear("bear"),
                ],
            });
            syncLayer6(poor);
            expect(offered(poor)).not.toContain(GRANTED_MINUS10);
            expect(() =>
                activateAbilityOnState(poor, {
                    playerId: "p1",
                    cardInstanceId: "pw",
                    abilityId: GRANTED_MINUS10,
                })
            ).toThrow(/Not enough loyalty/);

            const rich = walkerBoard({
                mine: [
                    walkerStaticsSource(),
                    liliana("pw", "p1", 10),
                    bear("bear"),
                ],
            });
            syncLayer6(rich);
            expect(offered(rich)).toContain(GRANTED_MINUS10);
            activateAbilityOnState(rich, {
                playerId: "p1",
                cardInstanceId: "pw",
                abilityId: GRANTED_MINUS10,
            });
            expect(rich.pendingTarget?.targetType).toBe("Creature");
        });
    });
});

describe("zero-loyalty exemption (CR 704.5i, issue #7199)", () => {
    it("keeps a walker you control on the battlefield at 0 loyalty, visible on the wire", () => {
        withTemporaryDefinition(WALKER_STATICS, () => {
            const state = walkerBoard({
                mine: [walkerStaticsSource(), liliana("pw", "p1", 0)],
            });
            checkStateBasedActions(state);
            expect(onBattlefield(state, 0, "pw")).toBeDefined();

            const wire = projectPublicState(state, 1, "p1");
            const projected = wire.players[0]!.battlefield.find(
                (c) => c.id === "pw"
            );
            expect(projected?.counters?.loyalty).toBe(0);
        });
    });

    it("does not cover an opponent's walker", () => {
        withTemporaryDefinition(WALKER_STATICS, () => {
            const state = walkerBoard({
                mine: [walkerStaticsSource()],
                theirs: [liliana("their-pw", "p2", 0)],
            });
            checkStateBasedActions(state);
            expect(onBattlefield(state, 1, "their-pw")).toBeUndefined();
            expect(state.players[1]!.graveyard.map((c) => c.id)).toContain(
                "their-pw"
            );
        });
    });

    it("stops applying once the source leaves (CR 611.3a): the next check puts the walker in the graveyard", () => {
        withTemporaryDefinition(WALKER_STATICS, () => {
            const state = walkerBoard({
                mine: [walkerStaticsSource(), liliana("pw", "p1", 0)],
            });
            checkStateBasedActions(state);
            expect(onBattlefield(state, 0, "pw")).toBeDefined();

            state.players[0]!.battlefield =
                state.players[0]!.battlefield.filter((c) => c.id !== "statics");
            checkStateBasedActions(state);
            expect(onBattlefield(state, 0, "pw")).toBeUndefined();
        });
    });
});
