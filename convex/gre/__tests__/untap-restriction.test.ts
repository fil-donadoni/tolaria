// GRE-level scenario tests for the `untapRestriction` dispatcher
// (CR 502.1, ADR 0005).
//
// Covers the data-driven `untapStep` rewrite end-to-end at the engine
// layer:
//   - zero-eligibles auto-resolve (no prompt enqueued)
//   - single-eligible cap-style prompt (ADR 0003 tactical zero-branch)
//   - multi-eligible cap-style prompt
//   - submit-untap commit path (untap chosen + clear pending + leave UNTAP)
//   - submit-skip commit path (no untap + clear pending + leave UNTAP)
//   - wire-format projection survives (PendingChoice projected with the
//     range count + filter shape so the client renders correctly)
//   - per-permanent `does-not-untap` axis still wins
//
// Uses Winter Orb (LEA) as the in-play restriction because S0 ships only
// Winter Orb migrated. Future slices (S1–S3) add Smoke / Stasis / Meekstone
// coverage in this same file.

import { describe, expect, it } from "vitest";
import type { CardInstanceState, GameState, PlayerState } from "../state";
import {
    advancePhase,
    untapStep,
    computeHardSkipFilters,
    effectivePermanentView,
} from "../phases";
import {
    winterOrb,
    plains,
    grizzlyBears,
    stasis,
    meekstone,
    smoke,
    sengirVampire,
} from "../../cards/sets/lea";
import { matchesPermanentFilter } from "../state";
import { projectPublicState } from "../../gameProjections";
import { tryGetCardById } from "../../cards";
import type { CardType } from "../../cards/types";

function makeInstance(
    cardId: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    const def = tryGetCardById(cardId);
    return {
        id: overrides.id ?? `inst-${Math.random().toString(36).slice(2, 8)}`,
        card: { id: cardId },
        types: (def?.types as CardType[]) ?? [],
        subtypes: def?.subtypes ?? [],
        power: def?.power,
        toughness: def?.toughness,
        staticAbilities: def?.staticAbilities ?? [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

function makePlayer(
    id: string,
    overrides: Partial<PlayerState> = {}
): PlayerState {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        deck: {},
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
    return {
        players: [makePlayer("p1"), makePlayer("p2")],
        stack: [],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "UNTAP",
        rngSeed: 0,
        rngCounter: 0,
        ...overrides,
    };
}

describe("untapRestriction dispatcher (CR 502.1, ADR 0005)", () => {
    describe("Winter Orb — land-only cap (ADR 0004 modern Oracle)", () => {
        it("zero eligibles (no tapped lands) → no prompt; flag cleanup still runs", () => {
            const orb = makeInstance(winterOrb.id, { id: "orb" });
            const land = makeInstance(plains.id, {
                id: "l1",
                isTapped: false,
                manaCommitted: true,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [orb, land] }),
                    makePlayer("p2"),
                ],
            });
            untapStep(state);
            expect(state.pendingChoices ?? []).toEqual([]);
            expect(state.pendingUntapStep).toBeUndefined();
            // Per-permanent flag cleanup still runs across the active BF.
            expect(
                state.players[0].battlefield[1].manaCommitted
            ).toBeUndefined();
        });

        it("single tapped land → prompt with { min: 0, max: 1 }, land filter (ADR 0003 cap-style zero-branch)", () => {
            const orb = makeInstance(winterOrb.id, { id: "orb" });
            const land = makeInstance(plains.id, {
                id: "l1",
                isTapped: true,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [orb, land] }),
                    makePlayer("p2"),
                ],
            });
            untapStep(state);
            expect(state.pendingChoices).toHaveLength(1);
            const head = state.pendingChoices![0];
            expect(head.kind).toBe("untap-pick");
            expect(head.count).toEqual({ min: 0, max: 1 });
            expect(head.filter).toEqual({ types: "Land" });
            expect(head.playerId).toBe("p1");
            expect(head.zoneOwnerId).toBe("p1");
            expect(state.priorityPlayerId).toBe("p1");
            // Land is still tapped — the pick has not committed.
            expect(
                state.players[0].battlefield.find((c) => c.id === "l1")
                    ?.isTapped
            ).toBe(true);
        });

        it("two tapped lands → prompt; resume after picking one land untaps the chosen id and leaves UNTAP", () => {
            const orb = makeInstance(winterOrb.id, { id: "orb" });
            const land1 = makeInstance(plains.id, {
                id: "l1",
                isTapped: true,
            });
            const land2 = makeInstance(plains.id, {
                id: "l2",
                isTapped: true,
            });
            const state = makeState({
                phase: "END_STEP",
                players: [
                    makePlayer("p1", { battlefield: [orb, land1, land2] }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p2",
            });
            advancePhase(state);
            // Drove END_STEP → CLEANUP → turn flip → UNTAP for p1 → prompt.
            expect(state.phase).toBe("UNTAP");
            expect(state.activePlayerId).toBe("p1");
            expect(state.pendingChoices?.[0].kind).toBe("untap-pick");

            // Simulate the submission path: append a pick, then dispatch the
            // commit logic by re-running the same routine the mutation uses.
            state.pendingChoices![0].selected.push("l1");
            // Commit: untap chosen ids, dequeue, re-enter untapStep, leave
            // UNTAP if no further prompts pending.
            const chosen = state.pendingChoices![0].selected;
            const chooserId =
                state.pendingChoices![0].zoneOwnerId ??
                state.pendingChoices![0].playerId;
            const chooser = state.players.find((p) => p.id === chooserId)!;
            for (const id of chosen) {
                const c = chooser.battlefield.find((x) => x.id === id);
                if (c) c.isTapped = false;
            }
            state.pendingChoices = undefined;
            untapStep(state);
            advancePhase(state);

            expect(state.phase).toBe("UPKEEP");
            const bf = state.players[0].battlefield;
            expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(false);
            // The non-picked land stays tapped — the cap binds it this turn.
            expect(bf.find((c) => c.id === "l2")?.isTapped).toBe(true);
        });

        it("two tapped lands → prompt; resume with empty selection (Skip) untaps nothing and leaves UNTAP", () => {
            const orb = makeInstance(winterOrb.id, { id: "orb" });
            const land1 = makeInstance(plains.id, {
                id: "l1",
                isTapped: true,
            });
            const land2 = makeInstance(plains.id, {
                id: "l2",
                isTapped: true,
            });
            const state = makeState({
                phase: "END_STEP",
                players: [
                    makePlayer("p1", { battlefield: [orb, land1, land2] }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p2",
            });
            advancePhase(state);
            expect(state.pendingChoices?.[0].kind).toBe("untap-pick");

            // Skip commit: empty selection.
            state.pendingChoices = undefined;
            untapStep(state);
            advancePhase(state);

            expect(state.phase).toBe("UPKEEP");
            const bf = state.players[0].battlefield;
            expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(true);
            expect(bf.find((c) => c.id === "l2")?.isTapped).toBe(true);
        });

        it("Winter Orb does NOT cap non-land permanents — tapped Grizzly Bears untap normally", () => {
            const orb = makeInstance(winterOrb.id, { id: "orb" });
            const land = makeInstance(plains.id, {
                id: "l1",
                isTapped: true,
            });
            const bear = makeInstance(grizzlyBears.id, {
                id: "bear",
                isTapped: true,
                isSummoningSick: false,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [orb, land, bear] }),
                    makePlayer("p2"),
                ],
            });
            untapStep(state);
            const bf = state.players[0].battlefield;
            // Bear is unrestricted (not a land) → untaps immediately, even
            // while the land prompt is still pending.
            expect(bf.find((c) => c.id === "bear")?.isTapped).toBe(false);
            // Orb is an artifact (not a land) → also untaps immediately.
            expect(bf.find((c) => c.id === "orb")?.isTapped).toBe(false);
            // Land is restricted — stays tapped until the pick commits.
            expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(true);
        });

        it("per-permanent `does-not-untap` excludes the marked permanent from eligibility and from auto-untap", () => {
            const orb = makeInstance(winterOrb.id, { id: "orb" });
            const land = makeInstance(plains.id, {
                id: "l1",
                isTapped: true,
                staticAbilities: ["does-not-untap"],
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [orb, land] }),
                    makePlayer("p2"),
                ],
            });
            untapStep(state);
            // The lone tapped land has does-not-untap → excluded from
            // eligibles → no prompt + land stays tapped.
            expect(state.pendingChoices ?? []).toEqual([]);
            expect(
                state.players[0].battlefield.find((c) => c.id === "l1")
                    ?.isTapped
            ).toBe(true);
        });

        it("wire format: PendingChoice with range count + land filter survives projectPublicState", () => {
            const orb = makeInstance(winterOrb.id, { id: "orb" });
            const land1 = makeInstance(plains.id, {
                id: "l1",
                isTapped: true,
            });
            const land2 = makeInstance(plains.id, {
                id: "l2",
                isTapped: true,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [orb, land1, land2] }),
                    makePlayer("p2"),
                ],
            });
            untapStep(state);

            const projected = projectPublicState(state, 1, "p1");
            expect(projected.pendingChoices?.[0].kind).toBe("untap-pick");
            expect(projected.pendingChoices?.[0].count).toEqual({
                min: 0,
                max: 1,
            });
            expect(projected.pendingChoices?.[0].filter).toEqual({
                types: "Land",
            });
            // Active player's lands are still tapped in the slim view.
            const slim = projected.players[0].battlefield;
            expect(slim.find((c) => c.id === "l1")?.isTapped).toBe(true);
            expect(slim.find((c) => c.id === "l2")?.isTapped).toBe(true);
        });
    });

    describe("Stasis — hard skip (maxUntap: 0, filter matches every permanent)", () => {
        it("no PendingChoice + all matching active-BF permanents stay tapped + cleanup runs", () => {
            const enchant = makeInstance(stasis.id, { id: "stasis" });
            const land = makeInstance(plains.id, {
                id: "l1",
                isTapped: true,
                manaCommitted: true,
                chosenMana: { W: 1 },
            });
            const bear = makeInstance(grizzlyBears.id, {
                id: "bear",
                isTapped: true,
                isSummoningSick: true,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [enchant, land, bear],
                    }),
                    makePlayer("p2"),
                ],
            });
            untapStep(state);

            expect(state.pendingChoices ?? []).toEqual([]);
            expect(state.pendingUntapStep).toBeUndefined();
            const bf = state.players[0].battlefield;
            expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(true);
            expect(bf.find((c) => c.id === "bear")?.isTapped).toBe(true);
            // Full cleanup ran — parallels the prior `skip-untap-step`
            // keyword semantics for downstream priority windows.
            expect(
                bf.find((c) => c.id === "l1")?.manaCommitted
            ).toBeUndefined();
            expect(bf.find((c) => c.id === "l1")?.chosenMana).toBeUndefined();
            expect(
                bf.find((c) => c.id === "bear")?.isSummoningSick
            ).toBeUndefined();
        });

        it("Stasis overrides Winter Orb on the same board — lands stay tapped, no land-pick prompt", () => {
            // Per the dispatcher: a `maxUntap: 0` restriction's matched
            // permanents are removed from every other cap's eligibility
            // set, so Winter Orb's land prompt cannot surface under Stasis.
            const enchant = makeInstance(stasis.id, { id: "stasis" });
            const orb = makeInstance(winterOrb.id, { id: "orb" });
            const land1 = makeInstance(plains.id, {
                id: "l1",
                isTapped: true,
            });
            const land2 = makeInstance(plains.id, {
                id: "l2",
                isTapped: true,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [enchant, orb, land1, land2],
                    }),
                    makePlayer("p2"),
                ],
            });
            untapStep(state);

            expect(state.pendingChoices ?? []).toEqual([]);
            const bf = state.players[0].battlefield;
            expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(true);
            expect(bf.find((c) => c.id === "l2")?.isTapped).toBe(true);
        });

        it("Stasis on the opponent's side still skips the active player's untap step", () => {
            const enchant = makeInstance(stasis.id, {
                id: "stasis",
                controllerId: "p2",
                ownerId: "p2",
            });
            const land = makeInstance(plains.id, {
                id: "l1",
                isTapped: true,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [land] }),
                    makePlayer("p2", { battlefield: [enchant] }),
                ],
            });
            untapStep(state);

            expect(state.pendingChoices ?? []).toEqual([]);
            expect(
                state.players[0].battlefield.find((c) => c.id === "l1")
                    ?.isTapped
            ).toBe(true);
        });
    });

    describe("hard-skip ∩ cap intersection (CR 502.1)", () => {
        it("Creature ∩ Creature+power≥3: cap's eligibles exclude high-power creatures", () => {
            // Meekstone (maxUntap:0, Creature power≥3) + Smoke (maxUntap:1, Creature)
            const stone = makeInstance(meekstone.id, { id: "stone" });
            const smk = makeInstance(smoke.id, { id: "smoke" });
            const bear = makeInstance(grizzlyBears.id, {
                id: "bear",
                isTapped: true,
                isSummoningSick: false,
            });
            const vamp = makeInstance(sengirVampire.id, {
                id: "vamp",
                isTapped: true,
                isSummoningSick: false,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [stone, smk, bear, vamp],
                    }),
                    makePlayer("p2"),
                ],
            });
            untapStep(state);

            // Smoke prompt present with creature filter; only bear eligible
            // (vampire vetoed by Meekstone's hard-skip filter).
            expect(state.pendingChoices).toHaveLength(1);
            expect(state.pendingChoices![0].kind).toBe("untap-pick");
            expect(state.pendingChoices![0].filter).toEqual(
                expect.objectContaining({ types: "Creature" })
            );
            expect(
                state.pendingChoices![0].filter!.excludeInstanceIds
            ).toContain("vamp");
            expect(
                state.players[0].battlefield.find((c) => c.id === "vamp")
                    ?.isTapped
            ).toBe(true);
        });

        it("any ∩ Creature: Stasis vetoes all Smoke eligibles → no prompt", () => {
            // Stasis (maxUntap:0, any filter) + Smoke (maxUntap:1, Creature)
            const enchant = makeInstance(stasis.id, { id: "stasis" });
            const smk = makeInstance(smoke.id, { id: "smoke" });
            const bear = makeInstance(grizzlyBears.id, {
                id: "bear",
                isTapped: true,
                isSummoningSick: false,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [enchant, smk, bear],
                    }),
                    makePlayer("p2"),
                ],
            });
            untapStep(state);

            // Stasis vetoes everything → Smoke's eligible set is empty → no prompt.
            expect(state.pendingChoices ?? []).toEqual([]);
            expect(
                state.players[0].battlefield.find((c) => c.id === "bear")
                    ?.isTapped
            ).toBe(true);
        });

        it("non-overlapping filters: Meekstone (Creature power≥3) does not affect Winter Orb (Land)", () => {
            const stone = makeInstance(meekstone.id, { id: "stone" });
            const orb = makeInstance(winterOrb.id, { id: "orb" });
            const land1 = makeInstance(plains.id, {
                id: "l1",
                isTapped: true,
            });
            const land2 = makeInstance(plains.id, {
                id: "l2",
                isTapped: true,
            });
            const vamp = makeInstance(sengirVampire.id, {
                id: "vamp",
                isTapped: true,
                isSummoningSick: false,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [stone, orb, land1, land2, vamp],
                    }),
                    makePlayer("p2"),
                ],
            });
            untapStep(state);

            // Winter Orb's land prompt is unaffected by Meekstone (lands don't match Creature filter).
            expect(state.pendingChoices).toHaveLength(1);
            expect(state.pendingChoices![0].filter).toEqual(
                expect.objectContaining({ types: "Land" })
            );
            // Vampire stays tapped (Meekstone hard skip).
            expect(
                state.players[0].battlefield.find((c) => c.id === "vamp")
                    ?.isTapped
            ).toBe(true);
        });

        it("cap with zero post-intersection eligibles → auto-resolve, no prompt (ADR 0003)", () => {
            const stone = makeInstance(meekstone.id, { id: "stone" });
            const smk = makeInstance(smoke.id, { id: "smoke" });
            const vamp1 = makeInstance(sengirVampire.id, {
                id: "vamp1",
                isTapped: true,
                isSummoningSick: false,
            });
            const vamp2 = makeInstance(sengirVampire.id, {
                id: "vamp2",
                isTapped: true,
                isSummoningSick: false,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [stone, smk, vamp1, vamp2],
                    }),
                    makePlayer("p2"),
                ],
            });
            untapStep(state);

            // All creatures have power ≥ 3 → vetoed by Meekstone → Smoke auto-resolves.
            expect(state.pendingChoices ?? []).toEqual([]);
        });
    });

    describe("commit-time veto via computeHardSkipFilters (CR 502.1)", () => {
        it("rejects a power-4 creature matching Meekstone's hard-skip filter", () => {
            const stone = makeInstance(meekstone.id, { id: "stone" });
            const vamp = makeInstance(sengirVampire.id, {
                id: "vamp",
                isTapped: true,
                isSummoningSick: false,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [stone, vamp] }),
                    makePlayer("p2"),
                ],
            });

            const vetoFilters = computeHardSkipFilters(state);
            const view = effectivePermanentView(state, vamp);
            expect(
                vetoFilters.some((f) => matchesPermanentFilter(view, f))
            ).toBe(true);
        });

        it("accepts a power-2 creature not matching any hard-skip filter", () => {
            const stone = makeInstance(meekstone.id, { id: "stone" });
            const bear = makeInstance(grizzlyBears.id, {
                id: "bear",
                isTapped: true,
                isSummoningSick: false,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [stone, bear] }),
                    makePlayer("p2"),
                ],
            });

            const vetoFilters = computeHardSkipFilters(state);
            const view = effectivePermanentView(state, bear);
            expect(
                vetoFilters.some((f) => matchesPermanentFilter(view, f))
            ).toBe(false);
        });

        it("non-creature permanents (lands) are never vetoed by Meekstone's creature-power filter", () => {
            const stone = makeInstance(meekstone.id, { id: "stone" });
            const land = makeInstance(plains.id, {
                id: "l1",
                isTapped: true,
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [stone, land] }),
                    makePlayer("p2"),
                ],
            });

            const vetoFilters = computeHardSkipFilters(state);
            const view = effectivePermanentView(state, land);
            expect(
                vetoFilters.some((f) => matchesPermanentFilter(view, f))
            ).toBe(false);
        });
    });
});
