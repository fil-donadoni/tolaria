/**
 * An "any number" look-and-keep (CR 401.4) whose window holds no
 * keep-eligible card raises no choice (issue #9118): the looked-at cards go
 * straight to the bottom, so there is no empty keep for the Bot to submit.
 * The blade entry "look-distribute: Torsten keeps every eligible card past the
 * hand size" is the other half: a window with eligible cards is kept whole.
 */

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { buildPositionFromSpec } from "../blade/build";

const idOf = (c: { card: unknown }) => (c.card as { id?: string }).id;

describe("look-distribute with no eligible card (CR 401.4, issue #9118)", () => {
    it("Torsten's ETB over a window of seven noncreature, nonland cards raises no keep", () => {
        const s = buildPositionFromSpec(
            {
                cards: [
                    {
                        name: "Torsten, Founder of Benalia",
                        owner: "me",
                        zone: "hand",
                    },
                    {
                        name: "Forest",
                        owner: "me",
                        zone: "battlefield",
                        count: 4,
                    },
                    {
                        name: "Plains",
                        owner: "me",
                        zone: "battlefield",
                        count: 3,
                    },
                    {
                        name: "Giant Growth",
                        owner: "me",
                        zone: "library",
                        count: 7,
                    },
                    {
                        name: "Savannah Lions",
                        owner: "me",
                        zone: "library",
                        count: 10,
                    },
                    {
                        name: "Forest",
                        owner: "opp",
                        zone: "library",
                        count: 20,
                    },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 7,
                libraryCount: 0,
            },
            [
                { kind: "cast", card: "Torsten, Founder of Benalia", by: "me" },
                { kind: "resolve-top" },
                { kind: "resolve-top" },
            ],
            "torsten, no eligible card"
        );
        expect(
            (s.pendingChoices ?? []).filter((c) => c.kind === "look-distribute")
        ).toEqual([]);
        // The whole window went to the bottom; nothing reached the hand.
        const me = s.players.find((p) => p.id === s.activePlayerId)!;
        const growth = getCardByName("Giant Growth").id;
        expect(me.hand.filter((c) => idOf(c) === growth)).toHaveLength(0);
        expect(me.library.slice(-7).every((c) => idOf(c) === growth)).toBe(
            true
        );
    });
});
