// The compiler's MODAL DOUBLE-FACED layout gate (CR 712.3 / 712.12,
// ADR 0122 §5).
//
// `layout: "modal_dfc"` is two classes, and the Scryfall string cannot tell
// them apart. Measured against the vendored corpus, 100 cards carry it: 60
// with a LAND back face, reached by CR 712.12's land play and modelled here,
// and 40 with a spell or nonland permanent back face, reached by CR 712.11b's
// second cast option and unbuilt (ADR 0122 §6). Admitting the string would
// admit both, so the gate is a TYPE test on the back face's type line —
// exactly the class CR 712.12 names, with no card-name list to rot.
//
// Asserted on SYNTHESIZED rows in the shape `scripts/oracle-corpus.ts` reduces
// the real ones to, because the corpus cache is gitignored and a test that
// needed it would be skipped in every fresh worktree — the same arrangement
// `splitLayout.test.ts` uses. What the corpus itself proves is in the
// lockfile, where the refusal reason appears verbatim.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { goldOracleCard } from "../gold";
import type { CardDefinition } from "../../cards/types";
import type { OracleCard, OracleFace } from "../types";

function modalCard(faces: [OracleFace, OracleFace]): OracleCard {
    return {
        oracleId: "00000000-0000-0000-0000-000000000002",
        name: faces.map((f) => f.name).join(" // "),
        manaCost: "",
        typeLine: faces.map((f) => f.typeLine).join(" // "),
        oracleText: "",
        layout: "modal_dfc",
        faces,
    };
}

const LAND_BACK: OracleFace = {
    name: "Quiet Meadow",
    manaCost: "",
    typeLine: "Land",
    oracleText: "{T}: Add {W}.",
};

const reasonsOf = (card: OracleCard): string => {
    const outcome = compileCard(card);
    return outcome.state === "unparsed"
        ? outcome.gaps.map((g) => g.reason).join(" | ")
        : `(${outcome.state})`;
};

describe("CR 712.12 — a LAND-backed modal double-faced card is ADMITTED", () => {
    const card = modalCard([
        {
            name: "Quiet Scholar",
            manaCost: "{1}{W}",
            typeLine: "Creature — Human Wizard",
            oracleText: "Flying",
            power: "2",
            toughness: "1",
        },
        LAND_BACK,
    ]);

    it("compiles the FRONT face as the card and the back face as a modal backFace", () => {
        const outcome = compileCard(card);
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        // CR 712.8a — the card's own characteristics ARE the front face's,
        // with nothing derived and nothing combined.
        expect(outcome.definition.name).toBe("Quiet Scholar");
        expect(outcome.definition.types).toEqual(["Creature"]);
        expect(outcome.definition.manaCost).toEqual({ X: 1, W: 1 });
        // CR 712.3 — the back face is the modal kind, which is what routes it
        // to the registered twin rather than transform's id codec.
        expect(outcome.definition.backFace?.kind).toBe("modal");
        expect(outcome.definition.backFace?.name).toBe("Quiet Meadow");
        expect(outcome.definition.backFace?.types).toEqual(["Land"]);
        expect(
            outcome.definition.backFace?.activatedAbilities?.[0]?.useStack
        ).toBe(false);
    });

    it("round-trips through goldOracleCard, so Guard C compares the whole card", () => {
        const outcome = compileCard(card);
        if (outcome.state === "unparsed") throw new Error("expected a card");
        const rebuilt = goldOracleCard({
            id: "00000000-0000-0000-0000-000000000002",
            rarity: "rare",
            ...outcome.definition,
        } as CardDefinition);
        expect(rebuilt.layout).toBe("modal_dfc");
        expect(rebuilt.faces?.map((f) => f.name)).toEqual([
            "Quiet Scholar",
            "Quiet Meadow",
        ]);
        // The rebuilt input compiles back to the same definition — without
        // this leg a modal card would round-trip as a `"normal"` front face
        // and silently drop the land the layout exists for.
        const again = compileCard(rebuilt);
        expect(again.state).not.toBe("unparsed");
        if (again.state === "unparsed") return;
        expect(again.definition.backFace).toEqual(outcome.definition.backFace);
    });
});

describe("CR 712.11b — a NONLAND-backed modal double-faced card is refused", () => {
    it("refuses a creature back face (the whole 40-card class), naming the rule", () => {
        const reasons = reasonsOf(
            modalCard([
                {
                    name: "Quiet Scholar",
                    manaCost: "{1}{W}",
                    typeLine: "Creature — Human Wizard",
                    oracleText: "Flying",
                    power: "2",
                    toughness: "1",
                },
                {
                    name: "Loud Scholar",
                    manaCost: "{3}{W}",
                    typeLine: "Creature — Human Wizard",
                    oracleText: "Flying",
                    power: "4",
                    toughness: "4",
                },
            ])
        );
        expect(reasons).toContain("712.11b");
        expect(reasons).toContain("out of scope");
    });

    it("still refuses the LAYOUT when a face count is wrong", () => {
        const card = modalCard([LAND_BACK, LAND_BACK]);
        expect(reasonsOf({ ...card, faces: [LAND_BACK] })).toContain(
            "needs exactly two faces"
        );
    });
});

describe("CR 712.8f — a back face the record cannot carry is REFUSED, never truncated", () => {
    it("refuses a land face whose text compiled to something a CardBackFace has no field for", () => {
        const reasons = reasonsOf(
            modalCard([
                {
                    name: "Quiet Scholar",
                    manaCost: "{1}{W}",
                    typeLine: "Creature — Human Wizard",
                    oracleText: "Flying",
                    power: "2",
                    toughness: "1",
                },
                {
                    name: "Trigger Meadow",
                    manaCost: "",
                    typeLine: "Land",
                    oracleText:
                        "When this land enters, draw a card.\n{T}: Add {W}.",
                },
            ])
        );
        // Either the grammar cannot read the line at all (a gap, which is the
        // honest answer) or it reads it into a triggered ability the record
        // has no field for — both refuse the card, and neither ships a land
        // missing one of its abilities.
        expect(reasons).not.toBe("(ready)");
        expect(reasons).not.toBe("(quarantine)");
    });
});
