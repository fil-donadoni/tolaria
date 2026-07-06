// Land-entry pay-choice (CR 614.12, ADR 0051) — the RAV/GPT/DIS "shock land"
// cycle. A played land carrying `entersTappedUnlessPay` suspends entry on a
// stackless `land-entry-tapped` PendingChoice: pay the cost to enter untapped,
// or decline and enter tapped. Paying removes only the land's own tapped
// clause — any other tapped source (Kismet) still applies (CR 616).

import { describe, it, expect } from "vitest";
import {
    steamVents,
    stompingGround,
    godlessShrine,
} from "../../cards/sets/gpt/colorless";
import {
    wateryGrave,
    sacredFoundry,
    templeGarden,
    overgrownTomb,
} from "../../cards/sets/rav/colorless";
import {
    breedingPool,
    hallowedFountain,
    bloodCrypt,
} from "../../cards/sets/dis/colorless";
import { kismet } from "../../cards/sets/leg/white";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { applyPlayLand } from "../playLand";
import { applyLandEntrySubmit } from "../pendingChoiceSubmit";
import { getPlayer } from "../state";
import { legalActions } from "../legalActions";
import { projectPublicState } from "../../gameProjections";

const ALL_SHOCKS = [
    {
        def: steamVents,
        colors: [{ U: 1 }, { R: 1 }],
        subtypes: ["Island", "Mountain"],
    },
    {
        def: stompingGround,
        colors: [{ R: 1 }, { G: 1 }],
        subtypes: ["Mountain", "Forest"],
    },
    {
        def: godlessShrine,
        colors: [{ W: 1 }, { B: 1 }],
        subtypes: ["Plains", "Swamp"],
    },
    {
        def: wateryGrave,
        colors: [{ U: 1 }, { B: 1 }],
        subtypes: ["Island", "Swamp"],
    },
    {
        def: sacredFoundry,
        colors: [{ R: 1 }, { W: 1 }],
        subtypes: ["Mountain", "Plains"],
    },
    {
        def: templeGarden,
        colors: [{ G: 1 }, { W: 1 }],
        subtypes: ["Forest", "Plains"],
    },
    {
        def: overgrownTomb,
        colors: [{ B: 1 }, { G: 1 }],
        subtypes: ["Swamp", "Forest"],
    },
    {
        def: breedingPool,
        colors: [{ G: 1 }, { U: 1 }],
        subtypes: ["Forest", "Island"],
    },
    {
        def: hallowedFountain,
        colors: [{ W: 1 }, { U: 1 }],
        subtypes: ["Plains", "Island"],
    },
    {
        def: bloodCrypt,
        colors: [{ B: 1 }, { R: 1 }],
        subtypes: ["Swamp", "Mountain"],
    },
];

function playSteamVents(
    life = 20,
    p2Battlefield: ReturnType<typeof makeInstance>[] = []
) {
    const shock = makeInstance(steamVents.id, { id: "shock", zone: "hand" });
    const state = makeState({
        players: [
            makePlayer("p1", { life, hand: [shock] }),
            makePlayer("p2", { battlefield: p2Battlefield }),
        ],
    });
    return { state, player: getPlayer(state, "p1") };
}

describe("shock land entry: definition shape (CR 614.12)", () => {
    it.each(ALL_SHOCKS)(
        "$def.name declares entersTappedUnlessPay, subtypes, and the two-colour mana choice",
        ({ def, colors, subtypes }) => {
            expect(def.entersTappedUnlessPay).toEqual({ life: 2 });
            expect(def.subtypes).toEqual(subtypes);
            expect(def.entersTapped).toBeUndefined();
            expect(def.entersTappedUnless).toBeUndefined();
            expect(def.activatedAbilities![0].manaChoices).toEqual(colors);
        }
    );
});

describe("shock land entry: suspend (CR 614.12, ADR 0051)", () => {
    it("suspends entry on a land-entry-tapped choice — the land stays in hand", () => {
        const { state, player } = playSteamVents();
        const result = applyPlayLand(state, player, "shock");

        expect(result).toBeNull(); // no on-battlefield instance yet
        expect(player.hand.find((c) => c.id === "shock")).toBeDefined();
        expect(
            player.battlefield.find((c) => c.id === "shock")
        ).toBeUndefined();

        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("land-entry-tapped");
        expect(head?.playerId).toBe("p1");
        expect(head?.landInstanceId).toBe("shock");
        expect(head?.cost).toEqual({ life: 2 });
        expect(state.priorityPlayerId).toBe("p1");
    });
});

describe("shock land entry: resolve (CR 614.12)", () => {
    it("pay 2 life → enters UNTAPPED, controller loses 2 life", () => {
        const { state, player } = playSteamVents(20);
        applyPlayLand(state, player, "shock");
        applyLandEntrySubmit(state, { playerId: "p1", accept: true });

        const land = player.battlefield.find((c) => c.id === "shock");
        expect(land).toBeDefined();
        expect(land!.isTapped).toBe(false);
        expect(getPlayer(state, "p1").life).toBe(18);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("decline → enters TAPPED, life unchanged", () => {
        const { state, player } = playSteamVents(20);
        applyPlayLand(state, player, "shock");
        applyLandEntrySubmit(state, { playerId: "p1", accept: false });

        const land = player.battlefield.find((c) => c.id === "shock");
        expect(land!.isTapped).toBe(true);
        expect(getPlayer(state, "p1").life).toBe(20);
    });

    it("records the land drop exactly once (CR 305.2)", () => {
        const { state, player } = playSteamVents(20);
        applyPlayLand(state, player, "shock");
        applyLandEntrySubmit(state, { playerId: "p1", accept: true });
        expect(getPlayer(state, "p1").landsPlayedThisTurn).toBe(1);
    });
});

describe("shock land entry: independence from other tapped sources (CR 616)", () => {
    it("Kismet forces tapped AND you may still pay 2 life (Arena parity)", () => {
        const kismetInst = makeInstance(kismet.id, {
            id: "kismet",
            controllerId: "p2",
        });
        const { state, player } = playSteamVents(20, [kismetInst]);
        applyPlayLand(state, player, "shock");

        // Paying is still offered even though the land will enter tapped anyway.
        applyLandEntrySubmit(state, { playerId: "p1", accept: true });

        const land = player.battlefield.find((c) => c.id === "shock");
        // Kismet's independent replacement keeps it tapped despite the payment.
        expect(land!.isTapped).toBe(true);
        // The payment still happened (each replacement is independent).
        expect(getPlayer(state, "p1").life).toBe(18);
    });
});

describe("shock land entry: affordability gate (CR 118.4)", () => {
    it("at 1 life only 'decline' is legal, and accepting throws", () => {
        const { state, player } = playSteamVents(1);
        applyPlayLand(state, player, "shock");

        const actions = legalActions(state);
        const kinds = actions.map((a) =>
            a.action.kind === "submit-land-entry"
                ? `land-entry:${a.action.accept}`
                : a.action.kind
        );
        expect(kinds).toContain("land-entry:false");
        expect(kinds).not.toContain("land-entry:true");

        expect(() =>
            applyLandEntrySubmit(state, { playerId: "p1", accept: true })
        ).toThrow(/Cannot pay/);
    });
});

describe("shock land entry: wire format (ADR 0051)", () => {
    it("the pending choice and the tapped land survive projectPublicState", () => {
        const { state, player } = playSteamVents(20);
        applyPlayLand(state, player, "shock");

        // The suspended choice projects to the chooser.
        const projectedSuspended = projectPublicState(state, 1, "p1");
        const head = projectedSuspended.pendingChoices?.[0];
        expect(head?.kind).toBe("land-entry-tapped");
        expect(head?.cost).toEqual({ life: 2 });

        applyLandEntrySubmit(state, { playerId: "p1", accept: false });

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "shock");
        expect(slim!.isTapped).toBe(true);
        void player;
    });
});
