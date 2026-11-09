// Bot-play sweep (issue #8977) — a spell that makes a target player discard a
// card the caster picks through a filter (CR 701.9a; Duress: "a noncreature,
// nonland card") is posed against a hidden hand re-dealt from a spell that
// filter admits. The default pile spell is a creature, so Duress took nothing
// in every determinization and the Bot rightly passed. Verdicts go through
// the real `playBotReach` pipeline.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { botReachSpec, playBotReach } from "../botReach";
import { targetDiscardSpell } from "../botReachTargetDiscard";

describe("targetDiscardSpell", () => {
    it("seeds a noncreature spell when the pick refuses creatures", () => {
        expect(
            targetDiscardSpell(getCardByName("Duress")!, "Serra Angel")
        ).toBe("Counterspell");
    });

    it("keeps the default pile spell when every pick admits it", () => {
        for (const name of ["Thoughtseize", "Deception"])
            expect(
                targetDiscardSpell(getCardByName(name)!, "Serra Angel"),
                name
            ).toBe("Serra Angel");
    });

    it("seeds the opponent's library of the generated position", () => {
        const library = (botReachSpec(getCardByName("Duress")!).cards ?? [])
            .filter((c) => c.owner === "opp" && c.zone === "library")
            .map((c) => c.name);
        expect(library).toEqual(["Counterspell"]);
    });
});

describe("playBotReach on a filtered target discard", () => {
    it("plays Duress once the hand holds a noncreature spell", () => {
        expect(playBotReach(getCardByName("Duress")!)).toEqual({
            outcome: "played",
        });
    }, 600_000);
});
