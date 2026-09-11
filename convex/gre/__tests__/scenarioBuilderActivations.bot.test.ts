// CR 602.5 (issue #3448) — the BEHAVIOURAL half of the scenario spec's
// per-turn activation tally: what the rebuilt position actually lets the
// judged seat DO.
//
// It lives in the bot suite rather than beside the rest of the builder's tests
// because it reads the legal-move list through `enumerateMoves`, which
// `bot-suite-boundary.test.ts` classifies as a bot-only module — the app suite
// loses the CPU race on those and times out. Same split as
// `scenarioBuilderTiming.bot.test.ts` (issue #3454).

import { describe, expect, it } from "vitest";
import { buildStateFromScenario } from "../scenarioBuilder";
import { makeState } from "../../cards/__tests__/setup";
import { enumerateMoves } from "../moves";
import { gaeasTouch } from "../../cards/sets/drk/green";
import type { GameState } from "../state";
import type { ScenarioSpec } from "../../debugScenarioSpec";

/** Gaea's Touch's `oncePerTurn` ability — a free ({0}) sorcery-speed
 *  activation, so on the judged seat's own main phase the ONLY thing that can
 *  withhold it from the enumerated list is the per-turn tally. */
const ABILITY = "gaeas-touch-forest";

const BOARD: ScenarioSpec = {
    cards: [{ name: gaeasTouch.name, owner: "me" }],
};

function activatedAbilityIds(state: GameState): string[] {
    return enumerateMoves(state, state.players[0].id)
        .filter((m) => m.kind === "activate-ability")
        .map((m) => (m as { abilityId?: string }).abilityId ?? "?");
}

describe("buildStateFromScenario — a spent once-per-turn ability stays spent (issue #3448)", () => {
    it("offers NO activation of an ability the spec says was already used (CR 602.5)", () => {
        const spent = buildStateFromScenario(makeState(), {
            cards: [
                {
                    ...BOARD.cards[0],
                    activations: { [ABILITY]: 1 },
                },
            ],
        });

        expect(activatedAbilityIds(spent)).not.toContain(ABILITY);

        // The control: the SAME board with the tally absent DOES offer it, so
        // the assertion above measures the tally and not some unrelated
        // illegality of this fixture (cost, timing, phase restriction).
        const fresh = buildStateFromScenario(makeState(), BOARD);
        expect(activatedAbilityIds(fresh)).toContain(ABILITY);
    });
});
