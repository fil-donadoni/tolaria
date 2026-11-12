// The colours a card supplies to a Limited mana base (issue #9334): produced
// plus fetched. A fetch land produces no mana, so the rules' "could produce"
// left it colourless and the Limited Bot never counted it as fixing.
import { describe, expect, it } from "vitest";
import { getCardByName, tryGetDefinition } from "../../cards";
import { getDefinitionProducibleColors } from "../../gre/constants";
import { fetchableColors, limitedSourceColors } from "../manaSourceColors";
import { draftLabGetAutoBuildCardMeta } from "../../../src/lib/limited/draftLabCardMeta";

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

    it("the Draft Lab's card meta reads it: a fetch land is a source of its colours", () => {
        const meta = draftLabGetAutoBuildCardMeta(
            getCardByName("Polluted Delta").id
        );
        expect(meta?.producedColors).toEqual(["U", "B"]);
    });
});
