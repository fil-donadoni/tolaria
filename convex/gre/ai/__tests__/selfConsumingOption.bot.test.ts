// Issue #9592 — the option a self-consuming ability gives its permanent.
//
// A Clue's "{2}, sacrifice this token: draw a card" sacrifices its own source
// as its cost (CR 602.1a), so the standing reading skips it (issue #5145: the
// permanent and the effect it buys are ONE asset). Before this issue that left
// the Clue at a blank artifact's `base + MV` floor. `dslSelfConsumingOption`
// prices the option it holds, and `withSelfConsumingOption` lifts the
// permanent by it, never past what the activation yields.
//
// Every board is built through the REAL blade builder; the activation is
// walked forward with the engine's own `applyMoveInSearch`, so the draw on
// the board is the one a live activation produces.

import { describe, expect, it } from "vitest";
import { buildBladeState } from "../blade/runner";
import { seatPlayerId } from "../blade/matcher";
import { applyMoveInSearch, decidingPlayer } from "../../search";
import { enumerateMoves } from "../../moves";
import { evaluate } from "../../evaluate";
import { cardValueById, withSelfConsumingOption } from "../../cardValue";
import { dslSelfConsumingOption } from "../cardScriptValue";
import { tokenDefinitionId, tryGetDefinition } from "../../../cards/registry";
import { findTokenSpec } from "../../../cards/tokenCatalogue";
import { getCardByName } from "../../../cards";
import type { BladeScenario } from "../blade/types";
import type { ScenarioCard } from "../../../debugScenarioSpec";
import type { GameState } from "../../state";

/** A blank artifact token: no ability, no body, the floor a Clue used to
 *  read at. Placed through the token codec's own `token:` id. */
const BLANK = tokenDefinitionId({ name: "Artifact", types: ["Artifact"] });

function token(name: string): ScenarioCard {
    return { name, owner: "me", zone: "battlefield", token: true };
}

/** `library` names the card both libraries are made of; omitted, each holds
 *  the builder's twenty filler cards. */
function board(
    cards: ScenarioCard[],
    landCount = 0,
    library?: string
): BladeScenario {
    const libraries: ScenarioCard[] = library
        ? (["me", "opp"] as const).flatMap((owner) =>
              Array.from({ length: 20 }, () => ({
                  name: library,
                  owner,
                  zone: "library" as const,
              }))
          )
        : [];
    return {
        label: "self-consuming-option",
        spec: {
            cards: [...cards, ...libraries],
            phase: "PRECOMBAT_MAIN",
            turn: 6,
            landCount,
            libraryCount: library ? 0 : 20,
        },
        bot: "me",
        budget: { iterations: 1 },
        seeds: [1],
        tier: "must",
        expect: { forbidden: [] },
    };
}

/** The bot's score on a board holding the one token `name`. */
function scoreWith(name: string): number {
    const state = buildBladeState(board([token(name)]));
    return evaluate(state, seatPlayerId(state, "me"));
}

/** The registry definition of the catalogue token `name`. */
function tokenDef(name: string) {
    const spec = findTokenSpec(name);
    expect(spec, `token "${name}" must be in the catalogue`).toBeDefined();
    const def = tryGetDefinition(tokenDefinitionId(spec!));
    expect(def, `token "${name}" must be registered`).toBeDefined();
    return def!;
}

describe("a self-consuming ability is option worth on its permanent (issue #9592)", () => {
    it.each(["Clue", "Food", "Map"])(
        "a %s in play scores above a blank artifact token (CR 602.1a)",
        (name) => {
            expect(scoreWith(name)).toBeGreaterThan(scoreWith(BLANK));
        }
    );

    it("activating a Clue never reads as a loss: sacrifice + draw scores at least what holding it did (issue #5145's invariant)", () => {
        // The card drawn is a real one (Lightning Bolt: of the cards probed,
        // the one that reads lowest in hand), never the builder's filler: a
        // filler card reads 8 in hand, which is what that library holds, not
        // what a draw is worth.
        const state = buildBladeState(
            board([token("Clue")], 2, "Lightning Bolt")
        );
        const me = seatPlayerId(state, "me");
        const before = evaluate(state, me);
        const activation = enumerateMoves(state, me).find(
            (m) => m.kind === "activate-ability"
        );
        expect(
            activation,
            "the Clue's ability must be enumerable"
        ).toBeDefined();
        const handBefore = handSize(state, me);
        applyMoveInSearch(state, me, activation!);
        for (let i = 0; i < 4 && state.stack.length > 0; i++) {
            const owed = decidingPlayer(state);
            if (!owed) break;
            applyMoveInSearch(state, owed, { kind: "pass" });
        }
        // The activation really happened: the card was drawn, the Clue is gone.
        expect(handSize(state, me)).toBe(handBefore + 1);
        expect(
            state.players
                .find((p) => p.id === me)!
                .battlefield.some(
                    (c) => tryGetDefinition(String(c.card.id))?.name === "Clue"
                )
        ).toBe(false);
        expect(evaluate(state, me)).toBeGreaterThanOrEqual(before);
    });

    it("a mana ability reads no option: Treasure's sacrifice is the `mana` term's (CR 605.1a)", () => {
        expect(dslSelfConsumingOption(tokenDef("Treasure"))).toBeUndefined();
        expect(cardValueById(tokenDef("Treasure").id)).toBe(
            cardValueById(BLANK)
        );
    });

    it.each(["Seal of Cleansing", "Aeolipile", "Strip Mine", "Bear Trap"])(
        "%s, whose target can be a permanent it does not control, reads no option (its yield is a board question)",
        (name) => {
            expect(dslSelfConsumingOption(getCardByName(name))).toBeUndefined();
        }
    );

    it("prices the activation cost: the option nets the effect against the mana it costs", () => {
        const clue = dslSelfConsumingOption(tokenDef("Clue"))!;
        const food = dslSelfConsumingOption(tokenDef("Food"))!;
        expect(clue.ceiling).toBeGreaterThan(0);
        expect(food.ceiling).toBeGreaterThan(0);
        // A card drawn is worth more than three life for the same {2}.
        expect(clue.ceiling).toBeGreaterThan(food.ceiling);
        expect(clue.uplift).toBeLessThan(clue.ceiling);
    });

    it("a cost the reader cannot price reads no option (Blood's discard is priced; the rummage nets nothing)", () => {
        expect(dslSelfConsumingOption(tokenDef("Blood"))).toBeUndefined();
    });

    it("lifts by the uplift, never past the ceiling, never below the worth it was given", () => {
        expect(withSelfConsumingOption(8, { uplift: 10, ceiling: 30 })).toBe(
            18
        );
        expect(withSelfConsumingOption(8, { uplift: 10, ceiling: 12 })).toBe(
            12
        );
        expect(withSelfConsumingOption(40, { uplift: 10, ceiling: 12 })).toBe(
            40
        );
        expect(withSelfConsumingOption(8, undefined)).toBe(8);
    });
});

function handSize(state: GameState, playerId: string): number {
    return state.players.find((p) => p.id === playerId)!.hand.length;
}
