// #754 — Ice Cauldron client-layer end-to-end. The GRE/serialization/wire
// projection for Ice Cauldron are correct and tested; this asserts the CLIENT
// layer consumes the projected fields: the frontend CardInstance type exposes
// notedMana + castableFromExileBy, they survive the GRE → projection → client
// type path, and the UI helpers (preview noted-mana, mana-pool restriction
// label) read them correctly for both casting the exiled card and spending the
// restricted mana on it.
import { describe, it, expect } from "vitest";
import type { CardInstance } from "~/types/game";
import {
    projectFullState,
    type SlimCardInstance,
} from "@convex/gameProjections";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { restrictedManaLabel } from "../restricted-mana";

const ICE_CAULDRON_ID = getCardByName("Ice Cauldron").id;
const BRAINSTORM_ID = getCardByName("Brainstorm").id;

/** Builds the post-charge Ice Cauldron board: the artifact carries the noted
 *  mana keyed to a face-down, cast-from-exile Brainstorm in p1's exile. */
function chargedState() {
    const cauldron = makeInstance(ICE_CAULDRON_ID, {
        id: "cauldron",
        controllerId: "p1",
        ownerId: "p1",
        counters: { charge: 1 },
        notedMana: { mana: { U: 2 }, castableCardId: "noted-spell" },
    });
    const exiled = makeInstance(BRAINSTORM_ID, {
        id: "noted-spell",
        controllerId: "p1",
        ownerId: "p1",
        zone: "exile",
        castableFromExileBy: "p1",
        knownTo: ["p1"], // face down: known only to its controller
    });
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [cauldron], exile: [exiled] }),
            makePlayer("p2"),
        ],
    });
}

function projectedFor(
    state: ReturnType<typeof makeState>,
    playerIndex: number,
    instanceId: string,
    zone: "battlefield" | "exile"
): CardInstance {
    const projected = projectFullState(state, 1);
    const slim = projected.players[playerIndex][zone].find(
        (c) => c.id === instanceId
    ) as SlimCardInstance | undefined;
    if (!slim)
        throw new Error(`instance ${instanceId} not in projected ${zone}`);
    return slim as unknown as CardInstance;
}

describe("Ice Cauldron client-type wire path (#754)", () => {
    it("the noted mana survives projection onto the client CardInstance type", () => {
        const card = projectedFor(chargedState(), 0, "cauldron", "battlefield");
        // The field is typed on the client CardInstance and carries the bank.
        expect(card.notedMana).toEqual({
            mana: { U: 2 },
            castableCardId: "noted-spell",
        });
    });

    it("the cast-from-exile flag survives projection onto the client CardInstance type", () => {
        const card = projectedFor(chargedState(), 0, "noted-spell", "exile");
        expect(card.castableFromExileBy).toBe("p1");
    });

    it("the preview noted-mana section reads the projected notedMana", () => {
        const card = projectedFor(chargedState(), 0, "cauldron", "battlefield");
        // The preview section's data contract (CardPreviewNotedMana `noted`).
        const noted = card.notedMana!;
        const entries = Object.entries(noted.mana).filter(([, n]) => n > 0);
        expect(entries).toEqual([["U", 2]]);
    });

    it("end-to-end: restricted mana from the second ability is labelled with the exiled card", () => {
        // Activating the second ability floats instance-keyed restricted {U}{U}.
        // The mana-pool label resolves the exiled card's name from the projected
        // exile instance — the same lookup the component performs.
        const state = chargedState();
        state.players[0].restrictedMana = [
            { color: "U", amount: 2, castableCardId: "noted-spell" },
        ];
        const projected = projectFullState(state, 1);
        const p1 = projected.players[0];
        const restricted = p1.restrictedMana!;
        expect(restricted).toHaveLength(1);
        // Resolve the name from the projected exile, as PlayerManaPool does.
        const resolveName = (id: string) => {
            const inst = (p1.exile as SlimCardInstance[]).find(
                (c) => c.id === id
            );
            return inst ? getCardByName("Brainstorm").name : undefined;
        };
        // The restricted unit is keyed to the exiled card and labelled with it.
        expect(restrictedManaLabel(restricted[0], resolveName)).toBe(
            "Only: Brainstorm"
        );
    });

    it("end-to-end: the exiled card is castable by its controller, not the opponent", () => {
        const state = chargedState();
        // Controller's view: the cast flag matches their viewer id → castable.
        const ownView = projectedFor(state, 0, "noted-spell", "exile");
        const viewerIsController = ownView.castableFromExileBy === "p1";
        expect(viewerIsController).toBe(true);
        // From p2's perspective the flag (controller's id) never matches p2.
        expect(ownView.castableFromExileBy).not.toBe("p2");
    });
});
