// Issue #10370 — CR 602.2b / 601.2g: an activated ability whose mana cost the
// viewer cannot fund is projected as `unaffordableAbilityIds`, so the board's
// ability menu and actionable ring stop offering it. The price is the commit's
// own (`resolveActivationManaCost`), the funds the cast gate's own census.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import type { CardInstanceState, GameState } from "../state";
import type { SlimBattlefieldCard, SlimHandCard } from "../../gameProjections";

const TROLL = getCardByName("Troll of Khazad-dûm").id;
const PESTILENCE = getCardByName("Pestilence").id;
const GLASSES = getCardByName("Glasses of Urza").id;
const SWAMP = getCardByName("Swamp").id;
const ISLAND = getCardByName("Island").id;
const SWAMPCYCLING = getCardByName("Troll of Khazad-dûm").activatedAbilities![0]
    .id;

function lands(cardId: string, n: number, tapped: boolean) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(cardId, {
            id: `${cardId.slice(0, 4)}-${tapped ? "t" : "u"}${i}`,
            controllerId: "p1",
            zone: "battlefield",
            isTapped: tapped,
        })
    );
}

function board(opts: {
    hand?: CardInstanceState[];
    battlefield: CardInstanceState[];
    pool?: Partial<Record<"W" | "U" | "B" | "R" | "G" | "C", number>>;
}): GameState {
    return makeState({
        phase: "POSTCOMBAT_MAIN",
        players: [
            makePlayer("p1", {
                hand: opts.hand ?? [],
                battlefield: opts.battlefield,
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...opts.pool },
            }),
            makePlayer("p2"),
        ],
    });
}

function handCard(state: GameState, id: string): SlimHandCard {
    const me = projectPublicState(state, 1, "p1").players[0];
    return me.hand!.find((c) => c?.id === id)!;
}

function permanent(state: GameState, id: string): SlimBattlefieldCard {
    const me = projectPublicState(state, 1, "p1").players[0];
    return me.battlefield.find((c) => c.id === id)!;
}

describe("activation mana affordability — hand (CR 602.2b / 702.29e)", () => {
    const troll = () =>
        makeInstance(TROLL, { id: "troll", zone: "hand", controllerId: "p1" });

    it("Swampcycling {1} with every land tapped and an empty pool is unaffordable", () => {
        const state = board({
            hand: [troll()],
            battlefield: lands(SWAMP, 5, true),
        });
        expect(handCard(state, "troll").unaffordableAbilityIds).toEqual([
            SWAMPCYCLING,
        ]);
    });

    it("one untapped land funds it", () => {
        const state = board({
            hand: [troll()],
            battlefield: [...lands(SWAMP, 4, true), ...lands(SWAMP, 1, false)],
        });
        expect(handCard(state, "troll").unaffordableAbilityIds).toBeUndefined();
    });

    it("floating mana funds it (CR 106.4)", () => {
        const state = board({
            hand: [troll()],
            battlefield: lands(SWAMP, 5, true),
            pool: { R: 1 },
        });
        expect(handCard(state, "troll").unaffordableAbilityIds).toBeUndefined();
    });
});

describe("activation mana affordability — battlefield (CR 602.2b)", () => {
    const pest = () =>
        makeInstance(PESTILENCE, { id: "pest", controllerId: "p1" });

    it("Pestilence's {B} with no untapped source is unaffordable", () => {
        const state = board({
            battlefield: [pest(), ...lands(SWAMP, 2, true)],
        });
        expect(permanent(state, "pest").unaffordableAbilityIds).toEqual([
            "pestilence-damage",
        ]);
    });

    it("an untapped Swamp funds it", () => {
        const state = board({
            battlefield: [pest(), ...lands(SWAMP, 1, false)],
        });
        expect(permanent(state, "pest").unaffordableAbilityIds).toBeUndefined();
    });

    it("is colour-aware: an untapped Island can't pay {B}", () => {
        const state = board({
            battlefield: [pest(), ...lands(ISLAND, 3, false)],
        });
        expect(permanent(state, "pest").unaffordableAbilityIds).toEqual([
            "pestilence-damage",
        ]);
    });

    it("a {T}-only ability is never unaffordable for want of mana", () => {
        const state = board({
            battlefield: [
                makeInstance(GLASSES, { id: "glasses", controllerId: "p1" }),
            ],
        });
        expect(
            permanent(state, "glasses").unaffordableAbilityIds
        ).toBeUndefined();
    });
});
