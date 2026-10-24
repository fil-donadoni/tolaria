// An empty array is never a legal carried filter value (FilterDescriptor.lower
// contract): the shared `shorthandArray` normalizer lowers `[]` to `undefined`
// (filter skipped), so a requirement authoring `[]` offers and accepts exactly
// the candidates a requirement omitting the field does. Before the collapse a
// `value.some(...)` filter over `[]` rejected every candidate. CR 601.2c /
// 115.1 (targets are chosen against the requirement as written).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import type { TargetRequirement } from "../../cards/types";
import { REGISTRY, shorthandArray, type FilterKey } from "../targetFilters";
import {
    getLegalTargets,
    intrinsicPermanentTargetViolation,
    NO_TARGETING_SOURCE,
    pendingTargetFiltersFromRequirement,
} from "../rules";
import { counterspell, grizzlyBears } from "../../cards/sets/lea/index.cards";

/** Every registry key must be classified: adding a descriptor without a row
 *  is a compile error, so an array-valued one cannot dodge the guard. */
const SHAPE: Record<FilterKey, "array" | "other"> = {
    controller: "other",
    subtypeFilter: "array",
    supertypeFilter: "array",
    excludeSubtypes: "array",
    excludeSupertypes: "array",
    excludeTypes: "array",
    excludeColors: "array",
    colorFilter: "other",
    colorFilterAny: "array",
    tappedFilter: "other",
    combatRoleFilter: "array",
    combatPartnerOf: "other",
    requireAbility: "other",
    requireAbilityAny: "array",
    excludeAbility: "other",
    excludeInstanceIds: "array",
    powerFilter: "other",
    toughnessFilter: "other",
    mvFilter: "other",
    spellStackKind: "other",
    stackSourceTypeFilter: "array",
    spellTargetsInstanceIds: "array",
    spellTypeFilter: "array",
    spellExcludeTypeFilter: "array",
    spellCreaturePtFilter: "other",
    spellSingleTargetingController: "other",
    spellSingleTarget: "other",
    spellWouldDestroyLandYouControl: "other",
    spellTargetsPermanentFilter: "other",
    spellWasKicked: "other",
    playerAttackedThisTurn: "other",
    playerControlsMoreThan: "other",
    sameController: "other",
    isToken: "other",
    controlledSinceTurnStart: "other",
    attachedToFilter: "other",
};

describe("empty filter array lowers to undefined (registry-wide)", () => {
    it("classifies exactly the registry keys", () => {
        expect(Object.keys(SHAPE).sort()).toEqual(Object.keys(REGISTRY).sort());
    });

    const arrayKeys = (Object.keys(SHAPE) as FilterKey[]).filter(
        (k) => SHAPE[k] === "array"
    );

    it.each(arrayKeys)("%s: [] is skipped, never carried", (key) => {
        const req = {
            type: "creature",
            count: 1,
            [key]: [],
        } as TargetRequirement;
        expect(REGISTRY[key].lower(req)).toBeUndefined();
    });

    it("nested type lists collapse too", () => {
        const attached = REGISTRY.attachedToFilter.lower({
            type: "permanent",
            count: 1,
            attachedToFilter: { types: [] },
        } as TargetRequirement) as { types?: string[] };
        expect(attached.types).toBeUndefined();
        const witness = REGISTRY.spellTargetsPermanentFilter.lower({
            type: "spell",
            count: 1,
            spellTargetsPermanentFilter: { types: [] },
        } as TargetRequirement) as { types?: string[] };
        expect("types" in witness).toBe(false);
    });

    it("non-empty values are unchanged; a scalar is wrapped", () => {
        expect(shorthandArray(["A", "B"])).toEqual(["A", "B"]);
        expect(shorthandArray("A")).toEqual(["A"]);
        expect(shorthandArray(undefined)).toBeUndefined();
    });
});

describe("offered/accepted parity for [] vs omitted", () => {
    it("permanent kind: getLegalTargets and the intrinsic gate", () => {
        const bears = makeInstance(grizzlyBears().id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        bears.types = ["Creature"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bears] }),
                makePlayer("p2"),
            ],
        });
        const offered = (extra: Partial<TargetRequirement>) =>
            getLegalTargets(
                state,
                { type: "Creature", count: 1, ...extra } as TargetRequirement,
                NO_TARGETING_SOURCE,
                "p1"
            ).map((t) => t.id);
        const baseline = offered({});
        expect(baseline).toContain("bears");
        for (const key of [
            "subtypeFilter",
            "supertypeFilter",
            "excludeSubtypes",
            "excludeSupertypes",
            "excludeTypes",
            "excludeColors",
            "colorFilterAny",
            "combatRoleFilter",
            "requireAbilityAny",
            "excludeInstanceIds",
        ] as const) {
            expect(offered({ [key]: [] }), key).toEqual(baseline);
            expect(
                intrinsicPermanentTargetViolation(state, bears, { [key]: [] }),
                key
            ).toBeNull();
        }
    });

    it("spell kind: getLegalTargets and the carried filters", () => {
        const state = makeState();
        pushSpell(state, counterspell().id, "p2");
        const base: TargetRequirement = { type: "spell", count: 1 };
        const baseline = getLegalTargets(
            state,
            base,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(baseline).toHaveLength(1);
        for (const key of [
            "spellTypeFilter",
            "spellExcludeTypeFilter",
            "stackSourceTypeFilter",
            "spellTargetsInstanceIds",
        ] as const) {
            const req = { ...base, [key]: [] } as TargetRequirement;
            expect(
                getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1").map(
                    (t) => t.id
                ),
                key
            ).toEqual(baseline);
            expect(
                pendingTargetFiltersFromRequirement(req, undefined),
                key
            ).toEqual(pendingTargetFiltersFromRequirement(base, undefined));
        }
    });
});
