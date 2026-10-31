// CR 712.19 / 712.4b — a meld pair's combined back face name is in the
// name-choice DOMAIN but is never a name the meld CARD has (issue #7640).

import { describe, expect, it } from "vitest";
import {
    chooseableDomainNamesOf,
    chooseableNamesOf,
    hasName,
    objectHasChosenName,
} from "../cardNames";
import { buildIndexLookups } from "../definitionIndex";
import { meldBackFaceStandIn } from "../modalDfc";
import type { CardDefinition } from "../types";

const COMBINED = "Combined Colossus";

const front: CardDefinition = {
    id: "meld-front-1",
    name: "Front Half",
    types: ["Creature"],
    manaCost: { W: 1 },
    backFace: { kind: "meld", name: COMBINED, types: ["Planeswalker"] },
} as CardDefinition;

// The melded permanent presents the `#meld` twin, whose own name is the
// combined one.
const twin: CardDefinition = {
    id: "meld-front-1#meld",
    name: COMBINED,
    types: ["Planeswalker"],
} as CardDefinition;

describe("the combined back face name — domain, not object (CR 712.19 / 712.4b)", () => {
    it("is offered by the choice domain", () => {
        expect(chooseableDomainNamesOf(front)).toEqual([front.name, COMBINED]);
        expect(buildIndexLookups([front]).chooseableNames[front.id]).toEqual([
            front.name,
            COMBINED,
        ]);
    });

    it("is NOT a name the meld card has", () => {
        expect(chooseableNamesOf(front)).toEqual([front.name]);
        expect(hasName(front, COMBINED)).toBe(false);
        expect(hasName(front, front.name)).toBe(true);
        expect(
            objectHasChosenName(
                { card: { id: front.id } },
                COMBINED,
                () => front
            )
        ).toBe(false);
    });

    it("IS a name the melded permanent has", () => {
        expect(hasName(twin, COMBINED)).toBe(true);
        expect(
            objectHasChosenName({ card: { id: twin.id } }, COMBINED, () => twin)
        ).toBe(true);
    });

    it("reads the combined face's own types for a name restriction", () => {
        const standIn = meldBackFaceStandIn(front)!;
        expect(standIn.name).toBe(COMBINED);
        expect(standIn.types).toEqual(["Planeswalker"]);
        expect(standIn.manaCost).toBeUndefined();
    });
});
