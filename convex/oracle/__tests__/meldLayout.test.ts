// The compiler's MELD layout (CR 712.4 / 712.4a / 712.4b / 701.42, issue
// #7581).
//
// Scryfall reports a meld pair as THREE rows — two front cards and the
// combined back face — all `layout: "meld"`, with nothing in any one row
// saying which role it plays. `withMeldPairs` resolves the pairing from the
// meld ability's own text at corpus level; `compileCard` then lowers each
// front card with the combined back face as `backFace.kind: "meld"`, refuses
// the back-face row as a card, and refuses the meld ability's clause under a
// key of its own (claimed by issue #3341, which ships the `meld` Op).
//
// Asserted on SYNTHESIZED rows in the shape `scripts/oracle-corpus.ts` reduces
// the real ones to, because the corpus cache is gitignored — the same
// arrangement `modalDfcLayout.test.ts` uses. The pairing fixtures copy the
// real corpus wordings whose punctuation a naive split would get wrong.

import { describe, expect, it } from "vitest";
import {
    compileCard,
    MELD_CLAUSE_REASON,
    MELD_RESULT_REASON,
    MELD_UNPAIRED_REASON,
} from "../compile";
import { goldOracleCard } from "../gold";
import { withMeldPairs } from "../meldPairs";
import type { CardDefinition } from "../../cards/types";
import type { OracleCard } from "../types";

function meldRow(
    n: number,
    fields: Omit<OracleCard, "oracleId" | "layout">
): OracleCard {
    return {
        oracleId: `00000000-0000-0000-0000-00000000070${n}`,
        layout: "meld",
        ...fields,
    };
}

/** The holder: the card whose ability exiles both and melds them (CR 712.4a). */
const HOLDER = meldRow(1, {
    name: "Quiet Keeper",
    manaCost: "{2}{W}",
    typeLine: "Creature — Human Soldier",
    oracleText:
        "{5}: If you both own and control Quiet Keeper and a creature named Quiet Warden, exile them, then meld them into Quiet Colossus. Activate only as a sorcery.",
    power: "2",
    toughness: "2",
});

/** The partner: its own text plus the `(Melds with …)` reminder. */
const PARTNER = meldRow(2, {
    name: "Quiet Warden",
    manaCost: "{1}{W}",
    typeLine: "Creature — Human Soldier",
    oracleText: "Flying\n(Melds with Quiet Keeper.)",
    power: "1",
    toughness: "1",
});

/** The combined back face (CR 712.4b): no mana cost of its own. */
const RESULT = meldRow(3, {
    name: "Quiet Colossus",
    manaCost: "",
    typeLine: "Legendary Creature — Avatar",
    oracleText: "Vigilance",
    power: "9",
    toughness: "9",
});

const NORMAL: OracleCard = {
    oracleId: "00000000-0000-0000-0000-000000000799",
    name: "Grizzly Test",
    manaCost: "{1}{G}",
    typeLine: "Creature — Bear",
    oracleText: "",
    power: "2",
    toughness: "2",
    layout: "normal",
};

const byName = (cards: readonly OracleCard[], name: string): OracleCard =>
    cards.find((c) => c.name === name)!;

const reasonsOf = (card: OracleCard): string[] => {
    const outcome = compileCard(card);
    return outcome.state === "unparsed"
        ? outcome.gaps.map((g) => g.reason)
        : [`(${outcome.state})`];
};

describe("CR 712.4a — withMeldPairs resolves the pair from the meld ability's text", () => {
    const paired = withMeldPairs([NORMAL, HOLDER, PARTNER, RESULT]);

    it("stamps the combined back face on BOTH front cards", () => {
        expect(byName(paired, "Quiet Keeper").meldBack?.name).toBe(
            "Quiet Colossus"
        );
        expect(byName(paired, "Quiet Warden").meldBack?.name).toBe(
            "Quiet Colossus"
        );
        expect(byName(paired, "Quiet Warden").meldBack?.power).toBe("9");
    });

    it("marks the combined back face as a result, never a front card", () => {
        const result = byName(paired, "Quiet Colossus");
        expect(result.meldResult).toBe(true);
        expect(result.meldBack).toBeUndefined();
    });

    it("passes a row of any other layout through as the same object", () => {
        expect(paired[0]).toBe(NORMAL);
    });

    it("reads a name holding a comma and a sentence running on past it", () => {
        // Titania, Voice of Gaea / Argoth, Sanctum of Nature and Mishra,
        // Claimed by Gix: a split on "," or "." would cut both names short.
        const holder = meldRow(4, {
            name: "Quiet, Voice of Test",
            manaCost: "{1}{G}",
            typeLine: "Legendary Creature — Elemental",
            oracleText:
                "At the beginning of your upkeep, if you both own and control Quiet, Voice of Test and a land named Argent, Sanctum of Test, exile them, then meld them into Quiet, Test Incarnate. It enters tapped.",
            power: "3",
            toughness: "3",
        });
        const partner = meldRow(5, {
            name: "Argent, Sanctum of Test",
            manaCost: "",
            typeLine: "Land",
            oracleText: "{T}: Add {G}.",
        });
        const result = meldRow(6, {
            name: "Quiet, Test Incarnate",
            manaCost: "",
            typeLine: "Legendary Creature — Avatar",
            oracleText: "Trample",
            power: "6",
            toughness: "6",
        });
        const out = withMeldPairs([holder, partner, result]);
        expect(byName(out, "Argent, Sanctum of Test").meldBack?.name).toBe(
            "Quiet, Test Incarnate"
        );
        expect(byName(out, "Quiet, Test Incarnate").meldResult).toBe(true);
    });

    it("leaves a meld card with no counterpart in the corpus unstamped", () => {
        const out = withMeldPairs([HOLDER, RESULT]);
        expect(byName(out, "Quiet Keeper").meldBack).toBeUndefined();
        expect(byName(out, "Quiet Colossus").meldResult).toBeUndefined();
    });
});

describe("CR 712.4 — a meld front card is ADMITTED with a meld back face", () => {
    const partner = byName(
        withMeldPairs([HOLDER, PARTNER, RESULT]),
        "Quiet Warden"
    );

    it("compiles the front face as the card and the combined face as backFace", () => {
        const outcome = compileCard(partner);
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.name).toBe("Quiet Warden");
        expect(outcome.definition.manaCost).toEqual({ X: 1, W: 1 });
        expect(outcome.definition.staticAbilities).toEqual(["flying"]);
        expect(outcome.definition.backFace).toEqual({
            kind: "meld",
            name: "Quiet Colossus",
            types: ["Creature"],
            subtypes: ["Avatar"],
            supertypes: ["Legendary"],
            power: 9,
            toughness: 9,
            staticAbilities: ["vigilance"],
            oracleText: "Vigilance",
        });
    });

    it("is QUARANTINED while the Meld registry row is not implemented", () => {
        // CR 712.4b — the back face is reachable only as a melded permanent,
        // which issue #3341 builds; a `ready` half would ship a back face the
        // engine cannot turn up.
        const outcome = compileCard(partner);
        expect(outcome.state).toBe("quarantine");
        if (outcome.state !== "quarantine") return;
        expect(outcome.reasons).toContainEqual({
            kind: "planned-mechanic",
            detail: 'keyword "Meld" is not implemented in the Mechanics Registry',
        });
    });

    it("round-trips through goldOracleCard, so Guard C compares the whole card", () => {
        const outcome = compileCard(partner);
        if (outcome.state === "unparsed") throw new Error("expected a card");
        const rebuilt = goldOracleCard({
            id: partner.oracleId,
            rarity: "rare",
            ...outcome.definition,
        } as CardDefinition);
        expect(rebuilt.layout).toBe("meld");
        expect(rebuilt.meldBack?.name).toBe("Quiet Colossus");
        const again = compileCard(rebuilt);
        expect(again.state).not.toBe("unparsed");
        if (again.state === "unparsed") return;
        expect(again.definition).toEqual(outcome.definition);
    });
});

describe("CR 712.4 — refused meld rows, each under its own key", () => {
    const paired = withMeldPairs([HOLDER, PARTNER, RESULT]);

    it("refuses the meld ability's clause under the meld-action key (CR 701.42)", () => {
        expect(reasonsOf(byName(paired, "Quiet Keeper"))).toEqual([
            MELD_CLAUSE_REASON,
        ]);
    });

    it("refuses the combined back face as a card (CR 712.4b)", () => {
        expect(reasonsOf(byName(paired, "Quiet Colossus"))).toEqual([
            MELD_RESULT_REASON,
        ]);
    });

    it("refuses a meld card whose pair was never resolved", () => {
        expect(reasonsOf(PARTNER)).toEqual([MELD_UNPAIRED_REASON]);
    });

    it("refuses a back face carrying what a CardBackFace cannot hold", () => {
        const triggered = withMeldPairs([
            HOLDER,
            PARTNER,
            {
                ...RESULT,
                oracleText: "When this creature enters, draw a card.",
            },
        ]);
        const [reason] = reasonsOf(byName(triggered, "Quiet Warden"));
        expect(reason).toMatch(
            /^meld back face carries .*compiledTriggeredAbilities/
        );
    });

    it("reports the back face's own gaps on its front card", () => {
        const unread = withMeldPairs([
            HOLDER,
            PARTNER,
            { ...RESULT, oracleText: "Quiet Colossus hums an unread tune." },
        ]);
        expect(reasonsOf(byName(unread, "Quiet Warden"))).toEqual([
            "no slot consumed the line",
        ]);
    });
});
