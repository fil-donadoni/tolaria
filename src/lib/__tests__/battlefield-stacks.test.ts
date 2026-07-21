import { describe, it, expect } from "vitest";
import { groupBattlefield } from "../battlefield-stacks";
import type { CardInstance } from "~/types/game";

// ---------------------------------------------------------------------------
// Pure grouping helper tests (PRD #621, issue #622). External-behaviour only:
// the grouping a board produces — never internal layout math.
// ---------------------------------------------------------------------------

let seq = 0;
function makeCard(overrides: Partial<CardInstance> = {}): CardInstance {
    return {
        id: `inst-${seq++}`,
        card: { id: "def-bear" },
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        ...overrides,
    };
}

const noHosts = new Map<string, CardInstance[]>();

function keys(perms: CardInstance[]) {
    return perms.map((c) => c.id);
}

describe("groupBattlefield — identity key (PRD #621)", () => {
    it("collapses same card id + same summoning sickness into one stack", () => {
        const a = makeCard({ id: "a" });
        const b = makeCard({ id: "b" });
        const c = makeCard({ id: "c" });
        const groups = groupBattlefield([a, b, c], noHosts);
        expect(groups).toHaveLength(1);
        expect(groups[0].isStack).toBe(true);
        expect(keys(groups[0].members)).toEqual(["a", "b", "c"]);
    });

    it("different card id → separate groups", () => {
        const bear = makeCard({ id: "bear", card: { id: "def-bear" } });
        const wall = makeCard({ id: "wall", card: { id: "def-wall" } });
        const groups = groupBattlefield([bear, wall], noHosts);
        expect(groups).toHaveLength(2);
        expect(groups.every((g) => !g.isStack)).toBe(true);
    });

    it("summoning sickness is part of the key — sick and ready split", () => {
        const sick = makeCard({ id: "sick", isSummoningSick: true });
        const ready = makeCard({ id: "ready", isSummoningSick: false });
        const groups = groupBattlefield([sick, ready], noHosts);
        expect(groups).toHaveLength(2);
        // Two sick copies still stack with each other.
        const sick2 = makeCard({ id: "sick2", isSummoningSick: true });
        const g2 = groupBattlefield([sick, sick2], noHosts);
        expect(g2).toHaveLength(1);
        expect(g2[0].isStack).toBe(true);
    });

    it("a single permanent is a singleton group, not a stack", () => {
        const groups = groupBattlefield([makeCard({ id: "lone" })], noHosts);
        expect(groups).toHaveLength(1);
        expect(groups[0].isStack).toBe(false);
        expect(groups[0].key).toBe("lone");
    });
});

describe("groupBattlefield — arrival deferral (zone-change flights)", () => {
    it("a deferred clean permanent renders as its own singleton instead of joining the fan", () => {
        const a = makeCard({ id: "a" });
        const b = makeCard({ id: "b" });
        const arrived = makeCard({ id: "arrived" });
        const groups = groupBattlefield(
            [a, b, arrived],
            noHosts,
            false,
            new Set(["arrived"])
        );
        expect(groups).toHaveLength(2);
        const stack = groups.find((g) => g.isStack);
        const singleton = groups.find((g) => !g.isStack);
        expect(keys(stack!.members)).toEqual(["a", "b"]);
        expect(singleton!.key).toBe("arrived");
    });

    it("deferral preserves input order and stacks the rest normally", () => {
        const arrived = makeCard({ id: "arrived" });
        const a = makeCard({ id: "a" });
        const b = makeCard({ id: "b" });
        const groups = groupBattlefield(
            [arrived, a, b],
            noHosts,
            false,
            new Set(["arrived"])
        );
        expect(groups.map((g) => g.key)).toEqual(["arrived", "a"]);
        expect(groups[1].isStack).toBe(true);
    });

    it("an absent or empty defer set groups exactly as before", () => {
        const a = makeCard({ id: "a" });
        const b = makeCard({ id: "b" });
        expect(
            groupBattlefield([a, b], noHosts, false, new Set())
        ).toHaveLength(1);
        expect(groupBattlefield([a, b], noHosts)).toHaveLength(1);
    });
});

describe("groupBattlefield — tap state splits the stack (QA)", () => {
    it("differing tapped state splits into two groups (untapped pile + tapped pile)", () => {
        const tapped = makeCard({ id: "tapped", isTapped: true });
        const untapped = makeCard({ id: "untapped", isTapped: false });
        const groups = groupBattlefield([tapped, untapped], noHosts);
        expect(groups).toHaveLength(2);
        // Both are singletons here (one member each) — the untapped pile and
        // the tapped pile are separate groups.
        const u = groups.find((g) => g.members[0].id === "untapped")!;
        const t = groups.find((g) => g.members[0].id === "tapped")!;
        expect(u.stackKey).toBe(t.stackKey?.replace(/\|1$/, "|0"));
        expect(u.stackKey).not.toBe(t.stackKey);
    });

    it("six untapped forests stack; tapping some splits the pile by tap state", () => {
        const forests = Array.from({ length: 6 }, (_, i) =>
            makeCard({ id: `f${i}`, isTapped: i >= 4 })
        );
        const groups = groupBattlefield(forests, noHosts);
        expect(groups).toHaveLength(2);
        const untapped = groups.find((g) => g.members.length === 4)!;
        const tapped = groups.find((g) => g.members.length === 2)!;
        expect(untapped.isStack).toBe(true);
        expect(keys(untapped.members)).toEqual(["f0", "f1", "f2", "f3"]);
        expect(keys(tapped.members)).toEqual(["f4", "f5"]);
    });

    it("differing mana-committed flag still stacks together (flag excluded from the key)", () => {
        // Same card, same tap state — only the mana-committed flag differs.
        const committed = makeCard({
            id: "committed",
            isTapped: true,
            manaCommitted: true,
        });
        const free = makeCard({ id: "free", isTapped: true });
        const groups = groupBattlefield([committed, free], noHosts);
        expect(groups).toHaveLength(1);
        expect(groups[0].isStack).toBe(true);
    });
});

describe("groupBattlefield — altered predicate ejects to singleton", () => {
    function assertEjects(altered: CardInstance, label: string) {
        const clean1 = makeCard({ id: "clean1" });
        const clean2 = makeCard({ id: "clean2" });
        const groups = groupBattlefield(
            [clean1, altered, clean2],
            altered.attachedTo === "HOST"
                ? new Map([["HOST", [makeCard()]]])
                : noHosts
        );
        const alteredGroup = groups.find((g) =>
            g.members.some((m) => m.id === altered.id)
        );
        expect(alteredGroup, label).toBeDefined();
        expect(alteredGroup!.isStack, `${label} must be singleton`).toBe(false);
        expect(alteredGroup!.members).toHaveLength(1);
    }

    it("any counter ejects", () => {
        assertEjects(
            makeCard({ id: "ctr", counters: { "+1/+1": 1 } }),
            "counter"
        );
    });

    it("marked damage ejects", () => {
        assertEjects(makeCard({ id: "dmg", damageMarked: 2 }), "damage");
    });

    it("temporary P/T mod ejects", () => {
        assertEjects(
            makeCard({
                id: "tmp",
                temporaryPTMods: [{ power: 1, toughness: 1 }],
            }),
            "temp P/T"
        );
    });

    it("being an attachment (attachedTo set) ejects", () => {
        assertEjects(
            makeCard({ id: "aura", attachedTo: "some-host" }),
            "attachment"
        );
    });

    it("granted activated ability ejects", () => {
        assertEjects(
            makeCard({
                id: "ga",
                grantedActivatedAbilities: [
                    { sourceCardId: "s", abilityId: "x", auraId: "au" },
                ],
            }),
            "granted activated"
        );
    });

    it("granted static ability ejects", () => {
        assertEjects(
            makeCard({
                id: "gs",
                grantedStaticAbilities: [{ ability: "flying" }],
            }),
            "granted static"
        );
    });

    it("granted triggered ability ejects", () => {
        assertEjects(
            makeCard({
                id: "gt",
                grantedTriggeredAbilities: [
                    { sourceCardId: "s", abilityId: "x" },
                ],
            }),
            "granted triggered"
        );
    });

    it("color override ejects", () => {
        assertEjects(
            makeCard({ id: "co", colorOverride: ["U"] }),
            "color override"
        );
    });

    it("copy origin ejects", () => {
        assertEjects(
            makeCard({ id: "cp", copiedFrom: "def-original" }),
            "copy origin"
        );
    });

    it("attacking ejects", () => {
        assertEjects(makeCard({ id: "atk", isAttacking: true }), "attacking");
    });

    it("blocking ejects", () => {
        assertEjects(makeCard({ id: "blk", isBlocking: true }), "blocking");
    });

    it("being an aura/equipment host ejects (host id in the map)", () => {
        const host = makeCard({ id: "host" });
        const other = makeCard({ id: "other" });
        const attachmentsByHost = new Map<string, CardInstance[]>([
            ["host", [makeCard({ id: "the-aura", attachedTo: "host" })]],
        ]);
        const groups = groupBattlefield([host, other], attachmentsByHost);
        const hostGroup = groups.find((g) =>
            g.members.some((m) => m.id === "host")
        )!;
        expect(hostGroup.isStack).toBe(false);
        expect(hostGroup.members).toHaveLength(1);
    });

    it("empty counters / zero damage / empty arrays do NOT eject", () => {
        const a = makeCard({
            id: "a",
            counters: {},
            damageMarked: 0,
            temporaryPTMods: [],
            grantedStaticAbilities: [],
            colorOverride: [],
        });
        const b = makeCard({ id: "b" });
        const groups = groupBattlefield([a, b], noHosts);
        expect(groups).toHaveLength(1);
        expect(groups[0].isStack).toBe(true);
    });
});

describe("groupBattlefield — ordering", () => {
    it("tap-split groups are stable by first-member position (QA: tapped/untapped no longer interleave in one pile)", () => {
        const u1 = makeCard({ id: "u1", isTapped: false });
        const t1 = makeCard({ id: "t1", isTapped: true });
        const u2 = makeCard({ id: "u2", isTapped: false });
        const t2 = makeCard({ id: "t2", isTapped: true });
        // Input deliberately interleaved.
        const groups = groupBattlefield([t1, u1, t2, u2], noHosts);
        // Two piles: the tapped one (first member t1 at index 0) leads.
        expect(groups).toHaveLength(2);
        expect(keys(groups[0].members)).toEqual(["t1", "t2"]);
        expect(keys(groups[1].members)).toEqual(["u1", "u2"]);
        expect(groups[0].stackKey).toBeTruthy();
        expect(groups[1].stackKey).toBeTruthy();
        expect(groups[0].stackKey).not.toBe(groups[1].stackKey);
    });

    it("group order is stable relative to input (first-member position)", () => {
        const bear = makeCard({ id: "bear", card: { id: "def-bear" } });
        const wallA = makeCard({ id: "wallA", card: { id: "def-wall" } });
        const bear2 = makeCard({ id: "bear2", card: { id: "def-bear" } });
        const wallB = makeCard({ id: "wallB", card: { id: "def-wall" } });
        const groups = groupBattlefield([bear, wallA, bear2, wallB], noHosts);
        expect(groups).toHaveLength(2);
        // Bear group first (its first member appears at index 0).
        expect(groups[0].key).toBe("bear");
        expect(keys(groups[0].members)).toEqual(["bear", "bear2"]);
        expect(groups[1].key).toBe("wallA");
        expect(keys(groups[1].members)).toEqual(["wallA", "wallB"]);
    });

    it("does not mutate the input array or its order", () => {
        const t1 = makeCard({ id: "t1", isTapped: true });
        const u1 = makeCard({ id: "u1", isTapped: false });
        const input = [t1, u1];
        groupBattlefield(input, noHosts);
        expect(keys(input)).toEqual(["t1", "u1"]);
    });
});

// Divide-as-you-choose un-stacking (CR 601.2d): while a divide-damage
// selection is active, every identical permanent must render as its OWN slot
// so each instance is individually dialable (variant B — the chosen UX). The
// board passes `disableStacking` for the duration of the selection.
describe("groupBattlefield — disableStacking (divide-as-you-choose, CR 601.2d)", () => {
    it("renders every identical permanent as its own singleton when disabled", () => {
        const a = makeCard({ id: "a" });
        const b = makeCard({ id: "b" });
        const c = makeCard({ id: "c" });
        // Without the flag these three Grizzly Bears collapse into one ×3 stack.
        expect(groupBattlefield([a, b, c], noHosts)).toHaveLength(1);
        // With it, three individual slots — no fan overlap to fight.
        const groups = groupBattlefield([a, b, c], noHosts, true);
        expect(groups).toHaveLength(3);
        expect(groups.every((g) => !g.isStack)).toBe(true);
        expect(keys(groups.flatMap((g) => g.members))).toEqual(["a", "b", "c"]);
    });
});
