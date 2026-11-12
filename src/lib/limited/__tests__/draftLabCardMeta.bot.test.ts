// The Draft Lab's card meta reads the Limited mana-source colours (issue
// #9334): a fetch land is a source of the colours it can fetch.
import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import { draftLabGetAutoBuildCardMeta } from "../draftLabCardMeta";

describe("Draft Lab card meta: mana-source colours", () => {
    it("a fetch land is a source of its colours", () => {
        const meta = draftLabGetAutoBuildCardMeta(
            getCardByName("Polluted Delta").id
        );
        expect(meta?.producedColors).toEqual(["U", "B"]);
    });
});
