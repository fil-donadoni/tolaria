// CR 605.3a (issue #3630) — a sacrifice land's picker shows {G} and {G}{G};
// without a label the second row reads like a free extra mana. The row whose
// ability sacrifices the source says so, and only that row.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import ManaChoicePicker from "../mana-choice-picker";

describe("ManaChoicePicker — sacrifice rows (CR 605.3a, issue #3630)", () => {
    afterEach(cleanup);

    it("labels exactly the rows flagged as sacrificing the source", () => {
        render(
            <ManaChoicePicker
                choices={[{ G: 1 }, { G: 2 }]}
                sacrificeFlags={[false, true]}
                onSelect={() => {}}
                onCancel={() => {}}
            />
        );
        // The popover portals into `document.body` (`AnchoredPicker`).
        const rows = [...document.querySelectorAll("button")];
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).not.toContain("Sacrifice");
        expect(rows[1].textContent).toContain("Sacrifice");
    });

    it("labels nothing when no flags are passed", () => {
        render(
            <ManaChoicePicker
                choices={[{ G: 1 }, { G: 2 }]}
                onSelect={() => {}}
                onCancel={() => {}}
            />
        );
        expect(document.body.textContent).not.toContain("Sacrifice");
    });
});
