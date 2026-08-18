// mh2 — multicolor BOT-side behavior (issue #2391).
//
// The bot's own view of Grist, the Hunger Tide. Two surfaces, both of which
// the CR 113.6c off-battlefield static reaches and neither of which the
// server-side card test covers:
//
//  1. LATENT WORTH of a card not in play (`gre/evaluate.ts` `cardValue`) —
//     it reads `isCreature(card)` and the instance's effective P/T, i.e. the
//     materialised off-battlefield characteristics. A Grist in hand is a 1/1
//     creature card to the bot, exactly as it is to the rules.
//  2. The +1's `aiEffects` shadow script — the ability's effect is a
//     `resolve()` closure the value model cannot walk, so without the sketch
//     the bot prices the ability at nothing. `aiEffectsGuard.bot.test.ts`
//     enforces its PRESENCE catalogue-wide; this pins that it is honest
//     (a token and a mill, the one iteration a script can express).
//
// NOT covered here, deliberately: whether the bot ENUMERATES Grist's loyalty
// abilities as legal moves. It does not — `gre/moves.ts` skips every ability
// with a `cost.loyalty`, catalogue-wide and by design, pending the bot
// planeswalker-play slice (issue #700 / ADR 0058). That gate predates this
// card and applies identically to every shipped planeswalker; asserting the
// current behaviour either way would encode a limitation as a requirement.
// See `docs/findings/2391-bot-skips-loyalty-abilities.md`.

import { describe, it, expect } from "vitest";
import { gristTheHungerTide } from "../multicolor";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { cardValue } from "../../../../gre/evaluate";
import { isCreature } from "../../../../gre/constants";
import { checkStateBasedActions } from "../../../../gre/sba";
import { isRegisteredEffectOp } from "../../../mechanicsRegistry";

describe("Grist, the Hunger Tide — bot view (issue #2391)", () => {
    it("prices a Grist in hand as a creature card, not as a bare planeswalker card", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(gristTheHungerTide.id, {
                            id: "h-grist",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                        makeInstance(grizzlyBears.id, {
                            id: "h-bears",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        checkStateBasedActions(state);

        const grist = state.players[0].hand[0];
        // The bot's creature predicate — the same one every hand/library
        // heuristic in `ai/candidateValue.ts` reads.
        expect(isCreature(grist)).toBe(true);
        // And the latent-worth term it feeds reads a real 1/1 body rather than
        // the undefined P/T of a planeswalker card.
        expect(cardValue(state, grist)).toBeGreaterThan(0);
    });

    it("gives the +1 an honest aiEffects sketch, so the ability is not AI-blind", () => {
        const plus1 = gristTheHungerTide.activatedAbilities!.find(
            (a) => a.id === "grist-the-hunger-tide-plus1"
        )!;
        // A `resolve()` ability with no `effects[]` is invisible to the value
        // model unless it carries a shadow script (issue #1519).
        expect(plus1.resolve).toBeDefined();
        expect(plus1.effects).toBeUndefined();
        const sketch = plus1.aiEffects!;
        expect(sketch.map((op) => op.op)).toEqual(["createToken", "mill"]);
        // Every Op in the sketch must be a real registered verb — a typo here
        // valuates as nothing and nothing else notices.
        for (const op of sketch) {
            expect(isRegisteredEffectOp(op.op)).toBe(true);
        }
    });
});
