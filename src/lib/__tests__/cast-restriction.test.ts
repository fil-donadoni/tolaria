// #669 — frontend integration for the battlefield-scanned, player-scoped
// casting restriction (Brand of Ill Omen, CR 601.3a). The client grays out a
// hand card the server would reject by calling the shared
// `castProhibitionReason` helper (in `@convex/cards/castRestrictions`, the only
// frontend-safe path — the client must not import from `convex/gre/`). These
// tests exercise the helper with the same `Player[]`-shaped board the client
// passes, proving the GRE → game.ts → UI gate agrees at all three layers.

import { describe, it, expect } from "vitest";
import { castProhibitionReason } from "@convex/cards/castRestrictions";
import { brandOfIllOmen, balduvianBears } from "@convex/cards/sets/ice";
import type { CardInstance, Player } from "~/types/game";

function inst(
    cardId: string,
    overrides: Partial<CardInstance> = {}
): CardInstance {
    return {
        id: overrides.id ?? `inst-${cardId.slice(0, 6)}`,
        card: { id: cardId },
        controllerId: overrides.controllerId ?? "p1",
        types: overrides.types ?? [],
        subtypes: overrides.subtypes ?? [],
        ...overrides,
    } as CardInstance;
}

function player(id: string, battlefield: CardInstance[]): Player {
    return { id, battlefield } as Player;
}

// A creature spell and a noncreature spell as the would-be cast.
const creatureSpell = inst(balduvianBears.id, {
    id: "bears",
    controllerId: "p2",
    types: ["Creature"],
});
const noncreatureSpell = inst("any-instant", {
    id: "bolt",
    controllerId: "p2",
    types: ["Instant"],
});

describe("castProhibitionReason (client-side cast gate, CR 601.3a)", () => {
    it("Brand of Ill Omen: host's controller can't cast a creature spell", () => {
        const board = [
            player("p1", [
                inst(brandOfIllOmen.id, { id: "brand", attachedTo: "host" }),
            ]),
            player("p2", [
                inst(balduvianBears.id, {
                    id: "host",
                    controllerId: "p2",
                    types: ["Creature"],
                }),
            ]),
        ];
        expect(
            castProhibitionReason("p2", creatureSpell as never, {
                players: board as never,
            })
        ).toBeDefined();
    });

    it("the same player can still cast a noncreature spell", () => {
        const board = [
            player("p1", [
                inst(brandOfIllOmen.id, { id: "brand", attachedTo: "host" }),
            ]),
            player("p2", [
                inst(balduvianBears.id, {
                    id: "host",
                    controllerId: "p2",
                    types: ["Creature"],
                }),
            ]),
        ];
        expect(
            castProhibitionReason("p2", noncreatureSpell as never, {
                players: board as never,
            })
        ).toBeUndefined();
    });

    it("does not restrict a player who doesn't control the host", () => {
        const board = [
            player("p1", [
                inst(brandOfIllOmen.id, { id: "brand", attachedTo: "host" }),
            ]),
            player("p2", [
                inst(balduvianBears.id, {
                    id: "host",
                    controllerId: "p2",
                    types: ["Creature"],
                }),
            ]),
        ];
        // p1 controls Brand but not the host → may cast creatures freely.
        expect(
            castProhibitionReason("p1", creatureSpell as never, {
                players: board as never,
            })
        ).toBeUndefined();
    });

    it("an unattached Brand (no host) restricts no one", () => {
        const board = [
            player("p1", [inst(brandOfIllOmen.id, { id: "brand" })]),
            player("p2", []),
        ];
        expect(
            castProhibitionReason("p2", creatureSpell as never, {
                players: board as never,
            })
        ).toBeUndefined();
    });
});
