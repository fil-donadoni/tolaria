// SURFACE test for the human battlefield picker's filter mirror (issue #2373
// review fixup).
//
// The defect this guards: `EffectCardFilter.excludeSource` propagates through
// `toPermanentFilter` onto `PermanentFilter.excludeInstanceIds`, and that
// `PermanentFilter` rides the wire verbatim as `PendingChoice.filter`. Every
// SERVER and BOT reader honours it (they all call the engine
// `matchesPermanentFilter` in `convex/cards/filters.ts`), but the HUMAN seat
// evaluates the same wire filter through the CLIENT MIRROR in
// `~/lib/card-utils`, which had no `excludeInstanceIds` branch — so it failed
// OPEN and ringed the effect's own source as a legal pick. Clicking it threw
// "Card does not match the required filter" server-side.
//
// Per `.claude/rules/gre-development.md` § Proof-of-failure shape 3, a
// hand-built filter object does NOT catch this class — the assertion has to
// traverse the REAL reducers. So this file resolves Gut, True Soul Zealot's
// attack trigger through the real engine (`emitAttackersDeclaredEvents` +
// `resolveTopOfStack`), projects with the real `projectPublicState`, and feeds
// the projected `PendingChoice.filter` and the projected `CardInstance`
// straight into the client mirror. Nothing is constructed by hand.

import { describe, it, expect } from "vitest";
import { gutTrueSoulZealot } from "../../../convex/cards/sets/clb/red";
import { grizzlyBears } from "../../../convex/cards/sets/lea/green";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../convex/cards/__tests__/setup";
import { resolveTopOfStack, type GameState } from "../../../convex/gre/state";
import { emitAttackersDeclaredEvents } from "../../../convex/gre/phases";
import { projectPublicState } from "../../../convex/gameProjections";
import { matchesPermanentFilter } from "../card-utils";
import type { CardInstance } from "~/types/game";
import type { CardType } from "../../../convex/cards/types";

/** Resolves Gut's attack trigger through the REAL production entry points and
 *  returns the public projection the human controller (`p1`) actually sees. */
function projectedGutChoice() {
    const gut = makeInstance(gutTrueSoulZealot.id, { id: "gut" });
    const fodder = makeInstance(grizzlyBears.id, { id: "fodder" });
    // A creature-only board would let a `types: "Creature"` clause alone
    // explain a rejection; an artifact is present so the `any` clause list on
    // the wire filter is genuinely the one under test.
    const bauble = makeInstance(grizzlyBears.id, {
        id: "bauble",
        types: ["Artifact"] as CardType[],
        subtypes: [],
        power: undefined,
        toughness: undefined,
    });
    const state: GameState = makeState({
        players: [
            makePlayer("p1", { battlefield: [gut, fodder, bauble] }),
            makePlayer("p2"),
        ],
    });

    state.phase = "DECLARE_ATTACKERS";
    state.combat = {
        attackerIds: [gut.id],
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: false,
    };
    emitAttackersDeclaredEvents(state);
    resolveTopOfStack(state);

    const projected = projectPublicState(state, 1, "p1");
    const choice = projected.pendingChoices?.[0];
    const board = projected.players[0].battlefield as CardInstance[];
    return {
        choice,
        gut: board.find((c) => c.id === "gut")!,
        fodder: board.find((c) => c.id === "fodder")!,
        bauble: board.find((c) => c.id === "bauble")!,
    };
}

describe("client filter mirror vs the REAL wire PendingChoice.filter (CR 109.2 'another', issue #2373)", () => {
    it("the projection actually carries excludeInstanceIds — the field under test reaches the client", () => {
        const { choice } = projectedGutChoice();

        expect(choice).toBeDefined();
        expect(choice!.kind).toBe("sacrifice-permanents");
        // If this ever stops holding, the assertions below would pass
        // vacuously — the mirror would be rejecting nothing rather than
        // rejecting the source.
        expect(JSON.stringify(choice!.filter)).toContain("excludeInstanceIds");
    });

    it("REJECTS the effect's own source through the mirror (was fail-OPEN: Gut ringed as a legal sacrifice to her own trigger)", () => {
        const { choice, gut } = projectedGutChoice();

        expect(matchesPermanentFilter(gut, choice!.filter!)).toBe(false);
    });

    it("still ACCEPTS the other creature and the artifact (the exclusion is scoped, not a blanket reject)", () => {
        const { choice, fodder, bauble } = projectedGutChoice();

        expect(matchesPermanentFilter(fodder, choice!.filter!)).toBe(true);
        // Per the CLB ruling, an artifact Gut IS sacrificeable to her own
        // ability — `excludeSource` sits on the Creature clause only — so the
        // Artifact clause must not inherit the exclusion.
        expect(matchesPermanentFilter(bauble, choice!.filter!)).toBe(true);
    });
});
