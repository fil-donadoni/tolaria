// #669 — frontend integration for the battlefield-scanned, player-scoped
// casting restriction (Brand of Ill Omen, CR 601.3a). The client grays out a
// hand card the server would reject by calling the shared
// `castProhibitionReason` helper (in `@convex/cards/castRestrictions`, the only
// frontend-safe path — the client must not import from `convex/gre/`). These
// tests exercise the helper with the same `Player[]`-shaped board the client
// passes, proving the GRE → game.ts → UI gate agrees at all three layers.

import { describe, it, expect } from "vitest";
import { castProhibitionReason } from "@convex/cards/castRestrictions";
import {
    brandOfIllOmen,
    balduvianBears,
    blizzard,
    snowCoveredForest,
} from "@convex/cards/sets/ice";
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

    // Xantid Swarm's turn-scoped per-player cast lock (CR 601.3a / 514.2,
    // #1057) — a PlayerState-turn flag, not a battlefield-scanned static. The
    // client reads the same helper over the projected state, which carries the
    // flag (projectPublicState spreads it), so the affordance is suppressed.
    it("Xantid Swarm: a locked player can't cast ANY spell this turn", () => {
        const board = [player("p1", []), player("p2", [])];
        // Locked: p2 is in the turn-scoped list.
        expect(
            castProhibitionReason("p2", creatureSpell as never, {
                players: board as never,
                cannotCastSpellsThisTurn: [{ playerId: "p2" }],
            })
        ).toBeDefined();
        // The lock is per-player: the attacker (p1) is unaffected.
        expect(
            castProhibitionReason("p1", creatureSpell as never, {
                players: board as never,
                cannotCastSpellsThisTurn: [{ playerId: "p2" }],
            })
        ).toBeUndefined();
        // Not locked (empty list) → casts freely.
        expect(
            castProhibitionReason("p2", noncreatureSpell as never, {
                players: board as never,
                cannotCastSpellsThisTurn: [],
            })
        ).toBeUndefined();
    });

    // Abeyance's typed cast lock (CR 601.3a, issue #1124) — `cardTypes`
    // narrows the lock to the listed printed types instead of every spell.
    it("Abeyance: a typed lock only blocks the listed card types", () => {
        const board = [player("p1", []), player("p2", [])];
        // A Creature spell is unaffected by an instant/sorcery-only lock.
        expect(
            castProhibitionReason("p2", creatureSpell as never, {
                players: board as never,
                cannotCastSpellsThisTurn: [
                    { playerId: "p2", cardTypes: ["Instant", "Sorcery"] },
                ],
            })
        ).toBeUndefined();
        // The same lock forbids the listed type.
        expect(
            castProhibitionReason("p2", creatureSpell as never, {
                players: board as never,
                cannotCastSpellsThisTurn: [
                    { playerId: "p2", cardTypes: ["Creature"] },
                ],
            })
        ).toBeDefined();
    });
});

// Issue #2102 — the card-level SELF cast condition
// (`CardDefinition.castCondition`, CR 601.3a) goes through the same shared
// gate, so it is equally readable from the client's `Player[]`-shaped board.
// The client's Cast affordance today rides the server-computed `legalActions`
// on the wire (`board-hand-card.tsx`), which the projection test in
// `convex/cards/sets/ice/__tests__/green.test.ts` covers; this row proves the
// helper itself also evaluates correctly against the slim CLIENT shape, where
// `card` is `{ id }` only and permanents carry no `staticAbilities`.
describe("castCondition (client-side self cast condition, CR 601.3a)", () => {
    const blizzardSpell = inst(blizzard.id, {
        id: "blizzard-hand",
        controllerId: "p1",
        types: ["Enchantment"],
    });

    it("Blizzard: uncastable with no snow land", () => {
        const board = [player("p1", []), player("p2", [])];
        expect(
            castProhibitionReason("p1", blizzardSpell as never, {
                players: board as never,
            })
        ).toBe("Cast this spell only if you control a snow land.");
    });

    it("Blizzard: a non-snow land does not satisfy it (CR 205.4a)", () => {
        const board = [
            player("p1", [
                inst(balduvianBears.id, { id: "not-a-land", types: ["Land"] }),
            ]),
            player("p2", []),
        ];
        expect(
            castProhibitionReason("p1", blizzardSpell as never, {
                players: board as never,
            })
        ).toBeDefined();
    });

    it("Blizzard: castable once a snow land is controlled", () => {
        const board = [
            player("p1", [
                inst(snowCoveredForest.id, {
                    id: "snow",
                    types: ["Land"],
                }),
            ]),
            player("p2", []),
        ];
        expect(
            castProhibitionReason("p1", blizzardSpell as never, {
                players: board as never,
            })
        ).toBeUndefined();
    });

    it("Blizzard: the OPPONENT's snow land does not satisfy it (CR 109.4)", () => {
        const board = [
            player("p1", []),
            player("p2", [
                inst(snowCoveredForest.id, {
                    id: "their-snow",
                    controllerId: "p2",
                    types: ["Land"],
                }),
            ]),
        ];
        expect(
            castProhibitionReason("p1", blizzardSpell as never, {
                players: board as never,
            })
        ).toBeDefined();
    });
});
