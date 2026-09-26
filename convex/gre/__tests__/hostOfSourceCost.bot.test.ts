// Bot reachability for a `hostOfSource` sacrifice cost — "Sacrifice enchanted
// creature" (Bloodfire Infusion, issue #4319). The move enumerator's payability
// pre-check builds its OWN `FilterMatchContext`; a host-relative filter fails
// closed without `selfAttachedToId`, so a forgotten thread would make the Bot
// silently never offer the activation (no suite would notice). Asserts the
// enumerator offers it exactly while the Aura has a host on the battlefield.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { bloodfireInfusion } from "../../cards/sets/apc/red";
import { grizzlyBears } from "../../cards/sets/lea";
import { enumerateMoves } from "../moves";

function offered(attachedTo: string | undefined): boolean {
    const aura = makeInstance(bloodfireInfusion.id, {
        id: "aura",
        controllerId: "p1",
        ownerId: "p1",
        ...(attachedTo ? { attachedTo } : {}),
    });
    const host = makeInstance(grizzlyBears.id, {
        id: "host",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [aura, host],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
            makePlayer("p2"),
        ],
    });
    return enumerateMoves(state, "p1").some(
        (m) =>
            m.kind === "activate-ability" &&
            m.cardInstanceId === "aura" &&
            m.abilityId === "bloodfire-infusion-sweep"
    );
}

describe("Bot enumerates a hostOfSource sacrifice cost (issue #4319)", () => {
    it("offers the activation while the Aura enchants a creature it can sacrifice", () => {
        expect(offered("host")).toBe(true);
    });

    it("does not offer it once the Aura has no host to sacrifice", () => {
        expect(offered(undefined)).toBe(false);
        expect(offered("gone")).toBe(false);
    });
});
