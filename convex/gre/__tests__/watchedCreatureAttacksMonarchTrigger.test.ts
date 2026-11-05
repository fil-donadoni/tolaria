// CR 508.3a / 603.7b / 725 (issue #7202) — the instance-scoped repeating
// `this-turn-watched-creature-attacks-monarch` delayed trigger, driven through
// the real declaration choke point (`emitAttackersDeclaredEvents`) from an
// Effect Script shaped like Okoye, Mighty and Adored's beginning-of-combat body.
//
// Claims no Op test makes: only the WATCHED creature, attacking the PLAYER who
// is the monarch as attackers are declared, fires it; a planeswalker attack, an
// attacking monarch and a monarch-less game do not; it repeats across
// declarations, dies with its creature (CR 400.7) and expires at cleanup
// (CR 514.2); the grant its body makes crosses `projectPublicState`.
import { describe, expect, it } from "vitest";
import { getDefinition, withTemporaryDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import type { CardDefinition, GameEvent } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { emitAttackersDeclaredEvents, finalizeCleanup } from "../phases";
import { becomeMonarch, resolveTopOfStack, type GameState } from "../state";
import { collectTriggers } from "../triggers";

/** Grizzly Bears — a plain creature with no combat keyword of its own. */
const BEARS = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");

const WATCH = "this-turn-watched-creature-attacks-monarch";

const ARM_WATCH: CardDefinition = {
    ...BEARS,
    id: "arm-attacks-monarch-watch",
    name: "Arm Attacks-Monarch Watch",
    types: ["Sorcery"],
    effects: [
        {
            op: "delayedTrigger",
            timing: WATCH,
            oracleText:
                "Whenever that creature attacks the monarch this turn, it gains double strike and trample until end of turn.",
            watch: { target: 0 },
            capture: { $c: { target: 0 } },
            effects: [
                {
                    op: "grantAbility",
                    ability: "double strike",
                    target: { ref: "$c" },
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "grantAbility",
                    ability: "trample",
                    target: { ref: "$c" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

function armedBoard(): GameState {
    const state = makeState({
        activePlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(BEARS.id, {
                        id: "watched",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(BEARS.id, {
                        id: "other",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    pushSpell(state, ARM_WATCH.id, "p1", [
        { type: "permanent", id: "watched" },
    ]);
    resolveTopOfStack(state);
    return state;
}

function declare(
    state: GameState,
    attackerIds: string[],
    attackTargets?: Record<string, string>
): void {
    state.combat = {
        attackerIds,
        ...(attackTargets ? { attackTargets } : {}),
    } as unknown as GameState["combat"];
    emitAttackersDeclaredEvents(state);
}

const watches = (state: GameState) =>
    (state.delayedTriggers ?? []).filter((t) => t.timing === WATCH);

const fired = (state: GameState) =>
    state.stack.filter((i) => i.delayedTriggerId !== undefined);

/** Runs `body` with the arming spell registered. */
const withWatch = (body: () => void) =>
    withTemporaryDefinition(ARM_WATCH, body);

describe("attacks-the-monarch instance watch (CR 508.3a / 603.7b, issue #7202)", () => {
    it("fires when the watched creature attacks the monarch; the grant crosses the wire", () => {
        withWatch(() => {
            const state = armedBoard();
            becomeMonarch(state, "p2");
            declare(state, ["watched", "other"]);
            expect(fired(state)).toHaveLength(1);
            expect(
                projectPublicState(state, 0, "p1").stack.filter(
                    (i) => i.delayedTriggerId !== undefined
                )
            ).toHaveLength(1);
            resolveTopOfStack(state);
            const view = projectPublicState(state, 0, "p1").players[0];
            const abilitiesOf = (id: string) =>
                view.battlefield.find((c) => c.id === id)?.staticAbilities;
            // Only "that creature" — not the other attacker in the declaration.
            expect(abilitiesOf("watched")).toEqual(
                expect.arrayContaining(["double strike", "trample"])
            );
            expect(abilitiesOf("other")).not.toContain("trample");
        });
    });

    it("does not fire for another attacker in the declaration", () => {
        withWatch(() => {
            const state = armedBoard();
            becomeMonarch(state, "p2");
            declare(state, ["other"]);
            expect(fired(state)).toHaveLength(0);
        });
    });

    it("does not fire when the attacking player is the monarch", () => {
        withWatch(() => {
            const state = armedBoard();
            becomeMonarch(state, "p1");
            declare(state, ["watched"]);
            expect(fired(state)).toHaveLength(0);
        });
    });

    it("CR 725.1 — does not fire in a game with no monarch", () => {
        withWatch(() => {
            const state = armedBoard();
            expect(state.monarchId).toBeUndefined();
            declare(state, ["watched"]);
            expect(fired(state)).toHaveLength(0);
        });
    });

    it("CR 508.3a — attacking the monarch's planeswalker is not attacking the monarch", () => {
        withWatch(() => {
            const state = armedBoard();
            becomeMonarch(state, "p2");
            declare(state, ["watched"], { watched: "their-planeswalker" });
            expect(fired(state)).toHaveLength(0);
        });
    });

    it("CR 603.7b — repeats on a later declaration this turn (extra combat)", () => {
        withWatch(() => {
            const state = armedBoard();
            becomeMonarch(state, "p2");
            declare(state, ["watched"]);
            expect(fired(state)).toHaveLength(1);
            resolveTopOfStack(state);
            expect(watches(state)).toHaveLength(1);
            declare(state, ["watched"]);
            expect(fired(state)).toHaveLength(1);
        });
    });

    it("reads the monarch at the declaration, not when the watch was armed", () => {
        withWatch(() => {
            const state = armedBoard();
            becomeMonarch(state, "p1");
            becomeMonarch(state, "p2");
            declare(state, ["watched"]);
            expect(fired(state)).toHaveLength(1);
        });
    });

    it("CR 400.7 — the watch is gone once its creature leaves the battlefield", () => {
        withWatch(() => {
            const state = armedBoard();
            becomeMonarch(state, "p2");
            collectTriggers(state, [
                {
                    type: "PERMANENT_LEFT",
                    instanceId: "watched",
                    toZone: "exile",
                } as GameEvent,
            ]);
            expect(watches(state)).toHaveLength(0);
            declare(state, ["watched"]);
            expect(fired(state)).toHaveLength(0);
        });
    });

    it("CR 514.2 — expires at cleanup", () => {
        withWatch(() => {
            const state = armedBoard();
            expect(watches(state)).toHaveLength(1);
            state.phase = "CLEANUP";
            finalizeCleanup(state);
            expect(watches(state)).toHaveLength(0);
        });
    });
});
