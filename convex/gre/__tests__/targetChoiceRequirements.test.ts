// Forced target choice — CR 601.2c (issue #3805).
//
// CR 601.2c: "If any effects say that an object or player must be chosen as a
// target, the player chooses targets so that they obey the maximum possible
// number of such effects without violating any rules or effects that say that
// an object or player can't be chosen as a target."
//
// The Flagbearer cycle (APC) is the shipped instance: "While an opponent is
// choosing targets as part of casting a spell they control or activating an
// ability they control, that player must choose at least one Flagbearer on the
// battlefield if able."
//
// Every announcement below is driven through the REAL registered mutations
// (`announceCast` / `selectTarget`, via `gameMutationHarness`) rather than a
// hand-built `pendingTarget`: the narrowing is written onto the pending
// selection at announcement and re-derived at acceptance, so a hand-built
// pending target would assert the derivation against a board the engine never
// produced — and would pass with the announcement seam unwired.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { coalitionFlag, standardBearer } from "../../cards/sets/apc/white";
import { grizzlyBears } from "../../cards/sets/lea/green";
import { lightningBolt, stoneRain } from "../../cards/sets/lea/red";
import { mountain } from "../../cards/sets/lea/colorless";
import { activateAbility, announceCast, selectTarget } from "../../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness";
import type { Id } from "../../_generated/dataModel";
import { beginApplyingStaticEffects, type GameState } from "../state";
import { projectPublicState } from "../../gameProjections";
import { legalActions } from "../legalActions";
import { withTemporaryDefinitionAsync } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    activeTargetChoiceRequirements,
    satisfiesTargetChoiceRequirement,
} from "../targetChoiceRequirements";

const BASE = { gameId: "game-1" as Id<"games">, playerId: "p1" };
type AnyHandler = Handler<Record<string, unknown>, void>;

/** p1 holds `spellId` with one untapped Mountain; p2 holds whatever the
 *  scenario puts on the far side. */
function board(
    spellId: string,
    opponentBattlefield: GameState["players"][number]["battlefield"]
): GameState {
    const spell = makeInstance(spellId, {
        id: "spell-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const land = makeInstance(mountain.id, {
        id: "mountain-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    return makeState({
        players: [
            makePlayer("p1", { hand: [spell], battlefield: [land] }),
            makePlayer("p2", { battlefield: opponentBattlefield }),
        ],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
}

function oppPermanent(cardId: string, id: string) {
    return makeInstance(cardId, {
        id,
        controllerId: "p2",
        ownerId: "p2",
        zone: "battlefield",
    });
}

/** Announces the cast through the real mutation and returns the state the
 *  mutation persisted. */
async function announce(state: GameState): Promise<{
    harness: ReturnType<typeof makeMutationCtx>;
    after: GameState;
}> {
    const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
    await runMutation(announceCast as unknown as AnyHandler, harness.ctx, {
        ...BASE,
        cardInstanceId: "spell-1",
    });
    return { harness, after: persisted(harness) };
}

function persisted(harness: ReturnType<typeof makeMutationCtx>): GameState {
    // `state()` expands the persisted (compacted) row — the same read the
    // next mutation makes, so nothing here sees a shape the wire never carries.
    return harness.state();
}

describe("forced target choice (CR 601.2c) — announcement", () => {
    it("narrows the pick to the Flagbearer, leaving the better target illegal", async () => {
        const state = board(lightningBolt.id, [
            oppPermanent(standardBearer.id, "bearer"),
            oppPermanent(grizzlyBears.id, "bears"),
        ]);
        const { after } = await announce(state);
        // The 2/2 is the target a burn spell wants; CR 601.2c takes it away.
        expect(after.pendingTarget?.requiredTargetChoiceIds).toEqual([
            "bearer",
        ]);
    });

    it('is absent — "if able" — when no legal target satisfies it', async () => {
        // Stone Rain targets a LAND; the Flagbearer is a creature, so no legal
        // candidate obeys the requirement and the pick is unconstrained.
        const state = board(stoneRain.id, [
            oppPermanent(standardBearer.id, "bearer"),
            oppPermanent(mountain.id, "opp-mountain"),
        ]);
        state.players[0]!.battlefield.push(
            makeInstance(mountain.id, {
                id: "mountain-2",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            }),
            makeInstance(mountain.id, {
                id: "mountain-3",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            })
        );
        const { after } = await announce(state);
        expect(after.pendingTarget).toBeDefined();
        expect(after.pendingTarget?.requiredTargetChoiceIds).toBeUndefined();
    });

    it("binds only the OPPONENTS of the requirement's controller", async () => {
        // The Flagbearer is on the CASTER's own side: CR 601.2c's clause reads
        // "while an OPPONENT is choosing targets", so p1 chooses freely.
        const state = board(lightningBolt.id, [
            oppPermanent(grizzlyBears.id, "bears"),
        ]);
        state.players[0]!.battlefield.push(
            makeInstance(standardBearer.id, {
                id: "own-bearer",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            })
        );
        const { after } = await announce(state);
        expect(after.pendingTarget?.requiredTargetChoiceIds).toBeUndefined();
    });
});

describe("forced target choice (CR 601.2c) — acceptance", () => {
    it("rejects a pick outside the narrowed set", async () => {
        const state = board(lightningBolt.id, [
            oppPermanent(standardBearer.id, "bearer"),
            oppPermanent(grizzlyBears.id, "bears"),
        ]);
        const { harness } = await announce(state);
        await expect(
            runMutation(selectTarget as unknown as AnyHandler, harness.ctx, {
                ...BASE,
                targetType: "permanent",
                targetId: "bears",
            })
        ).rejects.toThrow(/must choose a permanent an effect requires/);
    });

    it("rejects the opposing PLAYER as a target while the requirement binds", async () => {
        const state = board(lightningBolt.id, [
            oppPermanent(standardBearer.id, "bearer"),
        ]);
        const { harness } = await announce(state);
        await expect(
            runMutation(selectTarget as unknown as AnyHandler, harness.ctx, {
                ...BASE,
                targetType: "player",
                targetId: "p2",
            })
        ).rejects.toThrow(/must choose a permanent an effect requires/);
    });

    it("accepts the Flagbearer and commits the announcement", async () => {
        const state = board(lightningBolt.id, [
            oppPermanent(standardBearer.id, "bearer"),
            oppPermanent(grizzlyBears.id, "bears"),
        ]);
        const { harness } = await announce(state);
        await runMutation(selectTarget as unknown as AnyHandler, harness.ctx, {
            ...BASE,
            targetType: "permanent",
            targetId: "bearer",
        });
        const after = persisted(harness);
        // The selection closed — the cast moved on to payment or the stack.
        expect(after.pendingTarget).toBeUndefined();
    });
});

describe("forced target choice (CR 601.2c) — an ACTIVATED ability (CR 602.2b)", () => {
    // CR 602.2b: "The remainder of the process for activating an ability is
    // identical to the process for casting a spell listed in rules 601.2b-i."
    // The ability seam is its own announcement site (`gre/activation.ts`), so
    // it owes its own coverage — the cast tests above cannot see it unwired.
    const TIM_ID = "e4dc1103-7bf1-47f6-9006-d3ed9ccd7a6a"; // Prodigal Sorcerer

    it("narrows an activation's target the same way a cast's is narrowed", async () => {
        const tim = makeInstance(TIM_ID, {
            id: "tim",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            enteredOnTurn: 0,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tim] }),
                makePlayer("p2", {
                    battlefield: [
                        oppPermanent(standardBearer.id, "bearer"),
                        oppPermanent(grizzlyBears.id, "bears"),
                    ],
                }),
            ],
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await runMutation(
            activateAbility as unknown as AnyHandler,
            harness.ctx,
            {
                ...BASE,
                cardInstanceId: "tim",
                abilityId: "prodigal-sorcerer-ability",
            }
        );
        // "Any target" would happily take the opponent's face or the 2/2.
        expect(harness.state().pendingTarget?.requiredTargetChoiceIds).toEqual([
            "bearer",
        ]);
    });
});

describe("forced target choice (CR 601.2c) — a cross-slot constraint", () => {
    // CR 601.2c deferral rests on "picking a non-satisfier never removes a
    // satisfier from a later slot". `sameController` (Barrin's Spite, "two
    // target creatures controlled by the same player") breaks that: deferring
    // the first pick onto your OWN creature makes the opponent's Flagbearer
    // illegal for the second, and the announcement escapes the requirement
    // altogether. The engine fails CLOSED and binds the first pick instead.
    const SPITE: CardDefinition = {
        id: "3b1f9e47-1d2a-45f0-9d8e-2c0a6b5e4411",
        name: "Test Spite",
        rarity: "rare",
        oracleText:
            "Test Spite deals 1 damage to each of two target creatures controlled by the same player.",
        manaCost: {},
        types: ["Instant"],
        targetRequirement: {
            type: "Creature",
            count: 2,
            sameController: true,
        },
        effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
    };

    it("binds the FIRST pick rather than deferring into an unsatisfiable second", async () => {
        await withTemporaryDefinitionAsync(SPITE, async () => {
            const state = board(SPITE.id, [
                oppPermanent(standardBearer.id, "bearer"),
                oppPermanent(grizzlyBears.id, "bears"),
            ]);
            state.players[0]!.battlefield.push(
                makeInstance(grizzlyBears.id, {
                    id: "mine-1",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "battlefield",
                }),
                makeInstance(grizzlyBears.id, {
                    id: "mine-2",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "battlefield",
                })
            );
            const { harness, after } = await announce(state);
            expect(after.pendingTarget?.requiredTargetChoiceIds).toEqual([
                "bearer",
            ]);
            // …and the escape route is closed at acceptance too.
            await expect(
                runMutation(
                    selectTarget as unknown as AnyHandler,
                    harness.ctx,
                    { ...BASE, targetType: "permanent", targetId: "mine-1" }
                )
            ).rejects.toThrow(/must choose a permanent an effect requires/);
        });
    });
});

describe("forced target choice (CR 601.2c) — action space", () => {
    it("offers only the narrowed pick in `legalActions`", async () => {
        const state = board(lightningBolt.id, [
            oppPermanent(standardBearer.id, "bearer"),
            oppPermanent(grizzlyBears.id, "bears"),
        ]);
        const { after } = await announce(state);
        const targets = legalActions(after)
            .filter(
                (a): a is Extract<typeof a, { expect: "target" }> =>
                    a.expect === "target"
            )
            .map((a) => a.action)
            .filter((a) => a.kind === "select-target");
        // The action space is what a driver enumerates; an entry the mutation
        // then rejects is the freeze `gre-development.md` § Bot reachability
        // is about.
        expect(targets).toHaveLength(1);
        expect(targets[0]).toMatchObject({ target: { id: "bearer" } });
    });
});

describe("forced target choice (CR 601.2c) — what satisfies it", () => {
    it("counts a creature that is a Flagbearer only by an Aura (CR 613 layer 4)", () => {
        const bears = oppPermanent(grizzlyBears.id, "bears");
        const flag = makeInstance(coalitionFlag.id, {
            id: "flag",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            attachedTo: "bears",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bears, flag] }),
            ],
        });
        // The REAL aura-attach materialization, not a hand-set subtype list.
        beginApplyingStaticEffects(state, flag);
        expect(bears.subtypes).toContain("Flagbearer");

        const [requirement] = activeTargetChoiceRequirements(state, "p1");
        expect(requirement).toBeDefined();
        expect(
            satisfiesTargetChoiceRequirement(state, requirement!, {
                type: "permanent",
                id: "bears",
            })
        ).toBe(true);
    });

    it("collapses two sources of the same clause into ONE requirement", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [
                        oppPermanent(standardBearer.id, "bearer-1"),
                        oppPermanent(standardBearer.id, "bearer-2"),
                    ],
                }),
            ],
        });
        // Two Flagbearers say "choose at least one Flagbearer" twice; choosing
        // one obeys both, so counting them separately would demand two slots.
        expect(activeTargetChoiceRequirements(state, "p1")).toHaveLength(1);
        expect(activeTargetChoiceRequirements(state, "p2")).toHaveLength(0);
    });
});

describe("forced target choice (CR 601.2c) — wire format", () => {
    it("survives projectPublicState so the client can grey the rest out", async () => {
        const state = board(lightningBolt.id, [
            oppPermanent(standardBearer.id, "bearer"),
            oppPermanent(grizzlyBears.id, "bears"),
        ]);
        const { after } = await announce(state);
        const projected = projectPublicState(after, 1, "p1");
        expect(projected.pendingTarget?.requiredTargetChoiceIds).toEqual([
            "bearer",
        ]);
    });
});
