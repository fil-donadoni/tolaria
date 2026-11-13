// The colours a card supplies to a Limited mana base (issue #9334): produced
// plus fetched. A fetch land produces no mana, so the rules' "could produce"
// left it colourless and the Limited Bot never counted it as fixing.
import { describe, expect, it } from "vitest";
import { getCardByName, tryGetDefinition } from "../../cards";
import { getDefinitionProducibleColors, manaValue } from "../../gre/constants";
import { getCardColorIdentity, getPipCountsFromCost } from "../../cards/colors";
import { scoreCandidate, type CardEvalMeta } from "../botDrafter";
import {
    fetchableColors,
    fetchTargetsOf,
    landTypesOf,
    limitedSourceColors,
    resolveFetchSources,
} from "../manaSourceColors";

const def = (name: string) => tryGetDefinition(getCardByName(name).id)!;

describe("Limited mana-source colours: produced ∪ fetched (issue #9334)", () => {
    it("a fetch land naming two land subtypes supplies exactly those colours", () => {
        expect(limitedSourceColors(def("Polluted Delta"))).toEqual(["U", "B"]);
        expect(limitedSourceColors(def("Arid Mesa"))).toEqual(["W", "R"]);
    });

    it("a fetch land for any basic land supplies every colour", () => {
        expect(limitedSourceColors(def("Prismatic Vista"))).toEqual([
            "W",
            "U",
            "B",
            "R",
            "G",
        ]);
        // Put onto the battlefield tapped, then untapped: still a fetch.
        expect(limitedSourceColors(def("Fabled Passage"))).toEqual([
            "W",
            "U",
            "B",
            "R",
            "G",
        ]);
    });

    it("a producer is unchanged, and a fetch land still produces nothing by the rules", () => {
        expect(limitedSourceColors(def("Underground Sea"))).toEqual(["U", "B"]);
        expect(limitedSourceColors(def("Mox Sapphire"))).toEqual(["U"]);
        // The in-game authority (Fellwar Stone's read) is untouched.
        expect([
            ...getDefinitionProducibleColors(def("Polluted Delta")),
        ]).toEqual([]);
    });

    it("a library search that is not a land's fetches nothing", () => {
        // A tutor finds a card for the hand; a non-land puts a creature in.
        expect([...fetchableColors(def("Demonic Tutor"))]).toEqual([]);
        expect([...fetchableColors(def("Natural Order"))]).toEqual([]);
        // The very ability of a fetch land, on a creature: not a land's.
        const delta = def("Polluted Delta");
        const onACreature = {
            ...def("Grizzly Bears"),
            activatedAbilities: delta.activatedAbilities,
        };
        expect([...fetchableColors(onACreature)]).toEqual([]);
    });
});

/** The Limited card meta, as every meta builder writes it. */
function meta(name: string): CardEvalMeta {
    const d = def(name);
    return {
        cardId: d.id,
        colors: getCardColorIdentity(d),
        manaValue: manaValue(d.manaCost),
        rarity: "common",
        pips: getPipCountsFromCost(d.manaCost),
        producedColors: limitedSourceColors(d),
        landTypes: landTypesOf(d),
        fetch: fetchTargetsOf(d) ?? undefined,
    };
}

describe("a fetch land reaches the lands it can find in its collection (issue #9348)", () => {
    it("reads its targets and a dual's land types off the definition", () => {
        expect(fetchTargetsOf(def("Polluted Delta"))).toEqual({
            anyBasic: false,
            landTypes: ["Island", "Swamp"],
        });
        expect(fetchTargetsOf(def("Prismatic Vista"))).toEqual({
            anyBasic: true,
            landTypes: [],
        });
        expect(fetchTargetsOf(def("Underground Sea"))).toBeNull();
        expect(landTypesOf(def("Tropical Island"))).toEqual([
            "Forest",
            "Island",
        ]);
        expect(landTypesOf(def("Grizzly Bears"))).toEqual([]);
    });

    it("Polluted Delta beside a Tropical Island is a green source too; alone it is U/B", () => {
        const delta = meta("Polluted Delta");
        const [alone] = resolveFetchSources([delta]);
        expect(alone.producedColors).toEqual(["U", "B"]);
        const [withTropical] = resolveFetchSources([
            delta,
            meta("Tropical Island"),
        ]);
        expect(withTropical.producedColors).toEqual(["U", "B", "G"]);
        // Savannah (Forest Plains) is no Island or Swamp: out of reach.
        const [withSavannah] = resolveFetchSources([delta, meta("Savannah")]);
        expect(withSavannah.producedColors).toEqual(["U", "B"]);
    });

    it("Fixing Value: the same green-short Pool values Polluted Delta only when it holds a dual the Delta can find", () => {
        // Six green two-drops; one green source either way (each dual makes
        // {G}), so the green deficit is identical — only what the Delta can
        // fetch differs.
        const greens = Array.from({ length: 6 }, () => meta("Grizzly Bears"));
        const fixing = (dual: string) =>
            scoreCandidate(meta("Polluted Delta"), [
                ...greens,
                meta(dual),
            ]).terms.find((t) => t.term === "fixingValue")!.rawValue;
        expect(fixing("Savannah")).toBe(0);
        expect(fixing("Tropical Island")).toBeGreaterThan(0);
    });
});
