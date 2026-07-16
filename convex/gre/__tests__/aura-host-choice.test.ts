// CR 303.4f — an Aura entering the battlefield by any means OTHER than
// resolving as an Aura spell (reanimation, exile-return, put-onto-battlefield)
// lets its controller choose a legal host "as it enters". CR 303.4g — with no
// legal host the Aura never enters and stays in its origin zone.
import { describe, expect, it } from "vitest";
import {
    putReanimatedSetOnBattlefield,
    finalizeAuraHost,
    resolveTopOfStack,
    type GameState,
} from "../state";
import { checkAuraAttachmentSBA } from "../sba";
import { applyPendingChoiceSubmit } from "../pendingChoiceSubmit";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import {
    unholyStrength,
    controlMagic,
    grizzlyBears,
    savannahLions,
    mountain,
    whiteKnight,
    warpArtifact,
    basaltMonolith,
} from "../../cards/sets/lea";
import { guardianBeast } from "../../cards/sets/arn";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";

// Issue #1119 — "enchant player" host support. No shipped card in the
// catalogue has `subtypes: ["Aura"]` + `targetRequirement: { type: "player" }`
// yet (the real-world analogue is Fallen Empires' Nettling Curse, not
// currently implemented), so this test-only definition exercises the engine
// capability directly rather than inventing a card-shaped fixture.
// `registerTokenDefinition` is the production seam that inserts a synthetic
// `CardDefinition` into the SAME registry `getDefinition`/`tryGetDefinition`
// read from (used in prod for token synthesis) — idempotent, and safe under
// this suite's `isolate: false` vitest config (module-mocking approaches like
// `vi.mock` are NOT: the registry module is a process-wide singleton shared
// across test files, and a per-file mock factory only wins the race if this
// file's module graph evaluates before any other file already imported the
// real registry).
const TEST_ENCHANT_PLAYER_AURA_ID = "test-only-enchant-player-aura";
const testEnchantPlayerAuraDef: CardDefinition = {
    id: TEST_ENCHANT_PLAYER_AURA_ID,
    rarity: "common",
    name: "Test Enchant-Player Aura",
    oracleText: "Enchant player",
    manaCost: { B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "player", count: 1 },
};
registerTokenDefinition(testEnchantPlayerAuraDef);

/** Board where `p1` has the named Aura in graveyard plus `creatures` creature
 *  instances on the battlefield (and an optional non-creature). Returns the
 *  state and the aura instance id so tests can drive reanimation. */
function boardWithGraveyardAura(opts: {
    auraId: string;
    creatures: { id: string; controllerId: string }[];
    extraNonCreature?: boolean;
}): { state: GameState; auraId: string; auraOwnerId: string } {
    const aura = makeInstance(opts.auraId, {
        id: "aura-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "graveyard",
    });
    const p1Battlefield = opts.creatures
        .filter((c) => c.controllerId === "p1")
        .map((c) =>
            makeInstance(grizzlyBears.id, {
                id: c.id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            })
        );
    if (opts.extraNonCreature) {
        p1Battlefield.push(
            makeInstance(mountain.id, {
                id: "land-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            })
        );
    }
    const p2Battlefield = opts.creatures
        .filter((c) => c.controllerId === "p2")
        .map((c) =>
            makeInstance(savannahLions.id, {
                id: c.id,
                controllerId: "p2",
                ownerId: "p2",
                zone: "battlefield",
            })
        );
    const p1 = makePlayer("p1", {
        graveyard: [aura],
        battlefield: p1Battlefield,
    });
    const p2 = makePlayer("p2", { battlefield: p2Battlefield });
    return {
        state: makeState({ players: [p1, p2] }),
        auraId: "aura-1",
        auraOwnerId: "p1",
    };
}

/** Splice the graveyard aura out and reanimate it, mirroring
 *  `returnGraveyardSetToBattlefield`. */
function reanimateAura(state: GameState, auraId: string): string[] {
    const gy = state.players[0].graveyard;
    const idx = gy.findIndex((c) => c.id === auraId);
    const [aura] = gy.splice(idx, 1);
    return putReanimatedSetOnBattlefield(state, [
        { card: aura, controllerId: "p1" },
    ]);
}

describe("non-cast Aura host choice (CR 303.4f)", () => {
    it("CR 303.4g — no legal host: the Aura stays in the graveyard", () => {
        // Unholy Strength enchants a creature; p1 has none on the battlefield.
        const { state, auraId } = boardWithGraveyardAura({
            auraId: unholyStrength.id,
            creatures: [],
            extraNonCreature: true, // a land is not a legal host
        });
        const entered = reanimateAura(state, auraId);

        expect(entered).toEqual([]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stagedAuraEntries ?? []).toHaveLength(0);
        // Back in p1's graveyard, unattached.
        const gyAura = state.players[0].graveyard.find((c) => c.id === auraId);
        expect(gyAura).toBeDefined();
        expect(gyAura!.attachedTo).toBeUndefined();
        expect(
            state.players.every((p) =>
                p.battlefield.every((c) => c.id !== auraId)
            )
        ).toBe(true);
    });

    it("exactly one legal host: auto-attaches with no prompt (ADR 0003)", () => {
        const { state, auraId } = boardWithGraveyardAura({
            auraId: unholyStrength.id,
            creatures: [{ id: "bear-1", controllerId: "p1" }],
        });
        const entered = reanimateAura(state, auraId);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(entered).toContain(auraId);
        const aura = state.players[0].battlefield.find((c) => c.id === auraId);
        expect(aura?.attachedTo).toBe("bear-1");
        // +2/+1 reaches the host (Grizzly Bears 2/2 → 4/3).
        const bear = state.players[0].battlefield.find(
            (c) => c.id === "bear-1"
        );
        expect(getEffectivePower(state, bear!)).toBe(4);
        expect(getEffectiveToughness(state, bear!)).toBe(3);
    });

    it("two legal hosts: enqueues a choose-aura-host choice with both candidates", () => {
        const { state, auraId } = boardWithGraveyardAura({
            auraId: unholyStrength.id,
            creatures: [
                { id: "bear-1", controllerId: "p1" },
                { id: "bear-2", controllerId: "p1" },
            ],
            extraNonCreature: true, // the land must NOT be offered
        });
        const entered = reanimateAura(state, auraId);

        // Deferred — not entered yet.
        expect(entered).toEqual([]);
        const choice = (state.pendingChoices ?? [])[0];
        expect(choice?.kind).toBe("choose-aura-host");
        expect(choice?.stackItemId).toBe("");
        expect(choice?.playerId).toBe("p1");
        expect(choice?.auraInstanceId).toBe(auraId);
        // The prompt names the Aura (resolved from the definition, not the slim
        // `{ id }`), and the subject card id drives the dialog image.
        expect(choice?.prompt).toBe("Choose what Unholy Strength enchants.");
        expect(choice?.subjectCardId).toBe(unholyStrength.id);
        // Only creatures are candidates — the land is filtered out (303.4f
        // enchant restriction).
        expect(new Set(choice?.candidateIds)).toEqual(
            new Set(["bear-1", "bear-2"])
        );
        // The Aura is held off every zone until answered.
        expect(state.stagedAuraEntries).toHaveLength(1);
        expect(
            state.players.every((p) =>
                [...p.battlefield, ...p.graveyard].every((c) => c.id !== auraId)
            )
        ).toBe(true);
    });

    it("finalizeAuraHost attaches the reanimated Aura to the chosen host", () => {
        const { state, auraId } = boardWithGraveyardAura({
            auraId: unholyStrength.id,
            creatures: [
                { id: "bear-1", controllerId: "p1" },
                { id: "bear-2", controllerId: "p1" },
            ],
        });
        reanimateAura(state, auraId);

        finalizeAuraHost(state, ["bear-2"]);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stagedAuraEntries ?? []).toHaveLength(0);
        const aura = state.players[0].battlefield.find((c) => c.id === auraId);
        expect(aura?.attachedTo).toBe("bear-2");
        const chosen = state.players[0].battlefield.find(
            (c) => c.id === "bear-2"
        );
        const other = state.players[0].battlefield.find(
            (c) => c.id === "bear-1"
        );
        expect(getEffectivePower(state, chosen!)).toBe(4); // buffed
        expect(getEffectivePower(state, other!)).toBe(2); // untouched
    });

    it("submit path (applyPendingChoiceSubmit) drives the same attachment", () => {
        const { state, auraId } = boardWithGraveyardAura({
            auraId: unholyStrength.id,
            creatures: [
                { id: "bear-1", controllerId: "p1" },
                { id: "bear-2", controllerId: "p1" },
            ],
        });
        reanimateAura(state, auraId);
        const choice = state.pendingChoices![0];

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: choice.stackItemId,
            step: choice.step,
            choiceId: choice.choiceId,
            cardInstanceIds: ["bear-1"],
        });

        expect(state.pendingChoices ?? []).toHaveLength(0);
        const aura = state.players[0].battlefield.find((c) => c.id === auraId);
        expect(aura?.attachedTo).toBe("bear-1");
    });

    it("rejects a submission outside the candidate allow-list", () => {
        const { state, auraId } = boardWithGraveyardAura({
            auraId: unholyStrength.id,
            creatures: [
                { id: "bear-1", controllerId: "p1" },
                { id: "bear-2", controllerId: "p1" },
            ],
            extraNonCreature: true,
        });
        reanimateAura(state, auraId);
        const choice = state.pendingChoices![0];

        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: choice.stackItemId,
                step: choice.step,
                choiceId: choice.choiceId,
                cardInstanceIds: ["land-1"], // not a legal host
            })
        ).toThrow();
    });

    it("Control Magic reanimated onto an opponent's creature (allControllers)", () => {
        // A legal host may sit on the opponent's battlefield — Control Magic
        // enchants any creature. Both creatures are candidates.
        const { state, auraId } = boardWithGraveyardAura({
            auraId: controlMagic.id,
            creatures: [
                { id: "mine", controllerId: "p1" },
                { id: "theirs", controllerId: "p2" },
            ],
        });
        const entered = reanimateAura(state, auraId);

        expect(entered).toEqual([]);
        const choice = state.pendingChoices![0];
        expect(choice.kind).toBe("choose-aura-host");
        expect(choice.allControllers).toBe(true);
        expect(new Set(choice.candidateIds)).toEqual(
            new Set(["mine", "theirs"])
        );

        finalizeAuraHost(state, ["theirs"]);
        // Control-change (CR 613.1b): the opponent's creature is now p1's.
        const stolen = state.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === "theirs");
        expect(stolen?.controllerId).toBe("p1");
    });

    it("wire format — candidateIds survive projectPublicState (CR 303.4f)", () => {
        const { state, auraId } = boardWithGraveyardAura({
            auraId: unholyStrength.id,
            creatures: [
                { id: "bear-1", controllerId: "p1" },
                { id: "bear-2", controllerId: "p1" },
            ],
        });
        reanimateAura(state, auraId);

        const projected = projectPublicState(state, 1, "p1");
        const choice = projected.pendingChoices?.[0];
        expect(choice?.kind).toBe("choose-aura-host");
        expect(new Set(choice?.candidateIds)).toEqual(
            new Set(["bear-1", "bear-2"])
        );
        // The subject card id survives the wire so the dialog can render the
        // Aura image client-side.
        expect(choice?.subjectCardId).toBe(unholyStrength.id);
    });
});

// Issue #1119 — bulk-reanimated Aura host check must honour the SAME
// protection (CR 702.16b) / cantBeEnchanted (CR 303.4) gate the cast path
// applies (`isFullyLegalAuraHost`, ADR-less shared predicate), not the
// narrower type-only match.
describe("bulk-reanimated Aura host legality — protection & cantBeEnchanted (CR 702.16b/303.4, issue #1119)", () => {
    it("CR 702.16b — a host protected from the Aura's color is never a candidate", () => {
        // Unholy Strength is black; White Knight has protection from black.
        // Grizzly Bears has no protection, so it's the only legal host.
        const aura = makeInstance(unholyStrength.id, {
            id: "aura-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const knight = makeInstance(whiteKnight.id, {
            id: "knight-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const p1 = makePlayer("p1", {
            graveyard: [aura],
            battlefield: [knight, bear],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const entered = putReanimatedSetOnBattlefield(state, [
            { card: aura, controllerId: "p1" },
        ]);

        // Exactly one legal host (the unprotected bear) — auto-attach, no
        // prompt. Proves the protected White Knight was excluded, not just
        // that a host existed at all.
        expect(entered).toContain("aura-1");
        const attached = state.players[0].battlefield.find(
            (c) => c.id === "aura-1"
        );
        expect(attached?.attachedTo).toBe("bear-1");
    });

    it("CR 702.16b — protected from EVERY candidate: the Aura stays in the graveyard", () => {
        const aura = makeInstance(unholyStrength.id, {
            id: "aura-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const knight = makeInstance(whiteKnight.id, {
            id: "knight-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const p1 = makePlayer("p1", {
            graveyard: [aura],
            battlefield: [knight],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const entered = putReanimatedSetOnBattlefield(state, [
            { card: aura, controllerId: "p1" },
        ]);

        expect(entered).toEqual([]);
        const gyAura = state.players[0].graveyard.find(
            (c) => c.id === "aura-1"
        );
        expect(gyAura).toBeDefined();
        expect(gyAura!.attachedTo).toBeUndefined();
    });

    it("CR 303.4 (Guardian Beast) — a cantBeEnchanted host is never a candidate", () => {
        // Guardian Beast (untapped): noncreature artifacts ITS CONTROLLER
        // controls can't be enchanted. Warp Artifact enchants any artifact.
        const aura = makeInstance(warpArtifact.id, {
            id: "aura-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const beast = makeInstance(guardianBeast.id, {
            id: "beast-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        });
        const monolith = makeInstance(basaltMonolith.id, {
            id: "monolith-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const p1 = makePlayer("p1", {
            graveyard: [aura],
            battlefield: [beast, monolith],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const entered = putReanimatedSetOnBattlefield(state, [
            { card: aura, controllerId: "p1" },
        ]);

        // Guardian Beast excludes the ONLY artifact on the board — no legal
        // host — the Aura stays in the graveyard (CR 303.4g).
        expect(entered).toEqual([]);
        const gyAura = state.players[0].graveyard.find(
            (c) => c.id === "aura-1"
        );
        expect(gyAura).toBeDefined();
        expect(gyAura!.attachedTo).toBeUndefined();
    });

    it("CR 303.4 (Guardian Beast) — a TAPPED Guardian Beast no longer guards: the artifact is a legal host", () => {
        const aura = makeInstance(warpArtifact.id, {
            id: "aura-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const beast = makeInstance(guardianBeast.id, {
            id: "beast-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: true, // the guard is "as long as untapped"
        });
        const monolith = makeInstance(basaltMonolith.id, {
            id: "monolith-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const p1 = makePlayer("p1", {
            graveyard: [aura],
            battlefield: [beast, monolith],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const entered = putReanimatedSetOnBattlefield(state, [
            { card: aura, controllerId: "p1" },
        ]);

        expect(entered).toContain("aura-1");
        const attached = state.players[0].battlefield.find(
            (c) => c.id === "aura-1"
        );
        expect(attached?.attachedTo).toBe("monolith-1");
    });
});

// Issue #1119 — `findAllLegalAuraHosts` scanned permanents only, so an
// "Enchant player" Aura reanimated with no fixed target never found a legal
// host and silently stayed in the graveyard even in a normal 2-player game
// (CR 303.4). This block proves the player-host branch, both through the
// non-cast (reanimation) entry path and — for symmetry — the ordinary CAST
// path, and that a player-attached Aura survives the CR 704.5m SBA sweep
// instead of being immediately detached (the SBA previously assumed
// `attachedTo` was always a battlefield permanent id).
describe("enchant-player Aura hosts (CR 303.4, issue #1119)", () => {
    it("bulk reanimation: both players are offered as candidates (2-player game)", () => {
        const aura = makeInstance(TEST_ENCHANT_PLAYER_AURA_ID, {
            id: "aura-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const p1 = makePlayer("p1", { graveyard: [aura] });
        const p2 = makePlayer("p2");
        const state = makeState({ players: [p1, p2] });

        const entered = putReanimatedSetOnBattlefield(state, [
            { card: aura, controllerId: "p1" },
        ]);

        // Deferred to a choice — not zero candidates, not an auto-attach.
        // Before the fix this would have been `[]` (0 candidates, straight
        // back to the graveyard) because the scan never considered players.
        expect(entered).toEqual([]);
        const choice = state.pendingChoices?.[0];
        expect(choice?.kind).toBe("choose-aura-host");
        expect(new Set(choice?.candidateIds)).toEqual(new Set(["p1", "p2"]));
    });

    it("finalizeAuraHost attaches the reanimated Aura to the chosen PLAYER and it survives the SBA sweep", () => {
        const aura = makeInstance(TEST_ENCHANT_PLAYER_AURA_ID, {
            id: "aura-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const p1 = makePlayer("p1", { graveyard: [aura] });
        const p2 = makePlayer("p2");
        const state = makeState({ players: [p1, p2] });
        putReanimatedSetOnBattlefield(state, [
            { card: aura, controllerId: "p1" },
        ]);

        finalizeAuraHost(state, ["p2"]);

        expect(state.pendingChoices ?? []).toHaveLength(0);
        const attached = state.players[0].battlefield.find(
            (c) => c.id === "aura-1"
        );
        expect(attached).toBeDefined();
        expect(attached!.attachedTo).toBe("p2");

        // CR 704.5m — the ongoing-legality SBA must NOT treat a player id as
        // "attached to nothing on the battlefield" and sweep it away.
        const acted = checkAuraAttachmentSBA(state);
        expect(acted).toBe(false);
        const stillAttached = state.players[0].battlefield.find(
            (c) => c.id === "aura-1"
        );
        expect(stillAttached).toBeDefined();
        expect(stillAttached!.attachedTo).toBe("p2");
    });

    it("cast path: an Aura targeting a player attaches to that player and survives the SBA sweep", () => {
        const p1 = makePlayer("p1");
        const p2 = makePlayer("p2");
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, TEST_ENCHANT_PLAYER_AURA_ID, "p1", [
            { type: "player", id: "p2" },
        ]);

        resolveTopOfStack(state);

        const attached = state.players[0].battlefield.find(
            (c) => (c.card as { id?: string }).id === TEST_ENCHANT_PLAYER_AURA_ID
        );
        expect(attached).toBeDefined();
        expect(attached!.attachedTo).toBe("p2");
        expect(checkAuraAttachmentSBA(state)).toBe(false);
    });
});
