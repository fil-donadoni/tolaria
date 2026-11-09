// Hideaway N (CR 702.75a) and the ability linked to its exile (CR 607.2a).
// "Hideaway N" is a keyword line emitting the one `staticAbilities` string the
// engine expands into the hideaway trigger; a later "put the exiled card into
// its owner's hand." names the card that trigger exiled, which the `hideaway`
// Op links to its source itself.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const HIDEAWAY =
    "Hideaway 4 (When this creature enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)";
const ENTERS_TAPPED = "This creature enters tapped.";
const PUT_INTO_HAND =
    "When this creature leaves the battlefield, put the exiled card into its owner's hand.";
const WATCHER_TEXT = `${HIDEAWAY}\n${ENTERS_TAPPED}\n${PUT_INTO_HAND}`;

function watcher(oracleText: string) {
    return compileCard(
        oracleCard({
            oracleId: "277aafa6-4270-4d24-a888-cf9e8e635d4b",
            name: "Watcher for Tomorrow",
            manaCost: "{1}{U}",
            typeLine: "Creature — Human Wizard",
            oracleText,
            power: "2",
            toughness: "1",
        })
    );
}

describe("hideaway keyword line (CR 702.75a)", () => {
    it("golden: Watcher for Tomorrow — hideaway 4 and the linked hand return", () => {
        const outcome = watcher(WATCHER_TEXT);
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.state).toBe("ready");
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Watcher for Tomorrow",
                types: ["Creature"],
                subtypes: ["Human", "Wizard"],
                manaCost: { X: 1, U: 1 },
                power: 2,
                toughness: 1,
                oracleText: WATCHER_TEXT,
                staticAbilities: ["hideaway 4"],
                entersTapped: true,
                compiledTriggeredAbilities: [
                    {
                        id: "watcher-for-tomorrow-trigger",
                        oracleText: PUT_INTO_HAND,
                        head: { kind: "left", scope: "self" },
                        effects: [
                            {
                                op: "moveZone",
                                target: { exiledWithSource: true },
                                to: "hand",
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("censuses the hideaway Op the keyword expands into", () => {
        const outcome = watcher(WATCHER_TEXT);
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.opsUsed).toContain("hideaway");
    });

    it("refuses Hideaway 0", () => {
        expect(watcher(`Hideaway 0\n${PUT_INTO_HAND}`).state).toBe("unparsed");
    });

    it("refuses two hideaway instances on one line", () => {
        expect(
            watcher(
                "Hideaway 3, hideaway 3 (When this creature enters, look at the top three cards of your library, exile one face down, then put the rest on the bottom in a random order. Then do it again.)"
            ).state
        ).toBe("unparsed");
    });

    it("refuses the hand return on a card that prints no exile", () => {
        expect(watcher(`${ENTERS_TAPPED}\n${PUT_INTO_HAND}`).state).toBe(
            "unparsed"
        );
    });

    it("refuses the hand return when a printed exile beside hideaway leaves the link unread", () => {
        const exile = "{2}, {T}: Exile target creature.";
        expect(watcher(`${WATCHER_TEXT}\n${exile}`).state).toBe("unparsed");
    });

    it("refuses the pile return beside hideaway", () => {
        const pile =
            "When this creature leaves the battlefield, each player returns to the battlefield all cards they own exiled with it.";
        expect(watcher(`${HIDEAWAY}\n${pile}`).state).toBe("unparsed");
    });
});
