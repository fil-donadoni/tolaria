// LCI green — per-colour card behavior tests (ADR 0043 parallel test file).
//
// Sentinel of the Nameless City is DSL-only over already-exercised Ops
// (`createToken`) behind an already-exercised multi-event trigger shape (the
// Sin, Spira's Punishment array `event`, `fin/multicolor.ts`), so the per-Op
// regime would ordinarily cover it. Two things earn this file anyway:
//
//  * The Map token's own activated ability is the FIRST token-scoped ability
//    in the catalogue that both TARGETS and carries a timing restriction, so
//    the `isTokenActivatedAbility` widening (issue #2376) has to be proven
//    end-to-end — a token ability whose `targetRequirement` were dropped in
//    synthesis would tsc-check and silently target nothing.
//  * The full path Sentinel → Map → Explore crosses GRE, game.ts (activation
//    + cost payment) and the projection, which is exactly the crossing
//    `.claude/rules/gre-development.md` requires one integration test for.

import { describe, it, expect } from "vitest";
import { sentinelOfTheNamelessCity } from "../green";
import { MAP_TOKEN_SPEC } from "../../../abilities/tokens/mapToken";
import { getCardByName, getDefinition } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    normalizeManaCost,
    getPlayer,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    buildPendingActivation,
    tryAutoCommitPendingActivation,
    assertActivationTimingLegal,
} from "../../../../game";
import { getLegalTargets } from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";

const grizzlyBears = getCardByName("Grizzly Bears");
const forest = getCardByName("Forest");
const MAP_ABILITY_ID = "map-token-sacrifice-explore";

/** Board: p1 controls Sentinel; p1's library is `libraryCardIds` (top first). */
function boardWithSentinel(libraryCardIds: string[]): {
    state: GameState;
    sentinel: CardInstanceState;
} {
    const sentinel = makeInstance(sentinelOfTheNamelessCity.id, {
        id: "sentinel",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [sentinel],
                library: libraryCardIds.map((defId, i) =>
                    makeInstance(defId, {
                        id: `lib${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    })
                ),
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 },
            }),
            makePlayer("p2"),
        ],
    });
    return { state, sentinel };
}

/** Fire Sentinel's trigger for one of its two events and resolve it. */
function resolveMapTrigger(
    state: GameState,
    sentinel: CardInstanceState,
    event: "PERMANENT_ENTERED" | "ATTACKERS_DECLARED"
): void {
    state.stack.push({
        ...sentinel,
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: "sentinel-of-the-nameless-city-map",
        triggerSourceId: sentinel.id,
        triggerEvent: (event === "PERMANENT_ENTERED"
            ? { type: "PERMANENT_ENTERED", instanceId: sentinel.id }
            : {
                  type: "ATTACKERS_DECLARED",
                  attackingPlayerId: "p1",
                  attackerIds: [sentinel.id],
              }) as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}

/** Announce + pay the Map's ability against `targetId`, leaving it on the
 *  stack. Mirrors the real activation path (`buildPendingActivation` →
 *  `tryAutoCommitPendingActivation`), so the {1}, the {T} and the
 *  "Sacrifice this token" leg are all paid the way a human's click pays them. */
function activateMap(state: GameState, mapId: string, targetId: string): void {
    const card = getPlayer(state, "p1").battlefield.find(
        (c) => c.id === mapId
    )!;
    const def = getDefinition((card.card as { id: string }).id);
    const ability = def.activatedAbilities!.find(
        (a) => a.id === MAP_ABILITY_ID
    )!;
    state.pendingActivation = buildPendingActivation({
        playerId: "p1",
        cardInstanceId: card.id,
        abilityId: ability.id,
        ability,
        manaCost: normalizeManaCost(ability.cost.mana!),
    });
    state.pendingActivation.targets = [
        { type: "permanent", id: targetId },
    ] as StackItem["targets"];
    tryAutoCommitPendingActivation(state, "p1");
}

describe("Sentinel of the Nameless City (LCI, CR 603.2 + CR 701.44)", () => {
    it("is a {2}{G} 3/4 Merfolk Warrior Scout with vigilance", () => {
        expect(sentinelOfTheNamelessCity.manaCost).toEqual({ X: 2, G: 1 });
        expect(sentinelOfTheNamelessCity.power).toBe(3);
        expect(sentinelOfTheNamelessCity.toughness).toBe(4);
        expect(sentinelOfTheNamelessCity.staticAbilities).toEqual([
            "vigilance",
        ]);
    });

    it("CR 603.2 — ONE ability answers BOTH events (enters and attacks), each creating a Map", () => {
        const { state, sentinel } = boardWithSentinel([grizzlyBears.id]);
        // ONE printed line ⇒ ONE ability, not two.
        expect(sentinelOfTheNamelessCity.triggeredAbilities).toHaveLength(1);

        resolveMapTrigger(state, sentinel, "PERMANENT_ENTERED");
        expect(
            state.players[0].battlefield.filter(
                (c) => c.isToken && c.subtypes?.includes("Map")
            )
        ).toHaveLength(1);

        resolveMapTrigger(state, sentinel, "ATTACKERS_DECLARED");
        expect(
            state.players[0].battlefield.filter(
                (c) => c.isToken && c.subtypes?.includes("Map")
            )
        ).toHaveLength(2);
    });

    it("the trigger's `matches` ignores an event about a DIFFERENT permanent", () => {
        const ability = sentinelOfTheNamelessCity.triggeredAbilities![0];
        const self = { id: "sentinel" } as Parameters<
            typeof ability.matches
        >[1];
        expect(
            ability.matches(
                {
                    type: "PERMANENT_ENTERED",
                    instanceId: "someone-else",
                } as Parameters<typeof ability.matches>[0],
                self
            )
        ).toBe(false);
        expect(
            ability.matches(
                {
                    type: "ATTACKERS_DECLARED",
                    attackingPlayerId: "p1",
                    attackerIds: ["someone-else"],
                } as Parameters<typeof ability.matches>[0],
                self
            )
        ).toBe(false);
    });
});

describe("Map token (CR 111.10) — the ability shape", () => {
    it("carries the printed cost, timing restriction and target requirement", () => {
        const ability = MAP_TOKEN_SPEC.activatedAbilities![0];
        expect(ability.oracleText).toBe(
            "{1}, {T}, Sacrifice this token: Target creature you control explores. Activate only as a sorcery."
        );
        // CR 602.1 — {1}, {T} and "Sacrifice this token" (the ability's OWN
        // source), all three legs.
        expect(ability.cost).toEqual({
            mana: { generic: 1 },
            tap: true,
            sacrifice: true,
        });
        expect(ability.useStack).toBe(true); // CR 605.1a — not a mana ability
        expect(ability.sorcerySpeedOnly).toBe(true); // CR 602.3b
        expect(ability.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            controller: "you",
        });
    });

    it("the widened token-ability surface SURVIVES token synthesis (issue #2376)", () => {
        const { state, sentinel } = boardWithSentinel([grizzlyBears.id]);
        resolveMapTrigger(state, sentinel, "PERMANENT_ENTERED");
        const map = state.players[0].battlefield.find((c) => c.isToken)!;
        const def = getDefinition((map.card as { id: string }).id);
        const ability = def.activatedAbilities!.find(
            (a) => a.id === MAP_ABILITY_ID
        )!;
        // Dropped in synthesis ⇒ the ability would target nothing and be
        // activatable at instant speed. tsc catches neither.
        expect(ability.targetRequirement).toBeDefined();
        expect(ability.sorcerySpeedOnly).toBe(true);
    });

    it("CR 115.1 — only creatures the ACTIVATOR controls are legal targets", () => {
        const { state, sentinel } = boardWithSentinel([grizzlyBears.id]);
        const theirs = makeInstance(grizzlyBears.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(theirs);
        resolveMapTrigger(state, sentinel, "PERMANENT_ENTERED");
        const map = state.players[0].battlefield.find((c) => c.isToken)!;
        const def = getDefinition((map.card as { id: string }).id);
        const ability = def.activatedAbilities!.find(
            (a) => a.id === MAP_ABILITY_ID
        )!;
        const legal = getLegalTargets(
            state,
            ability.targetRequirement!,
            map,
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("sentinel");
        expect(legal).not.toContain("theirs");
    });

    it("CR 602.3b — 'activate only as a sorcery' is refused with a non-empty stack", () => {
        const { state, sentinel } = boardWithSentinel([grizzlyBears.id]);
        resolveMapTrigger(state, sentinel, "PERMANENT_ENTERED");
        const map = state.players[0].battlefield.find((c) => c.isToken)!;
        const def = getDefinition((map.card as { id: string }).id);
        const ability = def.activatedAbilities!.find(
            (a) => a.id === MAP_ABILITY_ID
        )!;
        // A non-empty stack is never a sorcery-speed window (CR 307.5).
        state.stack.push({ ...sentinel, zone: "stack", castById: "p1" });
        expect(() =>
            assertActivationTimingLegal(state, map, ability)
        ).toThrow();
    });
});

describe("Sentinel → Map → Explore, end to end (CR 701.44)", () => {
    it("pays {1} + {T} + sacrifice, then a revealed LAND goes to hand with no counter", () => {
        const { state, sentinel } = boardWithSentinel([forest.id]);
        resolveMapTrigger(state, sentinel, "PERMANENT_ENTERED");
        const map = state.players[0].battlefield.find((c) => c.isToken)!;

        activateMap(state, map.id, "sentinel");
        // CR 602.1 — the whole cost is paid at activation: the token is gone
        // and the {1} is spent before the ability resolves.
        expect(state.players[0].battlefield.some((c) => c.id === map.id)).toBe(
            false
        );
        expect(state.players[0].manaPool.C).toBe(0);
        expect(state.stack).toHaveLength(1);

        resolveTopOfStack(state);
        expect(state.pendingChoices ?? []).toEqual([]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["lib0"]);
        const explored = state.players[0].battlefield.find(
            (c) => c.id === "sentinel"
        )!;
        expect(explored.counters?.["+1/+1"]).toBeUndefined();
    });

    it("a revealed NONLAND places a +1/+1 counter and offers the keep-or-bin choice — wire format", () => {
        const { state, sentinel } = boardWithSentinel([
            grizzlyBears.id,
            forest.id,
        ]);
        resolveMapTrigger(state, sentinel, "PERMANENT_ENTERED");
        const map = state.players[0].battlefield.find((c) => c.isToken)!;

        // WIRE FORMAT: the Map's art and its ability must reach the client
        // before it can ever be clicked. The projection carries only the
        // synthesized `card.id`; art and abilities are resolved from THAT, so
        // assert the whole path a client walks, not a fat-state field.
        const withMap = projectPublicState(state, 1, "p1");
        const slimMap = withMap.players[0].battlefield.find(
            (c) => c.id === map.id
        )!;
        expect(slimMap.subtypes).toContain("Map");
        const slimDef = getDefinition(slimMap.card.id);
        expect(slimDef.imagePrintId).toBe(MAP_TOKEN_SPEC.imagePrintId);
        expect(
            slimDef.activatedAbilities?.some((a) => a.id === MAP_ABILITY_ID)
        ).toBe(true);

        activateMap(state, map.id, "sentinel");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the choice
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("order-top");
        expect(head.playerId).toBe("p1");
        expect(head.candidateIds).toEqual(["lib0"]);
        // The revealed card is exposed to its controller as a library peek.
        expect(
            projectPublicState(state, 1, "p1").players[0].libraryPeek?.map(
                (c) => c.id
            )
        ).toEqual(["lib0"]);

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [],
            secondZoneIds: ["lib0"], // bin it
        });
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("lib0");
        expect(state.players[0].library.map((c) => c.id)).toEqual(["lib1"]);

        // WIRE FORMAT: the new counter's P/T contribution survives the
        // projection — a 3/4 with one +1/+1 counter is a 4/5.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "sentinel"
        )!;
        expect(slim.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(5);
    });
});
