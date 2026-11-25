// Gift — the two linked abilities of CR 702.174 and the give-a-gift event.
//
// CR 702.174a: the first ability is "As an additional cost to cast this
// spell, you may choose an opponent."
// CR 702.174b: on a permanent the second is "When this permanent enters, if
// its gift cost was paid, [effect]"; on an instant or sorcery, "If this
// spell's gift cost was paid, [effect]."
// CR 702.174c: "whenever a player gives a gift" triggers as a gift-paid
// instant or sorcery that player controls resolves, or as the gift triggered
// ability of a permanent that player controls resolves.
// CR 702.174j: a spell countered on resolution gives nothing.
//
// Every claim drives the real commit path (`finalizeTargetSelection`) and the
// real resolution / trigger machinery.
import { describe, expect, it } from "vitest";
import { finalizeTargetSelection } from "../../game";
import {
    getPlayer,
    processPendingActionTriggers,
    resolveTopOfStack,
    type GameState,
    type PendingTarget,
} from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup.helper";
import { getDefinition, withTemporaryDefinition } from "../../cards/registry";
import {
    giftCost,
    giftSpellOps,
    giftTrigger,
    type GiftKind,
} from "../../cards/abilities/gift";
import { giftGivenTrigger } from "../../cards/abilities/triggers/giftGivenTrigger";
import type { CardDefinition, TargetSelection } from "../../cards/types";

const CREATURE_ID = "test:gift-creature-probe";
const SPELL_ID = "test:gift-spell-probe";
const TARGETED_ID = "test:gift-targeted-probe";
const WATCHER_ID = "test:gift-watcher-probe";

const creatureProbe: CardDefinition = {
    id: CREATURE_ID,
    name: "Gift Creature Probe",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Raccoon"],
    power: 2,
    toughness: 2,
    oracleText: "Gift a card",
    kickers: [giftCost("card")],
    triggeredAbilities: [
        giftTrigger({ cardName: "Gift Creature Probe", kind: "card" }),
    ],
};

function spellProbe(kind: GiftKind): CardDefinition {
    return {
        id: SPELL_ID,
        name: "Gift Spell Probe",
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        oracleText: "Gift …\nYou gain 3 life.",
        kickers: [giftCost(kind)],
        effects: [
            ...giftSpellOps(kind),
            { op: "gainLife", player: "controller", amount: 3 },
        ],
    };
}

const targetedProbe: CardDefinition = {
    id: TARGETED_ID,
    name: "Gift Targeted Probe",
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Instant"],
    oracleText: "Gift a card\nDestroy target creature.",
    kickers: [giftCost("card")],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        ...giftSpellOps("card"),
        { op: "destroy", target: { target: 0 } },
    ],
};

/** "Whenever you give a gift, you gain 1 life." — the CR 702.174c reader. */
const watcher: CardDefinition = {
    id: WATCHER_ID,
    name: "Gift Watcher Probe",
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Hamster"],
    power: 1,
    toughness: 1,
    oracleText: "Whenever you give a gift, you gain 1 life.",
    triggeredAbilities: [
        giftGivenTrigger({
            id: "gift-watcher-trigger",
            oracleText: "Whenever you give a gift, you gain 1 life.",
            scope: "you",
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        }),
    ],
};

function withProbes(defs: CardDefinition[], fn: () => void): void {
    const [first, ...rest] = defs;
    if (first === undefined) return fn();
    withTemporaryDefinition(first, () => withProbes(rest, fn));
}

function board(def: CardDefinition, watcherController: "p1" | "p2") {
    const library = (owner: string) =>
        [1, 2, 3].map((n) =>
            makeInstance(WATCHER_ID, {
                id: `${owner}-lib-${n}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );
    const watcherCard = makeInstance(WATCHER_ID, {
        id: "watcher",
        controllerId: watcherController,
        ownerId: watcherController,
    });
    const victim = makeInstance(WATCHER_ID, {
        id: "victim",
        controllerId: "p2",
        ownerId: "p2",
    });
    const subject = makeInstance(def.id, {
        id: "subject",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                hand: [subject],
                library: library("p1"),
                battlefield: watcherController === "p1" ? [watcherCard] : [],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 1, C: 0 },
            }),
            makePlayer("p2", {
                library: library("p2"),
                battlefield:
                    watcherController === "p2"
                        ? [watcherCard, victim]
                        : [victim],
            }),
        ],
    });
}

function cast(
    state: GameState,
    payGift: boolean,
    selected: TargetSelection[] = []
): void {
    const pt: PendingTarget = {
        playerId: "p1",
        cardInstanceId: "subject",
        targetType: selected.length > 0 ? "Creature" : "any",
        count: selected.length,
        selected,
        ...(payGift ? { kickerPayments: { gift: 1 } } : {}),
    };
    finalizeTargetSelection(state, pt, "p1");
    expect(
        state.stack.find((s) => s.id === "subject"),
        "the spell never reached the stack"
    ).toBeDefined();
}

/** Resolves the stack and every trigger it raises. */
function drain(state: GameState): void {
    let guard = 0;
    while (guard++ < 64) {
        processPendingActionTriggers(state);
        resolveTriggerOrder(state);
        if (state.stack.length === 0) break;
        resolveTopOfStack(state);
    }
    expect(guard, "drain did not terminate").toBeLessThan(64);
}

const life = (state: GameState, id: string) => getPlayer(state, id).life;
const handSize = (state: GameState, id: string) =>
    getPlayer(state, id).hand.length;

describe("Gift on a permanent (CR 702.174a/b/c)", () => {
    it("promised: the opponent draws as it enters, and its controller gives a gift", () => {
        withProbes([creatureProbe, watcher], () => {
            const state = board(creatureProbe, "p1");
            const before = {
                hand: handSize(state, "p2"),
                life: life(state, "p1"),
            };
            cast(state, true);
            drain(state);
            expect(
                getPlayer(state, "p1").battlefield.some(
                    (c) => c.id === "subject"
                )
            ).toBe(true);
            expect(handSize(state, "p2")).toBe(before.hand + 1);
            expect(life(state, "p1")).toBe(before.life + 1);
        });
    });

    it("not promised: no gift trigger, no draw, no gift given", () => {
        withProbes([creatureProbe, watcher], () => {
            const state = board(creatureProbe, "p1");
            const before = {
                hand: handSize(state, "p2"),
                life: life(state, "p1"),
            };
            cast(state, false);
            drain(state);
            expect(handSize(state, "p2")).toBe(before.hand);
            expect(life(state, "p1")).toBe(before.life);
        });
    });
});

describe("Gift on an instant or sorcery (CR 702.174b/c/d/f/h)", () => {
    it.each([
        ["food", "Food"],
        ["treasure", "Treasure"],
        ["tapped-fish", "Fish"],
    ] as const)(
        "promised %s: the opponent gets a %s, the spell's own text runs, a gift is given",
        (kind, tokenName) => {
            const def = spellProbe(kind);
            withProbes([def, watcher], () => {
                const state = board(def, "p1");
                const before = life(state, "p1");
                cast(state, true);
                drain(state);
                const gifted = getPlayer(state, "p2").battlefield.filter(
                    (c) =>
                        c.isToken === true &&
                        getDefinition((c.card as { id: string }).id).name ===
                            tokenName
                );
                expect(gifted).toHaveLength(1);
                // CR 702.174f — the Fish enters tapped; the others untapped.
                expect(gifted[0]!.isTapped).toBe(kind === "tapped-fish");
                // 3 from the spell, 1 from the give-a-gift trigger.
                expect(life(state, "p1")).toBe(before + 4);
            });
        }
    );

    it("not promised: the spell's own text only", () => {
        const def = spellProbe("food");
        withProbes([def, watcher], () => {
            const state = board(def, "p1");
            const before = life(state, "p1");
            cast(state, false);
            drain(state);
            expect(
                getPlayer(state, "p2").battlefield.filter((c) => c.isToken)
            ).toHaveLength(0);
            expect(life(state, "p1")).toBe(before + 3);
        });
    });

    it("CR 702.174j — a promised spell countered on resolution gives nothing", () => {
        withProbes([targetedProbe, watcher], () => {
            const state = board(targetedProbe, "p1");
            const before = {
                hand: handSize(state, "p2"),
                life: life(state, "p1"),
            };
            cast(state, true, [{ type: "permanent", id: "victim" }]);
            // The only target leaves before resolution (CR 608.2b).
            const p2 = getPlayer(state, "p2");
            p2.battlefield = p2.battlefield.filter((c) => c.id !== "victim");
            drain(state);
            expect(handSize(state, "p2")).toBe(before.hand);
            expect(life(state, "p1")).toBe(before.life);
        });
    });
});

describe("Whenever you give a gift — scope (CR 702.174c / 109.5)", () => {
    it("an opponent's gift does not trigger a 'you' watcher", () => {
        const def = spellProbe("card");
        withProbes([def, watcher], () => {
            const state = board(def, "p2");
            const before = life(state, "p2");
            cast(state, true);
            drain(state);
            expect(life(state, "p2")).toBe(before);
        });
    });
});
