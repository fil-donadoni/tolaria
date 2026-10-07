// Landwalk keywords and the graveyard-card Enchant line (CR 702.14, CR 303.4a,
// issue #4540).
//
// Landwalk is ONE registry row ("Landwalk"); its printed spellings are one
// keyword per basic land type. The vocabulary expands that row from the table
// the engine's evasion is derived from, so the three consumers of the
// vocabulary — the keyword line, "gains <keyword>" and the descriptor's
// "with <keyword>" — all read "islandwalk" / "forestwalk" / "swampwalk".
//
// Three layers:
//
//  1. GOLDENS — one per accepted form, each a real corpus row: the keyword
//     line (Lynx, River Boa), the spell slot's "gains swampwalk" in a modal
//     bullet (Funeral Charm) and as a lone sentence (Nighthaze), and the
//     graveyard-card enchant line (Animate Dead's first line).
//  2. REFUSALS — the neighbours the rule must NOT read.
//  3. VOCABULARY — the expansion is derived, and only basic landwalk.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { keywordLineSlot } from "../grammar/slots/keywordLine";
import { keywordVocabulary } from "../grammar/shared/keywordVocabulary";
import type { OracleCard } from "../types";
import { oracleCard, parseContext } from "./oracle.fixture";

const LYNX: OracleCard = {
    oracleId: "61652a2d-dfe6-4d4f-8fad-9de1960208cb",
    name: "Lynx",
    manaCost: "{1}{G}",
    typeLine: "Creature — Cat",
    oracleText:
        "Forestwalk (This creature can't be blocked as long as defending player controls a Forest.)",
    power: "2",
    toughness: "1",
    layout: "normal",
};

const RIVER_BOA: OracleCard = {
    oracleId: "86187aed-77ce-4b2d-aab0-0a8f807a9451",
    name: "River Boa",
    manaCost: "{1}{G}",
    typeLine: "Creature — Snake",
    oracleText:
        "Islandwalk (This creature can't be blocked as long as defending player controls an Island.)\n{G}: Regenerate this creature.",
    power: "2",
    toughness: "1",
    layout: "normal",
};

const NIGHTHAZE: OracleCard = {
    oracleId: "c0044283-7034-4d1d-876a-a40ea15b7cc6",
    name: "Nighthaze",
    manaCost: "{B}",
    typeLine: "Sorcery",
    oracleText:
        "Target creature gains swampwalk until end of turn. (It can't be blocked as long as defending player controls a Swamp.)\nDraw a card.",
    layout: "normal",
};

const FUNERAL_CHARM: OracleCard = {
    oracleId: "8866272d-89cb-478c-82ae-20e1d510eab7",
    name: "Funeral Charm",
    manaCost: "{B}",
    typeLine: "Instant",
    oracleText:
        "Choose one —\n• Target player discards a card.\n• Target creature gets +2/-1 until end of turn.\n• Target creature gains swampwalk until end of turn. (It can't be blocked as long as defending player controls a Swamp.)",
    layout: "normal",
};

function compiled(card: OracleCard): Record<string, unknown> | undefined {
    const result = compileCard(card);
    expect(result.state).toBe("ready");
    return result.state === "ready"
        ? (sortKeys(result.definition) as Record<string, unknown>)
        : undefined;
}

describe("landwalk keyword line (CR 702.14)", () => {
    it("reads forestwalk (Lynx)", () => {
        expect(compiled(LYNX)).toEqual(
            sortKeys({
                name: "Lynx",
                types: ["Creature"],
                subtypes: ["Cat"],
                manaCost: { X: 1, G: 1 },
                power: 2,
                toughness: 1,
                oracleText: LYNX.oracleText,
                staticAbilities: ["forestwalk"],
            })
        );
    });

    it("reads islandwalk beside another line (River Boa)", () => {
        const def = compiled(RIVER_BOA);
        expect(def?.staticAbilities).toEqual(["islandwalk"]);
        expect(def?.activatedAbilities).toHaveLength(1);
    });

    it.each([
        "plainswalk",
        "islandwalk",
        "swampwalk",
        "mountainwalk",
        "forestwalk",
    ])("reads %s through the keyword line", (name) => {
        const run = keywordLineSlot.run(name, parseContext());
        expect(run.ok).toBe(true);
    });
});

describe("gains a landwalk keyword (CR 702.14)", () => {
    it("reads a lone sentence (Nighthaze)", () => {
        const def = compiled(NIGHTHAZE);
        expect(def?.effects).toEqual([
            {
                op: "grantAbility",
                target: { target: 0 },
                ability: "swampwalk",
                duration: { phase: "end-of-turn" },
            },
            expect.objectContaining({ op: "draw" }),
        ]);
        expect(def?.targetRequirement).toEqual({ type: "Creature", count: 1 });
    });

    it("reads a modal bullet (Funeral Charm)", () => {
        const def = compiled(FUNERAL_CHARM);
        expect(JSON.stringify(def)).toContain('"ability":"swampwalk"');
    });
});

describe("landwalk refusals", () => {
    const ctx = parseContext();

    it.each([
        ["Snow swampwalk", "snow landwalk has no fixture"],
        ["Legendary landwalk", "supertype landwalk has no fixture"],
        ["Desertwalk", "non-basic landwalk has no fixture"],
        ["Islandwalk, islandwalk", "the same keyword twice"],
    ])("refuses %s (%s)", (line) => {
        expect(keywordLineSlot.run(line, ctx).ok).toBe(false);
    });

    it("refuses a gained landwalk with another duration", () => {
        const card = oracleCard({
            typeLine: "Sorcery",
            oracleText: "Target creature gains swampwalk.",
            power: undefined,
            toughness: undefined,
        });
        expect(compileCard(card).state).not.toBe("ready");
    });
});

describe("landwalk vocabulary", () => {
    it("is derived from the registry row, one spelling per basic type", () => {
        const vocabulary = keywordVocabulary();
        for (const name of [
            "plainswalk",
            "islandwalk",
            "swampwalk",
            "mountainwalk",
            "forestwalk",
        ]) {
            const keyword = vocabulary.get(name);
            expect(keyword?.registryId).toBe("landwalk");
            expect(keyword?.ability).toBe(name);
            expect(keyword?.status).toBe("implemented");
        }
    });
});

describe("Enchant creature card in a graveyard (CR 702.5a, CR 303.4a)", () => {
    const ctx = parseContext();

    it("reads the graveyard-card target as Animate Dead's own requirement", () => {
        const run = keywordLineSlot.run(
            "Enchant creature card in a graveyard",
            ctx
        );
        expect(run.ok).toBe(true);
        if (!run.ok) return;
        expect(run.value).toEqual({
            kind: "enchant",
            requirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "any",
            },
        });
    });

    it.each([
        ["Enchant creature card in your graveyard", "your graveyard only"],
        ["Enchant creature card in exile", "no other zone"],
        ["Enchant nonblack creature card in a graveyard", "a colour filter"],
        ["Enchant Zombie creature card in a graveyard", "a subtype filter"],
        ["Enchant card in a graveyard", "no type"],
        ["Enchant creature cards in a graveyard", "plural"],
    ])("refuses %s (%s)", (line) => {
        expect(keywordLineSlot.run(line, ctx).ok).toBe(false);
    });
});
