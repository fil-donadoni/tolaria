// BIG — red card behavior tests (ADR 0043 colour split).
import { describe, it, expect } from "vitest";
import { sandstormSalvager } from "../red";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";

/** Push an activated ability onto the stack (cost assumed paid) and resolve. */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
    } as StackItem);
    resolveTopOfStack(state);
}

// The auto-generated canned-scenario smoke sweep (`scenarioGenerator.ts`)
// categorically skips every `forEach`-bearing script ("covered by the card's
// own tests") — this ability's mass counter placement + trample grant needs
// its own hand-written test per gre-development.md's forEach carve-out. The
// ETB Golem-creation trigger has NO forEach and is already covered by the
// smoke sweep (a fixed-count, fixed-controller `createToken` — no hand test
// required for that half).
describe("Sandstorm Salvager (Cube FREE residue token-maker, issue #1304)", () => {
    it("is a 1/1 with an ETB Golem-creation trigger and the mass-buff activated ability (structural shape; the ETB half's END-TO-END firing is covered by the DSL smoke sweep, effectScriptSmoke.test.ts — no forEach, fixed controller/count)", () => {
        expect(sandstormSalvager.power).toBe(1);
        expect(sandstormSalvager.toughness).toBe(1);
        expect(
            sandstormSalvager.triggeredAbilities!.some(
                (t) => t.id === "sandstorm-salvager-etb-golem"
            )
        ).toBe(true);
        const buff = sandstormSalvager.activatedAbilities!.find(
            (a) => a.id === "sandstorm-salvager-token-buff"
        )!;
        expect(buff.cost).toMatchObject({ mana: { generic: 2 }, tap: true });
    });

    it("mass-buffs creature tokens you control: +1/+1 counter + trample until end of turn (CR 122.6 / 611.2c), leaving non-tokens and opponent's tokens untouched", () => {
        const salvager = makeInstance(sandstormSalvager.id, {
            id: "salvager1",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const myToken = makeInstance(sandstormSalvager.id, {
            id: "my-token",
            controllerId: "p1",
            ownerId: "p1",
            isToken: true,
            types: ["Creature"],
            power: 1,
            toughness: 1,
        });
        const myNonToken = makeInstance(sandstormSalvager.id, {
            id: "my-real-creature",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"],
            power: 2,
            toughness: 2,
        });
        const theirToken = makeInstance(sandstormSalvager.id, {
            id: "their-token",
            controllerId: "p2",
            ownerId: "p2",
            isToken: true,
            types: ["Creature"],
            power: 1,
            toughness: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [salvager, myToken, myNonToken],
                }),
                makePlayer("p2", { battlefield: [theirToken] }),
            ],
        });
        resolveActivated(state, salvager, "sandstorm-salvager-token-buff");

        const mine = state.players[0].battlefield;
        const myTokenAfter = mine.find((c) => c.id === "my-token")!;
        const myNonTokenAfter = mine.find((c) => c.id === "my-real-creature")!;
        const theirTokenAfter = state.players[1].battlefield.find(
            (c) => c.id === "their-token"
        )!;

        expect(myTokenAfter.counters?.["+1/+1"]).toBe(1);
        expect(myTokenAfter.staticAbilities).toContain("trample");
        expect(myNonTokenAfter.counters?.["+1/+1"]).toBeUndefined();
        expect(myNonTokenAfter.staticAbilities).not.toContain("trample");
        expect(theirTokenAfter.counters?.["+1/+1"]).toBeUndefined();
        expect(theirTokenAfter.staticAbilities).not.toContain("trample");

        // Wire format: the counter and the granted keyword both survive the
        // projection (CR 122.6 / 611.2c are board-visible effects).
        const projected = projectPublicState(state, 1, "p1");
        const slimToken = projected.players[0].battlefield.find(
            (c) => c.id === "my-token"
        )!;
        expect(slimToken.counters?.["+1/+1"]).toBe(1);
        expect(slimToken.staticAbilities).toContain("trample");
    });
});
