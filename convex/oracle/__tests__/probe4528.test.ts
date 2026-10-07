import { it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";
const cases: [string, string, string, string][] = [
    ["Clairvoyance", "{U}", "Instant", "Look at target player's hand."],
    [
        "Telepathic Spies",
        "{2}{U}",
        "Creature — Human Wizard",
        "When this creature enters, look at target opponent's hand.",
    ],
    [
        "Glasses of Urza",
        "{1}",
        "Artifact",
        "{T}: Look at target player's hand.",
    ],
    [
        "Walker of Secret Ways",
        "{1}{U}",
        "Creature — Human Wizard",
        "Whenever this creature deals combat damage to a player, look at that player's hand.",
    ],
    [
        "Urza's Bauble",
        "{0}",
        "Artifact",
        "{T}, Sacrifice this artifact: Look at a card at random in target player's hand. You draw a card at the beginning of the next turn's upkeep.",
    ],
    [
        "Cabal Therapy",
        "{B}",
        "Sorcery",
        "Choose a nonland card name. Target player reveals their hand and discards all cards with that name.\nFlashback—Sacrifice a creature.",
    ],
    [
        "Desperate Research",
        "{X}{B}",
        "Sorcery",
        "Choose a card name other than a basic land card name. Reveal the top seven cards of your library and put all of them with that name into your hand. Exile the rest.",
    ],
    [
        "Skyship Weatherlight",
        "{4}",
        "Legendary Artifact",
        "When Skyship Weatherlight enters, search your library for any number of artifact and/or creature cards, exile them, then shuffle.\n{4}, {T}: Choose a card at random that was exiled with Skyship Weatherlight. Put that card into its owner's hand.",
    ],
];
it("probe", () => {
    for (const [name, manaCost, typeLine, oracleText] of cases) {
        const o = compileCard(
            oracleCard({
                name,
                manaCost,
                typeLine,
                oracleText,
                power: undefined,
                toughness: undefined,
            })
        );
        console.log(
            name,
            o.state,
            o.state === "unparsed" ? JSON.stringify(o.gaps).slice(0, 400) : ""
        );
    }
});
