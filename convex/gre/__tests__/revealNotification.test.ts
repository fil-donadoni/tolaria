// CR 701.20a reveal / CR 701.23b fail-to-find / CR 400.2 hidden zones —
// the transient reveal channel (issue #3425).
//
// Three defects, one channel. The `reveal` Op stamped Card Knowledge and
// returned, so 31 shipped cards revealed in complete silence while every
// SIBLING reveal-shaped Op popped the dialog; the tutor-to-top template's
// shuffle wiped the all-players knowledge the reveal had just granted and the
// put-on-top re-granted it to the library OWNER alone; and a library search
// that found nothing produced no client-visible signal at all, which a Hidden
// Zone (CR 400.2) projection can never supply on its own.
//
// Everything here is asserted through `projectPublicState` — the wire is the
// only thing a client sees, and a `pendingReveals` entry with the wrong
// audience is invisible exactly where it matters.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { getAllCards, getCardByName, getDefinition } from "../../cards";
import {
    buildSpellContext,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { projectPublicState } from "../../gameProjections";
import { OP_EXECUTORS } from "../effects/interpreter";
import type { CardDefinition, EffectOp } from "../../cards/types";

const STERLING_GROVE = getCardByName("Sterling Grove");
const WILD_GROWTH = getCardByName("Wild Growth").id;
const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id;
const ISLAND = getCardByName("Island").id;
const URZAS_BAUBLE = getCardByName("Urza's Bauble");

/** p1 has Sterling Grove on the battlefield; `libraryCardIds` is p1's library
 *  top-to-bottom. p2 holds a two-card hand so a whole-hand reveal has
 *  something to show. */
function groveState(libraryCardIds: string[]): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(STERLING_GROVE.id, {
                        id: "grove",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "battlefield",
                    }),
                ],
                library: libraryCardIds.map((cardId, i) =>
                    makeInstance(cardId, {
                        id: `lib-${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    })
                ),
            }),
            makePlayer("p2", {
                hand: [
                    makeInstance(ISLAND, {
                        id: "p2-hand-0",
                        controllerId: "p2",
                        ownerId: "p2",
                        zone: "hand",
                    }),
                ],
            }),
        ],
    });
}

/** Pushes an activated ability of a battlefield permanent onto the stack, the
 *  way `game.ts` does after costs are paid, and resolves it. Costs are not
 *  paid: none of the scripts under test reads the source. */
function activateAndResolve(
    state: GameState,
    playerId: string,
    cardInstanceId: string,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    const player = state.players.find((p) => p.id === playerId)!;
    const card = player.battlefield.find((c) => c.id === cardInstanceId)!;
    state.stack.push({
        ...structuredClone(card),
        zone: "stack" as const,
        castById: playerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

function head(state: GameState) {
    const h = state.pendingChoices?.[0];
    if (!h) throw new Error("no pending choice");
    return h;
}

function answer(state: GameState, ids: string[]): void {
    const h = head(state);
    applyPendingChoiceSubmit(state, {
        playerId: h.playerId,
        stackItemId: h.stackItemId,
        step: h.step,
        choiceId: h.choiceId,
        cardInstanceIds: ids,
    });
}

function revealsFor(state: GameState, viewerId: string) {
    return projectPublicState(state, 1, viewerId).pendingReveals ?? [];
}

describe("CR 701.20a — the `reveal` Op pops the reveal dialog (issue #3425)", () => {
    it("shows a searched-and-revealed card to BOTH players on the wire", () => {
        const state = groveState([GRIZZLY_BEARS, WILD_GROWTH, ISLAND]);
        activateAndResolve(state, "p1", "grove", "sterling-grove-search");
        // The script suspends on the search-library pick (CR 701.23a).
        expect(head(state).kind).toBe("search-library");
        answer(state, ["lib-1"]); // Wild Growth, the only enchantment

        for (const viewer of ["p1", "p2"]) {
            const reveals = revealsFor(state, viewer);
            const shown = reveals.filter((r) => r.kind === "reveal");
            expect(
                shown.map((r) => r.cards.map((c) => c.instanceId)),
                `viewer ${viewer}`
            ).toEqual([["lib-1"]]);
            expect(shown[0].cards[0].cardId).toBe(WILD_GROWTH);
            expect([...shown[0].audience].sort()).toEqual(["p1", "p2"]);
        }
    });

    it("keeps the found card face-up to the OPPONENT on top of the library after the shuffle (CR 701.20d / 701.24)", () => {
        const state = groveState([GRIZZLY_BEARS, WILD_GROWTH, ISLAND]);
        activateAndResolve(state, "p1", "grove", "sterling-grove-search");
        answer(state, ["lib-1"]);

        // The whole point of the Oracle line: that card is now on top.
        expect(state.players[0].library[0].id).toBe("lib-1");
        // …and the opponent, who legally saw the reveal and saw the
        // deterministic placement, still knows it. Read through the WIRE:
        // a library is `{ count, known[] }` and the sparse `known` channel is
        // the only way a card in a Hidden Zone reaches a viewer at all.
        for (const viewer of ["p1", "p2"]) {
            const lib = projectPublicState(state, 1, viewer).players.find(
                (p) => p.id === "p1"
            )!.library;
            const top = lib.known.find((k) => k.index === 0);
            expect(top?.card.id, `viewer ${viewer}`).toBe("lib-1");
            expect(
                (top?.card.card as { id?: string } | undefined)?.id,
                `viewer ${viewer}`
            ).toBe(WILD_GROWTH);
        }
    });

    it("leaves a private look addressed to its single viewer (no regression)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(URZAS_BAUBLE.id, {
                            id: "bauble",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "battlefield",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    hand: [
                        makeInstance(ISLAND, {
                            id: "p2-hand-0",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                }),
            ],
        });
        activateAndResolve(state, "p1", "bauble", "urzas-bauble-look-draw", [
            { type: "player", id: "p2" },
        ]);
        expect(revealsFor(state, "p1").map((r) => r.kind)).toEqual(["look"]);
        expect(revealsFor(state, "p2")).toEqual([]);
    });
});

describe("CR 701.23b — a library search that finds nothing says so (issue #3425)", () => {
    it("announces a fail-to-find to BOTH players", () => {
        // No enchantment in the library at all: the search still raises its
        // CR 701.23a look as a 0-pick prompt, and the player finishes it
        // having found nothing.
        const state = groveState([GRIZZLY_BEARS, ISLAND]);
        activateAndResolve(state, "p1", "grove", "sterling-grove-search");
        answer(state, []);

        for (const viewer of ["p1", "p2"]) {
            const notices = revealsFor(state, viewer).filter(
                (r) => r.kind === "fail-to-find"
            );
            expect(notices.length, `viewer ${viewer}`).toBe(1);
            expect(notices[0].cards).toEqual([]);
            expect([...notices[0].audience].sort()).toEqual(["p1", "p2"]);
        }
    });

    it("announces a DELIBERATE fail-to-find — a legal empty pick with a match present", () => {
        const state = groveState([GRIZZLY_BEARS, WILD_GROWTH, ISLAND]);
        activateAndResolve(state, "p1", "grove", "sterling-grove-search");
        answer(state, []); // CR 701.23b — not required to find
        expect(
            revealsFor(state, "p2").filter((r) => r.kind === "fail-to-find")
        ).toHaveLength(1);
    });

    it("stays silent when the search DOES find", () => {
        const state = groveState([GRIZZLY_BEARS, WILD_GROWTH, ISLAND]);
        activateAndResolve(state, "p1", "grove", "sterling-grove-search");
        answer(state, ["lib-1"]);
        for (const viewer of ["p1", "p2"]) {
            expect(
                revealsFor(state, viewer).filter(
                    (r) => r.kind === "fail-to-find"
                ),
                `viewer ${viewer}`
            ).toEqual([]);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Census — EVERY shipped `reveal` Op, not one hand-picked card.
//
// The fix is class-level by construction (one executor, no per-card opt-in),
// and this is what pins that: every `reveal` Op in the catalogue is executed
// verbatim — its own `player` ref, its own shape — and must enqueue an
// all-players `reveal` notification. A card that ever reached a non-notifying
// path would show up here as a missing entry, and a NEW reveal shape the
// executor does not handle fails the same way instead of shipping silent.
// ─────────────────────────────────────────────────────────────────────────

/** Every `reveal` Op in the catalogue, tagged with the card that carries it.
 *  Walks the whole definition object rather than the five named script sites:
 *  an Op nested inside `if` / `forEach` / a mode body is still a shipped
 *  reveal, and a walker that knows the site list goes stale the day a sixth
 *  site is added. */
function catalogueRevealOps(): { card: string; op: EffectOp }[] {
    const found: { card: string; op: EffectOp }[] = [];
    const seen = new Set<unknown>();
    function walk(node: unknown, card: string): void {
        if (node === null || typeof node !== "object") return;
        if (seen.has(node)) return;
        seen.add(node);
        if (Array.isArray(node)) {
            for (const child of node) walk(child, card);
            return;
        }
        const rec = node as Record<string, unknown>;
        if (rec.op === "reveal") found.push({ card, op: node as EffectOp });
        for (const value of Object.values(rec)) {
            if (typeof value === "function") continue; // `applies` / `matches`
            walk(value, card);
        }
    }
    for (const card of getAllCards() as CardDefinition[]) {
        walk(card as unknown, `${card.name} (${card.id})`);
    }
    return found;
}

describe("CR 701.20a — census: every shipped `reveal` Op notifies (issue #3425)", () => {
    const ops = catalogueRevealOps();

    it("finds the shipped reveal population", () => {
        // A floor, not an equality: the catalogue grows. It exists so a
        // refactor that silently stops FINDING the Ops cannot turn this whole
        // census into a vacuous pass.
        expect(ops.length).toBeGreaterThanOrEqual(30);
    });

    it("enqueues an all-players reveal for each one", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(ISLAND, {
                            id: "p1-hand-0",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    library: [
                        makeInstance(WILD_GROWTH, {
                            id: "p1-lib-0",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    hand: [
                        makeInstance(GRIZZLY_BEARS, {
                            id: "p2-hand-0",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                    library: [
                        makeInstance(ISLAND, {
                            id: "p2-lib-0",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "library",
                        }),
                    ],
                }),
            ],
        });
        const item = pushSpell(state, GRIZZLY_BEARS, "p1", [
            { type: "player", id: "p2" },
        ]);
        const ctx = buildSpellContext(state, item);
        // Seed every binding family a shipped reveal Op reads: the four picks
        // names its `cards` shape uses, and `$each` in the one forEach-scoped
        // player position (a player binding is the single-element [playerId]).
        for (const name of ["$picked", "$typecycled", "$found", "$called"]) {
            ctx.noteChoice(name, ["p1-lib-0", "p2-lib-0"]);
        }
        ctx.noteChoice("$each", ["p2"]);

        const missing: string[] = [];
        for (const { card, op } of ops) {
            const before = state.pendingReveals?.length ?? 0;
            // The third argument is the resume cursor `runOpList` threads
            // through every executor; `reveal` is not a structural Op and
            // never reads it, so a fresh one is passed.
            OP_EXECUTORS.reveal(
                ctx,
                op as Extract<EffectOp, { op: "reveal" }>,
                { pos: 0, resume: 0 }
            );
            const added = (state.pendingReveals ?? []).slice(before);
            const ok =
                added.length === 1 &&
                added[0].kind === "reveal" &&
                added[0].cards.length > 0 &&
                [...added[0].audience].sort().join() === "p1,p2";
            if (!ok) missing.push(card);
        }
        expect(missing).toEqual([]);
    });

    it("keeps the Op a pure DATA declaration — no card hand-rolls its own dialog", () => {
        // The other half of "class-level": a card that got the dialog by
        // calling `notifyReveal` itself would pass the sweep above while
        // leaving the Op broken for everyone else.
        for (const { card, op } of ops) {
            const keys = Object.keys(op as Record<string, unknown>).sort();
            expect(keys, card).toEqual(
                keys.includes("cards")
                    ? ["cards", "op", "player"]
                    : ["op", "player", "zone"]
            );
        }
    });
});

describe("definitions exist", () => {
    it("resolves Sterling Grove's search ability", () => {
        const def = getDefinition(STERLING_GROVE.id);
        expect(
            def.activatedAbilities?.some(
                (a) => a.id === "sterling-grove-search"
            )
        ).toBe(true);
    });
});
