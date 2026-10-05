import { describe, expect, it } from "vitest";
import { scanCardAnchors } from "../lib/compiler-gap-markers";

// Guard C joins a source anchor to a catalogue card by name. A split card
// (CR 709.4a) has no `name:` of its own: the key is built from its two halves,
// and under a `defineCard` factory (issue #4859) the `defineSplitCard(` call
// sits on the line AFTER the anchor.
describe("scanCardAnchors reads a split card under a defineCard factory (CR 709.4a)", () => {
    it("joins the two half names, the defineSplitCard call on the line after the anchor", () => {
        const factory = [
            "export const lifeDeath = defineCard(() =>",
            "    defineSplitCard({",
            '        name: "Life",',
            '        name: "Death",',
            "    })",
            ");",
        ];
        expect(scanCardAnchors(factory).anchors.map((a) => a.name)).toEqual([
            "Life // Death",
        ]);
    });

    it("the eager shape is no anchor (issue #4860)", () => {
        const eager = [
            "export const lifeDeath: CardDefinition = defineSplitCard({",
            '    name: "Life",',
            '    name: "Death",',
            "});",
        ];
        expect(scanCardAnchors(eager).anchors).toEqual([]);
    });
});
