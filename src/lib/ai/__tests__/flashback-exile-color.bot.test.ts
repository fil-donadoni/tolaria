// CR 105.2 / 118.5 / 702.34a (issue #1659) — the bot's resolution of a
// COLOUR-FILTERED graveyard exile CAST cost (flashback's "exile X blue cards
// from your graveyard", Flash of Insight, JUD 40).
//
// `buildCastExileChoiceView` (`src/lib/ai/bot-view.ts`) used to build
// `candidateIds` from the whole zone, without applying the cost's `color`
// filter — unlike the server mutation (`recordCastExileCostPick` →
// `graveyardCardMatchesColor`, `convex/game.ts`) which DOES enforce it. Delve
// has no colour filter so it never exposed the gap (see the sibling
// `delve-cast-exile.bot.test.ts`); a colour-filtered flashback/escape cost
// would let the bot submit a non-matching instance id, which the mutation
// rejects — the stall `useVsAiDriver`'s `.catch(() => lastSignature.current =
// null)` turns into a failing-mutation retry loop.
//
// The fix routes both `buildCastExileChoiceView` AND the human picker
// dialog's `eligible` memo through ONE shared predicate
// (`isExileCostEligible`, `convex/cards/exileCostEligibility.ts`) so the two
// client-side eligibility checks can never drift from each other or from the
// server — same single-authority shape as `getLegalTargets == selectTarget`.
//
// Deterministic single-scenario test (project convention: single preset
// scenarios + deterministic unit assertions, never self-play), driven through
// the REAL wire boundary (`projectPublicState` → `buildBotView` →
// `decideBotAction`), mirroring `delve-cast-exile.bot.test.ts`.

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import type { PendingCast } from "@convex/gre/state";
import { chooseCastExileCost, decideBotAction } from "../brain";
import { buildBotView } from "../bot-view";

const BOT = "u1-p2";
const HUMAN = "u1-p1";

const FLASH_OF_INSIGHT = getCardByName("Flash of Insight").id; // {X}{1}{U}
const BRAINSTORM = getCardByName("Brainstorm").id; // {U} — blue, eligible
const LIGHTNING_BOLT = getCardByName("Lightning Bolt").id; // {R} — red, ineligible
const ISLAND = getCardByName("Island").id; // colourless (no mana cost), ineligible

/** A graveyard mixing eligible (blue) and ineligible (non-blue) cards, plus
 *  the flashback card itself (`fbi`, excluded regardless of colour, CR
 *  702.34e) — pinning the ordering the fix must filter DOWN from, not just
 *  filter TO a subset that happens to already be all-blue. */
function mixedGraveyard() {
    return [
        makeInstance(FLASH_OF_INSIGHT, {
            id: "fbi",
            controllerId: BOT,
            ownerId: BOT,
            zone: "graveyard",
        }),
        makeInstance(BRAINSTORM, {
            id: "blue1",
            controllerId: BOT,
            ownerId: BOT,
            zone: "graveyard",
        }),
        makeInstance(LIGHTNING_BOLT, {
            id: "red1",
            controllerId: BOT,
            ownerId: BOT,
            zone: "graveyard",
        }),
        makeInstance(ISLAND, {
            id: "land1",
            controllerId: BOT,
            ownerId: BOT,
            zone: "graveyard",
        }),
        makeInstance(BRAINSTORM, {
            id: "blue2",
            controllerId: BOT,
            ownerId: BOT,
            zone: "graveyard",
        }),
    ];
}

/** The bot's own flashback cast of Flash of Insight parked on the colour-
 *  filtered exile picker: "Exile X blue cards from your graveyard",
 *  `count: 2` (the announced X), mirroring what `announceCast` builds off
 *  `additionalCosts.flashbackExileFromGraveyard: { color: "U" }`. */
function parkedFlashbackCast(count: number): PendingCast {
    return {
        playerId: BOT,
        cardInstanceId: "fbi",
        manaCost: { generic: 1, U: 1 },
        tappedLandIds: [],
        exileFromGraveyardChoice: {
            count,
            color: "U",
            excludeInstanceId: "fbi",
        },
    };
}

function baseState(pendingCast: PendingCast) {
    const bot = makePlayer(BOT, { graveyard: mixedGraveyard() });
    return makeState({
        players: [makePlayer(HUMAN), bot],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        phase: "PRECOMBAT_MAIN",
        pendingCast,
    });
}

describe("bot dispatch for a colour-filtered flashback exile cost (CR 702.34a, issue #1659)", () => {
    it("offers ONLY the colour-matching graveyard cards as candidates — never the excluded flashback card, a wrong-colour spell, or a colourless land", () => {
        const state = baseState(parkedFlashbackCast(2));
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);

        expect(view.castExileChoice).toEqual({
            candidateIds: ["blue1", "blue2"],
            required: 2,
            maximum: 2,
        });
    });

    it("submits only blue instance ids — the same set the server's graveyardCardMatchesColor would accept", () => {
        const state = baseState(parkedFlashbackCast(2));
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);

        const action = decideBotAction(view);
        expect(action.kind).toBe("cast-exile-cost");
        expect(
            action.kind === "cast-exile-cost" ? action.cardInstanceIds : []
        ).toEqual(["blue1", "blue2"]);
    });

    it("chooseCastExileCost never draws from an ineligible id even if asked for more than the candidate set holds", () => {
        expect(
            chooseCastExileCost({
                candidateIds: ["blue1", "blue2"],
                required: 5,
                maximum: 5,
            })
        ).toEqual(["blue1", "blue2"]);
    });
});
