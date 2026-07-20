// Haste vs. summoning sickness during DECLARE_ATTACKERS (issue #937, CR
// 702.10b): a summoning-sick creature IS a legal attacker if it has haste.
// `useBattlefieldVisualState` mirrors the server gate
// (`combat.ts` `validateAttackerEligibility`) so the UI does not gray out a
// creature the engine would happily let attack.
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { useBattlefieldVisualState } from "../useBattlefieldVisualState";

// Mutable buffer holder (hoisted above the mock factory) so a test can seed the
// client-side pick buffer that drives `isChoiceSelected` (the emerald selected
// ring for a `choose-permanents` pick — Frantic Search's untap step).
const bufferHolder = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: bufferHolder.ids,
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
        dismissError: vi.fn(),
    }),
}));

const PLAIN_DEF = { id: "plain-def", name: "Grizzly Bears", staticEffects: [] };

// Synthetic Chrome-Mox-shaped mana ability (CR 602.5b, issue #947): a
// `canActivate` predicate gated on an imprint counter, mirroring
// `convex/cards/sets/mrd/colorless.ts` without importing the real card —
// this proves the fix is a general `canActivate` mechanism, not a
// Chrome-Mox-specific special case.
const MOX_DEF = {
    id: "mox-def",
    name: "Test Gated Mox",
    staticEffects: [],
    activatedAbilities: [
        {
            id: "test-mox-mana",
            oracleText: "{T}: Add one mana of the imprinted colour.",
            cost: { tap: true },
            useStack: false,
            canActivate: (source: { counters?: Record<string, number> }) =>
                (source.counters?.["imprint-G"] ?? 0) > 0,
            manaChoices: [{ G: 1 }],
            getManaChoices: (source: { counters?: Record<string, number> }) =>
                (source.counters?.["imprint-G"] ?? 0) > 0 ? [{ G: 1 }] : [],
        },
    ],
};

// CR 702.126 — a spell declaring Improvise, for the artifact-tap-affordance
// tests below. Distinct id from PLAIN_DEF so `hasImprovise` only reads true
// for a card actually pointed at this definition.
const IMPROVISE_SPELL_DEF = {
    id: "improvise-spell-def",
    name: "Test Improvise Spell",
    staticAbilities: ["improvise"],
    staticEffects: [],
};

vi.mock("@convex/cards", () => ({
    getDefinition: (id: string) =>
        id === "mox-def"
            ? MOX_DEF
            : id === "improvise-spell-def"
              ? IMPROVISE_SPELL_DEF
              : PLAIN_DEF,
    tryGetDefinition: (id: string) =>
        id === "mox-def"
            ? MOX_DEF
            : id === "improvise-spell-def"
              ? IMPROVISE_SPELL_DEF
              : PLAIN_DEF,
}));

function creature(overrides: Partial<CardInstance> = {}): CardInstance {
    return {
        id: "c1",
        card: { id: "plain-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: true,
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        ...overrides,
    } as CardInstance;
}

/** A canActivate-gated mana source (CR 602.5b, issue #947) — an artifact
 *  with the synthetic `MOX_DEF`'s ability. `counters` un-set (or without the
 *  imprint key) means `canActivate` is false, i.e. un-imprinted. */
function moxCard(overrides: Partial<CardInstance> = {}): CardInstance {
    return {
        id: "mox1",
        card: { id: "mox-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: ["Artifact"],
        subtypes: [],
        staticAbilities: [],
        ...overrides,
    } as CardInstance;
}

function makePlayer(id: string, battlefield: CardInstance[]): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    } as Player;
}

type Ctx = React.ContextType<typeof GameContext>;

function makeContext(me: Player, overrides: Partial<NonNullable<Ctx>> = {}) {
    return {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "DECLARE_ATTACKERS",
        turn: 1,
        stackCount: 0,
        allPlayers: [me],
        showAllCards: false,
        debugAllActions: false,
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
        ...overrides,
    } as NonNullable<Ctx>;
}

function renderVisualState(me: Player, ctx: Partial<NonNullable<Ctx>> = {}) {
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={makeContext(me, ctx)}>{children}</GameContext>
    );
    return renderHook(() => useBattlefieldVisualState(me), { wrapper });
}

describe("useBattlefieldVisualState — haste bypasses summoning sickness during attacker declaration (#937, CR 702.10b)", () => {
    it("a summoning-sick creature WITH haste is selectable and not dimmed", () => {
        const hasty = creature({ id: "hasty1", staticAbilities: ["haste"] });
        const me = makePlayer("me", [hasty]);
        const { result } = renderVisualState(me);

        expect(result.current.canInteract(hasty)).toBe(true);
        expect(result.current.getVisualState(hasty).dimmed).toBe(false);
        expect(result.current.getVisualState(hasty).enabled).toBe(true);
    });

    it("a summoning-sick creature WITHOUT haste remains blocked and dimmed", () => {
        const sick = creature({ id: "sick1" });
        const me = makePlayer("me", [sick]);
        const { result } = renderVisualState(me);

        expect(result.current.canInteract(sick)).toBe(false);
        expect(result.current.getVisualState(sick).dimmed).toBe(true);
        expect(result.current.getVisualState(sick).enabled).toBe(false);
    });

    it("a tapped creature with haste remains ineligible (haste exempts sickness, not tapped-ness)", () => {
        const tappedHasty = creature({
            id: "tapped-hasty",
            isTapped: true,
            staticAbilities: ["haste"],
        });
        const me = makePlayer("me", [tappedHasty]);
        const { result } = renderVisualState(me);

        expect(result.current.canInteract(tappedHasty)).toBe(false);
        expect(result.current.getVisualState(tappedHasty).dimmed).toBe(true);
    });

    it("a creature with defender remains ineligible regardless of haste", () => {
        const defenderHasty = creature({
            id: "defender-hasty",
            isSummoningSick: false,
            staticAbilities: ["haste", "defender"],
        });
        const me = makePlayer("me", [defenderHasty]);
        const { result } = renderVisualState(me);

        expect(result.current.canInteract(defenderHasty)).toBe(false);
        expect(result.current.getVisualState(defenderHasty).dimmed).toBe(true);
    });

    it("a non-summoning-sick, non-hasty creature is selectable as usual", () => {
        const veteran = creature({ id: "vet1", isSummoningSick: false });
        const me = makePlayer("me", [veteran]);
        const { result } = renderVisualState(me);

        expect(result.current.canInteract(veteran)).toBe(true);
        expect(result.current.getVisualState(veteran).dimmed).toBe(false);
    });
});

describe("useBattlefieldVisualState — mana ability canActivate gate (CR 602.5b, issue #947)", () => {
    it("an un-imprinted (ungated) mana source is NOT clickable and NOT highlighted as a mana source", () => {
        const mox = moxCard();
        const me = makePlayer("me", [mox]);
        const { result } = renderVisualState(me, {
            phase: "PRECOMBAT_MAIN",
        });

        expect(result.current.canInteract(mox)).toBe(false);
        expect(result.current.getVisualState(mox).enabled).toBe(false);
    });

    it("an imprinted (gate-satisfied) mana source IS clickable", () => {
        const mox = moxCard({ counters: { "imprint-G": 1 } });
        const me = makePlayer("me", [mox]);
        const { result } = renderVisualState(me, {
            phase: "PRECOMBAT_MAIN",
        });

        expect(result.current.canInteract(mox)).toBe(true);
    });
});

// Multi-element cost picks (Fireblast's two Mountains, Thwart's three
// Islands, CR 701.21a) must show a distinct SELECTED ring on already-committed
// picks — `matchesSacrificePick` excludes picked ids, so without the
// `isCostPicked` branch a chosen permanent would lose its ring entirely and
// the player couldn't tell what they already selected.
describe("useBattlefieldVisualState — multi-pick sacrifice cost selected ring (CR 701.21a)", () => {
    function mountain(id: string): CardInstance {
        return {
            id,
            card: { id: "mountain-def" },
            controllerId: "me",
            ownerId: "me",
            zone: "battlefield",
            isTapped: false,
            isSummoningSick: false,
            types: ["Land"],
            subtypes: ["Mountain"],
            staticAbilities: [],
        } as CardInstance;
    }

    // Sacrifice two Mountains; m1 already picked, m2 still eligible.
    function ctxWithSacrifice() {
        return {
            phase: "PRECOMBAT_MAIN",
            combat: undefined,
            pendingCast: {
                playerId: "me",
                sacrificeSelection: {
                    playerId: "me",
                    reason: "Fireblast",
                    requirements: [
                        { filter: { subtypes: ["Mountain"] }, count: 2 },
                    ],
                    picked: ["m1"],
                },
            },
        } as unknown as Partial<NonNullable<Ctx>>;
    }

    it("already-picked permanent shows the green (emerald) selected ring", () => {
        const m1 = mountain("m1");
        const m2 = mountain("m2");
        const me = makePlayer("me", [m1, m2]);
        const { result } = renderVisualState(me, ctxWithSacrifice());

        expect(result.current.getVisualState(m1).ringClass).toBe(
            "ring-2 ring-signal-self rounded-sm"
        );
    });

    it("still-eligible permanent shows the dim candidate ring", () => {
        const m1 = mountain("m1");
        const m2 = mountain("m2");
        const me = makePlayer("me", [m1, m2]);
        const { result } = renderVisualState(me, ctxWithSacrifice());

        expect(result.current.getVisualState(m2).ringClass).toBe(
            "ring-2 ring-accent/40 rounded-sm"
        );
    });
});

// Multi-TARGET selection (Pyrokinesis's divided damage, Force of Vigor's
// up-to-two destroy) must mark an already-picked target with the GREEN
// emerald ring the card piles use — distinct from the faded-gold "valid but
// unpicked" ring — so the player can tell which targets they've committed.
describe("useBattlefieldVisualState — multi-target selected ring is green", () => {
    // Pick creatures as targets; c1 already selected, c2 still a valid pick.
    function ctxSelectingCreatures() {
        return {
            phase: "PRECOMBAT_MAIN",
            combat: undefined,
            pendingTarget: {
                playerId: "me",
                targetType: "Creature",
                selected: [{ type: "permanent", id: "c1" }],
            },
        } as unknown as Partial<NonNullable<Ctx>>;
    }

    it("an already-picked target shows the green (emerald) selected ring", () => {
        const c1 = creature({ id: "c1", isSummoningSick: false });
        const c2 = creature({ id: "c2", isSummoningSick: false });
        const me = makePlayer("me", [c1, c2]);
        const { result } = renderVisualState(me, ctxSelectingCreatures());

        expect(result.current.getVisualState(c1).ringClass).toBe(
            "ring-2 ring-signal-self rounded-sm"
        );
    });

    it("a still-valid unpicked target gets the accent-strong glow (matching a targetable player nameplate), not a ringClass", () => {
        const c1 = creature({ id: "c1", isSummoningSick: false });
        const c2 = creature({ id: "c2", isSummoningSick: false });
        const me = makePlayer("me", [c1, c2]);
        const { result } = renderVisualState(me, ctxSelectingCreatures());

        const vs = result.current.getVisualState(c2);
        // A legal-but-unpicked target reads with the same accent-strong glow a
        // targetable player nameplate gets — rendered as a box-shadow overlay
        // (targetGlow), not a Tailwind ring class.
        expect(vs.targetGlow).toBe(true);
        expect(vs.ringClass).toBe("");
    });
});

// Frantic Search's untap step is a battlefield `choose-permanents` pick over
// lands (filter Land). Each candidate land must carry a selection ring — the
// faded-bronze "pickable" ring before it's clicked, and the GREEN emerald ring
// once committed to the buffer. Before the fix the selected ring was solid
// bronze (`ring-accent`), indistinguishable from the faded-bronze pickable
// ring, so a clicked land didn't read as selected (issue: "le terre da stappare
// devono avere i ring di selezione").
describe("useBattlefieldVisualState — choose-permanents (untap) selection ring", () => {
    function land(id: string): CardInstance {
        return {
            id,
            card: { id: "island-def" },
            controllerId: "me",
            ownerId: "me",
            zone: "battlefield",
            isTapped: true,
            isSummoningSick: false,
            types: ["Land"],
            subtypes: ["Island"],
            staticAbilities: [],
        } as CardInstance;
    }

    // Frantic Search's untap pick: choose up to N lands on your own battlefield.
    function ctxUntapLands() {
        return {
            phase: "PRECOMBAT_MAIN",
            combat: undefined,
            pendingChoices: [
                {
                    stackItemId: "s1",
                    step: 2,
                    choiceId: "frantic-untap",
                    playerId: "me",
                    kind: "choose-permanents",
                    zone: "battlefield",
                    count: { min: 0, max: 3 },
                    prompt: "Untap up to three lands (Frantic Search).",
                    filter: { types: "Land" },
                    candidateIds: ["L0", "L1"],
                },
            ],
        } as unknown as Partial<NonNullable<Ctx>>;
    }

    it("an unpicked candidate land shows the faded-bronze pickable ring", () => {
        bufferHolder.ids = [];
        const me = makePlayer("me", [land("L0"), land("L1")]);
        const { result } = renderVisualState(me, ctxUntapLands());

        expect(result.current.getVisualState(me.battlefield[0]).ringClass).toBe(
            "ring-2 ring-accent/40 rounded-sm"
        );
    });

    it("a committed land shows the green (emerald) selected ring", () => {
        bufferHolder.ids = ["L0"];
        const me = makePlayer("me", [land("L0"), land("L1")]);
        const { result } = renderVisualState(me, ctxUntapLands());

        // Selected → emerald; the other candidate stays faded-bronze.
        expect(result.current.getVisualState(me.battlefield[0]).ringClass).toBe(
            "ring-2 ring-signal-self rounded-sm"
        );
        expect(result.current.getVisualState(me.battlefield[1]).ringClass).toBe(
            "ring-2 ring-accent/40 rounded-sm"
        );
        bufferHolder.ids = [];
    });
});

// CR 702.126 — Improvise (issue #1313). An untapped ARTIFACT with no mana
// ability of its own is a legal alternate payment source for the generic
// portion of a cast declaring the keyword, even though `hasManaAbility`
// rejects it outright — that rejection is exactly what admits it into the
// Improvise branch (`useBattlefieldVisualState.ts`).
describe("useBattlefieldVisualState — Improvise artifact-tap affordance (CR 702.126, issue #1313)", () => {
    function artifact(overrides: Partial<CardInstance> = {}): CardInstance {
        return {
            id: "art1",
            card: { id: "plain-def" }, // no mana ability (PLAIN_DEF)
            controllerId: "me",
            ownerId: "me",
            zone: "battlefield",
            isTapped: false,
            types: ["Artifact"],
            subtypes: [],
            staticAbilities: [],
            ...overrides,
        } as CardInstance;
    }

    function improviseSpellInHand(): CardInstance {
        return {
            id: "spell-1",
            card: { id: "improvise-spell-def" },
            controllerId: "me",
            ownerId: "me",
            zone: "hand",
            isTapped: false,
            types: ["Instant"],
            subtypes: [],
        } as CardInstance;
    }

    function nonImproviseSpellInHand(): CardInstance {
        return {
            id: "spell-1",
            card: { id: "plain-def" },
            controllerId: "me",
            ownerId: "me",
            zone: "hand",
            isTapped: false,
            types: ["Instant"],
            subtypes: [],
        } as CardInstance;
    }

    function payingCtx(
        battlefield: CardInstance[],
        pendingCastOverrides: Record<string, unknown> = {}
    ) {
        const spell = improviseSpellInHand();
        const me: Player = {
            ...makePlayer("me", battlefield),
            hand: [spell],
        };
        const ctx = {
            phase: "PRECOMBAT_MAIN",
            combat: undefined,
            pendingCast: {
                playerId: "me",
                cardInstanceId: "spell-1",
                manaCost: { U: 1, X: 2 },
                tappedLandIds: [],
                improviseTappedArtifactIds: [],
                ...pendingCastOverrides,
            },
        } as unknown as Partial<NonNullable<Ctx>>;
        return { me, ctx };
    }

    it("an untapped artifact with generic cost remaining is clickable and interactive", () => {
        const art = artifact();
        const { me, ctx } = payingCtx([art]);
        const { result } = renderVisualState(me, ctx);

        expect(result.current.canInteract(art)).toBe(true);
        expect(result.current.getVisualState(art).interactive).toBe(true);
        expect(result.current.getVisualState(art).enabled).toBe(true);
    });

    it("an untapped artifact is NOT clickable once no generic cost remains", () => {
        const art = artifact();
        const { me, ctx } = payingCtx([art], { manaCost: { U: 1 } });
        const { result } = renderVisualState(me, ctx);

        expect(result.current.canInteract(art)).toBe(false);
    });

    it("a tapped artifact NOT tapped for Improvise is not clickable (can't be undone this way)", () => {
        const art = artifact({ isTapped: true });
        const { me, ctx } = payingCtx([art]);
        const { result } = renderVisualState(me, ctx);

        expect(result.current.canInteract(art)).toBe(false);
    });

    it("a tapped artifact that WAS tapped for Improvise this payment is clickable (undo)", () => {
        const art = artifact({ id: "art1", isTapped: true });
        const { me, ctx } = payingCtx([art], {
            improviseTappedArtifactIds: ["art1"],
        });
        const { result } = renderVisualState(me, ctx);

        expect(result.current.canInteract(art)).toBe(true);
    });

    it("a non-artifact permanent (no mana ability) is never offered via the Improvise branch", () => {
        const notArtifact = artifact({ types: ["Creature"] });
        const { me, ctx } = payingCtx([notArtifact]);
        const { result } = renderVisualState(me, ctx);

        expect(result.current.canInteract(notArtifact)).toBe(false);
    });

    it("no artifact is offered when the spell being cast does NOT declare improvise", () => {
        const art = artifact();
        const spell = nonImproviseSpellInHand();
        const me: Player = { ...makePlayer("me", [art]), hand: [spell] };
        const ctx = {
            phase: "PRECOMBAT_MAIN",
            combat: undefined,
            pendingCast: {
                playerId: "me",
                cardInstanceId: "spell-1",
                manaCost: { X: 2 },
                tappedLandIds: [],
            },
        } as unknown as Partial<NonNullable<Ctx>>;
        const { result } = renderVisualState(me, ctx);

        expect(result.current.canInteract(art)).toBe(false);
    });

    it("an un-imprinted (currently unusable) mox is STILL offered as an Improvise tap — its mana ability isn't currently usable", () => {
        const mox = moxCard(); // no imprint counter → hasManaAbility() is false
        const { me, ctx } = payingCtx([mox]);
        const { result } = renderVisualState(me, ctx);

        expect(result.current.canInteract(mox)).toBe(true);
    });

    it("an imprinted mox (usable mana ability) routes through the mana branch, not Improvise — tapped-but-unrecorded reads not-clickable", () => {
        const mox = moxCard({ counters: { "imprint-G": 1 }, isTapped: true });
        // Tapped, but recorded in NEITHER tappedLandIds (mana branch) NOR
        // improviseTappedArtifactIds (Improvise branch): if `hasManaAbility`
        // were false here (routing it through Improvise) it would still be
        // rejected too, since it's absent from improviseTappedArtifactIds —
        // proving a mana-capable artifact never falls through to the
        // Improvise undo path regardless of which list is checked.
        const { me, ctx } = payingCtx([mox]);
        const { result } = renderVisualState(me, ctx);

        expect(result.current.canInteract(mox)).toBe(false);
    });

    it("an imprinted mox tapped and recorded as a mana source (tappedLandIds) reads clickable via the mana branch", () => {
        const mox = moxCard({ counters: { "imprint-G": 1 }, isTapped: true });
        const { me, ctx } = payingCtx([mox], { tappedLandIds: ["mox1"] });
        const { result } = renderVisualState(me, ctx);

        expect(result.current.canInteract(mox)).toBe(true);
    });
});
