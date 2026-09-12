// CR 106.4 / 106.6 (issue #3460, PRD #3397) — the BEHAVIOURAL half of the
// scenario spec's floating mana: what the rebuilt position actually lets the
// judged seat CAST. The round trip (lowering, the clear, the reported
// instance-keyed unit) is asserted beside the rest of the builder's tests in
// `scenarioBuilder.test.ts`.
//
// It lives in the bot suite because it reads the candidate list through
// `candidateMoves` — the verdict quiz's own enumeration, and a bot-only module
// (`bot-suite-boundary.test.ts`): the app suite loses the CPU race on those.
//
// Reading the pool back would prove nothing. A seeded pool that no enumeration
// consults is exactly the failure this widening exists to close: the quiz
// compares CANDIDATE LISTS, so the only assertion that counts is whether the
// move the mana pays for is offered.

import { describe, expect, it } from "vitest";
import { buildStateFromScenario } from "../scenarioBuilder";
import { makeState } from "../../cards/__tests__/setup";
import { candidateMoves } from "../ai/verdicts/candidates";
import { giantGrowth, grizzlyBears } from "../../cards/sets/lea/green";
import type { GameState } from "../state";
import type { ScenarioSpec } from "../../debugScenarioSpec";

/** A board with NO mana source of its own: a creature and an instant in hand,
 *  an opposing creature so the instant has a legal target (CR 601.2c), and not
 *  a single land. Every cast the seat can make in it is paid for by floating
 *  mana or not at all. */
const TAPPED_OUT: ScenarioSpec = {
    cards: [
        { name: grizzlyBears.name, owner: "me", zone: "hand" },
        { name: giantGrowth.name, owner: "me", zone: "hand" },
        { name: grizzlyBears.name, owner: "opp", zone: "battlefield" },
    ],
    landCount: 0,
};

/** The DEFINITION ids the seat may cast — the instance carries the definition,
 *  never a display name, so the id is what identifies it. */
function castableDefIds(state: GameState, playerId: string): string[] {
    const hands = [...state.players[0].hand, ...state.players[1].hand];
    return candidateMoves(state, playerId)
        .filter((m) => m.kind === "cast-spell")
        .map((m) => {
            const card = hands.find((c) => c.id === m.cardInstanceId);
            return (card?.card as { id?: string })?.id ?? "?";
        });
}

describe("buildStateFromScenario — what floating mana pays for (issue #3460)", () => {
    // THE behavioural claim (CR 106.4): floating mana is spendable, so the
    // rebuilt position must offer the casts it covers. Before this widening
    // the pool was dropped, and this list came back empty on a board where the
    // Bot had two mana and a decision to make.
    it("offers a cast the floating pool can pay for, and none when the pool is empty (CR 106.4)", () => {
        const withMana = buildStateFromScenario(makeState(), {
            ...TAPPED_OUT,
            // {1}{G} for Grizzly Bears, paid G + W (generic takes any colour).
            manaPool: { me: { G: 1, W: 2 } },
        });
        expect(castableDefIds(withMana, withMana.players[0].id)).toContain(
            grizzlyBears.id
        );

        // The SAME board with no pool: the discriminating half of the pair —
        // without it, a rebuild that quietly found mana elsewhere would pass.
        const tappedOut = buildStateFromScenario(makeState(), TAPPED_OUT);
        expect(castableDefIds(tappedOut, tappedOut.players[0].id)).toEqual([]);
    });

    // CR 106.6 — the restriction is enforced at the LEGALITY gate
    // (`getLegalActions`), which is where this widening's restricted-mana claim
    // is asserted (`scenarioBuilder.test.ts`). It is deliberately not asserted
    // through the enumeration here: `planManaPayment` models the fungible pool
    // as zero-tap sources and knows nothing about the parallel restricted one,
    // so the Bot drops a cast only restricted mana can pay for even in a live
    // game that produced it (Metamorphosis, Mishra's Workshop). That is a
    // pre-existing seam, recorded in
    // `docs/findings/3460-bot-cannot-spend-restricted-mana.md` — writing an
    // expectation for today's behaviour here would pin the gap as correct.
});
