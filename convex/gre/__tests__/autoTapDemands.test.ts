// Unit tests for the hand-spell Demand builder and its timing filter
// (PRD #472, ADR 0034). Issue #474 ships the spine; issue #475 adds the
// timing-aware filter: a sorcery-speed hand spell counts as a preservable
// Demand only at sorcery timing (CR 307.1 / 601.3a), while instant-speed
// spells (Instants and Flash cards, CR 702.8) count in any priority window.

import { describe, it, expect } from "vitest";
import {
    buildBoardAbilityDemands,
    buildCastPermanentAbilityDemands,
    buildHandSpellDemands,
} from "../autoTapDemands";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import { beginApplyingStaticEffects, type PendingCast } from "../state";
import type { Phase } from "../types";

// Card instance ids → definitions (verified in the set files).
const COUNTERSPELL = "0df55e3f-14de-46ef-b6b1-616618724d9e"; // {U}{U} Instant
const SAVANNAH_LIONS = "d05b92bd-797e-413f-a8b0-32e0937a1ee0"; // {W} Creature
const TIME_WALK = "e0139f60-d48e-46fb-9f5a-1e3d7558c834"; // {1}{U} Sorcery
const FOREST = "6f1c8cb0-38eb-408b-94e8-16db83999b3b"; // basic Land
const FIREBALL = "b7623c00-144b-4a8f-9c6c-f5e9e4f65ece"; // {X}{R} Sorcery
const POWER_SINK = "1b342dd3-09b9-4108-bf12-a65d4cef4eb9"; // {X}{U} Instant
// Shivan Dragon — "{R}: This creature gets +1/+0" (firebreathing, instant-speed).
const SHIVAN_DRAGON = "fefbf149-f988-4f8b-9f53-56f5878116a6";
// Jade Statue — "{2}: becomes a 3/6 ... Activate only during combat".
const JADE_STATUE = "8d82d94b-ceef-4533-a4f2-b6442a61b839";

function inHand(cardId: string, id: string) {
    return makeInstance(cardId, { id, controllerId: "p1", zone: "hand" });
}

const ids = (demands: { id: string }[]) => demands.map((d) => d.id).sort();

describe("buildHandSpellDemands — timing filter (issue #475, CR 307 / 601.3a)", () => {
    it("at sorcery timing, sorcery-speed and instant-speed spells both count", () => {
        const hand = [
            inHand(COUNTERSPELL, "cs"),
            inHand(SAVANNAH_LIONS, "lions"),
            inHand(TIME_WALK, "walk"),
        ];
        // Cast the Counterspell; the other two are candidate Demands.
        const demands = buildHandSpellDemands(
            hand,
            "cs",
            /* sorceryTiming */ true
        );
        expect(ids(demands)).toEqual(["lions", "walk"]);
    });

    it("at instant timing, sorcery-speed spells (creatures/sorceries) are filtered out", () => {
        const hand = [
            inHand(COUNTERSPELL, "cs"),
            inHand(SAVANNAH_LIONS, "lions"),
            inHand(TIME_WALK, "walk"),
        ];
        // Cast some instant off-turn (sorceryTiming=false): only the
        // instant-speed Counterspell remains a Demand; the creature and the
        // sorcery are not legally castable now, so no mana is held for them.
        const demands = buildHandSpellDemands(hand, "other", false);
        expect(ids(demands)).toEqual(["cs"]);
    });

    it("the instant being cast is still excluded from its own Demand set", () => {
        const hand = [inHand(COUNTERSPELL, "cs"), inHand(COUNTERSPELL, "cs2")];
        const demands = buildHandSpellDemands(hand, "cs", false);
        // The second Counterspell is still an instant-speed Demand.
        expect(ids(demands)).toEqual(["cs2"]);
    });

    it("a Flash card counts as a Demand at instant timing (CR 702.8)", () => {
        // Synthesize a Flash creature: a Savannah Lions instance with the flash
        // keyword granted. hasInstantSpeed keys off types/staticAbilities, so a
        // creature-with-flash is treated as instant-speed.
        const flashLion = makeInstance(SAVANNAH_LIONS, {
            id: "flion",
            controllerId: "p1",
            zone: "hand",
            staticAbilities: ["flash"],
        });
        const demands = buildHandSpellDemands([flashLion], "other", false);
        expect(ids(demands)).toEqual(["flion"]);
    });

    it("lands never count, at either timing", () => {
        const hand = [inHand(FOREST, "forest"), inHand(COUNTERSPELL, "cs")];
        expect(ids(buildHandSpellDemands(hand, "x", true))).toEqual(["cs"]);
        expect(ids(buildHandSpellDemands(hand, "x", false))).toEqual(["cs"]);
    });
});

describe("buildHandSpellDemands — X-spell inflation at X=1 (issue #477, CR 107.3 / 601.2b)", () => {
    const costOf = (cardId: string) => {
        const demands = buildHandSpellDemands(
            [inHand(cardId, "x")],
            "other",
            /* sorceryTiming */ true
        );
        return demands[0]?.cost;
    };

    it("a {X}{R} sorcery is preserved as {R}+1 generic (assumed X=1), not just {R}", () => {
        // Fireball ({X}{R}): without inflation X=0 → {R:1}; the spell would be
        // under-preserved and could be stranded. At X=1 it is {R:1, X:1}.
        expect(costOf(FIREBALL)).toEqual({ R: 1, X: 1 });
    });

    it("a {X}{U} instant is preserved as {U}+1 generic at X=1", () => {
        // Power Sink ({X}{U}) — instant, counts at any timing; demanded at X=1.
        const demands = buildHandSpellDemands(
            [inHand(POWER_SINK, "x")],
            "other",
            /* sorceryTiming */ false
        );
        expect(demands[0]?.cost).toEqual({ U: 1, X: 1 });
    });

    it("a fixed (non-variable) cost is untouched by the X=1 assumption", () => {
        // Time Walk's {1}{U} has a plain numeric generic, not a variable {X};
        // the chosenX=1 fold must NOT add a phantom extra generic to it.
        expect(costOf(TIME_WALK)).toEqual({ U: 1, X: 1 });
    });
});

function onBoard(cardId: string, id: string) {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        zone: "battlefield",
    });
}

const MAIN: Phase = "PRECOMBAT_MAIN";
const COMBAT: Phase = "DECLARE_ATTACKERS";
const myTurn = {
    phase: MAIN,
    isControllersTurn: true,
    isSorceryTiming: true,
};

/** The board the Demands are built against. `buildBoardAbilityDemands` folds
 *  the CR 601.2f cost modifiers (ADR 0096), which are board-wide, so it needs
 *  the whole state rather than the bare battlefield array. */
function stateWith(battlefield: ReturnType<typeof makeInstance>[]) {
    return makeState({
        players: [makePlayer("p1", { battlefield }), makePlayer("p2")],
    });
}

describe("buildBoardAbilityDemands — on-board activated abilities (issue #476, CR 602.1)", () => {
    it("a firebreathing ability ({R}: +1/+0) becomes a {R} Demand", () => {
        const shiv = [onBoard(SHIVAN_DRAGON, "shiv")];
        const demands = buildBoardAbilityDemands(stateWith(shiv), shiv, myTurn);
        expect(ids(demands)).toEqual(["shiv#shivan-dragon-ability"]);
        expect(demands[0].cost).toEqual({ R: 1 });
    });

    it("a repeatable ability is counted ONCE, not per activation (PRD story 12)", () => {
        // One firebreathing creature must yield exactly one Demand regardless of
        // how many times it could be re-activated.
        const shiv = [onBoard(SHIVAN_DRAGON, "shiv")];
        const demands = buildBoardAbilityDemands(stateWith(shiv), shiv, myTurn);
        expect(demands).toHaveLength(1);
    });

    it("two distinct firebreathing creatures are two distinct Demands", () => {
        const shivs = [
            onBoard(SHIVAN_DRAGON, "shivA"),
            onBoard(SHIVAN_DRAGON, "shivB"),
        ];
        const demands = buildBoardAbilityDemands(
            stateWith(shivs),
            shivs,
            myTurn
        );
        expect(ids(demands)).toEqual([
            "shivA#shivan-dragon-ability",
            "shivB#shivan-dragon-ability",
        ]);
    });

    it("instant-speed abilities count in any window (off-turn included)", () => {
        // Shivan's pump has no timing restriction → instant-speed (CR 602.5b).
        const offTurn = {
            phase: MAIN,
            isControllersTurn: false,
            isSorceryTiming: false,
        };
        const shiv = [onBoard(SHIVAN_DRAGON, "shiv")];
        const demands = buildBoardAbilityDemands(
            stateWith(shiv),
            shiv,
            offTurn
        );
        expect(ids(demands)).toEqual(["shiv#shivan-dragon-ability"]);
    });

    it("a phase-restricted ability counts only in its phase (Jade Statue, combat-only)", () => {
        const statue = [onBoard(JADE_STATUE, "jade")];
        // Main phase, own turn: NOT activatable now → not a Demand.
        expect(
            buildBoardAbilityDemands(stateWith(statue), statue, myTurn)
        ).toHaveLength(0);
        // During combat: activatable → a {2} Demand.
        const inCombat = buildBoardAbilityDemands(stateWith(statue), statue, {
            phase: COMBAT,
            isControllersTurn: true,
            isSorceryTiming: false,
        });
        expect(ids(inCombat)).toEqual(["jade#jade-statue-animate"]);
        expect(inCombat[0].cost).toEqual({ X: 2 }); // generic {2}
    });

    it("suppressed permanents (CR 613.1f) expose no ability Demands", () => {
        const suppressed = makeInstance(SHIVAN_DRAGON, {
            id: "shiv",
            controllerId: "p1",
            zone: "battlefield",
            abilitiesSuppressedBy: [{ sourceId: "humility", seq: 1 }],
        });
        expect(
            buildBoardAbilityDemands(
                stateWith([suppressed]),
                [suppressed],
                myTurn
            )
        ).toHaveLength(0);
    });

    it("a permanent with no mana-costed activated ability yields nothing", () => {
        // Savannah Lions is a vanilla creature — no activated abilities.
        const lions = [onBoard(SAVANNAH_LIONS, "lions")];
        expect(
            buildBoardAbilityDemands(stateWith(lions), lions, myTurn)
        ).toHaveLength(0);
    });
});

const notSorcery = { ...myTurn, isSorceryTiming: false };

describe("buildBoardAbilityDemands — an unactivatable ability reserves nothing (CR 602.5)", () => {
    const demandIds = (
        perm: ReturnType<typeof makeInstance>,
        timing: typeof myTurn
    ) => ids(buildBoardAbilityDemands(stateWith([perm]), [perm], timing));
    const named = (name: string, over: Record<string, unknown> = {}) =>
        makeInstance(getCardByName(name).id, {
            id: "perm",
            controllerId: "p1",
            zone: "battlefield",
            ...over,
        });

    it("Equip counts only at sorcery timing (CR 602.5d)", () => {
        const clamp = named("Skullclamp");
        expect(demandIds(clamp, myTurn)).toEqual(["perm#skullclamp-equip"]);
        expect(demandIds(clamp, notSorcery)).toEqual([]);
    });

    it("a {T} cost counts only for an untapped creature that is not summoning sick (CR 302.6)", () => {
        expect(demandIds(named("Savaen Elves"), myTurn)).toHaveLength(1);
        expect(
            demandIds(named("Savaen Elves", { isTapped: true }), myTurn)
        ).toEqual([]);
        expect(
            demandIds(named("Savaen Elves", { isSummoningSick: true }), myTurn)
        ).toEqual([]);
    });

    it("Cycling on a battlefield permanent does not count (CR 113.6)", () => {
        expect(demandIds(named("Barkhide Mauler"), myTurn)).toEqual([]);
    });
});

describe("buildCastPermanentAbilityDemands — the permanent being cast (issue #10465, CR 117.3b)", () => {
    /** Demands of casting `name` with `board` on p1's side (`oppBoard` on p2's). */
    function castDemands(
        name: string,
        opts: {
            timing?: typeof myTurn;
            board?: string[];
            oppBoard?: string[];
            pending?: Partial<PendingCast>;
        } = {}
    ) {
        const card = inHand(getCardByName(name).id, "cast");
        const state = makeState({
            phase: MAIN,
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [card],
                    battlefield: (opts.board ?? []).map((n, i) =>
                        onBoard(getCardByName(n).id, `b${i}`)
                    ),
                }),
                makePlayer("p2", {
                    battlefield: (opts.oppBoard ?? []).map((n, i) =>
                        makeInstance(getCardByName(n).id, {
                            id: `o${i}`,
                            controllerId: "p2",
                            ownerId: "p2",
                        })
                    ),
                }),
            ],
        });
        for (const player of state.players) {
            for (const perm of player.battlefield) {
                beginApplyingStaticEffects(state, perm);
            }
        }
        const before = structuredClone(state);
        const demands = buildCastPermanentAbilityDemands(
            state,
            {
                playerId: "p1",
                cardInstanceId: "cast",
                manaCost: {},
                tappedLandIds: [],
                ...opts.pending,
            },
            card,
            opts.timing ?? myTurn
        );
        // The arrival is simulated: the live state is untouched.
        expect(state).toEqual(before);
        return demands;
    }

    it("each mana-costed ability of a cast artifact is a Demand", () => {
        expect(
            castDemands("Pyrite Spellbomb", { timing: notSorcery }).map(
                (d) => d.cost
            )
        ).toEqual([{ R: 1 }, { X: 1 }]);
    });

    it("a {T} ability of a creature it enters summoning sick with is none (CR 302.6)", () => {
        expect(castDemands("Savaen Elves")).toEqual([]);
    });

    it("the same {T} ability counts when a static gives the creature haste (CR 702.10b)", () => {
        expect(ids(castDemands("Savaen Elves", { board: ["Fervor"] }))).toEqual(
            ["cast#savaen-elves-destroy-aura"]
        );
    });

    it("a non-{T} ability of a creature counts despite summoning sickness", () => {
        expect(ids(castDemands("Shivan Dragon"))).toEqual([
            "cast#shivan-dragon-ability",
        ]);
    });

    it("a {T} ability of a permanent entering tapped is none (CR 614.1d)", () => {
        expect(castDemands("Nevinyrral's Disk")).toEqual([]);
        expect(castDemands("Jayemdae Tome")).toHaveLength(1);
        expect(castDemands("Jayemdae Tome", { oppBoard: ["Kismet"] })).toEqual(
            []
        );
    });

    it("a sorcery-speed own ability counts only at sorcery timing (CR 602.5d)", () => {
        expect(ids(castDemands("Skullclamp"))).toEqual([
            "cast#skullclamp-equip",
        ]);
        expect(castDemands("Skullclamp", { timing: notSorcery })).toEqual([]);
    });

    it("an ability of the CARD in hand (Cycling) is none (CR 113.6)", () => {
        expect(castDemands("Barkhide Mauler")).toEqual([]);
    });

    it("an instant or sorcery, and a face-down cast, yield nothing", () => {
        expect(castDemands("Counterspell")).toEqual([]);
        // CR 708.2a — a face-down permanent has no abilities.
        expect(
            castDemands("Shivan Dragon", { pending: { morphed: true } })
        ).toEqual([]);
    });
});
