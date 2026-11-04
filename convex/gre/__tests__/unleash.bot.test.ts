// CR 702.98a — the Bot's seam on Unleash: the as-enters prompt is a search
// decision with both answers on the table, so the tree weighs a bigger body
// against the lost block, instead of a fixed policy picking for it.
import { describe, expect, it } from "vitest";
import {
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { choiceCandidates } from "../ai/choiceCandidates";
import { resolveTopOfStack } from "../state";

const UNLEASHED: CardDefinition = {
    id: "unleash-bot-test-creature",
    name: "Unleash Bot Tester",
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    staticAbilities: ["unleash"],
};

describe("Unleash (CR 702.98a), Bot choice surface", () => {
    it("the search enumerates accepting and declining", () => {
        withTemporaryDefinition(UNLEASHED, () => {
            const state = makeState({
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                players: [makePlayer("p1"), makePlayer("p2")],
            });
            pushSpell(state, UNLEASHED.id, "p1");
            resolveTopOfStack(state);

            const candidates = choiceCandidates(
                state,
                state.pendingChoices![0]
            );
            expect(candidates.map((c) => c.key).join(" ")).toMatch(/accept/);
            expect(candidates.map((c) => c.key).join(" ")).toMatch(/decline/);
        });
    });
});
