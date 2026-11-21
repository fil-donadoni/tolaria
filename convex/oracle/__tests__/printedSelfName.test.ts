// Issue #10429 — the self-reference marker is a grammar device; no display
// string a player reads may carry it. CR 201.5: a card's own name in its text
// refers to that object; CR 201.5c: so does its shortened name.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { printedSelfName, SELF_MARKER } from "../normalize";
import type { CompiledDefinition } from "../types";
import { oracleCard } from "./oracle.fixture";

function compiled(card: ReturnType<typeof oracleCard>): CompiledDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(JSON.stringify(outcome.gaps));
    return outcome.definition;
}

const FULCRUM = oracleCard({
    name: "The Echoverse Fulcrum",
    manaCost: "{2}",
    typeLine: "Legendary Artifact",
    oracleText:
        "When The Echoverse Fulcrum enters, draw a card, then discard a card.\n{5}, {T}, Exile The Echoverse Fulcrum: Destroy all creatures. Activate only as a sorcery.",
    power: undefined,
    toughness: undefined,
});

describe("printed self name in display strings (CR 201.5, issue #10429)", () => {
    it("an activated ability's cost names the card as printed", () => {
        expect(compiled(FULCRUM).activatedAbilities?.[0]?.oracleText).toBe(
            "{5}, {T}, Exile The Echoverse Fulcrum: Destroy all creatures. Activate only as a sorcery."
        );
    });

    it("a triggered ability's head names the card as printed", () => {
        expect(
            compiled(FULCRUM).compiledTriggeredAbilities?.[0]?.oracleText
        ).toBe(
            "When The Echoverse Fulcrum enters, draw a card, then discard a card."
        );
    });

    it("no display string anywhere in the definition keeps the marker", () => {
        expect(JSON.stringify(compiled(FULCRUM))).not.toContain(SELF_MARKER);
    });

    it("a mode's picker row and stack text name the card as printed", () => {
        const modes = compiled(
            oracleCard({
                name: "Searing Choice",
                manaCost: "{1}{R}",
                typeLine: "Instant",
                oracleText:
                    "Choose one —\n• Searing Choice deals 2 damage to any target.\n• Draw a card.",
                power: undefined,
                toughness: undefined,
            })
        ).modes;
        expect(modes?.[0]?.label).toBe(
            "Searing Choice deals 2 damage to any target"
        );
        expect(modes?.[0]?.oracleText).toBe(
            "Searing Choice deals 2 damage to any target."
        );
    });
});

describe("printedSelfName (CR 201.5c)", () => {
    const legend = (oracleText: string) =>
        oracleCard({
            name: "Silas Renn, Seeker Adept",
            typeLine: "Legendary Artifact Creature — Human",
            oracleText,
        });

    it("is the shortened name when the text uses only it", () => {
        expect(
            printedSelfName(legend("Whenever Silas Renn attacks, draw a card."))
        ).toBe("Silas Renn");
    });

    it("is the full name when the text prints it", () => {
        expect(
            printedSelfName(
                legend(
                    "Whenever Silas Renn, Seeker Adept attacks, draw a card."
                )
            )
        ).toBe("Silas Renn, Seeker Adept");
    });

    it("is the full name for a non-legendary card", () => {
        expect(
            printedSelfName(
                oracleCard({
                    name: "Grizzly Bears",
                    oracleText: "",
                })
            )
        ).toBe("Grizzly Bears");
    });
});
