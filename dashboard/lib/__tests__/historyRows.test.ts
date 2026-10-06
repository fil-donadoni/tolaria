import { describe, expect, it } from "vitest";
import { cmdBase } from "../historyRows";

describe("cmdBase (issue #5105)", () => {
    it("buckets the former and the current pipeline skill name together", () => {
        expect(cmdBase("/next-issue 3152")).toBe("/next-ticket");
        expect(cmdBase("/next-ticket 5105")).toBe("/next-ticket");
    });

    it("keeps every other command's first word", () => {
        expect(cmdBase("/rules-check 704.5a")).toBe("/rules-check");
        expect(cmdBase(null)).toBe("(none)");
    });
});
