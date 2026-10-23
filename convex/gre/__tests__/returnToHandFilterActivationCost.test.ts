// `cost.returnToHandFilter` — "Return a permanent matching <filter> you control
// to its owner's hand" as an ACTIVATION cost (CR 602.1a — the activation cost is
// everything before the colon; CR 118.1 — a cost is an action necessary to take
// another action; CR 601.2h via CR 602.2b — costs are paid as the ability is put
// on the stack, and an aborted payment is rewound). Wirewood Symbiote's "Return
// an Elf you control to its owner's hand: Untap target creature."
//
// The bounce twin of `cost.sacrificeFilter`: the activator CHOOSES the permanent
// through the one selection layer every give-up cost shares
// (`gre/sacrificeChoice.ts`), as a requirement with `action: "return"`. What this
// file proves is that the leg is gated (CR 118.3), chosen rather than auto-picked
// when the choice is real, paid at each commit site — inline, deferred, targeted,
// and the non-stack mana path — and paid to the card's OWNER.
//
// No catalogue card carries the leg yet (issue #5330 is the grammar rule that
// will lower Wirewood Symbiote onto it), so the abilities are synthetic and the
// candidates are real catalogue Elves and Forests.

import { describe, it, expect } from "vitest";
import { getCardByName, preloadDefinitions } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    activateAbilityOnState,
    buildPendingActivation,
    finalizeTargetSelection,
    selectSacrificeOnState,
    tryAutoCommitPendingActivation,
} from "../../game";
import { getPlayer, resolveTopOfStack } from "../state";
import type { CardInstanceState, GameState } from "../state";
import { getManaTapOptions } from "../constants";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const ELF = getCardByName("Llanowar Elves").id;
const FOREST = getCardByName("Forest").id;

const SYMBIOTE_ID = "00000000-0000-4000-8000-000065000001";
const DEFERRED_ID = "00000000-0000-4000-8000-000065000002";
const TARGETED_ID = "00000000-0000-4000-8000-000065000003";
const ELF_SELF_ID = "00000000-0000-4000-8000-000065000004";
const MANA_ID = "00000000-0000-4000-8000-000065000005";

const ELF_FILTER = { subtypes: ["Elf"] };

preloadDefinitions([
    {
        // The INLINE commit: no mana, no target. An Insect, so it never pays
        // its own Elf cost.
        id: SYMBIOTE_ID,
        name: "Synthetic Symbiote",
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Creature"],
        subtypes: ["Insect"],
        power: 1,
        toughness: 1,
        activatedAbilities: [
            {
                id: "symbiote-gain",
                oracleText:
                    "Return an Elf you control to its owner's hand: You gain 3 life.",
                cost: { returnToHandFilter: ELF_FILTER },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
    {
        // The DEFERRED commit: a mana leg forces the payment phase.
        id: DEFERRED_ID,
        name: "Synthetic Deferred Symbiote",
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Creature"],
        subtypes: ["Insect"],
        power: 1,
        toughness: 1,
        activatedAbilities: [
            {
                id: "deferred-gain",
                oracleText:
                    "{1}, Return an Elf you control to its owner's hand: You gain 3 life.",
                cost: { mana: { generic: 1 }, returnToHandFilter: ELF_FILTER },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
    {
        // The TARGETED commit — Wirewood Symbiote's own shape.
        id: TARGETED_ID,
        name: "Synthetic Targeted Symbiote",
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Creature"],
        subtypes: ["Insect"],
        power: 1,
        toughness: 1,
        activatedAbilities: [
            {
                id: "targeted-untap",
                oracleText:
                    "Return an Elf you control to its owner's hand: Untap target creature.",
                cost: { returnToHandFilter: ELF_FILTER },
                useStack: true,
                targetRequirement: { type: "Creature", count: 1 },
                effects: [
                    { op: "tapUntap", action: "untap", target: { target: 0 } },
                ],
            },
        ],
    } as CardDefinition,
    {
        // An ELF carrying the ability: CR 109.2 reads "an Elf you control" as
        // any Elf permanent, the source included.
        id: ELF_SELF_ID,
        name: "Synthetic Self-Returning Elf",
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Creature"],
        subtypes: ["Elf"],
        power: 1,
        toughness: 1,
        activatedAbilities: [
            {
                id: "elf-self-gain",
                oracleText:
                    "Return an Elf you control to its owner's hand: You gain 3 life.",
                cost: { returnToHandFilter: ELF_FILTER },
                useStack: true,
                effects: [{ op: "gainLife", player: "controller", amount: 3 }],
            },
        ],
    } as CardDefinition,
    {
        // The NON-STACK commit (CR 605.1a / 605.3b): a mana ability whose cost
        // names a land, parked like every filtered give-up leg.
        id: MANA_ID,
        name: "Synthetic Land Bouncer",
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Artifact"],
        activatedAbilities: [
            {
                id: "bouncer-mana",
                oracleText:
                    "Return a land you control to its owner's hand: Add {G}.",
                cost: { returnToHandFilter: { types: ["Land"] } },
                useStack: false,
                manaProduced: { G: 1 },
            },
        ],
    } as CardDefinition,
]);

function inst(
    defId: string,
    id: string,
    extra: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        ...extra,
    });
}

function board(battlefield: CardInstanceState[]): GameState {
    return makeState({
        players: [makePlayer("p1", { battlefield }), makePlayer("p2")],
    });
}

const onBattlefield = (state: GameState, id: string) =>
    state.players.some((p) => p.battlefield.some((c) => c.id === id));
const inHand = (state: GameState, playerId: string, id: string) =>
    getPlayer(state, playerId).hand.some((c) => c.id === id);

describe("cost.returnToHandFilter — affordability (CR 118.3)", () => {
    it("refuses the activation when the activator controls no matching permanent", () => {
        const state = board([inst(SYMBIOTE_ID, "src"), inst(FOREST, "forest")]);

        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "src",
                abilityId: "symbiote-gain",
            })
        ).toThrow(/return-to-hand cost/);
        expect(state.stack).toHaveLength(0);
        expect(state.pendingActivation).toBeUndefined();
    });

    it("an OPPONENT's Elf is no payment — the leg reads permanents YOU control", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [inst(SYMBIOTE_ID, "src")] }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(ELF, {
                            id: "opp-elf",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });

        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "src",
                abilityId: "symbiote-gain",
            })
        ).toThrow(/return-to-hand cost/);
    });
});

describe("cost.returnToHandFilter — the INLINE commit (CR 602.1a / 601.2h)", () => {
    it("with one Elf, returns it at commit — before the ability resolves", () => {
        const state = board([inst(SYMBIOTE_ID, "src"), inst(ELF, "elf")]);
        const lifeBefore = getPlayer(state, "p1").life;

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "symbiote-gain",
        });

        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(inHand(state, "p1", "elf")).toBe(true);
        expect(onBattlefield(state, "elf")).toBe(false);
        // A bounce, never a sacrifice.
        expect(getPlayer(state, "p1").graveyard).toHaveLength(0);
        // The source pays nothing of its own.
        expect(onBattlefield(state, "src")).toBe(true);

        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore + 3);
    });

    it("returns it to its OWNER's hand, not the activating controller's", () => {
        const state = board([
            inst(SYMBIOTE_ID, "src"),
            inst(ELF, "elf", { ownerId: "p2" }),
        ]);

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "symbiote-gain",
        });

        expect(getPlayer(state, "p2").hand.map((c) => c.id)).toEqual(["elf"]);
        expect(getPlayer(state, "p1").hand).toHaveLength(0);
    });

    it("the source pays its own cost when it matches the filter (CR 109.2)", () => {
        const state = board([inst(ELF_SELF_ID, "src")]);
        const lifeBefore = getPlayer(state, "p1").life;

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "elf-self-gain",
        });

        expect(inHand(state, "p1", "src")).toBe(true);
        expect(state.stack).toHaveLength(1);
        // CR 113.7a — the ability exists independently of its source.
        resolveTopOfStack(state);
        expect(getPlayer(state, "p1").life).toBe(lifeBefore + 3);
    });
});

describe("cost.returnToHandFilter — a real choice is the payer's (CR 602.1a)", () => {
    it("with two Elves, parks on a RETURN pick and bounces the one chosen", () => {
        const state = board([
            inst(SYMBIOTE_ID, "src"),
            inst(ELF, "elf-1"),
            inst(ELF, "elf-2", { isTapped: true }),
        ]);

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "symbiote-gain",
        });

        // Announced, not paid: both Elves still on the battlefield.
        const sel = state.pendingActivation?.sacrificeSelection;
        expect(sel?.requirements).toHaveLength(1);
        expect(sel?.requirements[0]).toMatchObject({
            count: 1,
            action: "return",
        });
        expect(sel?.picked).toEqual([]);
        expect(state.stack).toHaveLength(0);
        expect(onBattlefield(state, "elf-1")).toBe(true);
        expect(onBattlefield(state, "elf-2")).toBe(true);

        selectSacrificeOnState(state, {
            playerId: "p1",
            cardInstanceId: "elf-2",
        });

        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(inHand(state, "p1", "elf-2")).toBe(true);
        expect(onBattlefield(state, "elf-1")).toBe(true);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(0);
    });

    it("refuses a pick that does not match the filter", () => {
        const state = board([
            inst(SYMBIOTE_ID, "src"),
            inst(ELF, "elf-1"),
            inst(ELF, "elf-2", { isTapped: true }),
            inst(FOREST, "forest"),
        ]);
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "symbiote-gain",
        });

        expect(() =>
            selectSacrificeOnState(state, {
                playerId: "p1",
                cardInstanceId: "forest",
            })
        ).toThrow();
        expect(onBattlefield(state, "forest")).toBe(true);
    });
});

describe("cost.returnToHandFilter — the DEFERRED commit (CR 601.2h)", () => {
    it("announcement is not payment: the Elf leaves only when the mana is paid", () => {
        const src = inst(DEFERRED_ID, "src");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [src, inst(ELF, "elf")],
                    manaPool: { C: 1 },
                }),
                makePlayer("p2"),
            ],
        });
        const ability = {
            id: "deferred-gain",
            oracleText:
                "{1}, Return an Elf you control to its owner's hand: You gain 3 life.",
            cost: { mana: { generic: 1 }, returnToHandFilter: ELF_FILTER },
            useStack: true,
        };
        const player = getPlayer(state, "p1");
        state.pendingActivation = buildPendingActivation({
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "deferred-gain",
            ability,
            manaCost: { generic: 1 },
            sacrificeSelection: {
                playerId: player.id,
                reason: "test",
                requirements: [
                    { filter: ELF_FILTER, count: 1, action: "return" },
                ],
                picked: ["elf"],
            },
        });
        expect(onBattlefield(state, "elf")).toBe(true);

        expect(tryAutoCommitPendingActivation(state, "p1")).not.toBeNull();
        expect(inHand(state, "p1", "elf")).toBe(true);
        expect(onBattlefield(state, "elf")).toBe(false);
    });

    it("the real announcement carries the return requirement onto the payment", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [inst(DEFERRED_ID, "src"), inst(ELF, "elf")],
                }),
                makePlayer("p2"),
            ],
        });

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "deferred-gain",
        });

        // One Elf → the pick is auto-resolved, but the PAYMENT is still owed:
        // the mana leg parks the activation and the Elf stays put.
        const sel = state.pendingActivation?.sacrificeSelection;
        expect(sel?.requirements[0]?.action).toBe("return");
        expect(sel?.picked).toEqual(["elf"]);
        expect(onBattlefield(state, "elf")).toBe(true);
    });
});

describe("cost.returnToHandFilter — the TARGETED commit (CR 601.2c / 602.2b)", () => {
    it("returns the Elf when target selection finalizes, before resolution", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [inst(TARGETED_ID, "src"), inst(ELF, "elf")],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(ELF, {
                            id: "opp-elf",
                            controllerId: "p2",
                            ownerId: "p2",
                            isTapped: true,
                        }),
                    ],
                }),
            ],
        });

        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "targeted-untap",
        });
        const pt = state.pendingTarget;
        expect(pt, "a targeted ability parks a pendingTarget").toBeDefined();
        expect(onBattlefield(state, "elf")).toBe(true);

        pt!.selected = [{ type: "permanent", id: "opp-elf" }];
        finalizeTargetSelection(state, pt!, "p1");

        expect(state.stack).toHaveLength(1);
        expect(inHand(state, "p1", "elf")).toBe(true);
        resolveTopOfStack(state);
        expect(
            getPlayer(state, "p2").battlefield.find((c) => c.id === "opp-elf")
                ?.isTapped
        ).toBe(false);
    });

    it("refuses at finalize when the only Elf left before targets were chosen", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [inst(TARGETED_ID, "src"), inst(ELF, "elf")],
                }),
                makePlayer("p2"),
            ],
        });
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: "targeted-untap",
        });
        const pt = state.pendingTarget!;
        // The Elf leaves the battlefield while the target prompt is open.
        const p1 = getPlayer(state, "p1");
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "elf");
        pt.selected = [{ type: "permanent", id: "src" }];

        expect(() => finalizeTargetSelection(state, pt, "p1")).toThrow(
            /return-to-hand cost/
        );
        expect(state.stack).toHaveLength(0);
    });
});

describe("cost.returnToHandFilter — the NON-STACK mana path (CR 605.1a / 605.3b)", () => {
    const options = (state: GameState) =>
        getManaTapOptions(
            getPlayer(state, "p1").battlefield.find((c) => c.id === "src")!,
            "p1",
            state.players.map((p) => ({
                playerId: p.id,
                battlefield: p.battlefield,
            }))
        );

    it("is a mana source only while a land can be returned", () => {
        expect(options(board([inst(MANA_ID, "src")]))).toHaveLength(0);
        expect(
            options(board([inst(MANA_ID, "src"), inst(FOREST, "forest")]))
                .length
        ).toBeGreaterThan(0);
    });
});
