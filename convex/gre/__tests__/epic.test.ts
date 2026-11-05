// Epic (CR 702.50).
//
// CR 702.50a — "'Epic' means 'For the rest of the game, you can't cast spells,'
// and 'At the beginning of each of your upkeeps for the rest of the game, copy
// this spell except for its epic ability. If the spell has any targets, you may
// choose new targets for the copy.'"
// CR 702.50b — "A player can't cast spells once a spell with epic they control
// resolves, but effects (such as the epic ability itself) can still put copies of
// spells onto the stack."
//
// Driven through the production path: `resolveTopOfStack` → `advancePhase` →
// `fireDelayedTriggers` → `resolveTopOfStack`.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { castProhibitionReason } from "../../cards/castRestrictions";
import { withTemporaryDefinition } from "../../cards/registry";
import { grizzlyBears } from "../../cards/sets/lea/index.cards";
import type { CardDefinition, PermanentView } from "../../cards/types";
import { finalizeTargetSelection } from "../../game";
import { projectPublicState } from "../../gameProjections";
import { advancePhase } from "../phases";
import { playerHasRestriction } from "../playerRestrictions";
import { getLegalActions } from "../rules";
import { compactState, expandState } from "../serialize";
import {
    buildSpellContext,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../state";

const EPIC_GAIN: CardDefinition = {
    id: "test-only-epic-gain",
    rarity: "rare",
    name: "Test Epic Gain",
    oracleText: "You gain 2 life.\nEpic",
    manaCost: { X: 1 },
    types: ["Sorcery"],
    staticAbilities: ["epic"],
    effects: [{ op: "gainLife", amount: 2, player: "controller" }],
};

const EPIC_SHOCK: CardDefinition = {
    id: "test-only-epic-shock",
    rarity: "rare",
    name: "Test Epic Shock",
    oracleText: "Test Epic Shock deals 2 damage to any target.\nEpic",
    manaCost: { X: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "any", count: 1 },
    staticAbilities: ["epic"],
    effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
};

const FILLER: CardDefinition = {
    id: "test-only-epic-filler",
    rarity: "common",
    name: "Test Filler",
    oracleText: "",
    manaCost: { X: 1 },
    types: ["Instant"],
    effects: [{ op: "gainLife", amount: 1, player: "controller" }],
};

function withDefinitions(body: () => void): void {
    withTemporaryDefinition(EPIC_GAIN, () =>
        withTemporaryDefinition(EPIC_SHOCK, () =>
            withTemporaryDefinition(FILLER, body)
        )
    );
}

function library(owner: string) {
    return Array.from({ length: 30 }, (_, i) =>
        makeInstance(grizzlyBears().id, {
            id: `lib-${owner}-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: "library",
        })
    );
}

function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1", { library: library("p1") }),
            makePlayer("p2", { library: library("p2") }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

function life(state: GameState, playerId: string): number {
    return state.players.find((p) => p.id === playerId)!.life;
}

function graveyardCount(state: GameState, playerId: string): number {
    return state.players.find((p) => p.id === playerId)!.graveyard.length;
}

function advanceToUpkeepOf(state: GameState, playerId: string): void {
    for (let i = 0; i < 40; i++) {
        advancePhase(state);
        if (state.phase === "UPKEEP" && state.activePlayerId === playerId) {
            return;
        }
        state.stack = [];
    }
    throw new Error("never reached the upkeep");
}

const epicTriggers = (state: GameState) =>
    state.stack.filter((s) => s.triggeredAbilityId === "epic");

/** Resolves the firing and the copy it put on the stack. */
function resolveFiringAndCopy(state: GameState): void {
    resolveTopOfStack(state);
    resolveTopOfStack(state);
}

function handSpell(cardId: string, owner: string) {
    return makeInstance(cardId, {
        id: `hand-${owner}`,
        controllerId: owner,
        ownerId: owner,
        zone: "hand",
    });
}

describe("Epic's cast lock (CR 702.50a, 702.50b)", () => {
    it("forbids its controller every later spell, through the legal actions", () => {
        withDefinitions(() => {
            const state = board();
            const p1 = state.players[0];
            const spell = handSpell(FILLER.id, "p1");
            p1.hand = [spell];
            p1.manaPool = { ...p1.manaPool, C: 5 };
            const castable = () =>
                getLegalActions(state, p1, spell).includes("cast");
            expect(castable()).toBe(true);
            pushSpell(state, EPIC_GAIN.id, "p1");
            resolveTopOfStack(state);
            expect(playerHasRestriction(state, "p1", "cantCastSpells")).toBe(
                true
            );
            expect(castable()).toBe(false);
        });
    });

    it("leaves the other player free to cast", () => {
        withDefinitions(() => {
            const state = board();
            pushSpell(state, EPIC_GAIN.id, "p1");
            resolveTopOfStack(state);
            const spell = handSpell(FILLER.id, "p2");
            expect(
                castProhibitionReason(
                    "p2",
                    spell as unknown as PermanentView,
                    state
                )
            ).toBeUndefined();
        });
    });

    it("does not apply while the spell is only on the stack", () => {
        withDefinitions(() => {
            const state = board();
            pushSpell(state, EPIC_GAIN.id, "p1");
            expect(playerHasRestriction(state, "p1", "cantCastSpells")).toBe(
                false
            );
        });
    });

    it("the client's gate reads the lock off the projected state", () => {
        withDefinitions(() => {
            const state = board();
            pushSpell(state, EPIC_GAIN.id, "p1");
            resolveTopOfStack(state);
            const projected = projectPublicState(state, 1, "p1");
            const spell = handSpell(FILLER.id, "p1");
            expect(
                castProhibitionReason(
                    "p1",
                    spell as unknown as PermanentView,
                    projected as never
                )
            ).toBe("That player can't cast spells for the rest of the game.");
        });
    });

    it("outlasts the turn it started on", () => {
        withDefinitions(() => {
            const state = board();
            pushSpell(state, EPIC_GAIN.id, "p1");
            resolveTopOfStack(state);
            advanceToUpkeepOf(state, "p2");
            state.stack = [];
            advanceToUpkeepOf(state, "p1");
            expect(playerHasRestriction(state, "p1", "cantCastSpells")).toBe(
                true
            );
        });
    });
});

describe("A spell that does not resolve has no epic (CR 702.50a, 608.2b)", () => {
    it("schedules nothing and locks no one when its only target is gone", () => {
        withDefinitions(() => {
            const state = board();
            pushSpell(state, EPIC_SHOCK.id, "p1", [
                { type: "permanent", id: "gone" },
            ]);
            resolveTopOfStack(state);
            expect(graveyardCount(state, "p1")).toBe(1);
            expect(playerHasRestriction(state, "p1", "cantCastSpells")).toBe(
                false
            );
            expect(state.delayedTriggers).toBeUndefined();
        });
    });
});

describe("Epic's upkeep trigger (CR 702.50a)", () => {
    it("copies the spell at each of its controller's upkeeps, not the opponent's", () => {
        withDefinitions(() => {
            const state = board();
            pushSpell(state, EPIC_GAIN.id, "p1");
            resolveTopOfStack(state);
            const afterOriginal = life(state, "p1");
            expect(afterOriginal).toBe(22);

            advanceToUpkeepOf(state, "p2");
            expect(epicTriggers(state)).toHaveLength(0);

            advanceToUpkeepOf(state, "p1");
            expect(epicTriggers(state)).toHaveLength(1);
            resolveFiringAndCopy(state);
            expect(life(state, "p1")).toBe(24);

            advanceToUpkeepOf(state, "p2");
            advanceToUpkeepOf(state, "p1");
            expect(epicTriggers(state)).toHaveLength(1);
            resolveFiringAndCopy(state);
            expect(life(state, "p1")).toBe(26);
        });
    });

    it("gives the trigger to the spell's controller and the priority to the active player", () => {
        withDefinitions(() => {
            const state = board();
            pushSpell(state, EPIC_GAIN.id, "p1");
            resolveTopOfStack(state);
            advanceToUpkeepOf(state, "p1");
            const [trigger] = epicTriggers(state);
            expect(trigger.controllerId).toBe("p1");
            expect(trigger.targets).toBeUndefined();
            expect(state.priorityPlayerId).toBe("p1");
        });
    });

    it("the copy is a spell on the stack that was not cast, in spite of the lock", () => {
        withDefinitions(() => {
            const state = board();
            pushSpell(state, EPIC_GAIN.id, "p1");
            resolveTopOfStack(state);
            advanceToUpkeepOf(state, "p1");
            state.spellsCastThisTurn = 0;
            resolveTopOfStack(state);
            const copy = state.stack.at(-1)!;
            expect(copy.isCopy).toBe(true);
            expect(copy.triggeredAbilityId).toBeUndefined();
            expect(state.spellsCastThisTurn).toBe(0);
        });
    });

    it("the copy has no epic ability, so it never schedules a second trigger", () => {
        withDefinitions(() => {
            const state = board();
            pushSpell(state, EPIC_GAIN.id, "p1");
            resolveTopOfStack(state);
            advanceToUpkeepOf(state, "p1");
            resolveTopOfStack(state);
            expect(state.stack.at(-1)!.staticAbilities).not.toContain("epic");
            resolveTopOfStack(state);
            expect(state.delayedTriggers).toHaveLength(1);
        });
    });

    it("the copy ceases to exist: the graveyard holds only the original", () => {
        withDefinitions(() => {
            const state = board();
            pushSpell(state, EPIC_GAIN.id, "p1");
            resolveTopOfStack(state);
            expect(graveyardCount(state, "p1")).toBe(1);
            advanceToUpkeepOf(state, "p1");
            resolveFiringAndCopy(state);
            expect(graveyardCount(state, "p1")).toBe(1);
            expect(state.stack).toHaveLength(0);
        });
    });

    it("still copies when the card has since left the graveyard", () => {
        withDefinitions(() => {
            const state = board();
            pushSpell(state, EPIC_GAIN.id, "p1");
            resolveTopOfStack(state);
            state.players[0].graveyard = [];
            advanceToUpkeepOf(state, "p1");
            resolveFiringAndCopy(state);
            expect(life(state, "p1")).toBe(24);
        });
    });

    it("copies the decisions made for the spell (CR 707.10)", () => {
        withDefinitions(() => {
            const state = board();
            const spell = pushSpell(state, EPIC_GAIN.id, "p1");
            spell.chosenX = 3;
            resolveTopOfStack(state);
            advanceToUpkeepOf(state, "p1");
            resolveTopOfStack(state);
            expect(state.stack.at(-1)!.chosenX).toBe(3);
        });
    });
});

describe("New targets for the copy (CR 702.50a, 707.10c)", () => {
    function firedShock(): GameState {
        const state = board();
        pushSpell(state, EPIC_SHOCK.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        advanceToUpkeepOf(state, "p1");
        resolveTopOfStack(state);
        return state;
    }

    it("offers the trigger's controller a new target", () => {
        withDefinitions(() => {
            const state = firedShock();
            expect(state.pendingTarget?.kind).toBe("copy-retarget");
            expect(state.pendingTarget?.playerId).toBe("p1");
        });
    });

    it("keeps the original's target on the copy until it is changed", () => {
        withDefinitions(() => {
            const state = firedShock();
            const copy = state.stack.find((s) => s.isCopy)!;
            expect(copy.targets).toEqual([{ type: "player", id: "p2" }]);
        });
    });

    it("the answer lands on the copy, and the copy hits the new target", () => {
        withDefinitions(() => {
            const state = firedShock();
            const prompt = state.pendingTarget!;
            prompt.selected = [{ type: "player", id: "p1" }];
            finalizeTargetSelection(state, prompt, "p1");
            expect(epicTriggers(state)).toHaveLength(1);
            resolveTopOfStack(state);
            expect(epicTriggers(state)).toHaveLength(0);
            expect(state.pendingTarget).toBeUndefined();
            resolveTopOfStack(state);
            expect(life(state, "p1")).toBe(18);
            expect(life(state, "p2")).toBe(18);
        });
    });
});

describe("A copy of an epic spell made by another effect keeps epic (CR 707.2)", () => {
    it("locks the copier and gives them a trigger of their own", () => {
        withDefinitions(() => {
            const state = board();
            const epic = pushSpell(state, EPIC_GAIN.id, "p1");
            const fork = pushSpell(state, FILLER.id, "p2");
            buildSpellContext(state, fork).copyStackItem(epic.id, {
                controllerId: "p2",
            });
            state.stack = state.stack.filter((s) => s.id !== fork.id);
            resolveTopOfStack(state);
            expect(playerHasRestriction(state, "p2", "cantCastSpells")).toBe(
                true
            );
            expect(playerHasRestriction(state, "p1", "cantCastSpells")).toBe(
                false
            );
            expect(state.delayedTriggers?.[0]?.controller).toBe("p2");
            expect(graveyardCount(state, "p2")).toBe(0);
        });
    });
});

describe("Epic across the save and the wire", () => {
    function afterEpic(): GameState {
        const state = board();
        pushSpell(state, EPIC_GAIN.id, "p1");
        resolveTopOfStack(state);
        return state;
    }

    const reload = (state: GameState) =>
        expandState(structuredClone(compactState(state)));

    it("a reloaded game still copies, still without epic", () => {
        withDefinitions(() => {
            const state = reload(afterEpic());
            expect(state.delayedTriggers?.[0]?.timing).toBe("each-own-upkeep");
            advanceToUpkeepOf(state, "p1");
            const reloaded = reload(state);
            resolveTopOfStack(reloaded);
            const copy = reloaded.stack.at(-1)!;
            expect(copy.isCopy).toBe(true);
            expect(copy.staticAbilities).not.toContain("epic");
            resolveTopOfStack(reloaded);
            expect(life(reloaded, "p1")).toBe(24);
            expect(reloaded.delayedTriggers).toHaveLength(1);
            expect(playerHasRestriction(reloaded, "p1", "cantCastSpells")).toBe(
                true
            );
        });
    });

    it("the save slims the held spell", () => {
        withDefinitions(() => {
            const compact = compactState(afterEpic()) as unknown as {
                delayedTriggers: { spellToCopy: Record<string, unknown> }[];
            };
            // `types` coalesces away against the definition in a compact card.
            expect(
                compact.delayedTriggers[0].spellToCopy.types
            ).toBeUndefined();
        });
    });

    it("the wire ships the held spell without its card definition", () => {
        withDefinitions(() => {
            const state = afterEpic();
            const instance = state.delayedTriggers![0];
            (instance.spellToCopy as StackItem).card = EPIC_GAIN as never;
            const projected = projectPublicState(state, 1, "p2");
            expect(projected.delayedTriggers?.[0]?.spellToCopy?.card).toEqual({
                id: EPIC_GAIN.id,
            });
        });
    });

    it("the firing crosses the wire as an ability of the spell's card", () => {
        withDefinitions(() => {
            const state = afterEpic();
            advanceToUpkeepOf(state, "p1");
            const projected = projectPublicState(state, 1, "p2");
            const item = projected.stack.at(-1)!;
            expect(item.triggeredAbilityId).toBe("epic");
            expect((item.card as { id: string }).id).toBe(EPIC_GAIN.id);
        });
    });
});
