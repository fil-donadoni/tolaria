// **Yield** — the per-ability standing "do not hand me **Priority** while this
// is on top of the **Stack**" (issue #3556).
//
// Every stack object here comes out of the REAL projection
// (`projectPublicState` → `projectStackItem`), never a hand-built view: the
// whole point of a single key derivation is that the toggle, the auto-pass and
// the resets read the SAME fields the client is actually handed, and a
// hand-assembled `StackItem` would not prove that (`.claude/rules/gre-development.md`
// § Frontend wiring analysis).
import { describe, it, expect } from "vitest";
import { makeInstance, makeState } from "@convex/cards/__tests__/setup";
import { getCardByName } from "@convex/cards";
import { turnFaceDown } from "@convex/gre/faceDown";
import { NO_BOARD_LAYER_VIEW } from "@convex/gre/layers";
import { projectPublicState } from "@convex/gameProjections";
import type {
    GameState,
    StackItem as EngineStackItem,
} from "@convex/gre/state";
import type { StackItem } from "~/types/game";
import {
    clearSeatCardYields,
    clearSeatYields,
    countYields,
    hasYield,
    shouldAutoPassYield,
    toggleYield,
    topOfStack,
    yieldCardIdentityForDefinition,
    yieldKeyForStackItem,
    type YieldState,
} from "~/lib/yields";

const NOBLE = getCardByName("Noble Hierarch");
const IGNOBLE = getCardByName("Ignoble Hierarch");
const BOLT = getCardByName("Lightning Bolt");

/** The synthesized exalted trigger's id (CR 702.83a — `keywordTriggers.ts`). */
const EXALTED = "exalted";

type Entry =
    | { kind: "trigger"; defId: string; abilityId: string; instance: string }
    | { kind: "spell"; defId: string; instance: string };

function engineItem(entry: Entry): EngineStackItem {
    const base = {
        ...makeInstance(entry.defId, {
            id: entry.instance,
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
        }),
        castById: "p1",
    };
    return (
        entry.kind === "trigger"
            ? {
                  ...base,
                  triggeredAbilityId: entry.abilityId,
                  triggerSourceId: "src",
              }
            : base
    ) as EngineStackItem;
}

/** Project a whole stack for a viewer and hand back the CLIENT's view of it. */
function projectStack(entries: Entry[], viewerId = "p1"): StackItem[] {
    const state: GameState = makeState({
        stack: entries.map(engineItem),
    } as Partial<GameState>);
    return projectPublicState(state, 1, viewerId)
        .stack as unknown as StackItem[];
}

const nobleExalted = (instance: string): Entry => ({
    kind: "trigger",
    defId: NOBLE.id,
    abilityId: EXALTED,
    instance,
});

describe("Yield key identity — the ABILITY, not the object (issue #3556 §2)", () => {
    it("gives two distinct instances of the same trigger of the same card ONE key", () => {
        const [first, second] = projectStack([
            nobleExalted("trig-1"),
            nobleExalted("trig-2"),
        ]);
        expect(first.id).not.toBe(second.id);
        expect(yieldKeyForStackItem(first)).toBe(yieldKeyForStackItem(second));
    });

    it("separates the SAME exalted trigger on a different card (Noble vs Ignoble Hierarch)", () => {
        const [noble, ignoble] = projectStack([
            nobleExalted("trig-1"),
            {
                kind: "trigger",
                defId: IGNOBLE.id,
                abilityId: EXALTED,
                instance: "trig-2",
            },
        ]);
        expect(yieldKeyForStackItem(noble)).not.toBe(
            yieldKeyForStackItem(ignoble)
        );
    });

    it("separates a DIFFERENT ability of the same card, and a spell from a trigger", () => {
        const [trigger, other, spell] = projectStack([
            nobleExalted("trig-1"),
            {
                kind: "trigger",
                defId: NOBLE.id,
                abilityId: "some-other-ability",
                instance: "trig-2",
            },
            { kind: "spell", defId: BOLT.id, instance: "spell-1" },
        ]);
        expect(yieldKeyForStackItem(trigger)).not.toBe(
            yieldKeyForStackItem(other)
        );
        expect(yieldKeyForStackItem(spell)).toBe(
            `spell|${yieldCardIdentityForDefinition(BOLT.id)}`
        );
    });

    it("keys a trigger under the card identity its permanent's menu clears by", () => {
        const [trigger] = projectStack([nobleExalted("trig-1")]);
        const key = yieldKeyForStackItem(trigger)!;
        const state = clearSeatCardYields(
            { p1: [key] },
            "p1",
            yieldCardIdentityForDefinition(NOBLE.id)
        );
        expect(countYields(state, "p1")).toBe(0);
    });

    it("leaves another card's yields alone when one card is cleared", () => {
        const [noble, ignoble] = projectStack([
            nobleExalted("trig-1"),
            {
                kind: "trigger",
                defId: IGNOBLE.id,
                abilityId: EXALTED,
                instance: "trig-2",
            },
        ]);
        const held: YieldState = {
            p1: [yieldKeyForStackItem(noble)!, yieldKeyForStackItem(ignoble)!],
        };
        const after = clearSeatCardYields(
            held,
            "p1",
            yieldCardIdentityForDefinition(NOBLE.id)
        );
        expect(after.p1).toEqual([yieldKeyForStackItem(ignoble)]);
    });
});

describe("A face-down spell has no Yield identity (CR 708.2a)", () => {
    // `turnFaceDown` swaps the stack item's own `card.id` to the shared
    // FACE_DOWN_CARD_ID sentinel for EVERY viewer, caster included — so keying
    // on it would put every face-down cast of every card in ONE bucket, and a
    // yield set on a face-down Serra Angel would auto-pass the next face-down
    // anything. CR 708.2a gives such a spell no name: it gets no key, and
    // therefore no toggle.
    function projectFaceDownSpell(
        viewerId: "p1" | "p2",
        defId: string = NOBLE.id
    ): StackItem {
        const spell = makeInstance(defId, {
            id: "fd-spell",
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
        });
        turnFaceDown(NO_BOARD_LAYER_VIEW, spell as never, "morph");
        const state: GameState = makeState({
            stack: [{ ...spell, castById: "p1" } as EngineStackItem],
        } as Partial<GameState>);
        return projectPublicState(state, 1, viewerId)
            .stack[0] as unknown as StackItem;
    }

    it("mints no key, for the caster or the opponent", () => {
        expect(yieldKeyForStackItem(projectFaceDownSpell("p1"))).toBeNull();
        expect(yieldKeyForStackItem(projectFaceDownSpell("p2"))).toBeNull();
    });

    it("does not carry a yield from one face-down cast to an unrelated one", () => {
        // Whatever key the FIRST face-down spell would mint, the SECOND — a
        // different card entirely — must not be covered by it.
        const first = projectFaceDownSpell("p1", NOBLE.id);
        const second = projectFaceDownSpell("p1", IGNOBLE.id);
        const mintedFromFirst = yieldKeyForStackItem(first);
        const held: YieldState = {
            p1: mintedFromFirst ? [mintedFromFirst] : [],
        };
        expect(shouldAutoPassYield(ctxFor([second]), held, true)).toBe(false);
    });
});

describe("Yield store is per SEAT (issue #3556 §7)", () => {
    it("does not apply seat p1's yield while p2 is the viewer", () => {
        const [trigger] = projectStack([nobleExalted("trig-1")]);
        const key = yieldKeyForStackItem(trigger)!;
        const held = toggleYield({}, "p1", key);
        expect(hasYield(held, "p1", key)).toBe(true);
        expect(hasYield(held, "p2", key)).toBe(false);
    });

    it("clears only the clearing seat", () => {
        const [trigger] = projectStack([nobleExalted("trig-1")]);
        const key = yieldKeyForStackItem(trigger)!;
        let held = toggleYield({}, "p1", key);
        held = toggleYield(held, "p2", key);
        const after = clearSeatYields(held, "p1");
        expect(countYields(after, "p1")).toBe(0);
        expect(countYields(after, "p2")).toBe(1);
    });

    it("toggles off", () => {
        const [trigger] = projectStack([nobleExalted("trig-1")]);
        const key = yieldKeyForStackItem(trigger)!;
        const on = toggleYield({}, "p1", key);
        expect(hasYield(toggleYield(on, "p1", key), "p1", key)).toBe(false);
    });
});

/** A priority window with the given stack, for seat p1, holding priority. */
function ctxFor(stack: StackItem[]) {
    return {
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        stackItems: stack,
    };
}

function heldFor(item: StackItem, seatId = "p1"): YieldState {
    return { [seatId]: [yieldKeyForStackItem(item)!] };
}

describe("Yield auto-pass — top of stack only (issue #3556 §3)", () => {
    it("fires when the yielded object is on TOP, whatever sits underneath", () => {
        const stack = projectStack([
            { kind: "spell", defId: BOLT.id, instance: "spell-1" },
            nobleExalted("trig-1"),
        ]);
        expect(topOfStack(stack)!.id).toBe("trig-1");
        expect(
            shouldAutoPassYield(ctxFor(stack), heldFor(stack[1]), true)
        ).toBe(true);
    });

    it("does NOT fire when the yielded object is underneath an unyielded one", () => {
        const stack = projectStack([
            nobleExalted("trig-1"),
            { kind: "spell", defId: BOLT.id, instance: "spell-1" },
        ]);
        expect(
            shouldAutoPassYield(ctxFor(stack), heldFor(stack[0]), true)
        ).toBe(false);
    });

    it("does not fire on an empty stack — that window belongs to Phase Stop", () => {
        expect(
            shouldAutoPassYield(ctxFor([]), { p1: ["spell|card:x"] }, true)
        ).toBe(false);
    });

    it("does not fire for a seat that holds no yield on the top object", () => {
        const stack = projectStack([nobleExalted("trig-1")]);
        expect(shouldAutoPassYield(ctxFor(stack), {}, true)).toBe(false);
        expect(
            shouldAutoPassYield(
                { ...ctxFor(stack), playerId: "p2", priorityPlayerId: "p2" },
                heldFor(stack[0], "p1"),
                true
            )
        ).toBe(false);
    });
});

describe("Yield never suppresses owed input (issue #3556 §4)", () => {
    const stack = projectStack([nobleExalted("trig-1")]);
    const held = heldFor(stack[0]);
    const base = ctxFor(stack);

    it("fires in the plain priority window it exists for", () => {
        expect(shouldAutoPassYield(base, held, true)).toBe(true);
    });

    const blocked: [string, Record<string, unknown>][] = [
        ["the page is hidden", {}],
        ["the seat does not hold priority", { priorityPlayerId: "p2" }],
        [
            "the game is over",
            { gameOver: { winnerId: "p2", loserId: "p1", reason: "life" } },
        ],
        [
            "the seat owes a pending choice",
            { pendingChoices: [{ playerId: "p1" }] },
        ],
        ["a cast is mid-announcement", { pendingCast: { playerId: "p1" } }],
        [
            "an activation is mid-announcement",
            { pendingActivation: { playerId: "p1" } },
        ],
        ["a target is being selected", { pendingTarget: { playerId: "p1" } }],
        [
            "attackers are being declared",
            {
                phase: "DECLARE_ATTACKERS",
                combat: {
                    attackerIds: [],
                    confirmed: false,
                    blockerAssignments: {},
                    blockersConfirmed: false,
                },
            },
        ],
        [
            "blockers are being declared",
            {
                playerId: "p2",
                priorityPlayerId: "p2",
                phase: "DECLARE_BLOCKERS",
                combat: {
                    attackerIds: ["a"],
                    confirmed: true,
                    blockerAssignments: {},
                    blockersConfirmed: false,
                },
            },
        ],
        [
            "combat damage awaits assignment",
            {
                phase: "COMBAT_DAMAGE",
                combat: {
                    attackerIds: ["a"],
                    confirmed: true,
                    blockerAssignments: {},
                    blockersConfirmed: true,
                    damageConfirmed: false,
                },
            },
        ],
        [
            "the server already holds a standing Pass Turn for this seat",
            { autoPassPlayers: ["p1"] },
        ],
    ];

    for (const [why, patch] of blocked) {
        it(`refuses while ${why}`, () => {
            const pageVisible = why !== "the page is hidden";
            const seatHeld =
                patch.playerId === "p2" ? heldFor(stack[0], "p2") : held;
            expect(
                shouldAutoPassYield(
                    { ...base, ...patch } as Parameters<
                        typeof shouldAutoPassYield
                    >[0],
                    seatHeld,
                    pageVisible
                )
            ).toBe(false);
        });
    }
});

describe("A Yield cannot deadlock a board (issue #3556 §8)", () => {
    it("resolves the yielded object instead of looping: two seats yielding it produce the two consecutive passes", () => {
        // CR 117.4 — the stack resolves its top object once both players pass
        // in succession. Drive the real predicate against a shrinking stack the
        // way the board does, and assert termination rather than asserting a
        // single call.
        let stack = projectStack([
            { kind: "spell", defId: BOLT.id, instance: "spell-1" },
            nobleExalted("trig-1"),
        ]);
        const held: YieldState = {
            p1: [yieldKeyForStackItem(stack[1])!],
            p2: [yieldKeyForStackItem(stack[1])!],
        };
        let priority = "p1";
        let passes = 0;
        let steps = 0;
        while (stack.length > 0 && steps++ < 20) {
            const fired = shouldAutoPassYield(
                {
                    playerId: priority,
                    activePlayerId: "p1",
                    priorityPlayerId: priority,
                    phase: "PRECOMBAT_MAIN",
                    stackItems: stack,
                },
                held,
                true
            );
            if (!fired) break;
            passes += 1;
            priority = priority === "p1" ? "p2" : "p1";
            if (passes === 2) {
                stack = stack.slice(0, -1); // top resolves
                passes = 0;
            }
        }
        // The yielded trigger resolved; the unyielded Bolt underneath stopped
        // the loop and handed priority back.
        expect(stack.map((i) => i.id)).toEqual(["spell-1"]);
        expect(steps).toBeLessThan(20);
    });
});
