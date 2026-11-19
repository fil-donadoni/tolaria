/**
 * Issue #9869 — the flip-walker template: "you may exile this, then return it
 * to the battlefield transformed" (CR 712.2 / 400.7), answered as a cost-free
 * may-pay (CR 608.2d). The Bot declined it because the planeswalker that
 * returns was priced at the blind `base + MV` floor (issue #9973): the flip
 * read as giving a 1/2 away for an empty permanent.
 *
 * The positions are the blade entries' own; this file names the mechanism.
 */

import { describe, expect, it } from "vitest";
import { buildBladeState, findBladeScenario, runBladeScenario } from "../blade";
import { applyMoveInSearch } from "../../search";
import { cardValue } from "../../evaluate";
import { loyaltyArmValueById } from "../../cardValue";
import { nonCreatureBodyRaw } from "../../creatureBody";
import { manaValue } from "../../constants";
import { getInstanceManaCost } from "../../../cards";

const ACCEPT =
    "flip-walker may-pay: exiles the front face into its planeswalker when no creature can attack it";

function anchor() {
    const entry = findBladeScenario(ACCEPT);
    if (!entry) throw new Error(`No blade entry "${ACCEPT}"`);
    return entry;
}

describe("flip-walker may-pay (issue #9869)", () => {
    /** CR 712.2 / 306.5b — the walker the real accept returns carries its
     *  back face's loyalty arm in its worth, above the `base + MV` floor. */
    it("prices the planeswalker the flip returns above the blind mana-value floor", () => {
        const state = buildBladeState(anchor());
        const me = state.players[0];
        applyMoveInSearch(state, me.id, { kind: "may-pay", accept: true });
        const walker = me.battlefield.find((c) =>
            c.types.includes("Planeswalker")
        );
        if (!walker) throw new Error("the accept returned no planeswalker");
        const arm = loyaltyArmValueById(String(walker.card.id));
        expect(arm).toBeGreaterThan(0);
        const floor = nonCreatureBodyRaw(
            manaValue(getInstanceManaCost(walker))
        );
        expect(cardValue(state, walker)).toBeGreaterThanOrEqual(floor + arm);
    });

    it("accepts the flip on the reported board through the real search", () => {
        const result = runBladeScenario(anchor());
        expect(result.failureMessage).toBe("");
    }, 300_000);
});
