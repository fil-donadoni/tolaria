// Issue #1741 (parent PRD #1736 — hybrid mana costs, umbrella #782). #1755
// already made most of the Brain hybrid-aware (`isManaCostCovered` on the
// affordability path, `autoTap.ts`'s solver, `coloredCostLeftover`'s move
// enumeration). The one gap this closes: `buildManaSpendChoiceView`'s
// `colorUsefulness` heuristic (`src/lib/ai/bot-view.ts`) scanned only FLAT
// colour keys (`norm[color]`) off a card's normalized cost. Since #1738 a
// guild-hybrid pip is folded into the normalized cost under a COMPOSITE key
// (`"R/W"`, `parseHybridCostKey` / `normalizedHybridPips`,
// `convex/gre/manaColors.ts`), so a hybrid card in hand always scored zero
// usefulness for either of its colours — the bot couldn't tell a Mountain
// was worth protecting for a `{R/W}` card.
//
// Two tests: (1) the actual fix — `colorUsefulness` now credits BOTH
// candidate colours a hand-only hybrid pip can pay; (2) the acceptance
// criterion restated literally — a bot with only a Mountain in play sees a
// legal cast move for its `{R/W}` one-drop (this leg already worked before
// this change, per the affordability path being hybrid-aware since #1755;
// kept as a regression guard tying the move-enumeration leg to this issue).

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { enumerateMoves } from "@convex/gre/moves";
import type { PendingCast } from "@convex/gre/state";
import { buildBotView } from "../bot-view";

const BOT = "u1-p2";
const HUMAN = "u1-p1";

const ORNITHOPTER = getCardByName("Ornithopter").id; // {0} — the parked spell itself
const FIGURE_OF_DESTINY = getCardByName("Figure of Destiny").id; // {R/W} one-drop
const MOUNTAIN = getCardByName("Mountain").id;

describe("colorUsefulness credits a guild-hybrid pip toward BOTH candidate colours (issue #1741)", () => {
    it("a hand-only {R/W} card contributes to W usefulness, not just a flat-key colour", () => {
        // A parked generic-spend ambiguity between W and U (unrelated to the
        // hybrid card itself) — the exact shape #1446 already exercises. The
        // OTHER hand card is Figure of Destiny, whose normalized cost is
        // `{ "R/W": 1 }` — no flat "W" or "R" key at all.
        const cast = makeInstance(ORNITHOPTER, {
            id: "cast",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const other = makeInstance(FIGURE_OF_DESTINY, {
            id: "other",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const pendingCast: PendingCast = {
            playerId: BOT,
            cardInstanceId: "cast",
            manaCost: { X: 1 },
            tappedLandIds: [],
            manaSpendChoice: { generic: 1, candidateColors: ["W", "U"] },
        };
        const bot = makePlayer(BOT, {
            hand: [cast, other],
            manaPool: { W: 1, U: 1, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = makeState({
            players: [bot, makePlayer(HUMAN)],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            pendingCast,
        });

        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.manaSpendChoice).toBeDefined();

        // W is one half of the {R/W} pip and IS a candidate colour here — it
        // must be credited even though the normalized cost carries no flat
        // "W" key. U gets nothing: Figure of Destiny doesn't need it.
        expect(view.manaSpendChoice!.colorUsefulness.W).toBe(1);
        expect(view.manaSpendChoice!.colorUsefulness.U).toBeUndefined();
    });

    it("credits BOTH candidate colours when both halves of the pip are in play", () => {
        // Same shape, but the ambiguity is between R and W — both halves of
        // Figure of Destiny's own hybrid pip — proving the credit isn't
        // accidentally single-colour.
        const cast = makeInstance(ORNITHOPTER, {
            id: "cast",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const other = makeInstance(FIGURE_OF_DESTINY, {
            id: "other",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const pendingCast: PendingCast = {
            playerId: BOT,
            cardInstanceId: "cast",
            manaCost: { X: 1 },
            tappedLandIds: [],
            manaSpendChoice: { generic: 1, candidateColors: ["R", "W"] },
        };
        const bot = makePlayer(BOT, {
            hand: [cast, other],
            manaPool: { W: 1, U: 0, B: 0, R: 1, G: 0, C: 0 },
        });
        const state = makeState({
            players: [bot, makePlayer(HUMAN)],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            pendingCast,
        });

        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.manaSpendChoice!.colorUsefulness).toEqual({
            R: 1,
            W: 1,
        });
    });
});

describe("bot with a Mountain in play can cast its {R/W} one-drop (issue #1741 acceptance criterion)", () => {
    it("enumerateMoves offers a cast-spell move for Figure of Destiny off a single Mountain", () => {
        const mountain = makeInstance(MOUNTAIN, {
            id: "mtn",
            controllerId: BOT,
            ownerId: BOT,
            zone: "battlefield",
        });
        const figure = makeInstance(FIGURE_OF_DESTINY, {
            id: "figure",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const bot = makePlayer(BOT, {
            battlefield: [mountain],
            hand: [figure],
        });
        const state = makeState({
            players: [bot, makePlayer(HUMAN)],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });

        const moves = enumerateMoves(state, BOT);
        const castsFigure = moves.some(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "figure"
        );
        expect(castsFigure).toBe(true);
    });
});
