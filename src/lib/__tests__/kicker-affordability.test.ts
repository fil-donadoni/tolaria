// Frontend wiring (SURFACE) test for the Kicker cast-cost dialog gate
// (CR 702.33a, ADR 0079, issue #1937). `affordableKickersForCard`
// (src/lib/card-utils.ts) decides which Kicker toggles the cast-cost dialog
// offers at all — and it is silent on both sides of a mistake: a false NEGATIVE
// makes a Kicker unreachable in the UI with a perfectly healthy server, a false
// POSITIVE lets the caster commit to a cost `announceCast` then rejects. It
// hands a hand-built `{ activePlayerId, players }` view to the SERVER predicate
// `canPayKickerLegs` (`convex/gre/kicker.ts`), so every field that predicate
// reads must survive the wire projection.
//
// Per `.claude/rules/gre-development.md` § Frontend wiring analysis item 4, the
// assertion is therefore driven THROUGH the reducer: state is projected via
// `projectPublicState` first, then the gate runs on the projected players. A
// hand-built view (which is what `cast-cost-dialog.test.tsx` passes as props)
// would mask a stripped field and does not count.

import { describe, it, expect } from "vitest";
import { getCardByName, registerTokenDefinition } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import type { CardDefinition } from "@convex/cards/types";
import { affordableKickersForCard } from "../card-utils";
import type { CardInstance, Player } from "~/types/game";

// Bloodchief's Thirst — {B}, "Kicker {2}{B}": the mana-only shape all 25
// shipped Kicker cards have.
const thirst = getCardByName("Bloodchief's Thirst");
const swamp = getCardByName("Swamp");

// No printed card carries a NON-MANA Kicker leg yet, so the unaffordable case
// needs a probe. Both legs are priced by `canPayKickerLegs` off fields the
// projection must preserve: `life` and the battlefield permanents' types.
const NON_MANA_PROBE_ID = "test:client-kicker-nonmana-leg-probe";
const nonManaProbe: CardDefinition = {
    id: NON_MANA_PROBE_ID,
    rarity: "common",
    name: "Client Kicker Leg Probe",
    manaCost: { X: 1 },
    types: ["Sorcery"],
    kickers: [
        {
            id: "kicker-life",
            description: "Kicker — Pay 30 life",
            life: 30,
        },
        {
            id: "kicker-sac",
            description: "Kicker — Sacrifice two Swamps",
            permanent: {
                action: "sacrifice",
                filter: { subtypes: ["Swamp"] },
                count: 2,
            },
        },
        {
            id: "kicker-mana",
            description: "Kicker {5}",
            mana: { X: 5 },
        },
    ],
    effects: [],
};
registerTokenDefinition(nonManaProbe);

/** Build the scenario and hand back the WIRE-PROJECTED view the client sees. */
function projected(cardDefId: string, opts: { swamps: number; life: number }) {
    const spell = makeInstance(cardDefId, {
        id: "spell1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const battlefield = Array.from({ length: opts.swamps }, (_, i) =>
        makeInstance(swamp.id, {
            id: `sw${i}`,
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { life: opts.life, hand: [spell], battlefield }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    const view = projectPublicState(state, 1, "p1") as unknown as {
        players: Player[];
        activePlayerId: string;
    };
    const card = view.players[0].hand.find(
        (c) => c?.id === "spell1"
    ) as CardInstance;
    return { view, card };
}

function offeredIds(cardDefId: string, opts: { swamps: number; life: number }) {
    const { view, card } = projected(cardDefId, opts);
    return affordableKickersForCard(
        card,
        "p1",
        view.players,
        view.activePlayerId
    ).map((k) => k.id);
}

describe("affordableKickersForCard — cast-cost dialog gate (CR 702.33a, ADR 0079)", () => {
    it("OFFERS a mana-only kicker even with no mana available", () => {
        // The mana leg folds into the spell's total and is paid by the ordinary
        // deferred-payment path, so an empty pool must NOT hide the toggle —
        // otherwise every kicked cast made from untapped lands is unreachable.
        expect(offeredIds(thirst.id, { swamps: 0, life: 20 })).toEqual([
            "kicker",
        ]);
    });

    it("HIDES an unaffordable life leg and an unaffordable permanent leg, keeping the mana-only one", () => {
        // 20 life < 30 → the life leg is unpayable (CR 119.4); one Swamp < two
        // → the sacrifice leg is unpayable (CR 601.2f). The mana-only kicker on
        // the same card stays offered — the gate is per Kicker, not per card.
        expect(offeredIds(NON_MANA_PROBE_ID, { swamps: 1, life: 20 })).toEqual([
            "kicker-mana",
        ]);
    });

    it("OFFERS those same legs once the board and life total can pay them", () => {
        expect(offeredIds(NON_MANA_PROBE_ID, { swamps: 2, life: 40 })).toEqual([
            "kicker-life",
            "kicker-sac",
            "kicker-mana",
        ]);
    });

    it("offers nothing for a card with no kickers", () => {
        expect(offeredIds(swamp.id, { swamps: 0, life: 20 })).toEqual([]);
    });
});
