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
import { additionalCostPrintedLabel } from "@convex/gre/kicker";
import type { CardInstance, Player } from "~/types/game";

// Bloodchief's Thirst — {B}, "Kicker {2}{B}": the mana-only shape all 25
// shipped Kicker cards have.
const thirst = getCardByName("Bloodchief's Thirst");
// Intrepid Rabbit — {2}{W}, "Offspring {1}" (CR 702.175a, issue #2079): the
// SAME cost half under a different keyword. The dialog must offer it exactly
// like a Kicker — the gate reads `kickers[]`, never the keyword — and must
// render a label that says "Offspring", not "Kicker".
const rabbit = getCardByName("Intrepid Rabbit");
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

    // CR 702.175a (issue #2079) — the OTHER keyword that rides this cost half.
    // The affordance is what the acceptance criterion "the cast dialog offers
    // it with legible cost text before commit" means, and it is proved through
    // the reducer: a hand-built view would mask a projection that dropped the
    // hand card's definition id, which is the only thing the client resolves
    // `kickers[]` from.
    it("OFFERS an Offspring cost, labelled as Offspring and not as a Kicker", () => {
        const { view, card } = projected(rabbit.id, { swamps: 0, life: 20 });
        const offered = affordableKickersForCard(
            card,
            "p1",
            view.players,
            view.activePlayerId
        );
        expect(offered.map((k) => k.id)).toEqual(["offspring"]);
        // The toggle renders `description` verbatim, and the printed WORD comes
        // from ADDITIONAL_COST_KEYWORDS — the single label authority.
        expect(offered[0].description).toBe("Offspring {1}");
        expect(additionalCostPrintedLabel(offered[0])).toBe("Offspring");
    });

    // CR 702.47a (issue #2394) — Splice, the third keyword on this cost half
    // and the only one whose entry is SYNTHESIZED from the caster's hand rather
    // than declared on the card being cast. The gate is the whole client-side
    // affordance: with no row here the caster can never reveal anything, so the
    // card's second half is unreachable in the UI with a perfectly healthy
    // server — the exact failure `.claude/rules/gre-development.md` § Frontend
    // wiring analysis is about. Driven through the reducer, which matters more
    // here than for a declared Kicker: the option list is derived from the
    // caster's HAND, and an opponent's hand is projected as `null[]`.
    it("OFFERS a splice reveal for an Arcane cast, one row per eligible hand card", () => {
        const spike = getCardByName("Lava Spike");
        const breach = getCardByName("Through the Breach");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(spike.id, {
                            id: "spell1",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                        makeInstance(breach.id, {
                            id: "breach1",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                        makeInstance(breach.id, {
                            id: "breach2",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                }),
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
        const offered = affordableKickersForCard(
            card,
            "p1",
            view.players,
            view.activePlayerId
        );
        // CR 702.47b — two copies in hand are two independently revealable
        // CARDS, so two rows; the ids carry the instance, not the printing.
        expect(offered.map((k) => k.id)).toEqual([
            "splice:breach1",
            "splice:breach2",
        ]);
        // The toggle renders `description` verbatim, and it must name the card
        // being revealed: two rows reading only "Splice onto Arcane {2}{R}{R}"
        // would be indistinguishable in the dialog.
        expect(offered[0].description).toBe(
            "Through the Breach — Splice onto Arcane {2}{R}{R}"
        );
        expect(additionalCostPrintedLabel(offered[0])).toBe("Splice");
        // The mana leg is not gated (an empty pool must not hide the row), and
        // the Arcane spell itself is never offered as a reveal onto itself.
        expect(
            offered.some((k) => k.id === "splice:spell1"),
            "the card being cast was offered as a splice onto itself"
        ).toBe(false);
    });

    it("offers NO splice reveal when the spell is not of the spliced-onto subtype", () => {
        const breach = getCardByName("Through the Breach");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(thirst.id, {
                            id: "spell1",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                        makeInstance(breach.id, {
                            id: "breach1",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                }),
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
        // Bloodchief's Thirst is not Arcane: its own Kicker is the only row.
        expect(
            affordableKickersForCard(
                card,
                "p1",
                view.players,
                view.activePlayerId
            ).map((k) => k.id)
        ).toEqual(["kicker"]);
    });
});
