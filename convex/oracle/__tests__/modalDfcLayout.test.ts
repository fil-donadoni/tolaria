// The compiler's MODAL DOUBLE-FACED layout (CR 712.3 / 712.11b / 712.12,
// ADR 0122 §5).
//
// `layout: "modal_dfc"` is two classes, and the Scryfall string cannot tell
// them apart. Measured against the vendored corpus, 100 cards carry it: 60
// with a LAND back face, reached by CR 712.12's land play, and 40 with a spell
// or nonland permanent back face, reached by CR 712.11b's second cast option
// (issue #7200). Both are admitted; what either face compiled to is still
// bounded by what a `CardBackFace` can carry.
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

describe("CR 712.11b — a NONLAND-backed modal double-faced card is ADMITTED (issue #7200)", () => {
    const QUIET_SCHOLAR: OracleFace = {
        name: "Quiet Scholar",
        manaCost: "{1}{W}",
        typeLine: "Creature — Human Wizard",
        oracleText: "Flying",
        power: "2",
        toughness: "1",
    };

    it("carries a creature back face's OWN mana cost, which its cast pays", () => {
        const outcome = compileCard(
            modalCard([
                QUIET_SCHOLAR,
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
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.manaCost).toEqual({ X: 1, W: 1 });
        expect(outcome.definition.backFace?.kind).toBe("modal");
        expect(outcome.definition.backFace?.manaCost).toEqual({ X: 3, W: 1 });
        expect(outcome.definition.backFace?.power).toBe(4);
        expect(outcome.definition.backFace?.staticAbilities).toEqual([
            "flying",
        ]);
    });

    const instantBacked = modalCard([
        QUIET_SCHOLAR,
        {
            name: "Loud Bolt",
            manaCost: "{R}",
            typeLine: "Instant",
            oracleText: "Loud Bolt deals 3 damage to any target.",
        },
    ]);

    it("carries an instant back face's effect script and target", () => {
        const outcome = compileCard(instantBacked);
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        const back = outcome.definition.backFace;
        expect(back?.types).toEqual(["Instant"]);
        expect(back?.manaCost).toEqual({ R: 1 });
        expect(back?.targetRequirement).toBeDefined();
        expect(back?.effects?.[0]?.op).toBe("dealDamage");
    });

    it("round-trips an instant back face through goldOracleCard", () => {
        const outcome = compileCard(instantBacked);
        if (outcome.state === "unparsed") throw new Error("expected a card");
        const rebuilt = goldOracleCard({
            id: "00000000-0000-0000-0000-000000000002",
            rarity: "rare",
            ...outcome.definition,
        } as CardDefinition);
        expect(rebuilt.faces?.[1]?.manaCost).toBe("{R}");
        const again = compileCard(rebuilt);
        if (again.state === "unparsed") throw new Error("expected a card");
        expect(again.definition.backFace).toEqual(outcome.definition.backFace);
    });
});

describe("the modal layout gate", () => {
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
