// Split second (CR 702.61, issue #4007).
//
// CR 702.61a — "As long as this spell is on the stack, players can't cast other
// spells or activate abilities that aren't mana abilities."
// CR 702.61b — mana abilities, special actions and triggers are untouched.
//
// Driven through the real mutations (`gameMutationHarness.fixture`), the GRE seams
// the mutations and the wire read, and `projectPublicState`. Every refusal has a
// pair on a spell without the keyword, so a test cannot pass because the action
// was illegal for another reason. The Bot's side is `splitSecond.bot.test.ts`.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import {
    nonManaActivationLockedPlayers,
    splitSecondSpellOnStack,
} from "../../cards/abilities/splitSecond";
import { getCardByName, registerTokenDefinition } from "../../cards";
import {
    activateManaAbility,
    activatePlayerAbility,
    announceCast,
    foretellCard,
    tapUntap,
} from "../../game";
import {
    gameStateSeed,
    makeMutationCtx,
    runMutation,
    type Handler,
} from "../../__tests__/gameMutationHarness.fixture";
import type { Id } from "../../_generated/dataModel";
import { projectPublicState } from "../../gameProjections";
import { activateAbilityOnState } from "../activation";
import { turnFaceDown } from "../faceDown";
import { getLegalActions } from "../rules";
import { compactState, expandState } from "../serialize";
import {
    buildSpellContext,
    emitSpellCastEvent,
    getPlayer,
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../state";

const SPLIT_SECOND_SPELL = "test:split-second-instant";
registerTokenDefinition({
    id: SPLIT_SECOND_SPELL,
    rarity: "common",
    name: "Test Split Second Instant",
    manaCost: {},
    types: ["Instant"],
    staticAbilities: ["split second"],
    resolve: () => {},
});
const PLAIN_SPELL = "test:plain-instant";
registerTokenDefinition({
    id: PLAIN_SPELL,
    rarity: "common",
    name: "Test Plain Instant",
    manaCost: {},
    types: ["Instant"],
    resolve: () => {},
});
/** Casts a card from p1's hand as part of its own resolution (CR 608.2g). */
const RESOLUTION_CASTER = "test:split-second-resolution-caster";
registerTokenDefinition({
    id: RESOLUTION_CASTER,
    rarity: "common",
    name: "Test Resolution Caster",
    manaCost: {},
    types: ["Sorcery"],
    resolve: (ctx) => {
        ctx.castChosenSpell("p1", "response", "p1", { free: true });
    },
});
const FACE_DOWN_CASTER = "test:split-second-face-down-caster";
registerTokenDefinition({
    id: FACE_DOWN_CASTER,
    rarity: "common",
    name: "Test Face-Down Caster",
    manaCost: {},
    types: ["Sorcery"],
    resolve: (ctx) => ctx.castFaceDown("response"),
});
/** A mana ability with no {T} in its cost: `activateManaAbility` reads the shared
 *  precondition, unlike `tapUntap`. */
const MANA_SOURCE = "test:split-second-mana-source";
registerTokenDefinition({
    id: MANA_SOURCE,
    rarity: "common",
    name: "Test Mana Source",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "filter-mana",
            oracleText: "{R}: Add {G}.",
            useStack: false,
            cost: { mana: { R: 1 } },
            manaProduced: { G: 1 },
        },
    ],
});
const SPELL_COPIER = "test:split-second-copier";
registerTokenDefinition({
    id: SPELL_COPIER,
    rarity: "common",
    name: "Test Spell Copier",
    manaCost: {},
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    resolve: (ctx) => {
        const target = ctx.targets?.[0];
        if (target?.type === "spell") ctx.copyStackItem(target.id);
    },
});

const SHIVAN = getCardByName("Shivan Dragon").id;
const ENCHANTRESS = getCardByName("Verduran Enchantress").id;
const BEHOLD = getCardByName("Behold the Multiverse").id;
const ISLAND = getCardByName("Island").id;
const MOUNTAIN = getCardByName("Mountain").id;
const THINK_TWICE = getCardByName("Think Twice").id;
const CHANNEL = getCardByName("Channel").id;
const KAVU_CHAMELEON = getCardByName("Kavu Chameleon").id;

function own(
    cardId: string,
    id: string,
    zone: CardInstanceState["zone"]
): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone,
        isSummoningSick: false,
    });
}

/** p1 holds priority in their main phase with `stacked`, cast by p2, on the stack;
 *  `extras` is p1's side. */
function board(
    stacked: string,
    extras: Parameters<typeof makePlayer>[1] = {}
): GameState {
    const state = makeState({
        players: [makePlayer("p1", extras), makePlayer("p2")],
    });
    pushSpell(state, stacked, "p2");
    return state;
}

function bolt(): CardInstanceState {
    return own(getCardByName("Lightning Bolt").id, "response", "hand");
}

const withPool = (state: GameState, red = 1): GameState => {
    getPlayer(state, "p1").manaPool.R = red;
    return state;
};

type CardArgs = {
    gameId: Id<"games">;
    playerId: string;
    cardInstanceId: string;
};

const run = (
    harness: ReturnType<typeof makeMutationCtx>,
    handler: unknown,
    args: Record<string, unknown>
) =>
    runMutation<CardArgs, void>(
        handler as Handler<CardArgs, void>,
        harness.ctx,
        {
            gameId: "game-1" as Id<"games">,
            playerId: "p1",
            ...args,
        } as CardArgs
    );

describe("the lock is read off the stack (CR 702.61a)", () => {
    it("a spell with split second locks; a spell without it and an empty stack do not", () => {
        expect(splitSecondSpellOnStack(board(SPLIT_SECOND_SPELL))).toBe(true);
        expect(splitSecondSpellOnStack(board(PLAIN_SPELL))).toBe(false);
        expect(splitSecondSpellOnStack(makeState())).toBe(false);
    });

    it("multiple instances on the one spell are redundant (CR 702.61c)", () => {
        const state = board(PLAIN_SPELL);
        state.stack[0].staticAbilities = ["split second", "split second"];
        expect(splitSecondSpellOnStack(state)).toBe(true);
        state.stack.pop();
        expect(splitSecondSpellOnStack(state)).toBe(false);
    });

    it("functions only on the stack: a permanent with the keyword locks nothing", () => {
        const creature = own(SHIVAN, "kept", "battlefield");
        creature.staticAbilities = ["split second"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [creature], hand: [bolt()] }),
                makePlayer("p2"),
            ],
        });
        expect(splitSecondSpellOnStack(state)).toBe(false);
        expect(
            getLegalActions(withPool(state), getPlayer(state, "p1"), bolt())
        ).toContain("cast");
    });

    it("an ability on the stack spreading such a source locks nothing", () => {
        const state = makeState();
        const ability: StackItem = {
            ...own(SHIVAN, "ability", "stack"),
            staticAbilities: ["split second"],
            castById: "p1",
            abilityId: "shivan-dragon-pump",
        };
        state.stack.push(ability);
        expect(splitSecondSpellOnStack(state)).toBe(false);
    });

    it("a face-down spell has no abilities (CR 708.2)", () => {
        const state = board(SPLIT_SECOND_SPELL);
        turnFaceDown(state, state.stack[0], "cast-face-down");
        expect(splitSecondSpellOnStack(state)).toBe(false);
    });

    it("a copy of the spell has it (CR 707.2), and keeps the lock when the original is gone", () => {
        const state = board(SPLIT_SECOND_SPELL);
        const original = state.stack[0];
        pushSpell(state, SPELL_COPIER, "p1", [
            { type: "spell", id: original.id },
        ]);
        resolveTopOfStack(state);
        const copy = state.stack.find((s) => s.id !== original.id);
        expect(copy).toBeDefined();
        state.stack = [copy!];
        expect(splitSecondSpellOnStack(state)).toBe(true);
    });
});

describe("no other spell can be cast (CR 702.61a)", () => {
    it("takes the cast off a hand card, and the same card is castable over a plain spell", () => {
        const card = bolt();
        const locked = withPool(board(SPLIT_SECOND_SPELL, { hand: [card] }));
        expect(getLegalActions(locked, getPlayer(locked, "p1"), card)).toEqual(
            []
        );
        const open = withPool(board(PLAIN_SPELL, { hand: [card] }));
        expect(getLegalActions(open, getPlayer(open, "p1"), card)).toContain(
            "cast"
        );
    });

    it("takes the cast off a graveyard card (flashback, CR 702.34a)", () => {
        const card = own(THINK_TWICE, "response", "graveyard");
        const extras = {
            graveyard: [card],
            battlefield: Array.from({ length: 3 }, (_, i) =>
                own(ISLAND, `island${i}`, "battlefield")
            ),
        };
        const locked = board(SPLIT_SECOND_SPELL, extras);
        expect(
            getLegalActions(locked, getPlayer(locked, "p1"), card)
        ).not.toContain("cast");
        const open = board(PLAIN_SPELL, extras);
        expect(getLegalActions(open, getPlayer(open, "p1"), card)).toContain(
            "cast"
        );
    });

    it("the announceCast mutation refuses it and writes nothing", async () => {
        const locked = withPool(board(SPLIT_SECOND_SPELL, { hand: [bolt()] }));
        const harness = makeMutationCtx("p1", [gameStateSeed(locked)]);
        await expect(
            run(harness, announceCast, { cardInstanceId: "response" })
        ).rejects.toThrow();
        expect(harness.state().stack).toHaveLength(1);
        expect(harness.state().pendingCast).toBeUndefined();
    });

    it("the spell itself is cast normally, and the lock ends when it leaves the stack", async () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [own(SPLIT_SECOND_SPELL, "fast", "hand"), bolt()],
                }),
                makePlayer("p2"),
            ],
        });
        withPool(state);
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await run(harness, announceCast, {
            cardInstanceId: "fast",
            keepPriority: true,
        });
        const stacked = harness.state();
        expect(stacked.stack.map((s) => s.id)).toEqual(["fast"]);
        expect(splitSecondSpellOnStack(stacked)).toBe(true);
        const castOffered = () => {
            // Priority is the variable this test keeps out of the answer.
            stacked.priorityPlayerId = "p1";
            const me = getPlayer(stacked, "p1");
            return getLegalActions(stacked, me, me.hand[0]);
        };
        expect(castOffered()).toEqual([]);

        resolveTopOfStack(stacked);
        expect(stacked.stack).toHaveLength(0);
        expect(splitSecondSpellOnStack(stacked)).toBe(false);
        expect(castOffered()).toContain("cast");
    });

    it("refuses a cast during resolution while the spell sits below (CR 608.2g)", () => {
        const cast = (stacked: string) => {
            const state = board(stacked, { hand: [bolt()] });
            pushSpell(state, RESOLUTION_CASTER, "p1");
            resolveTopOfStack(state);
            return state.stack.some((s) => s.id === "response");
        };
        expect(cast(SPLIT_SECOND_SPELL)).toBe(false);
        expect(cast(PLAIN_SPELL)).toBe(true);
    });

    it("refuses a face-down cast during resolution (CR 708.2)", () => {
        const cast = (stacked: string) => {
            const state = board(stacked, { hand: [bolt()] });
            const resolving = pushSpell(state, FACE_DOWN_CASTER, "p1");
            buildSpellContext(state, resolving).castFaceDown("response");
            return state.stack.some((s) => s.id === "response");
        };
        expect(cast(SPLIT_SECOND_SPELL)).toBe(false);
        expect(cast(PLAIN_SPELL)).toBe(true);
    });
});

describe("no ability that isn't a mana ability can be activated (CR 702.61a)", () => {
    const dragonBoard = (stacked: string) =>
        withPool(
            board(stacked, {
                battlefield: [own(SHIVAN, "dragon", "battlefield")],
            })
        );

    it("refuses a stack ability, which is legal over a plain spell", () => {
        const args = {
            playerId: "p1",
            cardInstanceId: "dragon",
            abilityId: "shivan-dragon-pump",
        };
        const locked = dragonBoard(SPLIT_SECOND_SPELL);
        expect(() => activateAbilityOnState(locked, args)).toThrow(
            "split second"
        );
        expect(locked.stack).toHaveLength(1);
        const open = dragonBoard(PLAIN_SPELL);
        activateAbilityOnState(open, args);
        expect(open.stack).toHaveLength(2);
    });

    it("refuses a targeted stack ability before it opens a target selection", () => {
        const sorcerer = own(
            getCardByName("Prodigal Sorcerer").id,
            "pinger",
            "battlefield"
        );
        const locked = board(SPLIT_SECOND_SPELL, { battlefield: [sorcerer] });
        const abilityId =
            getCardByName("Prodigal Sorcerer").activatedAbilities![0].id;
        expect(() =>
            activateAbilityOnState(locked, {
                playerId: "p1",
                cardInstanceId: "pinger",
                abilityId,
            })
        ).toThrow("split second");
        expect(locked.pendingTarget).toBeUndefined();
    });

    it("leaves a mana ability legal: the tapUntap mutation still adds the mana (CR 702.61b)", async () => {
        const state = board(SPLIT_SECOND_SPELL, {
            battlefield: [own(MOUNTAIN, "mountain", "battlefield")],
        });
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await run(harness, tapUntap, { cardInstanceId: "mountain" });
        const after = getPlayer(harness.state(), "p1");
        expect(after.battlefield[0].isTapped).toBe(true);
        expect(after.manaPool.R).toBe(1);
    });

    it("split second leaves a mana ability legal through activateManaAbility (CR 702.61b)", async () => {
        const state = withPool(
            board(SPLIT_SECOND_SPELL, {
                battlefield: [own(MANA_SOURCE, "source", "battlefield")],
            })
        );
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await run(harness, activateManaAbility, {
            cardInstanceId: "source",
            abilityId: "filter-mana",
        });
        expect(getPlayer(harness.state(), "p1").manaPool.G).toBe(1);
    });

    it("split second leaves a mana ability declaring only a chooser legal (CR 702.61b)", async () => {
        const vivi = getCardByName("Vivi Ornitier");
        const ability = vivi.activatedAbilities!.find((a) => !a.useStack)!;
        expect(ability.manaProduced ?? ability.manaChoices).toBeUndefined();
        const state = board(SPLIT_SECOND_SPELL, {
            battlefield: [
                {
                    ...own(vivi.id, "vivi", "battlefield"),
                    counters: { "+1/+1": 2 },
                },
            ],
        });
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await run(harness, activateManaAbility, {
            cardInstanceId: "vivi",
            abilityId: ability.id,
            manaChoiceIndex: 0,
        });
        const pool = getPlayer(harness.state(), "p1").manaPool;
        expect(pool.U + pool.R).toBeGreaterThan(0);
    });

    it("a player-level grant: stack refused, mana allowed (CR 702.61a, CR 702.61b)", async () => {
        const seed = makeState();
        pushSpell(seed, CHANNEL, "p1");
        resolveTopOfStack(seed);
        const channelGrant = seed.players[0].grantedAbilities![0];
        const state = board(SPLIT_SECOND_SPELL, {
            grantedAbilities: [
                channelGrant,
                {
                    id: "stack-grant",
                    sourceCardId: KAVU_CHAMELEON,
                    abilityId: "kavu-chameleon-color",
                    duration: { phase: "end-of-turn" as const },
                    grantedAtTurn: 1,
                },
            ],
        });
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await expect(
            run(harness, activatePlayerAbility, {
                grantedAbilityInstanceId: "stack-grant",
            })
        ).rejects.toThrow("split second");
        await run(harness, activatePlayerAbility, {
            grantedAbilityInstanceId: channelGrant.id,
        });
        expect(getPlayer(harness.state(), "p1").manaPool.C).toBe(1);
    });
});

describe("what the lock leaves alone (CR 702.61b)", () => {
    it("a special action: foretelling still goes through the mutation", async () => {
        const state = board(SPLIT_SECOND_SPELL, {
            hand: [own(BEHOLD, "omen", "hand")],
            battlefield: [
                own(ISLAND, "land0", "battlefield"),
                own(ISLAND, "land1", "battlefield"),
            ],
        });
        const harness = makeMutationCtx("p1", [gameStateSeed(state)]);
        await run(harness, foretellCard, { cardInstanceId: "omen" });
        expect(
            getPlayer(harness.state(), "p1").exile.map((c) => c.id)
        ).toContain("omen");
    });

    it("a trigger triggers and goes on the stack above the spell", () => {
        const state = board(PLAIN_SPELL, {
            battlefield: [own(ENCHANTRESS, "enchantress", "battlefield")],
        });
        state.stack = [];
        const cast = pushSpell(state, SPLIT_SECOND_SPELL, "p1");
        cast.types = ["Enchantment"];
        emitSpellCastEvent(state, cast);
        processPendingActionTriggers(state);
        expect(state.stack).toHaveLength(2);
        expect(state.stack[1].triggeredAbilityId).toBeDefined();
        expect(splitSecondSpellOnStack(state)).toBe(true);
    });
});

describe("the wire (CR 702.61a)", () => {
    it("the projected stack carries the lock and the hand loses its cast", () => {
        const state = withPool(board(SPLIT_SECOND_SPELL, { hand: [bolt()] }));
        const projected = projectPublicState(state, 1, "p1");
        expect(splitSecondSpellOnStack(projected)).toBe(true);
        expect(projected.players[0].hand[0]?.legalActions).toEqual([]);
        expect(nonManaActivationLockedPlayers(projected)).toEqual(["p1", "p2"]);
    });

    it("the hand keeps its cast over a plain spell, and the Abeyance lock passes through", () => {
        const state = withPool(board(PLAIN_SPELL, { hand: [bolt()] }));
        state.cannotActivateAbilitiesThisTurn = ["p2"];
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand[0]?.legalActions).toContain("cast");
        expect(nonManaActivationLockedPlayers(projected)).toEqual(["p2"]);
    });

    it("a face-down spell's projection locks nothing for either viewer", () => {
        const state = board(SPLIT_SECOND_SPELL);
        turnFaceDown(state, state.stack[0], "cast-face-down");
        for (const viewer of ["p1", "p2"]) {
            expect(
                splitSecondSpellOnStack(projectPublicState(state, 1, viewer))
            ).toBe(false);
        }
    });

    it("survives the persistence round trip", () => {
        const state = board(SPLIT_SECOND_SPELL);
        expect(splitSecondSpellOnStack(expandState(compactState(state)))).toBe(
            true
        );
    });
});
