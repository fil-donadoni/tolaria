// CR 601.3 / 601.3e (issue #7205) — a cast-from-top-of-library permission that
// covers only SOME spells (`castsSpellsFromTopOfLibrary.spellFilter`): Mystic
// Forge's "You may cast artifact spells and colorless spells from the top of
// your library."
//
// The grant is a test-only definition (Mystic Forge itself ships in its own
// Hand Tail issue): Bolas's Citadel's permission with the filter and without
// the life replacement, registered through `withTemporaryDefinition`.
//
// Covers every seam that reads the grant: the legality gate
// (`isCastableLibraryTopSpell` / `getLegalActions`), the per-cast grant pick
// (`libraryTopCastGrant` → `libraryTopCastLifeCost`), the per-HALF test CR
// 601.3e asks of a split card, the wire (`projectPublicState`) and the
// `announceCast` mutation's own refusal of an uncovered half.

import { describe, expect, it } from "vitest";
import { projectPublicState } from "../../gameProjections";
import { announceCast } from "../../game";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import type { Id } from "../../_generated/dataModel";
import {
    getLegalActions,
    isCastableLibraryTopSpell,
    libraryTopAnnouncementLicensed,
    libraryTopCastGrant,
    libraryTopCastLifeCost,
} from "../rules";
import { splitCastAltCostId } from "../splitCast";
import { adventureCastAltCostId } from "../adventure";
import { MORPH_CAST_ALT_COST_ID } from "../morph";
import { castRawManaCost } from "../castCost";
import type { GameState } from "../state";
import {
    BLUE_ARTIFACT,
    BRAZEN_BORROWER,
    CITADEL,
    COLORLESS_BEAR,
    CREATURES_FOR_LIFE,
    CREATURES_ONLY,
    EXALTED_ANGEL,
    FORGE,
    GRIZZLY_BEARS,
    INSTANTS_AND_SORCERIES,
    NONCREATURE_MORPH,
    STAND_DELIVER,
    WHITE_ONLY,
    board,
    withDefs,
    withDefsAsync,
} from "./libraryTopCastFilter.fixture";

const GAME_ID = "game-1" as Id<"games">;
type AnnounceCastArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
    alternativeCostId?: string;
};

/** Drive the REGISTERED `announceCast` handler for the library top. */
const runAnnounceCast = (
    ctx: Parameters<typeof runMutation>[1],
    alternativeCostId?: string
) =>
    runMutation<AnnounceCastArgs, void>(
        announceCast as unknown as Handler<AnnounceCastArgs, void>,
        ctx,
        {
            gameId: GAME_ID,
            playerId: "p1",
            cardInstanceId: "top",
            ...(alternativeCostId ? { alternativeCostId } : {}),
        }
    );

const castable = (state: GameState) => {
    const p1 = state.players[0];
    return (
        isCastableLibraryTopSpell(state, p1, "top") &&
        getLegalActions(state, p1, p1.library[0]).includes("cast")
    );
};

describe("CR 601.3 — a filtered cast-from-top permission covers only its spells (issue #7205)", () => {
    it("an artifact spell is covered, even a coloured one", () => {
        withDefs(() => {
            expect(castable(board([FORGE.id], BLUE_ARTIFACT.id))).toBe(true);
        });
    });

    it("a colourless spell is covered, even a non-artifact one (CR 202.2b)", () => {
        withDefs(() => {
            expect(castable(board([FORGE.id], COLORLESS_BEAR.id))).toBe(true);
        });
    });

    it("a coloured non-artifact spell is NOT covered — no cast, though the mana is there", () => {
        withDefs(() => {
            const state = board([FORGE.id], GRIZZLY_BEARS.id);
            expect(castable(state)).toBe(false);
            // The premise: the same card IS castable under an unfiltered grant.
            expect(castable(board([CITADEL.id], GRIZZLY_BEARS.id))).toBe(true);
        });
    });

    it("the grant pick is per CARD: beside a Citadel, the uncovered spell takes the Citadel's life payment", () => {
        withDefs(() => {
            // Forge scanned FIRST: a first-grant-wins pick would hand Grizzly
            // Bears the Forge's printed-cost grant and charge no life at all.
            const state = board([FORGE.id, CITADEL.id], GRIZZLY_BEARS.id);
            const p1 = state.players[0];
            expect(castable(state)).toBe(true);
            expect(
                libraryTopCastGrant(state, p1, p1.library[0])
                    ?.manaCostReplacement
            ).toBe("life-equal-to-mana-value");
            expect(libraryTopCastLifeCost(state, p1, p1.library[0])).toBe(2);
        });
    });

    it("announceCast commits the uncovered spell under the Citadel: 2 life, no mana", async () => {
        await withDefsAsync(async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(board([FORGE.id, CITADEL.id], GRIZZLY_BEARS.id)),
            ]);
            await runAnnounceCast(harness.ctx);
            const p1 = harness.state().players[0];
            expect(p1.life).toBe(18);
            expect(p1.battlefield.filter((c) => c.isTapped)).toHaveLength(0);
            expect(harness.state().stack.map((s) => s.id)).toEqual(["top"]);
        });
    });
});

describe("CR 601.3e — a split card is covered HALF by half (issue #7205)", () => {
    const STAND = splitCastAltCostId(STAND_DELIVER, "left");
    const DELIVER = splitCastAltCostId(STAND_DELIVER, "right");

    it("the white half is covered, the blue half is not", () => {
        withDefs(() => {
            const state = board([WHITE_ONLY.id], STAND_DELIVER.id);
            const p1 = state.players[0];
            const card = p1.library[0];
            expect(libraryTopCastGrant(state, p1, card, STAND)).toBeDefined();
            expect(
                libraryTopCastGrant(state, p1, card, DELIVER)
            ).toBeUndefined();
            // One covered half is enough to offer the card at all.
            expect(castable(state)).toBe(true);
        });
    });

    it("an uncovered half lends the card no legality: covered Stand unpayable, payable Deliver uncovered → no cast", () => {
        withDefs(() => {
            const state = board([WHITE_ONLY.id], STAND_DELIVER.id);
            const p1 = state.players[0];
            // No white mana: Stand's {W} is unpayable, Deliver's {2}{U} is not.
            p1.battlefield = p1.battlefield.filter(
                (c) => !c.id.startsWith("land-2-")
            );
            expect(
                getLegalActions(state, p1, p1.library[0]).includes("cast")
            ).toBe(false);
        });
    });

    it("each half pays under ITS OWN grant: Deliver, covered only by the Citadel, costs no mana", () => {
        withDefs(() => {
            // The whole card (W+U) is covered by the white-only grant, which
            // replaces nothing; Deliver ({2}{U}) is covered only by the
            // Citadel. A whole-card pick charged Deliver its mana AND 3 life.
            const state = board([WHITE_ONLY.id, CITADEL.id], STAND_DELIVER.id);
            const p1 = state.players[0];
            const card = p1.library[0];
            expect(castRawManaCost(state, card, "library", DELIVER)).toEqual(
                {}
            );
            expect(libraryTopCastLifeCost(state, p1, card, DELIVER)).toBe(3);
            expect(libraryTopCastLifeCost(state, p1, card, STAND)).toBe(0);
        });
    });

    it("announceCast refuses the uncovered half and accepts the covered one", async () => {
        await withDefsAsync(async () => {
            const refused = makeMutationCtx("p1", [
                gameStateSeed(board([WHITE_ONLY.id], STAND_DELIVER.id)),
            ]);
            await expect(runAnnounceCast(refused.ctx, DELIVER)).rejects.toThrow(
                "No permission lets you cast that spell from your library"
            );

            const accepted = makeMutationCtx("p1", [
                gameStateSeed(board([WHITE_ONLY.id], STAND_DELIVER.id)),
            ]);
            await runAnnounceCast(accepted.ctx, STAND);
            expect(accepted.state().pendingTarget?.cardInstanceId).toBe("top");
        });
    });
});

describe("WIRE — the library-top affordance follows the filter (issue #7205)", () => {
    const topCard = (state: GameState) =>
        projectPublicState(state, 1, "p1").players.find((p) => p.id === "p1")!
            .library.known[0]?.card;

    it("an uncovered top card carries no cast affordance", () => {
        withDefs(() => {
            const state = board([FORGE.id], GRIZZLY_BEARS.id);
            // Forge has Citadel's look-at-top clause, so the card is VISIBLE;
            // only the cast affordance is absent.
            expect(topCard(state)?.legalActions ?? []).not.toContain("cast");
        });
    });

    it("castManaCostReplaced reads the grant that covers THIS card", () => {
        withDefs(() => {
            expect(
                topCard(board([FORGE.id, CITADEL.id], GRIZZLY_BEARS.id))
                    ?.castManaCostReplaced
            ).toBe(true);
            expect(
                topCard(board([FORGE.id, CITADEL.id], BLUE_ARTIFACT.id))
                    ?.castManaCostReplaced
            ).toBeUndefined();
        });
    });
});

describe("CR 601.3e — the Adventure and the face-down morph cast are announcements off the top (issue #7526)", () => {
    const PETTY_THEFT = adventureCastAltCostId(BRAZEN_BORROWER);
    const licensed = (state: GameState, alt: string | undefined) => {
        const p1 = state.players[0];
        return libraryTopAnnouncementLicensed(state, p1, p1.library[0], alt);
    };

    it("Melek's example: an instant-and-sorcery grant casts the instant Adventure, not the creature", () => {
        withDefs(() => {
            const state = board(
                [INSTANTS_AND_SORCERIES.id],
                BRAZEN_BORROWER.id
            );
            expect(licensed(state, PETTY_THEFT)).toBe(true);
            expect(licensed(state, undefined)).toBe(false);
            // The Adventure alone is enough to offer the card at all.
            expect(castable(state)).toBe(true);
        });
    });

    it("the reverse: a creature grant casts the creature, not the Adventure", () => {
        withDefs(() => {
            const state = board([CREATURES_ONLY.id], BRAZEN_BORROWER.id);
            expect(licensed(state, undefined)).toBe(true);
            expect(licensed(state, PETTY_THEFT)).toBe(false);
        });
    });

    it("Garruk's Horde's example: a creature grant casts a NONCREATURE morph card face down", () => {
        withDefs(() => {
            const state = board([CREATURES_ONLY.id], NONCREATURE_MORPH.id);
            expect(licensed(state, MORPH_CAST_ALT_COST_ID)).toBe(true);
            expect(licensed(state, undefined)).toBe(false);
            expect(castable(state)).toBe(true);
        });
    });

    it("Mystic Forge: a COLOURED morph card cast face down is a colourless spell (CR 702.37c)", () => {
        withDefs(() => {
            const state = board([FORGE.id], EXALTED_ANGEL.id);
            expect(licensed(state, MORPH_CAST_ALT_COST_ID)).toBe(true);
            expect(licensed(state, undefined)).toBe(false);
            expect(castable(state)).toBe(true);
        });
    });

    it("CR 601.2b — a morph cast never rides a grant that replaces the mana cost: no cast at all", () => {
        withDefs(() => {
            // The face-down 2/2 is covered by the creature filter, but the
            // grant pays life INSTEAD of the mana cost — a second alternative
            // method beside morph — and the printed enchantment is uncovered.
            const state = board([CREATURES_FOR_LIFE.id], NONCREATURE_MORPH.id);
            const p1 = state.players[0];
            expect(
                libraryTopCastGrant(
                    state,
                    p1,
                    p1.library[0],
                    MORPH_CAST_ALT_COST_ID
                )
            ).toBeDefined();
            expect(licensed(state, MORPH_CAST_ALT_COST_ID)).toBe(false);
            expect(castable(state)).toBe(false);
        });
    });

    it("the Adventure's own cost is what affordability is judged against", () => {
        withDefs(() => {
            // Petty Theft is {1}{U}; leave a single Island and one Forest.
            const state = board(
                [INSTANTS_AND_SORCERIES.id],
                BRAZEN_BORROWER.id
            );
            const p1 = state.players[0];
            p1.battlefield = p1.battlefield.filter(
                (c) =>
                    c.id !== "land-1-b" &&
                    !c.id.startsWith("land-2-") &&
                    c.id !== "land-0-b"
            );
            expect(castable(state)).toBe(true);
            // No blue at all: the Adventure is unpayable, and the creature the
            // grant does not cover lends it nothing.
            p1.battlefield = p1.battlefield.filter((c) => c.id !== "land-1-a");
            expect(castable(state)).toBe(false);
        });
    });

    it("the face-down cast is judged against the rule's {3}, never the face-down view's empty cost", () => {
        withDefs(() => {
            const state = board([FORGE.id], EXALTED_ANGEL.id);
            const p1 = state.players[0];
            // Two lands: {3} is unpayable.
            p1.battlefield = p1.battlefield.filter(
                (c) => !c.id.startsWith("land-") || c.id.startsWith("land-0-")
            );
            expect(castable(state)).toBe(false);
        });
    });

    it("announceCast refuses Brazen Borrower and accepts Petty Theft under the instant-and-sorcery grant", async () => {
        await withDefsAsync(async () => {
            const refused = makeMutationCtx("p1", [
                gameStateSeed(
                    board([INSTANTS_AND_SORCERIES.id], BRAZEN_BORROWER.id)
                ),
            ]);
            await expect(runAnnounceCast(refused.ctx)).rejects.toThrow(
                "No permission lets you cast that spell from your library"
            );

            const accepted = makeMutationCtx("p1", [
                gameStateSeed(
                    board([INSTANTS_AND_SORCERIES.id], BRAZEN_BORROWER.id)
                ),
            ]);
            await runAnnounceCast(accepted.ctx, PETTY_THEFT);
            expect(accepted.state().pendingTarget?.cardInstanceId).toBe("top");
        });
    });

    it("announceCast casts the noncreature morph card face down under the creature grant", async () => {
        await withDefsAsync(async () => {
            const harness = makeMutationCtx("p1", [
                gameStateSeed(board([CREATURES_ONLY.id], NONCREATURE_MORPH.id)),
            ]);
            await runAnnounceCast(harness.ctx, MORPH_CAST_ALT_COST_ID);
            const state = harness.state();
            // Parked on its payment: the rule's {3}, never the printed cost,
            // and marked for the face-down commit (CR 702.37c).
            expect(state.pendingCast).toMatchObject({
                cardInstanceId: "top",
                manaCost: { X: 3 },
                morphed: true,
            });
        });
    });

    it("WIRE — the printed cast is withdrawn from the picker when only the Adventure is licensed", () => {
        withDefs(() => {
            const top = (state: GameState) =>
                projectPublicState(state, 1, "p1").players.find(
                    (p) => p.id === "p1"
                )!.library.known[0]?.card;
            const melek = top(
                board([INSTANTS_AND_SORCERIES.id], BRAZEN_BORROWER.id)
            );
            expect(melek?.legalActions).toContain("cast");
            expect(melek?.printedCostCastUnavailable).toBe(true);
            expect(
                top(board([CREATURES_ONLY.id], BRAZEN_BORROWER.id))
                    ?.printedCostCastUnavailable
            ).toBeUndefined();
        });
    });
});
