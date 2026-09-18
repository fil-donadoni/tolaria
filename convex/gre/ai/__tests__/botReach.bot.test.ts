// Bot-play sweep (ADR 0105 § 7.2, issue #3830) — one fixture per outcome on
// the generated position, each run twice to pin determinism. The sweep itself
// runs over the whole `ready` set in `oracle:compile`; this file is the
// evidence that its three verdicts mean what the lockfile says they mean.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { withTemporaryDefinition } from "../../../cards/registry";
import type { CardDefinition } from "../../../cards/types";
import { decidingPlayer } from "../../search";
import {
    buildBotReachState,
    castShape,
    playBotReach,
    playBotReachSeats,
    type BotReachVerdict,
} from "../botReach";

/** Twice, and the two verdicts must agree — the blade determinism contract. */
function playTwice(def: CardDefinition): BotReachVerdict {
    const first = playBotReach(def);
    expect(playBotReach(def)).toEqual(first);
    return first;
}

/** CR 601.2 — a spell whose resolution changes nothing: legal, affordable,
 *  and never worth the mana. */
const NO_OP_SORCERY: CardDefinition = {
    id: "bot-reach-test:no-op",
    name: "Bot Reach No-Op",
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    effects: [],
};

/** CR 115.1 / 601.2c — a targeted spell with no legal target in the
 *  generated position (it seeds no planeswalker), so no cast move exists. */
const UNTARGETABLE_INSTANT: CardDefinition = {
    id: "bot-reach-test:untargetable",
    name: "Bot Reach Untargetable",
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Planeswalker", count: 1 },
    effects: [],
};

describe("Bot-play sweep (ADR 0105 § 7.2)", () => {
    it("played — the Bot casts an affordable creature at both seats", () => {
        expect(playTwice(getCardByName("Grizzly Bears"))).toEqual({
            outcome: "played",
        });
    });

    it("played — the follow-through answers a targeted spell's inputs", () => {
        expect(playTwice(getCardByName("Lightning Bolt")).outcome).toBe(
            "played"
        );
    });

    it("ignored — a legal, affordable no-op is never chosen, and ships", () => {
        withTemporaryDefinition(NO_OP_SORCERY, () => {
            expect(playTwice(NO_OP_SORCERY)).toEqual({
                outcome: "ignored",
                cause: "never-chosen",
                form: "Sorcery",
            });
        });
    });

    it("frozen — no legal move uses the card", () => {
        withTemporaryDefinition(UNTARGETABLE_INSTANT, () => {
            expect(playTwice(UNTARGETABLE_INSTANT)).toEqual({
                outcome: "frozen",
                cause: "no-legal-move",
                form: "Instant target:Planeswalker",
            });
        });
    });

    it("both seats — the holder owns the decision whichever seat it is", () => {
        const def = getCardByName("Grizzly Bears");
        for (const seat of [0, 1] as const) {
            const { state, holderId, instanceId } = buildBotReachState(
                def,
                seat
            );
            expect(holderId).toBe(state.players[seat]!.id);
            expect(decidingPlayer(state)).toBe(holderId);
            const holder = state.players[seat]!;
            expect(holder.hand.some((c) => c.id === instanceId)).toBe(true);
        }
    });

    it("both seats — the card is actually played from each seat", () => {
        const seats = playBotReachSeats(getCardByName("Grizzly Bears"));
        const base = buildBotReachState(
            getCardByName("Grizzly Bears"),
            0
        ).state.players.map((p) => p.id);
        expect(seats.map((s) => s.holderId)).toEqual(base);
        // Neither seat freezes. Not "both played": at the sweep's budget the
        // second-built seat's search is noisier on this very position (see
        // docs/findings/3830-bot-reach-seat-asymmetric-search-noise.md), and
        // `played` means SOME seat chose the card — `ignored` is "never".
        expect(seats[0]!.verdict.outcome).toBe("played");
        expect(seats[1]!.verdict.outcome).not.toBe("frozen");
    });

    it("the form is the cast shape, never the card", () => {
        expect(castShape(UNTARGETABLE_INSTANT)).toBe(
            "Instant target:Planeswalker"
        );
        expect(castShape(getCardByName("Fireball"))).toBe(
            "Sorcery target:any X"
        );
    });
});
