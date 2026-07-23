import { describe, it } from "vitest";
import { buildSpellContext, applyTargetPrevention } from "../state";
import { makeInstance, makePlayer, makeState } from "../../cards/__tests__/setup";
import { grizzlyBears } from "../../cards/sets/lea/green";

function creature(id: string, power: number, toughness: number, overrides: any = {}): any {
  return { id, card: { id: `def-${id}` }, types: ["Creature"], subtypes: [], power, toughness, staticAbilities: [], controllerId: "p1", ownerId: "p1", zone: "battlefield", isTapped: false, ...overrides };
}

describe("probe", () => {
  it("infect creature", () => {
    const source = creature("toucher", 0, 0, { staticAbilities: ["infect"] });
    const state = makeState({ players: [makePlayer("p1", { battlefield: [source] }), makePlayer("p2")] });
    const item = { ...source, castById: "p1", targets: [] };
    const bear = makeInstance(grizzlyBears.id, { id: "bear", controllerId: "p2", ownerId: "p2" });
    state.players[1].battlefield.push(bear);
    console.log("PROBE prevention reduced:", applyTargetPrevention(state as any, "permanent", "bear", 2));
    const ctx = buildSpellContext(state as any, item as any);
    ctx.dealDamage({ type: "permanent", id: "bear" }, 2);
    const stBear = state.players[1].battlefield.find((c:any)=>c.id==="bear");
    console.log("PROBE stateBear===localBear:", stBear === bear);
    console.log("PROBE stateBear.counters:", JSON.stringify(stBear?.counters), "dmg:", stBear?.damageMarked, "damagedBy:", JSON.stringify(stBear?.damagedBySources));
  });
});
