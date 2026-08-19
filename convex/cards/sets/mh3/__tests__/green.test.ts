// MH3 — green behavior tests (ADR 0043 colour split).
//
// Malevolent Rumble — {1}{G} Sorcery (issue #1531/#1525). Its `lookDistribute`
// leg has its OWN permanent interpreter coverage (per-Op regime, ADR 0045,
// `convex/gre/effects/__tests__/interpreter.test.ts`), but the catalogue's
// auto-generated canned-scenario smoke sweep (`effectScriptSmoke.test.ts`)
// explicitly SKIPS every `lookDistribute` card — it suspends on a live
// look-distribute pick the generator can't drive — so (per Reviving Vapors'
// own precedent, `convex/cards/sets/inv/__tests__/multicolor.test.ts`) this
// is the card-level proof the script is wired correctly end to end: the
// permanent filter picks out only permanent-typed cards from the revealed
// window, the rest (incl. filtered-out nonpermanents) go to the graveyard,
// and the Eldrazi Spawn token is created alongside.

import { describe, it, expect } from "vitest";
import {
    fanaticOfRhonas,
    malevolentRumble,
    springheartNantuko,
} from "../green";
import { grizzlyBears } from "../../lea";
import { collectTriggers } from "../../../../gre/triggers";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { applyBestowCharacteristics } from "../../../../gre/bestow";
import { forest, island } from "../../lea/colorless";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack, type GameState } from "../../../../gre/state";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { projectPublicState } from "../../../../gameProjections";
import {
    getDefinition,
    getInstanceManaCost,
    registerTokenDefinition,
} from "../../..";
import { getEffectiveColors } from "../../../effectiveColors";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { manaValue } from "../../../../gre/constants";
import {
    abandonPendingPayment,
    activateAbilityOnState,
    buildPendingActivation,
    tryAutoCommitPendingActivation,
} from "../../../../game";

// Two throwaway nonpermanent library-filler defs (mirrors Reviving Vapors'
// `REVIVING_VAPORS_MV4_ID` pattern) — proves the filter actually EXCLUDES
// nonpermanent cards from hand-eligibility rather than accepting anything.
const TEST_INSTANT_ID = "test-malevolent-rumble-instant";
registerTokenDefinition({
    id: TEST_INSTANT_ID,
    name: TEST_INSTANT_ID,
    rarity: "common",
    manaCost: { generic: 1 },
    types: ["Instant"],
});
const TEST_SORCERY_ID = "test-malevolent-rumble-sorcery";
registerTokenDefinition({
    id: TEST_SORCERY_ID,
    name: TEST_SORCERY_ID,
    rarity: "common",
    manaCost: { generic: 1 },
    types: ["Sorcery"],
});

// Answers the head `pendingChoices` "look-distribute" entry (CR 608.2)
// keeping the given card instance ids and resumes resolution — mirrors
// Reviving Vapors' own `submitChoice` helper.
function submitChoice(state: GameState, cardInstanceIds: string[]): void {
    const head = state.pendingChoices![0];
    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds,
    });
}

const libOf = (ids: [string, string][]) =>
    ids.map(([cid, defId]) =>
        makeInstance(defId, {
            id: cid,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );

describe("Malevolent Rumble (CR 401.4 reveal/dig, CR 707.2 token, issue #1531)", () => {
    it("reveals the top four, keeps the chosen permanent to hand, bins the rest, and creates the Eldrazi Spawn", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf([
                        ["keepLand", island.id], // permanent — chosen
                        ["burnSpell", TEST_INSTANT_ID], // nonpermanent
                        ["someSorcery", TEST_SORCERY_ID], // nonpermanent
                        ["otherLand", island.id], // permanent — NOT chosen
                        ["untouched", island.id], // never enters the look window
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, malevolentRumble.id, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspends on the dig pick

        const head = state.pendingChoices![0];
        expect(head.kind).toBe("look-distribute");
        // The FULL revealed window (candidateIds) — all 4 looked-at cards —
        // but `eligibleIds` narrows hand-eligibility to the two permanents
        // (issue #1266's filtered-eligibility shape).
        expect(head.candidateIds).toEqual([
            "keepLand",
            "burnSpell",
            "someSorcery",
            "otherLand",
        ]);
        expect(head.eligibleIds).toEqual(["keepLand", "otherLand"]);
        expect(head.destination).toBe("graveyard");

        submitChoice(state, ["keepLand"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);

        // (a) the chosen permanent went to hand.
        expect(state.players[0].hand.map((c) => c.id)).toContain("keepLand");
        // (b) the rest of the revealed window — incl. the filtered-out
        // nonpermanents AND the unchosen permanent — went to the graveyard.
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(
            expect.arrayContaining(["burnSpell", "someSorcery", "otherLand"])
        );
        // The 5th library card never entered the look window — untouched.
        expect(state.players[0].library.map((c) => c.id)).toEqual([
            "untouched",
        ]);

        // (c) one 0/1 colorless Eldrazi Spawn token was created on the
        // controller's battlefield.
        const token = state.players[0].battlefield.find(
            (c) => c.isToken === true
        );
        expect(token).toBeDefined();
        expect(token!.types).toEqual(["Creature"]);
        expect(token!.subtypes).toEqual(["Eldrazi", "Spawn"]);
        expect(token!.power).toBe(0);
        expect(token!.toughness).toBe(1);
        expect(token!.controllerId).toBe("p1");
        const tokenDef = getDefinition(token!.card.id as string);
        expect(tokenDef.manaCost).toEqual({}); // no colored pips — colorless
        expect(tokenDef.activatedAbilities?.[0].oracleText).toBe(
            "Sacrifice this token: Add {C}."
        );
    });

    it("wire format: hand/graveyard/token outcome survives projectPublicState", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: libOf([
                        ["keepLand", island.id],
                        ["burnSpell", TEST_INSTANT_ID],
                        ["someSorcery", TEST_SORCERY_ID],
                        ["otherLand", island.id],
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, malevolentRumble.id, "p1");
        resolveTopOfStack(state); // suspends
        submitChoice(state, ["keepLand"]);

        const projected = projectPublicState(state, 1, "p1");
        expect(
            projected.players[0].hand.some((c) => c?.id === "keepLand")
        ).toBe(true);
        expect(projected.players[0].graveyard.map((c) => c.id)).toEqual(
            expect.arrayContaining(["burnSpell", "someSorcery", "otherLand"])
        );
        const projectedToken = projected.players[0].battlefield.find(
            (c) => c.isToken === true
        );
        expect(projectedToken).toBeDefined();
        expect(projectedToken!.subtypes).toEqual(["Eldrazi", "Spawn"]);
        expect(projectedToken!.power).toBe(0);
        expect(projectedToken!.toughness).toBe(1);
    });
});

// ===========================================================================
// Fanatic of Rhonas — Eternalize {2}{G}{G} (CR 702.129, issue #2339)
//
// The keyword ships WHOLE here because every surface it touches is new or
// newly reachable: the graveyard-only + sorcery-speed activation, the
// exile-this-from-your-graveyard cost (and its cancel semantics), the CR 707.2
// copy exceptions on the resulting token, and the wire projection of all four.
// ===========================================================================
describe("Fanatic of Rhonas — Eternalize (CR 702.129 / 707.2)", () => {
    const eternalize = fanaticOfRhonas.activatedAbilities!.find(
        (a) => a.id === "eternalize"
    )!;
    /** CR 111 — the card's own printed eternalize token (tmh3 #15). */
    const TOKEN_PRINT_ID = "6ef58164-4155-4e5b-8c16-f16f2ab65baa";

    /** Fanatic in p1's graveyard, {G}{G}{G}{G} floating, a main phase with an
     *  empty stack — every gate CLEAR except the one under test. */
    function graveyardScenario(
        overrides: { phase?: GameState["phase"]; green?: number } = {}
    ): GameState {
        const card = makeInstance(fanaticOfRhonas.id, {
            id: "fanatic",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        return makeState({
            phase: overrides.phase ?? "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    graveyard: [card],
                    manaPool: {
                        W: 0,
                        U: 0,
                        B: 0,
                        R: 0,
                        G: overrides.green ?? 4,
                        C: 0,
                    },
                }),
                makePlayer("p2"),
            ],
        });
    }

    /** Drives the REAL deferred-commit path with the graveyard source (the
     *  same one `activateAbility` funnels into once mana is covered). */
    function activate(state: GameState): void {
        state.pendingActivation = buildPendingActivation({
            playerId: "p1",
            cardInstanceId: "fanatic",
            abilityId: eternalize.id,
            ability: eternalize,
            manaCost: { X: 2, G: 2 },
            fromGraveyard: true,
        });
        tryAutoCommitPendingActivation(state, "p1");
    }

    it("pays by exiling the card from the graveyard as the ability goes on the stack (CR 702.129a / 118.3)", () => {
        const state = graveyardScenario();
        activate(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].abilityId).toBe(eternalize.id);
        // The cost moved the CARD graveyard → exile; the stack item is a clone.
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[0].exile.map((c) => c.id)).toEqual(["fanatic"]);
        // {2}{G}{G} paid out of the four floating green.
        expect(state.players[0].manaPool.G).toBe(0);
    });

    it("cancelling a part-paid activation leaves the graveyard untouched (CR 601.2h)", () => {
        // Announced through the REAL entry point with the cost only partly
        // covered, so the engine parks a `pendingActivation` instead of
        // committing — the exact window a player cancels in. Paying the exile
        // leg at ANNOUNCEMENT instead of at commit would strip the card out of
        // the graveyard here and never put it back.
        const state = graveyardScenario({ green: 1 });
        state.players[0].battlefield.push(
            makeInstance(forest.id, {
                id: "f1",
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "fanatic",
            abilityId: eternalize.id,
        });
        expect(state.pendingActivation).toBeDefined();
        expect(state.pendingActivation!.exileThisSource).toBe(true);
        // Nothing paid yet: the card is still in the graveyard, off the stack.
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "fanatic",
        ]);
        expect(state.stack).toHaveLength(0);

        abandonPendingPayment(state, "p1");
        expect(state.pendingActivation).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "fanatic",
        ]);
        expect(state.players[0].exile).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });

    it("resolves into a token copy carrying all four CR 707.2 exceptions", () => {
        const state = graveyardScenario();
        activate(state);
        resolveTopOfStack(state);

        const token = state.players[0].battlefield.find((c) => c.isToken);
        expect(token).toBeDefined();
        // "except it's a 4/4 …" — a BASE P/T override, so it reads through the
        // layer system (CR 613.4a layer 7a), not just off the instance.
        expect(getEffectivePower(state, token!)).toBe(4);
        expect(getEffectiveToughness(state, token!)).toBe(4);
        // "… black …" — layer 5 colour set, through the single colour
        // authority (the printed cost is green).
        expect(getEffectiveColors(token!)).toEqual(["B"]);
        // "… Zombie in addition to its other types …" (CR 205.1b).
        expect(token!.subtypes).toEqual(["Snake", "Druid", "Zombie"]);
        expect(token!.types).toEqual(["Creature"]);
        // "… with no mana cost" — mana value 0 (CR 202.3), read through the
        // single mana-cost authority rather than off the copied definition.
        expect(getInstanceManaCost(token!)).toEqual({});
        expect(manaValue(getInstanceManaCost(token!))).toBe(0);
        // CR 707.2 — the copy still presents the copied card otherwise: its
        // name and its two mana abilities come from Fanatic's definition.
        expect(getDefinition((token!.card as { id: string }).id).name).toBe(
            "Fanatic of Rhonas"
        );
        // CR 111 — the card's OWN printed eternalize token art, not the
        // creature printing the copy otherwise presents.
        expect(token!.imagePrintId).toBe(TOKEN_PRINT_ID);
        // The token was born AS a copy — it never had a printed identity of
        // its own to preserve, so `copiedFrom` must stay unset. Left pointing
        // at the disposable "Copy" 0/0 placeholder, it leaked into the card
        // preview's "original" face as a nameless, imageless token (issue
        // reported against this card's Chrome debug session).
        expect(token!.copiedFrom).toBeUndefined();
    });

    it("wire format: every exception survives projectPublicState", () => {
        const state = graveyardScenario();
        activate(state);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find((c) => c.isToken);
        expect(slim).toBeDefined();
        // The projection rewrites `card` down to `{ id }`, so anything read off
        // the fat instance's card object is gone by here — these four must be
        // instance-level or they are silently wrong on the client.
        expect(getEffectivePower(projected, slim!)).toBe(4);
        expect(getEffectiveToughness(projected, slim!)).toBe(4);
        expect(getEffectiveColors(slim!)).toEqual(["B"]);
        expect(manaValue(getInstanceManaCost(slim!))).toBe(0);
        expect(slim!.subtypes).toEqual(["Snake", "Druid", "Zombie"]);
        expect(slim!.imagePrintId).toBe(TOKEN_PRINT_ID);
        // The exiled card is public (CR 400.2) and reaches the client too.
        expect(projected.players[0].exile.map((c) => c.id)).toEqual([
            "fanatic",
        ]);
    });

    it("full path: activateAbilityOnState → stack → resolution → token in the projected state", () => {
        const state = graveyardScenario();
        // The REAL mutation core, exactly as the graveyard Activate button
        // calls it — no hand-built pendingActivation.
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "fanatic",
            abilityId: eternalize.id,
            keepPriority: true,
        });
        expect(state.stack).toHaveLength(1);
        expect(state.players[0].graveyard).toHaveLength(0);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find((c) => c.isToken);
        expect(slim).toBeDefined();
        expect(getEffectivePower(projected, slim!)).toBe(4);
        expect(getEffectiveColors(slim!)).toEqual(["B"]);
    });

    it("is illegal outside a sorcery window (CR 702.129a / 307.5)", () => {
        const state = graveyardScenario({ phase: "DECLARE_ATTACKERS" });
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "fanatic",
                abilityId: eternalize.id,
            })
        ).toThrow("Activate only as a sorcery");
        expect(state.stack).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(1);
    });

    it("is illegal from the battlefield — it functions only in the graveyard (CR 113.6)", () => {
        const state = graveyardScenario();
        const [card] = state.players[0].graveyard.splice(0, 1);
        card.zone = "battlefield";
        state.players[0].battlefield.push(card);
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p1",
                cardInstanceId: "fanatic",
                abilityId: eternalize.id,
            })
        ).toThrow("can't be activated from the battlefield");
        expect(state.stack).toHaveLength(0);
    });

    it("is illegal from an opponent's graveyard — only the owner may eternalize (CR 602.1)", () => {
        const state = graveyardScenario();
        state.priorityPlayerId = "p2";
        expect(() =>
            activateAbilityOnState(state, {
                playerId: "p2",
                cardInstanceId: "fanatic",
                abilityId: eternalize.id,
            })
        ).toThrow("You do not own this card");
        expect(state.players[0].graveyard).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Springheart Nantuko (issue #2388) — the catalogue's first Bestow card.
//
// The BESTOW cast mode itself is engine infra and is proved in
// `convex/gre/__tests__/bestow.test.ts` (CR 702.103b/e/f, the SBA exception,
// the wire projection, the DB round-trip). What is proved HERE is the card:
// the +1/+1 while attached, and both branches of the landfall trigger — which
// earn a hand-written test because the auto-generated smoke sweep cannot drive
// a script that suspends on a `mayPay`, and because "that creature" resolves
// through the `$host` attachment binding, which is only ever populated when
// the permanent is bestowed.
// ---------------------------------------------------------------------------

/** Synthesizes the PERMANENT_ENTERED event a land drop emits (CR 603.6a) and
 *  puts the resulting landfall trigger on the stack. */
function nantukoLandfallOnStack(
    state: GameState,
    landId: string,
    controllerId: string
) {
    const triggers = collectTriggers(state, [
        {
            type: "PERMANENT_ENTERED" as const,
            instanceId: landId,
            controllerId,
            cardId: forest.id,
            types: ["Land"] as const,
        },
    ]);
    expect(triggers).toHaveLength(1);
    state.stack.push(...triggers);
    return triggers[0];
}

/** A board where Nantuko is already bestowed onto `host`, plus a Forest that
 *  has "just entered". `hostController` decides whether the enchanted creature
 *  is one p1 controls (the payment branch) or the opponent's (it is not). */
function bestowedBoard(hostController: "p1" | "p2" = "p1") {
    const nantuko = makeInstance(springheartNantuko.id, {
        id: "nantuko",
        controllerId: "p1",
        ownerId: "p1",
    });
    // CR 702.103b — the state a resolved bestowed cast leaves behind. Applied
    // through the engine's own helper so this fixture can never drift from
    // what `finalizeTargetSelection` actually produces.
    applyBestowCharacteristics(nantuko);
    nantuko.attachedTo = "host";
    const host = makeInstance(grizzlyBears.id, {
        id: "host",
        controllerId: hostController,
        ownerId: hostController,
    });
    const land = makeInstance(forest.id, { id: "land1", controllerId: "p1" });
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    nantuko,
                    ...(hostController === "p1" ? [host] : []),
                    land,
                ],
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 2 },
            }),
            makePlayer("p2", {
                battlefield: hostController === "p2" ? [host] : [],
            }),
        ],
    });
    return { state, nantuko, host };
}

describe("Springheart Nantuko — bestowed buff (CR 613 layer 7c / 303.4m)", () => {
    it("gives the enchanted creature +1/+1, on the board and across the wire", () => {
        const { state, host } = bestowedBoard();
        expect(getEffectivePower(state, host)).toBe(3);
        expect(getEffectiveToughness(state, host)).toBe(3);

        const projected = projectPublicState(state, 1, "p1");
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slimHost)).toBe(3);
        expect(getEffectiveToughness(projected, slimHost)).toBe(3);
    });

    it("gives nothing while unattached — the buff is keyed on attachedTo", () => {
        const { state, host, nantuko } = bestowedBoard();
        nantuko.attachedTo = undefined;
        expect(getEffectivePower(state, host)).toBe(2);
        expect(getEffectiveToughness(state, host)).toBe(2);
    });
});

describe("Springheart Nantuko — Landfall (CR 603.6a / 109.5)", () => {
    it("attached to a creature you control and paid: copies that creature", () => {
        const { state } = bestowedBoard();
        nantukoLandfallOnStack(state, "land1", "p1");
        resolveTopOfStack(state);

        expect(state.pendingChoices?.[0]).toMatchObject({ kind: "may-pay" });
        applyMayPaySubmit(state, { playerId: "p1", accept: true });

        const p1 = state.players[0];
        const tokens = p1.battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(1);
        // CR 707.2 — a copy of the ENCHANTED creature, not the Insect.
        expect(getDefinition((tokens[0].card as { id: string }).id).name).toBe(
            "Grizzly Bears"
        );
        expect(p1.manaPool.G).toBe(1); // {1}{G} paid out of {G}{G} + {C}{C}
    });

    it("attached to a creature you control and DECLINED: creates the 1/1 green Insect", () => {
        const { state } = bestowedBoard();
        nantukoLandfallOnStack(state, "land1", "p1");
        resolveTopOfStack(state);

        expect(state.pendingChoices?.[0]).toMatchObject({ kind: "may-pay" });
        applyMayPaySubmit(state, { playerId: "p1", accept: false });

        const p1 = state.players[0];
        const tokens = p1.battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(1);
        expect(tokens[0].subtypes).toContain("Insect");
        expect(tokens[0].power).toBe(1);
        expect(tokens[0].toughness).toBe(1);
        expect(getEffectiveColors(tokens[0])).toEqual(["G"]);
    });

    it("UNATTACHED: offers no payment at all and creates the Insect (CR 608.2b — no $host)", () => {
        const { state, nantuko } = bestowedBoard();
        nantuko.attachedTo = undefined;
        nantukoLandfallOnStack(state, "land1", "p1");
        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(1);
        expect(tokens[0].subtypes).toContain("Insect");
        expect(state.players[0].manaPool.G).toBe(2); // nothing was paid
    });

    it("attached to a creature you DON'T control: no payment, Insect only (CR 109.5)", () => {
        // The `controlledBy` scope on the objectMatchesFilter predicate is the
        // whole of this clause: without it the may-pay would be offered on an
        // opponent's enchanted creature.
        const { state } = bestowedBoard("p2");
        nantukoLandfallOnStack(state, "land1", "p1");
        resolveTopOfStack(state);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        const tokens = state.players[0].battlefield.filter((c) => c.isToken);
        expect(tokens).toHaveLength(1);
        expect(tokens[0].subtypes).toContain("Insect");
    });

    it("wire format: the landfall token reaches the client with its colour and P/T", () => {
        const { state } = bestowedBoard();
        nantukoLandfallOnStack(state, "land1", "p1");
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });

        const projected = projectPublicState(state, 1, "p1");
        const slimToken = projected.players[0].battlefield.find(
            (c) => c.isToken
        )!;
        expect(slimToken.subtypes).toContain("Insect");
        expect(getEffectivePower(projected, slimToken)).toBe(1);
        expect(getEffectiveToughness(projected, slimToken)).toBe(1);
    });

    it("an OPPONENT's land entering does NOT trigger (CR 109.5 — a land YOU control)", () => {
        const { state } = bestowedBoard();
        const triggers = collectTriggers(state, [
            {
                type: "PERMANENT_ENTERED" as const,
                instanceId: "land1",
                controllerId: "p2",
                cardId: forest.id,
                types: ["Land"] as const,
            },
        ]);
        expect(triggers).toHaveLength(0);
    });
});
