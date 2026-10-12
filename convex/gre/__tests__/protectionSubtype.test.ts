// CR 702.16a — protection from a creature SUBTYPE (issue #2765, Shoreline
// Raider: "Protection from Kavu"). The subtype leg of the CHARACTERISTIC
// family: parsed against the CR 205.3m creature-type table, matched by the one
// `isProtectedFrom` predicate at every CR 702.16b–f consult site.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getAllCards } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { validateBlockerEligibility } from "../combat";
import {
    getProtectionQualities,
    isProtectedFromSource,
    parseProtectionQuality,
    protectionSourceView,
} from "../protection";
import {
    getLegalTargets,
    pendingTargetingSource,
    targetingSourceFromCard,
} from "../rules";
import type { CardInstanceState } from "../state";

const SHORELINE_RAIDER = "d895b3b8-2acc-4c9f-8341-f651c1255b7c"; // Merfolk, protection from Kavu
const KAVU_CHAMELEON = "f726437b-a41a-4ee9-b0ee-e09327508615"; // Kavu
const GRIZZLY_BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // Bear

function raider(controllerId = "p1"): CardInstanceState {
    return makeInstance(SHORELINE_RAIDER, {
        id: "raider",
        controllerId,
        ownerId: controllerId,
    });
}

function kavu(zone: "battlefield" | "graveyard" = "battlefield") {
    return makeInstance(KAVU_CHAMELEON, {
        id: "kavu",
        controllerId: "p2",
        ownerId: "p2",
        zone,
    });
}

describe("Shoreline Raider is catalogued with a parseable subtype quality", () => {
    it("declares 'protection from kavu' and the parser names it", () => {
        const def = (getAllCards() as CardDefinition[]).find(
            (c) => c.id === SHORELINE_RAIDER
        );
        expect(def?.staticAbilities).toEqual(["protection from kavu"]);
        expect(getProtectionQualities(raider())).toEqual([
            {
                kind: "characteristic",
                types: [],
                supertypes: [],
                subtypes: ["Kavu"],
            },
        ]);
    });

    it("CR 702.16m — case spellings parse to one quality", () => {
        expect(parseProtectionQuality("protection from Kavu")).toEqual(
            parseProtectionQuality("protection from kavu")
        );
    });
});

describe("isProtectedFrom — subtype leg (CR 702.16a)", () => {
    it("bars a Kavu permanent source", () => {
        expect(isProtectedFromSource(raider(), kavu(), false)).toBe(true);
    });

    it("must-NOT — a non-Kavu creature is not barred", () => {
        const bears = makeInstance(GRIZZLY_BEARS, { id: "bears" });
        expect(isProtectedFromSource(raider(), bears, false)).toBe(false);
    });

    it("has NO controller exception — the controller's own Kavu is barred", () => {
        const own = makeInstance(KAVU_CHAMELEON, {
            id: "own",
            controllerId: "p1",
            ownerId: "p1",
        });
        expect(isProtectedFromSource(raider("p1"), own, false)).toBe(true);
    });

    it("off-battlefield sources count — a Kavu spell and a Kavu card in a graveyard", () => {
        // CR 702.16a: "…and to any sources not on the battlefield that are of
        // that … subtype".
        expect(isProtectedFromSource(raider(), kavu(), true)).toBe(true);
        expect(isProtectedFromSource(raider(), kavu("graveyard"), false)).toBe(
            true
        );
    });

    it("reads subtypes LIVE — a layer-4 subtype grant makes a bear match", () => {
        const bears = makeInstance(GRIZZLY_BEARS, { id: "bears" });
        bears.subtypes = [...bears.subtypes, "Kavu"];
        expect(isProtectedFromSource(raider(), bears, false)).toBe(true);
    });

    it("a source view with no subtypes never matches (fails closed)", () => {
        expect(
            protectionSourceView(
                { ...kavu(), subtypes: [] } as CardInstanceState,
                false
            ).subtypes
        ).toEqual([]);
        expect(
            isProtectedFromSource(
                raider(),
                { ...kavu(), subtypes: [] } as CardInstanceState,
                false
            )
        ).toBe(false);
    });
});

describe("CR 702.16b — the offered set honours the subtype leg", () => {
    function board() {
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [raider("p1")] }),
                makePlayer("p2", {
                    battlefield: [
                        kavu(),
                        makeInstance(GRIZZLY_BEARS, {
                            id: "bears",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
    }

    function offeredTo(sourceId: string): string[] {
        const state = board();
        const source = pendingTargetingSource(state, sourceId, "ability");
        return getLegalTargets(
            state,
            { type: "Creature", count: 1 },
            source,
            "p2",
            undefined,
            [],
            undefined
        ).map((t) => t.id);
    }

    it("a Kavu source is not offered Shoreline Raider; a Bear source is", () => {
        expect(offeredTo("kavu")).not.toContain("raider");
        expect(offeredTo("bears")).toContain("raider");
    });

    it("targetingSourceFromCard carries the live subtypes", () => {
        expect(targetingSourceFromCard(kavu(), false).subtypes).toContain(
            "Kavu"
        );
    });
});

describe("CR 702.16f — a Kavu can't block Shoreline Raider", () => {
    it("a Kavu blocker is ineligible; a Bear blocks it normally", () => {
        const attacker = raider("p1");
        const bears = makeInstance(GRIZZLY_BEARS, {
            id: "bears",
            controllerId: "p2",
            ownerId: "p2",
        });
        const battlefield = [kavu(), bears];
        expect(
            validateBlockerEligibility(attacker, battlefield[0], battlefield)
                .eligible
        ).toBe(false);
        expect(
            validateBlockerEligibility(attacker, bears, battlefield).eligible
        ).toBe(true);
    });
});

describe("wire format — the verdict survives projectPublicState", () => {
    it("subtypes cross the wire so the client click gate sees the same answer", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [raider("p1")] }),
                makePlayer("p2", { battlefield: [kavu()] }),
            ],
        });
        const projected = projectPublicState(state, 1, "p2");
        const slimRaider = projected.players[0].battlefield[0];
        const slimKavu = projected.players[1].battlefield[0];
        expect(
            isProtectedFromSource(
                slimRaider as unknown as CardInstanceState,
                slimKavu as unknown as CardInstanceState,
                false
            )
        ).toBe(true);
    });
});
