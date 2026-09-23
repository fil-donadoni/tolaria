// The coin-flip series Grammar Rule refuses its neighbours (CR 705.2, issue
// #3813, ADR 0144 / ADR 0105 § 2 — fail-closed). The positive form is the
// Squee's Revenge golden fixture (`grammar/fixtures.ts`); every case below is
// a variation of that text that must NOT compile, because each would lower to
// an effect the card does not print.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./fixtures";

const CHOOSE = "Choose a number.";
const SERIES =
    "Flip a coin that many times or until you lose a flip, whichever comes first.";
const PAYOFF = "If you win all the flips, draw two cards for each flip.";

function sorcery(oracleText: string) {
    return oracleCard({
        name: "Test Series",
        manaCost: "{1}{U}{R}",
        typeLine: "Sorcery",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("coin-flip series grammar (CR 705.2, issue #3813)", () => {
    it("compiles the printed trio", () => {
        expect(
            compileCard(sorcery(`${CHOOSE} ${SERIES} ${PAYOFF}`)).state
        ).not.toBe("unparsed");
    });

    it.each([
        ["the trio out of order", `${SERIES} ${CHOOSE} ${PAYOFF}`],
        ["a series with no nomination", `${SERIES} ${PAYOFF}`],
        ["a payoff with no series", `${CHOOSE} ${PAYOFF}`],
        ["a series with no payoff", `${CHOOSE} ${SERIES}`],
        ["a lone nomination", `${CHOOSE} Draw a card.`],
        [
            "a payoff that is not a draw",
            `${CHOOSE} ${SERIES} If you win all the flips, you gain two life for each flip.`,
        ],
        [
            "a payoff drawn by another player",
            `${CHOOSE} ${SERIES} If you win all the flips, target player draws two cards for each flip.`,
        ],
        [
            'a pending "Choose a color." the series would jump ahead of',
            `Choose a color. ${CHOOSE} ${SERIES} ${PAYOFF} Creatures you control gain protection from the chosen color until end of turn.`,
        ],
        [
            "the voluntary-stop wording (Fiery Gambit's axis)",
            `${CHOOSE} Flip a coin until you lose a flip or choose to stop flipping. ${PAYOFF}`,
        ],
    ])("refuses %s", (_label, text) => {
        expect(compileCard(sorcery(text)).state).toBe("unparsed");
    });
});
