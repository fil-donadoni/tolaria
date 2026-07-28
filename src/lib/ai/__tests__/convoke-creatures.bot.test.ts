// CR 702.51 (issue #1338, parent PRD #702, ADR 0063) — the bot's resolution of
// the parked Convoke creature picker that Hogaak introduces.
//
// Without this the bot stalls exactly as the delve exile park (#1336) and the
// mana-spend park (#1446) once did: `pendingCast` blocks `passPriority`, the
// picker lives OUTSIDE `pendingChoices[]` so no Worker search surfaces a move,
// and `enumerateMoves` returns [] while a cast parks. The fix is a compile-time-
// exhaustive `BotAction` kind (`convoke-creatures`) with its own
// `botActionRealisation` branch and a direct `selectConvokeCreatures` mutation.
//
// Deterministic single-scenario tests driven through the REAL wire boundary
// (`projectPublicState` → `buildBotView` → `decideBotAction`).

import { describe, expect, it } from "vitest";
import { getCardByName } from "@convex/cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { projectPublicState } from "@convex/gameProjections";
import { enumerateMoves } from "@convex/gre/moves";
import {
    buildConvokeCreatureChoice,
    coverColoredAndHybridPips,
} from "@convex/gre/payWith";
import type { PendingCast } from "@convex/gre/state";
import type { Color } from "@convex/cards/types";
import {
    botActionRealisation,
    chooseConvokeCreatures,
    decideBotAction,
} from "../brain";
import { buildBotView } from "../bot-view";

const BOT = "u1-p2";
const HUMAN = "u1-p1";

const HOGAAK = getCardByName("Hogaak, Arisen Necropolis").id;
const CRAW_WURM = getCardByName("Craw Wurm").id; // green
const DRUDGE_SKELETONS = getCardByName("Drudge Skeletons").id; // black
const SWAMP = getCardByName("Swamp").id;

function fuel(n: number) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(SWAMP, {
            id: `gy${i}`,
            controllerId: BOT,
            ownerId: BOT,
            zone: "graveyard",
        })
    );
}

/** The bot's own Hogaak cast parked on the convoke picker. */
function parkedConvokeCast(creatures: string[], gyCount: number) {
    const hogaak = makeInstance(HOGAAK, {
        id: "hogaak",
        controllerId: BOT,
        ownerId: BOT,
        zone: "hand",
    });
    const bot = makePlayer(BOT, {
        hand: [hogaak],
        graveyard: fuel(gyCount),
        battlefield: creatures.map((cardId, i) =>
            makeInstance(cardId, {
                id: `cr${i}`,
                controllerId: BOT,
                ownerId: BOT,
            })
        ),
    });
    const pendingCast: PendingCast = {
        playerId: BOT,
        cardInstanceId: "hogaak",
        manaCost: { X: 5 },
        tappedLandIds: [],
        convokeCreatureChoice: {
            min: 2,
            max: Math.min(creatures.length, 7),
            hybridPips: [
                ["B", "G"],
                ["B", "G"],
            ],
        },
    };
    return makeState({
        players: [makePlayer(HUMAN), bot],
        activePlayerId: BOT,
        priorityPlayerId: BOT,
        phase: "PRECOMBAT_MAIN",
        pendingCast,
    });
}

describe("bot dispatch for the convoke creature pick (CR 702.51)", () => {
    it("classifies the new kind as its own direct-mutation realisation", () => {
        expect(botActionRealisation("convoke-creatures")).toBe(
            "convoke-creatures"
        );
    });

    it("decides a legal covering pick instead of stalling on the parked cast", () => {
        const state = parkedConvokeCast([CRAW_WURM, DRUDGE_SKELETONS], 5);
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);

        expect(view.convokeChoice?.min).toBe(2);
        expect(view.convokeChoice?.candidates.map((c) => c.id)).toEqual([
            "cr0",
            "cr1",
        ]);

        const action = decideBotAction(view);
        expect(action.kind).toBe("convoke-creatures");
        // Picks exactly the two colour-matching creatures for the two {B/G} pips.
        expect(
            action.kind === "convoke-creatures"
                ? action.creatureInstanceIds
                : []
        ).toEqual(["cr0", "cr1"]);
        // A stall would surface as none/pass — and the Worker can't help.
        expect(enumerateMoves(state, BOT)).toEqual([]);
    });

    it("completes the cast on a natural Hogaak board (4 creatures + 3 fuel) instead of stalling (#1338 review)", () => {
        // delve fuel (3) < generic (5) after the two hybrids: the built min MUST
        // force 4 creatures (2 hybrids + 2 generic). Before the fix min was 2,
        // the bot tapped only 2, generic never reached 0, and the cast parked
        // forever — a hard stall (enumerateMoves is [], so no Worker rescue).
        const hogaak = makeInstance(HOGAAK, {
            id: "hogaak",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const creatures = [
            CRAW_WURM,
            DRUDGE_SKELETONS,
            CRAW_WURM,
            DRUDGE_SKELETONS,
        ].map((cardId, i) =>
            makeInstance(cardId, {
                id: `cr${i}`,
                controllerId: BOT,
                ownerId: BOT,
            })
        );
        const bot = makePlayer(BOT, {
            hand: [hogaak],
            graveyard: fuel(3),
            battlefield: creatures,
        });
        const choice = buildConvokeCreatureChoice(bot, hogaak, { X: 5 });
        expect(choice?.min).toBe(4);

        const pendingCast: PendingCast = {
            playerId: BOT,
            cardInstanceId: "hogaak",
            manaCost: { X: 5 },
            tappedLandIds: [],
            convokeCreatureChoice: choice,
        };
        const state = makeState({
            players: [makePlayer(HUMAN), bot],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
            pendingCast,
        });

        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.convokeChoice?.min).toBe(4);

        const action = decideBotAction(view);
        expect(action.kind).toBe("convoke-creatures");
        const picked =
            action.kind === "convoke-creatures"
                ? action.creatureInstanceIds
                : [];
        // Taps the forced 4 — enough that convoke covers BOTH hybrids and the 2
        // generic pips delve can't reach (leftover 2 + 3 fuel = the 5 generic).
        expect(picked).toHaveLength(4);
        const colorById = new Map(
            view.convokeChoice!.candidates.map((c) => [
                c.id,
                new Set<Color>(c.colors as Color[]),
            ])
        );
        const leftover = coverColoredAndHybridPips(
            picked.map((id) => colorById.get(id)!),
            {},
            [
                ["B", "G"],
                ["B", "G"],
            ]
        );
        expect(leftover).not.toBeNull();
        // convoke's leftover generic + delve fuel (3) must cover all 5 generic.
        expect((leftover ?? 0) + 3).toBeGreaterThanOrEqual(5);
        // No Worker move exists — the direct convoke pick is the ONLY way forward.
        expect(enumerateMoves(state, BOT)).toEqual([]);
    });

    it("chooseConvokeCreatures colour-matches hybrids then tops up to the minimum", () => {
        const picked = chooseConvokeCreatures({
            candidates: [
                { id: "red", colors: ["R"] },
                { id: "green", colors: ["G"] },
                { id: "black", colors: ["B"] },
            ],
            hybridPips: [["B", "G"]],
            coloredPips: {},
            min: 1,
            max: 3,
        });
        // The single {B/G} pip is covered by the green OR black creature (both
        // size-1); the greedy takes the first least-flexible match.
        expect(picked).toHaveLength(1);
        expect(["green", "black"]).toContain(picked[0]);
    });

    it("stays quiet when the parked cast belongs to the OPPONENT", () => {
        const state = parkedConvokeCast([CRAW_WURM, DRUDGE_SKELETONS], 5);
        state.pendingCast!.playerId = HUMAN;
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.convokeChoice).toBeUndefined();
    });

    it("stays quiet once the pick is already recorded", () => {
        const state = parkedConvokeCast([CRAW_WURM, DRUDGE_SKELETONS], 5);
        state.pendingCast!.convokeCreatureChoice!.pickedCreatureIds = [
            "cr0",
            "cr1",
        ];
        const view = buildBotView(projectPublicState(state, 1, BOT), BOT);
        expect(view.convokeChoice).toBeUndefined();
    });
});
