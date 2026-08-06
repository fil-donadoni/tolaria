// bng — green card tests.
//
// Courser of Kruphix introduces the play-lands-from-TOP-of-library capability
// (CR 305.1-analog), so it earns the full regime rather than riding the DSL
// smoke sweep: the permission lookup, the affordance gate, the real play-commit
// seam, and the wire SURFACE the client actually reads. Its other two clauses
// reuse shipped capabilities (`revealsLibraryTop`, exercised by Goblin Spy in
// `inv/__tests__/red.test.ts`; the `landfallTrigger` factory + `gainLife` Op)
// and are covered here only where they INTERACT with the new permission — a
// land played off the top must still trip landfall (CR 603.6a keys on the
// entry, not on the source zone).

import { describe, it, expect } from "vitest";
import { getPlayer, resolveTopOfStack } from "../../../../gre/state";
import {
    canPlayLandsFromTopOfLibrary,
    isPlayableLibraryTopLand,
    getLegalActions,
} from "../../../../gre/rules";
import {
    applyPlayLandFromLibraryTop,
    applyPlayLandFromAnyZone,
    finalizeLandEntry,
    resolvePlayLandSourceZone,
} from "../../../../gre/playLand";
import { projectPublicState } from "../../../../gameProjections";
import { courserOfKruphix } from "../green";
import { courserBoard } from "./courserBoard";
import { forest, mountain } from "../../lea/colorless";
import { stompingGround } from "../../gpt/colorless";
import { grizzlyBears } from "../../lea/green";

describe("Courser of Kruphix — card definition", () => {
    it("is a 2/4 Enchantment Creature — Centaur for {1}{G}{G}", () => {
        expect(courserOfKruphix.manaCost).toEqual({ X: 1, G: 2 });
        expect(courserOfKruphix.types).toEqual(["Enchantment", "Creature"]);
        expect(courserOfKruphix.subtypes).toEqual(["Centaur"]);
        expect(courserOfKruphix.power).toBe(2);
        expect(courserOfKruphix.toughness).toBe(4);
    });

    it("declares BOTH the top-card reveal and the play-from-top permission", () => {
        // CR does not tie the two clauses together, so they are separate
        // fields; the card printing both is what makes it declare both.
        expect(courserOfKruphix.revealsLibraryTop).toBe("controller");
        expect(courserOfKruphix.playsLandsFromTopOfLibrary).toBe(true);
    });
});

describe("play-lands-from-top permission (CR 305.1-analog)", () => {
    it("canPlayLandsFromTopOfLibrary is true only for the Courser's controller", () => {
        const state = courserBoard([forest.id]);
        expect(
            canPlayLandsFromTopOfLibrary(state, getPlayer(state, "p1"))
        ).toBe(true);
        expect(
            canPlayLandsFromTopOfLibrary(state, getPlayer(state, "p2"))
        ).toBe(false);
    });

    it("is false once the Courser leaves the battlefield — no stale flag", () => {
        const state = courserBoard([forest.id]);
        getPlayer(state, "p1").battlefield = [];
        expect(
            canPlayLandsFromTopOfLibrary(state, getPlayer(state, "p1"))
        ).toBe(false);
    });

    it("isPlayableLibraryTopLand accepts index 0 but NOT a land deeper in the library", () => {
        const state = courserBoard([forest.id, mountain.id]);
        const player = getPlayer(state, "p1");
        expect(isPlayableLibraryTopLand(state, player, "p1-lib-0")).toBe(true);
        // The permission names the TOP card; the rest of the library stays a
        // hidden zone (CR 400.2).
        expect(isPlayableLibraryTopLand(state, player, "p1-lib-1")).toBe(false);
    });

    it("isPlayableLibraryTopLand rejects a NON-land on top", () => {
        const state = courserBoard([grizzlyBears.id, forest.id]);
        expect(
            isPlayableLibraryTopLand(state, getPlayer(state, "p1"), "p1-lib-0")
        ).toBe(false);
    });

    it("isPlayableLibraryTopLand is false with no Courser out", () => {
        const state = courserBoard([forest.id], false);
        expect(
            isPlayableLibraryTopLand(state, getPlayer(state, "p1"), "p1-lib-0")
        ).toBe(false);
    });
});

describe('affordance gate — getLegalActions offers "play" for the top land', () => {
    it('the top LAND has "play" while the permission holds', () => {
        const state = courserBoard([forest.id]);
        const player = getPlayer(state, "p1");
        expect(getLegalActions(state, player, player.library[0])).toContain(
            "play"
        );
    });

    it('the SECOND land has NO "play" — the permission is positional', () => {
        const state = courserBoard([forest.id, mountain.id]);
        const player = getPlayer(state, "p1");
        expect(getLegalActions(state, player, player.library[1])).not.toContain(
            "play"
        );
    });

    it('the top land has NO "play" without a Courser', () => {
        const state = courserBoard([forest.id], false);
        const player = getPlayer(state, "p1");
        expect(getLegalActions(state, player, player.library[0])).not.toContain(
            "play"
        );
    });

    it('the top land has NO "play" once the land drop is spent (CR 305.2)', () => {
        const state = courserBoard([forest.id], true, {
            landsPlayedThisTurn: 1,
        });
        const player = getPlayer(state, "p1");
        expect(getLegalActions(state, player, player.library[0])).not.toContain(
            "play"
        );
    });
});

describe("play-commit seam — applyPlayLandFromLibraryTop", () => {
    it("moves the top land to the battlefield and spends the land drop", () => {
        const state = courserBoard([forest.id, mountain.id]);
        const player = getPlayer(state, "p1");

        const entered = applyPlayLandFromLibraryTop(state, player, "p1-lib-0");

        expect(entered).not.toBeNull();
        expect(player.battlefield.map((c) => c.id)).toContain("p1-lib-0");
        expect(player.library.map((c) => c.id)).toEqual(["p1-lib-1"]);
        expect(player.landsPlayedThisTurn).toBe(1);
    });

    it("is a no-op for a card that is no longer on top (stale id)", () => {
        const state = courserBoard([forest.id, mountain.id]);
        const player = getPlayer(state, "p1");

        expect(
            applyPlayLandFromLibraryTop(state, player, "p1-lib-1")
        ).toBeNull();
        expect(player.library.map((c) => c.id)).toEqual([
            "p1-lib-0",
            "p1-lib-1",
        ]);
        expect(player.battlefield.map((c) => c.id)).not.toContain("p1-lib-1");
    });

    it("resolvePlayLandSourceZone reports library-top, and the dispatcher routes there", () => {
        const state = courserBoard([forest.id]);
        const player = getPlayer(state, "p1");

        expect(resolvePlayLandSourceZone(state, player, "p1-lib-0")).toBe(
            "library-top"
        );
        applyPlayLandFromAnyZone(state, player, "p1-lib-0");
        expect(player.battlefield.map((c) => c.id)).toContain("p1-lib-0");
    });
});

describe("shock land off the top (CR 614.12 / ADR 0051)", () => {
    it("suspends on the pay-choice with the land still on top, then enters UNTAPPED when paid", () => {
        const state = courserBoard([stompingGround.id]);
        const player = getPlayer(state, "p1");
        const lifeBefore = player.life;

        // The entry suspends BEFORE the zone move: nothing has entered yet and
        // the land is still at index 0 for the choice window.
        expect(
            applyPlayLandFromLibraryTop(state, player, "p1-lib-0")
        ).toBeNull();
        expect(player.library.map((c) => c.id)).toEqual(["p1-lib-0"]);
        expect(state.pendingChoices?.[0]?.kind).toBe("land-entry-tapped");

        const entered = finalizeLandEntry(
            state,
            "p1",
            "p1-lib-0",
            { life: 2 },
            true
        );

        // Paid: 2 life, land untapped, land drop spent, landfall triggered.
        expect(entered.isTapped).toBe(false);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore - 2);
        expect(getPlayer(state, "p1").landsPlayedThisTurn).toBe(1);
        expect(getPlayer(state, "p1").library).toEqual([]);
    });

    it("enters TAPPED when the pay-choice is declined", () => {
        const state = courserBoard([stompingGround.id]);
        const player = getPlayer(state, "p1");
        const lifeBefore = player.life;

        applyPlayLandFromLibraryTop(state, player, "p1-lib-0");
        const entered = finalizeLandEntry(
            state,
            "p1",
            "p1-lib-0",
            { life: 2 },
            false
        );

        expect(entered.isTapped).toBe(true);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore);
    });
});

describe("landfall interaction (CR 603.6a) — a top-played land still triggers", () => {
    it("gains 1 life when the land played OFF THE TOP enters", () => {
        const state = courserBoard([forest.id]);
        const player = getPlayer(state, "p1");
        const lifeBefore = player.life;

        applyPlayLandFromLibraryTop(state, player, "p1-lib-0");

        // The trigger goes on the stack (CR 603.3b — triggers never
        // auto-resolve); resolve it to observe the life gain.
        expect(state.stack.length).toBe(1);
        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore + 1);
    });
});

// The bot-side counterpart of this coverage — `enumerateMoves` sees the
// permission — lives in `green.bot.test.ts` (bot-suite boundary).

describe("wire SURFACE — projectPublicState tags the playable top land", () => {
    it("attaches legalActions to the viewer's OWN library top", () => {
        const state = courserBoard([forest.id, mountain.id]);
        const projected = projectPublicState(state, 1, "p1");
        const top = projected.players.find((p) => p.id === "p1")!.library
            .known[0];

        expect(top.index).toBe(0);
        expect(top.card.legalActions).toContain("play");
    });

    it("does NOT attach legalActions to the OPPONENT's view of that same top card", () => {
        // The CR 401.5 reveal is symmetric — p2 sees the card — but p2 can
        // never play it, so the affordance must not cross to their seat.
        const state = courserBoard([forest.id, mountain.id]);
        const projected = projectPublicState(state, 1, "p2");
        const top = projected.players.find((p) => p.id === "p1")!.library
            .known[0];

        expect(top.card.card.id).toBe(forest.id);
        expect(top.card.legalActions).toBeUndefined();
    });

    it("attaches an EMPTY legalActions (disabled affordance) once the land drop is spent", () => {
        const state = courserBoard([forest.id], true, {
            landsPlayedThisTurn: 1,
        });
        const projected = projectPublicState(state, 1, "p1");
        const top = projected.players.find((p) => p.id === "p1")!.library
            .known[0];

        // Present-but-empty is what renders the button DISABLED rather than
        // absent — the same convention the graveyard land affordance uses.
        expect(top.card.legalActions).toEqual([]);
    });

    it("attaches NOTHING when the top card is a non-land", () => {
        const state = courserBoard([grizzlyBears.id]);
        const projected = projectPublicState(state, 1, "p1");
        const top = projected.players.find((p) => p.id === "p1")!.library
            .known[0];

        expect(top.card.legalActions).toBeUndefined();
    });
});
