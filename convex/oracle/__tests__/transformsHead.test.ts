// The "transforms into {self}" trigger head (issue #8164, CR 701.27e) and the
// compiled transform back face that carries it (CR 712.8e).
//
// The golden (Concealing Curtains) lives in `grammar/fixtures.ts`; this file
// pins what a golden cannot: the openers a corpus card has not yet brought to
// `ready`, the refusals beside the head, the optional hand pick's pairing, and
// the id agreement between the Definition Index and the expanded card.

import { describe, expect, it } from "vitest";
import { backFaceAsTokenSpec } from "../../cards/backFaceSpec";
import { expandCompiledTriggers } from "../../cards/compiledTriggers";
import { backFaceTriggerTokenId } from "../../cards/definitionIndex";
import { tokenDefinitionId } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { compileCard } from "../compile";
import { matchSelfHead } from "../grammar/shared/triggerHead";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const transformCard = (backText: string): OracleCard => ({
    oracleId: "00000000-0000-4000-8000-000000008164",
    name: "Probe Front // Probe Back",
    manaCost: "",
    typeLine: "Creature — Elf // Creature — Horror",
    oracleText: "",
    layout: "transform",
    faces: [
        {
            name: "Probe Front",
            manaCost: "{B}",
            typeLine: "Creature — Elf",
            oracleText: "{2}{B}: Transform this creature.",
            power: "1",
            toughness: "1",
        },
        {
            name: "Probe Back",
            manaCost: "",
            typeLine: "Creature — Horror",
            oracleText: backText,
            power: "3",
            toughness: "4",
            colors: ["B"],
        },
    ],
});

const PICK_BODY =
    "target opponent reveals their hand. You may choose a nonland card from it. If you do, that player discards that card, then draws a card.";

describe("'transforms into {self}' head (CR 701.27e)", () => {
    it.each([
        "When this creature transforms into {self}",
        "Whenever this creature transforms into {self}",
        "When this permanent transforms into {self}",
        "When this land transforms into {self}",
    ])("reads %s", (span) => {
        expect(matchSelfHead(span)).toEqual({ kind: "transforms" });
    });

    it.each([
        // No corpus self head prints the bare verb: CR 701.27e's "into" is what
        // the row reads.
        "When this creature transforms",
        // CR 603.2 — another permanent's flip is not this head's event.
        "Whenever a permanent you control transforms into {self}",
        "When equipped creature transforms",
    ])("refuses %s", (span) => {
        expect(matchSelfHead(span)).toBeNull();
    });
});

describe("compiled transform back face (CR 712.8e)", () => {
    const definition = (text: string): CardDefinition => {
        const outcome = compileCard(transformCard(text));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        return { ...outcome.definition, id: "probe" } as CardDefinition;
    };
    const LINE = `When this creature transforms into Probe Back, ${PICK_BODY}`;

    it("keeps the descriptor on the face, and the expansion rebuilds it there", () => {
        const raw = definition(LINE);
        expect(raw.backFace?.compiledTriggeredAbilities).toHaveLength(1);
        expect(raw.backFace?.triggeredAbilities).toBeUndefined();
        const face = expandCompiledTriggers(raw).backFace!;
        expect(face.compiledTriggeredAbilities).toBeUndefined();
        expect(face.triggeredAbilities?.[0].event).toBe(
            "PERMANENT_TRANSFORMED"
        );
    });

    it("the Definition Index keys a raw row under the id the expanded face presents", () => {
        const raw = definition(LINE);
        const presented = tokenDefinitionId(
            backFaceAsTokenSpec(expandCompiledTriggers(raw).backFace!)
        );
        expect(backFaceTriggerTokenId(raw)).toBe(presented);
    });
});

describe("optional pick from a revealed hand (CR 608.2c)", () => {
    const sorcery = (text: string) =>
        compileCard(
            oracleCard({
                name: "Probe Sorcery",
                manaCost: "{B}",
                typeLine: "Sorcery",
                oracleText: text,
            })
        ).state;

    it("refuses 'You may choose' with no 'If you do' behind it", () => {
        expect(
            sorcery(
                "Target opponent reveals their hand. You may choose a nonland card from it. That player discards that card."
            )
        ).toBe("unparsed");
    });

    it("refuses the 'If you do' gate behind a pick that cannot take nothing", () => {
        expect(
            sorcery(
                "Target opponent reveals their hand. You choose a nonland card from it. If you do, that player discards that card, then draws a card."
            )
        ).toBe("unparsed");
    });

    it("refuses the gate with no revealed hand before it", () => {
        expect(
            sorcery(
                "If you do, that player discards that card, then draws a card."
            )
        ).toBe("unparsed");
    });
});
