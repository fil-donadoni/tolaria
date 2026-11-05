// Collect evidence (CR 701.59) as an alternative-cost leg, and the
// graveyard-cast permission scoped to one alternative cost (CR
// 118.9b) — both exercised end to end on Detective's Phoenix (MH3), the card
// that needs them: "Bestow—{R}, Collect evidence 6 … You may cast this card
// from your graveyard using its bestow ability."
//
// The project has no convex-test harness for `game.ts` mutations (ADR 0001),
// so — the `bestow.test.ts` / `escape.test.ts` pattern — the targeted commit
// is driven through the real exported `finalizeTargetSelection` (the function
// `announceCast` hands a completed `pendingTarget` to), the exile pick through
// `recordCastExileCostPick`, and the deferred commit through
// `tryAutoCommitPendingCast`. Everything downstream is the production path.

import { describe, it, expect } from "vitest";
import { finalizeTargetSelection, recordCastExileCostPick } from "../../game";
import {
    getPlayer,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type PendingTarget,
} from "../state";
import { tryAutoCommitPendingCast } from "../activation";
import { commitCast } from "../castCommit";
import { getDefinition } from "../../cards/registry";
import { getLegalActions } from "../rules";
import { affordableAlternativeCosts } from "../alternativeCost";
import {
    assertGraveyardCastAnnouncementLicensed,
    requiredGraveyardAlternativeCostId,
} from "../castCost";
import { checkStateBasedActions } from "../sba";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { syncLayers2to5 } from "../layers2to5";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { detectivesPhoenix } from "../../cards/sets/mh3/red.cards";
import {
    ancestralRecall,
    disenchant,
    grizzlyBears,
    lightningBolt,
} from "../../cards/sets/lea/index.cards";

const PHOENIX = detectivesPhoenix().id;

/** Graveyard fodder: Grizzly Bears (2) + Disenchant (2) + Lightning Bolt (1)
 *  + Ancestral Recall (1) = total mana value 6 exactly. `short` drops the
 *  Recall, leaving 5 — one short of collect evidence 6. */
function fodder(short = false): CardInstanceState[] {
    const cards = [
        makeInstance(grizzlyBears().id, { id: "ev-bears", zone: "graveyard" }),
        makeInstance(disenchant().id, {
            id: "ev-disenchant",
            zone: "graveyard",
        }),
        makeInstance(lightningBolt().id, { id: "ev-bolt", zone: "graveyard" }),
    ];
    if (!short) {
        cards.push(
            makeInstance(ancestralRecall().id, {
                id: "ev-recall",
                zone: "graveyard",
            })
        );
    }
    return cards.map((c) => ({ ...c, ownerId: "p1", controllerId: "p1" }));
}

/** p1 with Detective's Phoenix in `phoenixZone`, the fodder graveyard, one
 *  {R} floating and a Grizzly Bears host on the battlefield. */
function board(opts: {
    phoenixZone: "hand" | "graveyard";
    short?: boolean;
    host?: boolean;
}): GameState {
    const phoenix = makeInstance(PHOENIX, {
        id: "phoenix",
        controllerId: "p1",
        ownerId: "p1",
        zone: opts.phoenixZone,
    });
    const host = makeInstance(grizzlyBears().id, {
        id: "host",
        controllerId: "p1",
        ownerId: "p1",
    });
    const graveyard = fodder(opts.short);
    if (opts.phoenixZone === "graveyard") graveyard.unshift(phoenix);
    return makeState({
        players: [
            makePlayer("p1", {
                hand: opts.phoenixZone === "hand" ? [phoenix] : [],
                graveyard,
                battlefield: opts.host === false ? [] : [host],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
            makePlayer("p2"),
        ],
    });
}

function bestowOnto(hostId: string): PendingTarget {
    return {
        playerId: "p1",
        cardInstanceId: "phoenix",
        targetType: "Creature",
        count: 1,
        selected: [{ type: "permanent", id: hostId }],
        alternativeCostId: "bestow",
    };
}

function phoenixIn(state: GameState, zone: "hand" | "graveyard") {
    return getPlayer(state, "p1")[zone].find((c) => c.id === "phoenix")!;
}

describe("Collect evidence — affordability (CR 701.59a / 701.59b)", () => {
    it("offers the bestow cost with exactly total mana value 6 in the graveyard", () => {
        const state = board({ phoenixZone: "hand" });
        const p1 = getPlayer(state, "p1");
        expect(
            affordableAlternativeCosts(state, p1, phoenixIn(state, "hand")).map(
                (a) => a.id
            )
        ).toEqual(["bestow"]);
    });

    it("can't choose to collect evidence one mana value short (CR 701.59b)", () => {
        const state = board({ phoenixZone: "hand", short: true });
        const p1 = getPlayer(state, "p1");
        expect(
            affordableAlternativeCosts(state, p1, phoenixIn(state, "hand"))
        ).toEqual([]);
    });

    it("never counts the Phoenix itself toward its own cost (CR 601.2a)", () => {
        // Phoenix (MV 3) + 5 of fodder = 8 in the pile, but only 5 is OTHER.
        const state = board({ phoenixZone: "graveyard", short: true });
        const p1 = getPlayer(state, "p1");
        expect(
            affordableAlternativeCosts(state, p1, phoenixIn(state, "graveyard"))
        ).toEqual([]);
        expect(
            getLegalActions(state, p1, phoenixIn(state, "graveyard"))
        ).not.toContain("cast");
    });
});

describe("Graveyard cast scoped to the bestow cost (CR 118.9b)", () => {
    it("is castable from the graveyard while the bestow cost is payable", () => {
        const state = board({ phoenixZone: "graveyard" });
        const p1 = getPlayer(state, "p1");
        expect(
            getLegalActions(state, p1, phoenixIn(state, "graveyard"))
        ).toContain("cast");
        expect(
            requiredGraveyardAlternativeCostId(
                state,
                p1,
                phoenixIn(state, "graveyard")
            )
        ).toBe("bestow");
    });

    it("is not castable from the graveyard with no creature to bestow onto", () => {
        // Its printed {2}{R} creature cast would need no target — but the
        // permission licenses only the bestowed cast, which does (CR 303.4a).
        const state = board({ phoenixZone: "graveyard", host: false });
        getPlayer(state, "p1").manaPool = {
            W: 0,
            U: 0,
            B: 0,
            R: 3,
            G: 0,
            C: 0,
        };
        const p1 = getPlayer(state, "p1");
        expect(
            getLegalActions(state, p1, phoenixIn(state, "graveyard"))
        ).not.toContain("cast");
    });

    it("refuses a printed-cost (non-bestow) cast from the graveyard", () => {
        const state = board({ phoenixZone: "graveyard" });
        const p1 = getPlayer(state, "p1");
        const phoenix = phoenixIn(state, "graveyard");
        expect(() =>
            assertGraveyardCastAnnouncementLicensed(
                state,
                p1,
                phoenix,
                "graveyard",
                undefined
            )
        ).toThrow(/only for its bestow cost/);
        expect(() =>
            assertGraveyardCastAnnouncementLicensed(
                state,
                p1,
                phoenix,
                "graveyard",
                "bestow"
            )
        ).not.toThrow();
        // From HAND the permission is irrelevant: the printed cast stands.
        expect(() =>
            assertGraveyardCastAnnouncementLicensed(
                state,
                p1,
                phoenix,
                "hand",
                undefined
            )
        ).not.toThrow();
    });

    it("leaves the printed cast open when a broad graveyard permission also covers it", () => {
        // Yawgmoth's Will: "you may play lands and cast spells from your
        // graveyard" — that permission's cast pays the printed cost.
        const state = board({ phoenixZone: "graveyard" });
        state.graveyardPlayPermissionThisTurn = [
            { playerId: "p1", sourceId: "will", actions: ["cast"] },
        ] as unknown as GameState["graveyardPlayPermissionThisTurn"];
        const p1 = getPlayer(state, "p1");
        expect(
            requiredGraveyardAlternativeCostId(
                state,
                p1,
                phoenixIn(state, "graveyard")
            )
        ).toBeUndefined();
    });
});

describe("Detective's Phoenix — bestowed from the graveyard, end to end", () => {
    /** Announce the bestowed graveyard cast onto the host: it parks on the
     *  collect-evidence picker, UNPICKED (never auto-picked). */
    function announce(state: GameState) {
        finalizeTargetSelection(state, bestowOnto("host"), "p1");
        return state.pendingCast!;
    }

    it("parks on an unpicked collect-evidence picker even when the pick is forced", () => {
        // Exactly MV 6 of fodder: the ONLY legal payment is all four cards,
        // and still the payer is asked.
        const state = board({ phoenixZone: "graveyard" });
        const pc = announce(state);
        expect(pc.exileFromGraveyardChoice).toEqual({
            count: 1,
            minTotalManaValue: 6,
            excludeInstanceId: "phoenix",
        });
        expect(state.stack).toHaveLength(0);
    });

    it("refuses a pick under total mana value 6, and the Phoenix itself", () => {
        const state = board({ phoenixZone: "graveyard" });
        announce(state);
        expect(() =>
            recordCastExileCostPick(state, "p1", [
                "ev-bears",
                "ev-disenchant",
                "ev-bolt",
            ])
        ).toThrow(/total mana value of 6 or greater/);
        expect(() =>
            recordCastExileCostPick(state, "p1", [
                "phoenix",
                "ev-bears",
                "ev-disenchant",
            ])
        ).toThrow(/itself/);
        expect(
            state.pendingCast!.exileFromGraveyardChoice!.pickedCardIds
        ).toBeUndefined();
    });

    it("exiles the evidence, resolves as an Aura on the host, and grants +2/+2 flying haste", () => {
        const state = board({ phoenixZone: "graveyard" });
        announce(state);
        recordCastExileCostPick(state, "p1", [
            "ev-bears",
            "ev-disenchant",
            "ev-bolt",
            "ev-recall",
        ]);
        expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
        const p1 = getPlayer(state, "p1");
        expect(p1.exile.map((c) => c.id).sort()).toEqual([
            "ev-bears",
            "ev-bolt",
            "ev-disenchant",
            "ev-recall",
        ]);
        expect(p1.graveyard).toHaveLength(0);
        expect(p1.manaPool.R).toBe(0);
        const spell = state.stack.find((s) => s.id === "phoenix")!;
        expect(spell.bestowed).toBe(true);
        expect(spell.castFromZone).toBe("graveyard");

        resolveTopOfStack(state);
        syncLayers2to5(state);
        const phoenix = p1.battlefield.find((c) => c.id === "phoenix")!;
        const host = p1.battlefield.find((c) => c.id === "host")!;
        expect(phoenix.attachedTo).toBe("host");
        expect(phoenix.types).toEqual(["Enchantment"]);
        expect(getEffectivePower(state, host)).toBe(4);
        expect(getEffectiveToughness(state, host)).toBe(4);
        expect(host.staticAbilities).toEqual(
            expect.arrayContaining(["flying", "haste"])
        );
    });

    it("becomes a 2/2 creature when the host leaves (CR 702.103f), and returns to the graveyard to be cast again", () => {
        const state = board({ phoenixZone: "graveyard" });
        announce(state);
        recordCastExileCostPick(state, "p1", [
            "ev-bears",
            "ev-disenchant",
            "ev-bolt",
            "ev-recall",
        ]);
        tryAutoCommitPendingCast(state, "p1");
        resolveTopOfStack(state);
        removePermanentTo(state, "host", "graveyard");
        checkStateBasedActions(state);
        const p1 = getPlayer(state, "p1");
        const phoenix = p1.battlefield.find((c) => c.id === "phoenix")!;
        expect(phoenix.bestowed).toBeUndefined();
        expect(phoenix.types).toEqual(["Enchantment", "Creature"]);
        expect(getEffectivePower(state, phoenix)).toBe(2);

        // Dies → the graveyard, NOT exile (no flashback-style rider), and the
        // permission is live again for the next bestow.
        removePermanentTo(state, "phoenix", "graveyard");
        expect(p1.graveyard.map((c) => c.id)).toContain("phoenix");
    });

    it("projects the graveyard Phoenix with a cast affordance and no printed-cost row", () => {
        const state = board({ phoenixZone: "graveyard" });
        const view = projectPublicState(state, 1, "p1");
        const me = view.players.find((p) => p.id === "p1")!;
        const card = me.graveyard.find((c) => c.id === "phoenix")!;
        expect(card.legalActions).toContain("cast");
        expect(card.castKind).toBe("graveyard-intrinsic");
        expect(card.printedCostCastUnavailable).toBe(true);
    });
});

describe("Cast Commit kernel — an unanswered collect-evidence picker (CR 701.59a)", () => {
    it("refuses to commit rather than cast without collecting evidence", () => {
        // Any caller reaching the kernel with the picker still unpicked
        // (announceCast's inline commit, a future untargeted alt cost) must
        // get a refusal, never a free cast.
        const state = board({ phoenixZone: "graveyard" });
        const committed = commitCast(state, {
            casterId: "p1",
            cardInstanceId: "phoenix",
            cardDef: getDefinition(PHOENIX),
            manaCost: {},
            source: { zone: "graveyard" },
            legs: {
                exileFromGraveyardChoice: {
                    count: 1,
                    minTotalManaValue: 6,
                    excludeInstanceId: "phoenix",
                },
            },
            record: {},
            mode: {},
            placement: { kind: "announce" },
        });
        expect(committed).toBeNull();
        expect(state.stack).toHaveLength(0);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(5);
    });
});
