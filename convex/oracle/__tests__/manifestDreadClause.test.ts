// The "Manifest dread" Verb Frame (issue #2072): CR 701.62a's bare keyword
// action, lowered to the `manifestDread` Op for the controller's own library.
//
//  1. GOLDENS — real corpus cards compiled whole and compared with `sortKeys`
//     equality: the action on a spell (Manifest Dread) and as a dies trigger's
//     body (Innocuous Rat).
//  2. REFUSALS — the neighbours the sentence must NOT read: "manifest dread
//     twice" / "X times" (CR 701.40e — repeated manifests, another sentence)
//     and plain CR 701.40 manifest ("manifest the top card of your library",
//     whose registry row stays `planned`).
//
// No golden fixture: both cards graduate to `ready` with no smoke skip form to
// clear, which `goldenFixtures.test.ts` refuses. The engine half is
// `convex/gre/__tests__/manifestDread.test.ts`.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const REMINDER =
    "(Look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it's a creature card.)";

/** Manifest Dread's corpus row, verbatim (`data/oracle-corpus.json.gz`). */
const MANIFEST_DREAD: OracleCard = {
    oracleId: "df5a66d1-61f6-44d9-b464-3ee739e78dce",
    name: "Manifest Dread",
    manaCost: "{1}{G}",
    typeLine: "Sorcery",
    oracleText: `Manifest dread. ${REMINDER}`,
    layout: "normal",
};

/** Innocuous Rat's corpus row, verbatim. */
const INNOCUOUS_RAT: OracleCard = {
    oracleId: "114725ef-ac81-4d13-9153-0a303c3ce9c4",
    name: "Innocuous Rat",
    manaCost: "{1}{B}",
    typeLine: "Creature — Rat",
    oracleText: `When this creature dies, manifest dread. ${REMINDER}`,
    power: "1",
    toughness: "1",
    layout: "normal",
};

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const refused = (card: OracleCard) => compileCard(card).state === "unparsed";

const sorceryProbe = (oracleText: string) =>
    oracleCard({
        name: "Probe Sorcery",
        manaCost: "{1}{G}",
        typeLine: "Sorcery",
        oracleText,
        power: undefined,
        toughness: undefined,
    });

describe("'Manifest dread' effect clause — goldens (issue #2072)", () => {
    it("Manifest Dread: the bare action on a spell", () => {
        expect(sortKeys(compiled(MANIFEST_DREAD))).toEqual(
            sortKeys({
                name: "Manifest Dread",
                types: ["Sorcery"],
                manaCost: { X: 1, G: 1 },
                oracleText: MANIFEST_DREAD.oracleText,
                effects: [{ op: "manifestDread", player: "controller" }],
            })
        );
    });

    it("Innocuous Rat: the action as a dies trigger's body", () => {
        const def = compiled(INNOCUOUS_RAT);
        expect(def.compiledTriggeredAbilities).toHaveLength(1);
        expect(def.compiledTriggeredAbilities?.[0]?.effects).toEqual([
            { op: "manifestDread", player: "controller" },
        ]);
    });
});

describe("'Manifest dread' effect clause — refusals (issue #2072)", () => {
    it("refuses 'manifest dread twice' (CR 701.40e — repeated manifests)", () => {
        expect(refused(sorceryProbe("Manifest dread twice."))).toBe(true);
    });

    it("refuses 'manifest dread X times'", () => {
        expect(
            refused(
                oracleCard({
                    name: "Probe X",
                    manaCost: "{X}{G}",
                    typeLine: "Sorcery",
                    oracleText: "Manifest dread X times.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toBe(true);
    });

    it("refuses plain CR 701.40 manifest", () => {
        expect(
            refused(sorceryProbe("Manifest the top card of your library."))
        ).toBe(true);
    });
});
