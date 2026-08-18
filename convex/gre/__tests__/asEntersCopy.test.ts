// The as-enters COPY leg on EVERY entry path (CR 707.5 / 614.12a, ADR 0100
// slice 4, issue #2451).
//
// The originating user bug report: "Reanimate on phantasmal image doesn't
// work". Before this slice all five copy cards raised their copy choice from a
// `resolveSteps` step, which the engine runs only while a permanent SPELL is
// resolving — so every NON-CAST entry (reanimation, blink, put-onto-the-
// battlefield) skipped it and the permanent entered as its printed 0/0, which
// the next sweep binned (CR 704.5f). The choice is now a declaration on
// `entersWith.asEnters`, read at the CR 614 entry chokepoint.
//
// Scope note on fixtures: the CR 707.6 "the owed list GROWS" case needs a
// copied definition that itself declares an as-enters choice. Two shapes are
// exercised — one entirely out of the shipped catalogue (a Clone copying a
// Clone, copy→copy), and one against a registered synthetic definition with a
// NON-copy second leg (`payLife`), because the `name`/`payLife` legs are
// sibling slice #2467's and may not be wired to a shipped card yet.
import { describe, expect, it } from "vitest";
import {
    emitBecameTargetEvents,
    processPendingActionTriggers,
    putReanimatedSetOnBattlefield,
    resolveTopOfStack,
    createTokenPermanents,
    type CardInstanceState,
    type GameState,
} from "../state";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { compactState, expandState } from "../serialize";
import { checkStateBasedActions } from "../sba";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../layers";
import { projectPublicState } from "../../gameProjections";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import {
    clone,
    copyArtifact,
    vesuvanDoppelganger,
} from "../../cards/sets/lea/blue";
import { grizzlyBears, helmOfChatzuk, serraAngel } from "../../cards/sets/lea";
import { phantasmalImage } from "../../cards/sets/m12/blue";
import { phyrexianMetamorph } from "../../cards/sets/nph/blue";
import { reanimate } from "../../cards/sets/tmp/black";

/** "As this creature enters, pay any amount of life, up to 2." The CR 707.6
 *  fixture: a copy SOURCE whose own definition owes a NON-copy as-enters
 *  choice, so answering the copy grows the owed list with a leg that cannot be
 *  confused with the copy leg itself. */
const PAY_LIFE_ID = "test-2451-as-enters-pay-life";
const payLifeCreature: CardDefinition = {
    id: PAY_LIFE_ID,
    rarity: "common",
    name: "Test 2451 Pay-Life Creature",
    oracleText: "As this creature enters, pay any amount of life.",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 3,
    toughness: 3,
    entersWith: { asEnters: [{ kind: "payLife", cap: 2 }] },
};
registerTokenDefinition(payLifeCreature);

// --- Helpers ---------------------------------------------------------------

function head(state: GameState) {
    return (state.pendingChoices ?? [])[0];
}

/** Answers the head as-enters prompt through the REAL submit path. `[]` is the
 *  decline of the printed "you may". */
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

/** Census row B — the non-cast entry the bug report exercised: the card is
 *  lifted out of p1's graveyard and put onto the battlefield by an effect. */
function reanimateFromGraveyard(state: GameState, instanceId: string): void {
    const gy = state.players[0].graveyard;
    const idx = gy.findIndex((c) => c.id === instanceId);
    const [card] = gy.splice(idx, 1);
    putReanimatedSetOnBattlefield(state, [{ card, controllerId: "p1" }]);
}

/** A board with `defId` in p1's graveyard (instance id `subject`) and the given
 *  permanents on p2's battlefield. */
function graveyardBoard(
    defId: string,
    opponentBoard: CardInstanceState[] = []
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                life: 20,
                graveyard: [
                    makeInstance(defId, {
                        id: "subject",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "graveyard",
                    }),
                ],
            }),
            makePlayer("p2", { battlefield: opponentBoard }),
        ],
    });
}

function opponentPermanent(defId: string, id: string): CardInstanceState {
    return makeInstance(defId, { id, controllerId: "p2", ownerId: "p2" });
}

function entered(state: GameState, id = "subject"): CardInstanceState {
    return state.players[0].battlefield.find((c) => c.id === id)!;
}

// --- The reported bug, card by card ---------------------------------------

describe("CR 707.5 — the copy choice is raised on a NON-CAST entry (#2451)", () => {
    it("Phantasmal Image reanimated: prompt raised, copy applied, Illusion added, self-sac trigger granted", () => {
        const state = graveyardBoard(phantasmalImage.id, [
            opponentPermanent(serraAngel.id, "serra"),
        ]);

        reanimateFromGraveyard(state, "subject");

        // Pre-#2451 this was `pendingChoices: null` and a printed 0/0 already
        // on the battlefield.
        expect(head(state).asEntersKind).toBe("copy");
        expect(head(state).candidateIds).toEqual(["serra"]);
        // CR 707.5 — "it doesn't enter the battlefield, and THEN become a copy":
        // nothing is on any battlefield while the choice is outstanding.
        expect(state.players[0].battlefield).toHaveLength(0);

        answer(state, ["serra"]);

        const copy = entered(state);
        expect((copy.card as { id: string }).id).toBe(serraAngel.id);
        expect(getEffectivePower(state, copy)).toBe(4);
        expect(getEffectiveToughness(state, copy)).toBe(4);
        // CR 707.2's "except" clause: Illusion IN ADDITION TO the copied
        // subtypes, exactly as on the cast path.
        expect(copy.subtypes).toEqual(["Angel", "Illusion"]);
        expect(copy.staticAbilities).toEqual(["flying", "vigilance"]);
        // …and the granted BECAME_TARGET self-sacrifice trigger rode along.
        expect(
            copy.grantedTriggeredAbilities?.some(
                (g) => g.abilityId === "phantasmal-image-sacrifice"
            )
        ).toBe(true);
        // A 4/4 survives the sweep — the bug was that it did not.
        checkStateBasedActions(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "subject")
        ).toBe(true);
    });

    it("Phantasmal Image reanimated: the granted trigger actually FIRES on the reanimated copy (CR 603.2)", () => {
        const state = graveyardBoard(phantasmalImage.id, [
            opponentPermanent(serraAngel.id, "serra"),
        ]);
        reanimateFromGraveyard(state, "subject");
        answer(state, ["serra"]);

        const bolt = pushSpell(state, grizzlyBears.id, "p2");
        emitBecameTargetEvents(
            state,
            [{ type: "permanent", id: "subject" }],
            "p2",
            bolt.id
        );
        processPendingActionTriggers(state);

        expect(state.stack[state.stack.length - 1].triggeredAbilityId).toBe(
            "phantasmal-image-sacrifice"
        );
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.some((c) => c.id === "subject")
        ).toBe(false);
        expect(state.players[0].graveyard.some((c) => c.id === "subject")).toBe(
            true
        );
    });

    it("Clone reanimated: enters as a copy with the copied P/T, subtypes and abilities", () => {
        const state = graveyardBoard(clone.id, [
            opponentPermanent(serraAngel.id, "serra"),
        ]);

        reanimateFromGraveyard(state, "subject");
        expect(head(state).asEntersKind).toBe("copy");
        answer(state, ["serra"]);

        const copy = entered(state);
        expect((copy.card as { id: string }).id).toBe(serraAngel.id);
        expect(copy.subtypes).toEqual(["Angel"]);
        expect(copy.staticAbilities).toEqual(["flying", "vigilance"]);
        expect(getEffectivePower(state, copy)).toBe(4);
        expect(getEffectiveToughness(state, copy)).toBe(4);
        expect(copy.copiedFrom).toBe(clone.id);
    });

    it("Vesuvan Doppelganger reanimated: copies the body but keeps its own blue (CR 707.9d)", () => {
        const state = graveyardBoard(vesuvanDoppelganger.id, [
            opponentPermanent(serraAngel.id, "serra"),
        ]);

        reanimateFromGraveyard(state, "subject");
        answer(state, ["serra"]);

        const copy = entered(state);
        expect((copy.card as { id: string }).id).toBe(serraAngel.id);
        expect(getEffectivePower(state, copy)).toBe(4);
        expect(copy.colorOverride).toEqual(["U"]);
        expect(STATIC_EFFECT_CTX.getColors(copy)).toEqual(["U"]);
    });

    it("Phyrexian Metamorph reanimated: copies a creature and stays an artifact too", () => {
        const state = graveyardBoard(phyrexianMetamorph.id, [
            opponentPermanent(serraAngel.id, "serra"),
        ]);

        reanimateFromGraveyard(state, "subject");
        answer(state, ["serra"]);

        const copy = entered(state);
        expect((copy.card as { id: string }).id).toBe(serraAngel.id);
        expect(copy.types).toContain("Creature");
        expect(copy.types).toContain("Artifact");
    });

    it("Copy Artifact put onto the battlefield: copies an artifact and stays an enchantment too", () => {
        // Copy Artifact is an Enchantment, so Reanimate cannot fetch it — the
        // generic put-onto-the-battlefield path (census row B) is what a blink
        // or an Academy-Rector-shaped effect uses, and it is the same
        // chokepoint.
        const state = graveyardBoard(copyArtifact.id, [
            opponentPermanent(helmOfChatzuk.id, "helm"),
            opponentPermanent(serraAngel.id, "serra"),
        ]);

        reanimateFromGraveyard(state, "subject");
        // The declared `{ types: "Artifact" }` filter narrows the offer — the
        // Angel is not a legal source.
        expect(head(state).candidateIds).toEqual(["helm"]);
        answer(state, ["helm"]);

        const copy = entered(state);
        expect((copy.card as { id: string }).id).toBe(helmOfChatzuk.id);
        expect(copy.types).toContain("Artifact");
        expect(copy.types).toContain("Enchantment");
    });

    it("full path through the real Reanimate spell — the exact reported position", () => {
        const state = graveyardBoard(phantasmalImage.id, [
            opponentPermanent(serraAngel.id, "serra"),
        ]);
        const spell = pushSpell(state, reanimate.id, "p1", [
            { type: "graveyard-card", id: "subject", playerId: "p1" },
        ]);

        resolveTopOfStack(state);

        // The spell's own resolution parked the entry, so its stack item is
        // still live (ADR 0100 D5) and the rest of its script has NOT run.
        expect(head(state).asEntersKind).toBe("copy");
        expect(state.stack.map((s) => s.id)).toContain(spell.id);

        answer(state, ["serra"]);

        // The suspended resolution completed in the same mutation.
        expect(state.stack.map((s) => s.id)).not.toContain(spell.id);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        const copy = entered(state);
        expect((copy.card as { id: string }).id).toBe(serraAngel.id);
        expect(getEffectiveToughness(state, copy)).toBe(4);
    });
});

// --- Declining (CR 704.5f is CORRECT here, not the bug) --------------------

describe("declining the copy leaves the printed body (CR 704.5f, #2451)", () => {
    it("a declined Clone enters as its printed 0/0 and the sweep bins it", () => {
        const state = graveyardBoard(clone.id, [
            opponentPermanent(serraAngel.id, "serra"),
        ]);
        reanimateFromGraveyard(state, "subject");

        // The printed clause is "you MAY have this enter as a copy": an empty
        // submission is a legal answer, not a validation error.
        expect(head(state).count).toEqual({ min: 0, max: 1 });
        answer(state, []);

        // It DID enter (unlike the `discard` leg, a declined copy still enters)
        // and then died to the sweep — that outcome is correct, and is exactly
        // what the bug looked like from the player's seat when the prompt was
        // never offered at all.
        expect(state.players[0].graveyard.some((c) => c.id === "subject")).toBe(
            true
        );
        expect(
            state.players[0].battlefield.some((c) => c.id === "subject")
        ).toBe(false);
    });

    it("a declined Phantasmal Image has NO granted self-sacrifice trigger", () => {
        // The trigger is part of the copy effect's "except" clause, not printed
        // on the base card — declining must not grant it.
        const state = graveyardBoard(phantasmalImage.id, [
            opponentPermanent(serraAngel.id, "serra"),
        ]);
        reanimateFromGraveyard(state, "subject");
        answer(state, []);

        const gy = state.players[0].graveyard.find((c) => c.id === "subject")!;
        expect(gy.grantedTriggeredAbilities ?? []).toHaveLength(0);
    });

    it("no legal source — the choice is auto-declined, never a prompt nobody can answer", () => {
        const state = graveyardBoard(clone.id, []);

        reanimateFromGraveyard(state, "subject");

        // Standing auto-resolve rule: a "choice" whose only legal submission is
        // the empty one is answered on the chooser's behalf, and the entry runs
        // straight through instead of parking behind a dead prompt.
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stagedEntries).toBeUndefined();
        const printed = entered(state);
        expect((printed.card as { id: string }).id).toBe(clone.id);
        expect(getEffectiveToughness(state, printed)).toBe(0);

        checkStateBasedActions(state);
        expect(state.players[0].graveyard.some((c) => c.id === "subject")).toBe(
            true
        );
    });
});

// --- CR 707.6: the owed list is DISCOVERED, not fixed ----------------------

describe("CR 707.6 — the copy's controller makes the COPIED card's as-enters choices (#2451)", () => {
    it("a reanimated Clone copying a permanent with its own as-enters clause owes a SECOND, fresh choice", () => {
        const state = graveyardBoard(clone.id, [
            opponentPermanent(PAY_LIFE_ID, "source"),
        ]);
        // The source permanent already made ITS choice long ago; CR 707.6 says
        // that choice is NOT copied.
        state.players[1].battlefield[0].chosenName = "Should Not Be Copied";

        reanimateFromGraveyard(state, "subject");
        expect(head(state).asEntersKind).toBe("copy");

        answer(state, ["source"]);

        // Still staged: answering the copy revealed the COPIED definition's own
        // clause, which was not on Clone's printed declaration and could not
        // have been read up front.
        expect(state.stagedEntries).toHaveLength(1);
        expect(state.stagedEntries![0].owed).toEqual([
            { kind: "payLife", cap: 2 },
        ]);
        expect(head(state).asEntersKind).toBe("payLife");
        // CR 614.12a — and it still has not entered.
        expect(state.players[0].battlefield).toHaveLength(0);

        answer(state, ["2"]);

        expect(state.stagedEntries).toBeUndefined();
        const copy = entered(state);
        expect((copy.card as { id: string }).id).toBe(PAY_LIFE_ID);
        expect(getEffectivePower(state, copy)).toBe(3);
        // A FRESH pick, paid by the Clone's controller — not the source's.
        expect(state.players[0].life).toBe(18);
        expect(state.players[1].life).toBe(20);
    });

    it("copy→copy: copying a Clone does NOT re-owe the copy choice already answered", () => {
        // Entirely out of the shipped catalogue: the copied definition's own
        // `asEnters` is the `copy` leg itself. `consultedDefIds` is seeded with
        // the entry's own presented definition at park time, so landing back on
        // Clone's identity is a definition already consulted and appends
        // nothing — without that dedup this is an unbounded chain, since every
        // answer re-owes the same choice.
        const state = graveyardBoard(clone.id, [
            opponentPermanent(clone.id, "other-clone"),
            opponentPermanent(grizzlyBears.id, "bears"),
        ]);

        reanimateFromGraveyard(state, "subject");
        // The staged permanent is never its own copy source.
        expect(head(state).candidateIds).toEqual(["other-clone", "bears"]);

        answer(state, ["other-clone"]);

        expect(state.stagedEntries).toBeUndefined();
        expect(state.pendingChoices ?? []).toHaveLength(0);
        // It entered as a Clone — a printed 0/0 — and the sweep inside the
        // finalize (CR 704.5f) binned it in the same mutation.
        const gy = state.players[0].graveyard.find((c) => c.id === "subject")!;
        expect(gy).toBeDefined();
        expect(
            state.players[0].battlefield.some((c) => c.id === "subject")
        ).toBe(false);
    });

    it("a copied definition with no as-enters clause appends nothing and the entry resumes at once", () => {
        const state = graveyardBoard(clone.id, [
            opponentPermanent(grizzlyBears.id, "bears"),
        ]);

        reanimateFromGraveyard(state, "subject");
        answer(state, ["bears"]);

        expect(state.stagedEntries).toBeUndefined();
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect((entered(state).card as { id: string }).id).toBe(
            grizzlyBears.id
        );
    });

    it("the CR 707.6 chain survives the DB round-trip between its two choices", () => {
        // A pending choice IS a stable save point, so a two-choice chain is
        // saved and reloaded MID-chain in ordinary play, not as an edge case:
        // the copy has already been applied to a card that is in no zone.
        const state = graveyardBoard(clone.id, [
            opponentPermanent(PAY_LIFE_ID, "source"),
        ]);
        reanimateFromGraveyard(state, "subject");
        answer(state, ["source"]);

        const reloaded = expandState(compactState(state));
        expect(reloaded.stagedEntries).toHaveLength(1);
        expect(reloaded.stagedEntries![0].owed).toEqual([
            { kind: "payLife", cap: 2 },
        ]);

        answer(reloaded, ["1"]);

        const copy = entered(reloaded);
        expect((copy.card as { id: string }).id).toBe(PAY_LIFE_ID);
        expect(getEffectivePower(reloaded, copy)).toBe(3);
        expect(reloaded.players[0].life).toBe(19);
    });
});

// --- Census row C: token entries (ADR 0100 D5/D6) --------------------------

describe("as-enters copy on a TOKEN entry (census row C, #2451)", () => {
    it("a token whose spec declares the copy leg parks and enters as the copy", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [opponentPermanent(serraAngel.id, "serra")],
                }),
            ],
        });

        const ids = createTokenPermanents(
            state,
            {
                name: "As-Enters Copy Token",
                types: ["Creature"],
                power: 0,
                toughness: 0,
                entersWith: {
                    asEnters: [{ kind: "copy", filter: { types: "Creature" } }],
                },
            },
            "p1",
            1
        );

        expect(state.stagedEntries).toHaveLength(1);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(head(state).asEntersKind).toBe("copy");

        answer(state, ["serra"]);

        expect(state.players[0].battlefield).toHaveLength(1);
        const token = state.players[0].battlefield[0];
        expect(token.id).toBe(ids[0]);
        expect(token.isToken).toBe(true);
        expect(getEffectivePower(state, token)).toBe(4);
    });
});

// --- CR 400.7: the copy carry may resurrect NOTHING from a previous existence

describe("CR 400.7 — the copy carry never resurrects a previous existence (#2451)", () => {
    it("a graveyard Clone's stale colorOverride and foreign ability grant do NOT ride the copy back onto the battlefield", () => {
        const state = graveyardBoard(clone.id, [
            opponentPermanent(serraAngel.id, "serra"),
        ]);
        // The exit side clears neither of these (the CR 400.7 reset is
        // ENTRY-side), so both are reachable on a card sitting in a graveyard:
        // `colorOverride` from a colour-changing effect, and
        // `grantedTriggeredAbilities` from some OTHER source's grant — an aura
        // that was on this creature during its previous battlefield existence.
        const inGraveyard = state.players[0].graveyard.find(
            (c) => c.id === "subject"
        )!;
        inGraveyard.colorOverride = ["R"];
        inGraveyard.grantedTriggeredAbilities = [
            { sourceCardId: "some-other-aura", abilityId: "stale-grant" },
        ];

        reanimateFromGraveyard(state, "subject");
        answer(state, ["serra"]);

        const copy = entered(state);
        // The copy itself still happened…
        expect((copy.card as { id: string }).id).toBe(serraAngel.id);
        expect(copy.copiedFrom).toBe(clone.id);
        // …and Clone's `opts` name NEITHER a colour clause nor an added
        // trigger, so neither field may be set on the permanent that entered.
        expect(copy.colorOverride).toBeUndefined();
        expect(copy.grantedTriggeredAbilities).toBeUndefined();
        // A surviving `colorOverride` would outrank the copied colour here.
        expect(STATIC_EFFECT_CTX.getColors(copy)).toEqual(["W"]);
    });

    // The converse — a colour clause / added trigger the copy answer DID write
    // must still cross the entry reset — is guarded by the Vesuvan
    // Doppelganger (CR 707.9d) and Phantasmal Image cases above. A DECLINED
    // copy needs no case of its own: nothing is carried, and the ordinary
    // entry reset clears both fields on that leg regardless.
});

// --- Wire format (mandatory — P/T, subtypes and identity are client-visible)

describe("wire format: the reanimated copy survives projectPublicState (#2451)", () => {
    it("Phantasmal Image's copied identity, added subtype and P/T all project", () => {
        const state = graveyardBoard(phantasmalImage.id, [
            opponentPermanent(serraAngel.id, "serra"),
        ]);
        reanimateFromGraveyard(state, "subject");
        answer(state, ["serra"]);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "subject"
        )!;
        expect((slim.card as { id: string }).id).toBe(serraAngel.id);
        expect(slim.subtypes).toEqual(["Angel", "Illusion"]);
        expect(slim.staticAbilities).toEqual(["flying", "vigilance"]);
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });

    it("the STAGED permanent is in no projected zone while its choice is outstanding", () => {
        const state = graveyardBoard(clone.id, [
            opponentPermanent(serraAngel.id, "serra"),
        ]);
        reanimateFromGraveyard(state, "subject");

        const projected = projectPublicState(state, 1, "p1");
        for (const p of projected.players) {
            expect(p.battlefield.some((c) => c.id === "subject")).toBe(false);
            expect(p.graveyard.some((c) => c.id === "subject")).toBe(false);
        }
        // The dialog renders it from its definition id instead (ADR 0100 D2).
        expect(head(state).subjectCardId).toBe(clone.id);
    });
});
