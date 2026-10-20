// Bot-play sweep (ADR 0105 § 7.2, issue #3830) — flash creatures, discard, deny.
// One fixture per outcome on the generated position; the sweep itself runs over the whole
// `ready` set in `oracle:compile`, these files are the evidence its verdicts
// mean what the lockfile says (split by cost, issue #6148).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { attackEdictPosition, flashAmbushPosition } from "../botReachTarget";
import { botReachSpec, playBotReach, playBotReachSeats } from "../botReach";
import { COUNTER_INSTANT, FLASH_ETB_COUNTER } from "./botReachPlay.fixture";

describe("Bot-play sweep (ADR 0105 § 7.2) — flash creatures, discard, deny", () => {
    // Issue #4291: an instant that retypes a target land (an `optionChoice`
    // over basic types) and draws. The gap was a stale verdict: the search now
    // casts it at both seats, the holder's own land being a legal target. What
    // the cast leans on is the `option-pick` candidate generator, which answers
    // the mode choice (with none the verdict reads `ignored`). Pins reachability
    // only; valuer sensitivity and the chosen type are not.
    it("played — an instant that retypes a target land and draws", () => {
        expect(playBotReachSeats(getCardByName("Shimmering Mirage"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    // Issue #4292: a storm instant that makes a target player sacrifice a
    // creature (a `choice` over the edict). Pins reachability only.
    it("played — a storm instant that makes a target player sacrifice a creature", () => {
        expect(playBotReachSeats(getCardByName("Wing Shards"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    // Issue #4287: the same exchange behind a creature that also carries a
    // dies trigger (a pump on a target) — the trigger does not turn the
    // sacrifice-for-draw outlet into a scored sacrifice below the cast edge.
    it("played — a sacrifice-for-draw creature with a dies-pump trigger", () => {
        expect(playBotReachSeats(getCardByName("Marker Beetles"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    // Issue #4280: a creature with flash is posed once more, against an
    // attacker only it can block (`flashAmbushPosition`) — in a main phase
    // holding it and casting it are one play a turn apart.
    it("played — a flash creature, posed against an attacker", () => {
        expect(playBotReachSeats(getCardByName("Benalish Knight"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    // Issue #4281: haste rides the same window — a flash creature with haste is
    // still cast to block, so the ambush position covers it unchanged.
    it("played — a flash creature with haste, posed against an attacker", () => {
        const kavu = getCardByName("Raging Kavu");
        expect(flashAmbushPosition(kavu)).not.toBeNull();
        expect(playBotReachSeats(kavu)).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    it("only a targetless creature with flash is posed against an attacker", () => {
        expect(flashAmbushPosition(getCardByName("Benalish Knight"))).toEqual(
            expect.objectContaining({
                phase: "DECLARE_ATTACKERS",
                activePlayer: "opp",
                priority: "me",
            })
        );
        // No flash, no ambush; a flash spell is not a creature.
        expect(flashAmbushPosition(getCardByName("Serra Angel"))).toBeNull();
        expect(flashAmbushPosition(COUNTER_INSTANT)).toBeNull();
        // Its enters-trigger's target is a targetRequirement of the trigger,
        // not the card, so the flash snake is posed too.
        expect(flashAmbushPosition(FLASH_ETB_COUNTER)).not.toBeNull();
    });

    it("only an edict over attacking creatures is posed against an attack", () => {
        expect(attackEdictPosition(getCardByName("Wing Shards"))).toEqual(
            expect.objectContaining({
                phase: "DECLARE_ATTACKERS",
                activePlayer: "opp",
                priority: "me",
            })
        );
        // A spell aimed at a player that is not an attacker edict, and a
        // creature spell with no target.
        expect(attackEdictPosition(getCardByName("Mind Rot"))).toBeNull();
        expect(attackEdictPosition(getCardByName("Serra Angel"))).toBeNull();
        expect(attackEdictPosition(COUNTER_INSTANT)).toBeNull();
    });

    // Issue #4283: the same sacrifice-to-draw creature, with flying — the
    // evasion body must not change the verdict.
    it("played — a flying creature that sacrifices itself to draw a card", () => {
        expect(playBotReachSeats(getCardByName("Slinking Skirge"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);

    // Issue #4278: a spell that makes the opponent discard is posed against a
    // hand worth taking (`discardsFromTarget`) — an empty or opaque one takes
    // nothing, so the Bot rightly passed. Tendrils of Despair pays a creature
    // for the two cards, so it is the hard case.
    it("played — a spell that makes the opponent discard", () => {
        for (const name of ["Deception", "Tendrils of Despair"]) {
            expect(playBotReach(getCardByName(name)), name).toEqual({
                outcome: "played",
            });
        }
    }, 600_000);

    it("a discard is sweetened only when it is aimed at a target player", () => {
        const opponentCards = (name: string) => {
            const spec = botReachSpec(getCardByName(name));
            return {
                hand: spec.hiddenHand?.opp,
                library: (spec.cards ?? []).filter(
                    (c) => c.owner === "opp" && c.zone === "library"
                ).length,
            };
        };
        expect(opponentCards("Deception")).toEqual({ hand: 3, library: 1 });
        for (const name of ["Faithless Looting", "Wheel of Fortune"])
            expect(opponentCards(name), name).toEqual({
                hand: undefined,
                library: 0,
            });
    });

    // Issue #5431: a creature whose only ability sacrifices a permanent to
    // restrict a target player for the turn is played — the exchange children
    // below its own cast edge are pruned (`isDenialExchangeSacrifice`).
    it("played — a creature that sacrifices a permanent to deny a player", () => {
        expect(playBotReachSeats(getCardByName("Pardic Miner"))).toEqual([
            { holderId: "p1", verdict: { outcome: "played" } },
            { holderId: "p2", verdict: { outcome: "played" } },
        ]);
    }, 600_000);
});
