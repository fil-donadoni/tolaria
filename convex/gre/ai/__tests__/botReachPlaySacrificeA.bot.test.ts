// Bot-play sweep (ADR 0105 § 7.2, issue #3830) — sacrifice creatures, first half.
// One fixture per outcome on the generated position; the sweep itself runs over the whole
// `ready` set in `oracle:compile`, these files are the evidence its verdicts
// mean what the lockfile says (split by cost, issue #6148).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { playBotReachSeats } from "../botReach";

describe("Bot-play sweep (ADR 0105 § 7.2) — sacrifice creatures, first half", () => {
    // Issue #4271: a creature whose only ability sacrifices a body to grow
    // ITSELF is played — the sacrifice children below its own cast edge are
    // pruned (`isSourceConfinedSacrificeConversion`), so they no longer outweigh `pass`.
    it("played — a creature that sacrifices a creature to grow itself", () => {
        for (const name of [
            "Bloodflow Connoisseur",
            "Defiant Salvager",
            "Phyrexian Broodlings",
            "Scarland Thrinax",
        ]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // Issue #4272: a creature whose only ability sacrifices a permanent to
    // remove an announced target is played — the exchange children below its
    // own cast edge are pruned (`isRemovalExchangeSacrifice`).
    it("played — a creature that sacrifices a permanent to remove a target", () => {
        for (const name of [
            "Arms Dealer",
            "Bloodpyre Elemental",
            "Frostling",
        ]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // Issue #4276: a creature whose only ability sacrifices a creature to make
    // a target player discard is played — the exchange children below its own
    // cast edge are pruned (`isDiscardExchangeSacrifice`).
    it("played — a creature that sacrifices a creature to make a player discard", () => {
        for (const name of ["Nezumi Bone-Reader", "Sadistic Hypnotist"]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // Issue #4277: a creature whose only ability sacrifices a permanent to
    // drain a target player is played — the exchange children below its own
    // cast edge are pruned (`isDrainExchangeSacrifice`).
    it("played — a creature that sacrifices a permanent to drain a player", () => {
        for (const name of ["Cabal Archon", "Death Cultist"]) {
            expect(playBotReachSeats(getCardByName(name)), name).toEqual([
                { holderId: "p1", verdict: { outcome: "played" } },
                { holderId: "p2", verdict: { outcome: "played" } },
            ]);
        }
    }, 600_000);

    // Issue #4279: a creature whose only ability sacrifices it to make a
    // player draw is played — the exchange children below its own cast edge
    // are pruned (`isDrawExchangeSacrifice`).
    it("played — a creature that sacrifices itself to draw a card", () => {
        expect(playBotReachSeats(getCardByName("Limestone Golem"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);
});
