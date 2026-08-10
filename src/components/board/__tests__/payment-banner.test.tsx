// Payment banner routing (#939): the mana "Auto-tap" affordance only makes
// sense when there's actually uncovered mana. A pending activation can enter
// deferred-commit purely because of a non-mana cost picker (CR 602.1 —
// sacrifice a permanent matching a filter, or tap N other permanents), with
// the mana leg empty or already covered — in that case PaymentBanner must
// hide "Auto-tap" and describe the outstanding pick instead of showing a
// meaningless mana dialog on top of the battlefield's own sacrifice
// highlighting (useBattlefieldVisualState).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { PendingActivation, PendingCast, Player } from "~/types/game";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const autoTapForPayment = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());

const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    autoTapForPayment,
};

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) => MUTATIONS[ref._name] ?? noop,
    useQuery: () => undefined,
}));

vi.mock("@convex/_generated/api", () => {
    const game: Record<string, { _name: string }> = {
        autoTapForPayment: { _name: "autoTapForPayment" },
    };
    return { api: { game } };
});

import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
// The cast branch reads `types` / `supertypes` off the DEFINITION to key CR
// 106.6 restricted-mana eligibility (#1713), so the stub can't stop at a name.
vi.mock("@convex/cards", () => {
    const TYPES: Record<string, string[]> = {
        "artifact-spell": ["Artifact"],
        "some-spell": ["Instant"],
    };
    const def = (id: string) => ({
        id,
        name: `Card ${id}`,
        types: TYPES[id] ?? [],
        supertypes: [],
    });
    return {
        getInstanceManaCost: (c: ManaCostSource) => mockInstanceManaCost(c),
        getDefinition: def,
        tryGetDefinition: def,
    };
});

import PaymentBanner from "../payment-banner";

function player(over: Partial<Player> = {}): Player {
    return {
        id: "me",
        name: "Me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [
            {
                id: "src",
                card: { id: "goblin-bombardment" },
                controllerId: "me",
                ownerId: "me",
                zone: "battlefield",
                isTapped: false,
                types: ["Enchantment"],
            } as never,
        ],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...over,
    };
}

function activation(over: Partial<PendingActivation> = {}): PendingActivation {
    return {
        playerId: "me",
        cardInstanceId: "src",
        abilityId: "sac-ability",
        manaCost: {},
        tappedLandIds: [],
        tapSource: false,
        sacrificeSource: false,
        ...over,
    };
}

beforeEach(() => {
    autoTapForPayment.mockClear();
});
afterEach(cleanup);

describe("PaymentBanner activation routing (#939)", () => {
    it("sacrifice-only cost (no mana) → no Auto-tap button, subtitle names the sacrifice", () => {
        const pa = activation({
            sacrificeSelection: {
                playerId: "me",
                reason: "Ability",
                requirements: [{ filter: { types: "Creature" }, count: 1 }],
                picked: [],
            },
        });
        render(
            <PaymentBanner
                kind="activation"
                pendingActivation={pa}
                me={player()}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(screen.queryByText("Auto-tap")).toBeNull();
        expect(screen.getByText("sacrifice a creature")).toBeTruthy();
    });

    it("mana-only cost (uncovered) → Auto-tap button shown, generic subtitle", () => {
        const pa = activation({ manaCost: { R: 1 } });
        render(
            <PaymentBanner
                kind="activation"
                pendingActivation={pa}
                me={player()}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(screen.getByText("Auto-tap")).toBeTruthy();
        expect(screen.getByText("pay the activation costs")).toBeTruthy();
    });

    it("mixed mana + sacrifice, mana still uncovered → Auto-tap shown (sacrifice highlighting is a separate battlefield affordance)", () => {
        const pa = activation({
            manaCost: { R: 1 },
            sacrificeSelection: {
                playerId: "me",
                reason: "Ability",
                requirements: [{ filter: { types: "Creature" }, count: 1 }],
                picked: [],
            },
        });
        render(
            <PaymentBanner
                kind="activation"
                pendingActivation={pa}
                me={player()}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(screen.getByText("Auto-tap")).toBeTruthy();
        expect(screen.getByText("pay the activation costs")).toBeTruthy();
    });

    it("mana cost already covered by the pool + sacrifice still pending → no Auto-tap, sacrifice subtitle", () => {
        const pa = activation({
            manaCost: { R: 1 },
            sacrificeSelection: {
                playerId: "me",
                reason: "Ability",
                requirements: [{ filter: { types: "Land" }, count: 1 }],
                picked: [],
            },
        });
        const me = player({ manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 } });
        render(
            <PaymentBanner
                kind="activation"
                pendingActivation={pa}
                me={me}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(screen.queryByText("Auto-tap")).toBeNull();
        expect(screen.getByText("sacrifice a land")).toBeTruthy();
    });

    it("tap-other cost only (no mana) → no Auto-tap, subtitle names the tap", () => {
        const pa = activation({
            tapOtherChoice: {
                filter: { types: "Land", supertypes: ["Snow"] },
                count: 1,
                pickedIds: [],
            },
        });
        render(
            <PaymentBanner
                kind="activation"
                pendingActivation={pa}
                me={player()}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(screen.queryByText("Auto-tap")).toBeNull();
        expect(screen.getByText("tap a land")).toBeTruthy();
    });

    it("tap-other cost with count > 1 (Hand of Justice shape) → subtitle pluralizes without a stray article", () => {
        const pa = activation({
            tapOtherChoice: {
                filter: { types: "Creature" },
                count: 3,
                pickedIds: [],
            },
        });
        render(
            <PaymentBanner
                kind="activation"
                pendingActivation={pa}
                me={player()}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(screen.queryByText("Auto-tap")).toBeNull();
        expect(screen.getByText("tap 3 more creatures")).toBeTruthy();
    });

    it("tap-other cost with count > 1, some already picked → subtitle counts only the remainder", () => {
        const pa = activation({
            tapOtherChoice: {
                filter: { types: "Creature" },
                count: 3,
                pickedIds: ["c1"],
            },
        });
        render(
            <PaymentBanner
                kind="activation"
                pendingActivation={pa}
                me={player()}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(screen.getByText("tap 2 more creatures")).toBeTruthy();
    });

    it("clicking Auto-tap still dispatches autoTapForPayment when mana is owed", () => {
        const pa = activation({ manaCost: { R: 1 } });
        render(
            <PaymentBanner
                kind="activation"
                pendingActivation={pa}
                me={player()}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        fireEvent.click(screen.getByText("Auto-tap"));
        expect(autoTapForPayment).toHaveBeenCalledTimes(1);
        expect(autoTapForPayment.mock.calls[0][0]).toMatchObject({
            gameId: "g1",
            playerId: "me",
        });
    });

    it("cast kind is unaffected — Auto-tap always shown", () => {
        const pc = {
            playerId: "me",
            cardInstanceId: "hand1",
            manaCost: { G: 1 },
            tappedLandIds: [],
        } as unknown as PendingCast;
        const me = player({
            hand: [
                {
                    id: "hand1",
                    card: { id: "some-spell" },
                    controllerId: "me",
                    ownerId: "me",
                    zone: "hand",
                    isTapped: false,
                    types: ["Instant"],
                } as never,
            ],
        });
        render(
            <PaymentBanner
                kind="cast"
                pendingCast={pc}
                me={me}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(screen.getByText("Auto-tap")).toBeTruthy();
        expect(screen.getByText("pay the casting costs")).toBeTruthy();
    });
});

// Issue #1713 — the banner gates its "Auto-tap" affordance on whether the
// pending cost is already covered, and used to answer that from the raw
// `props.me.manaPool`. Mana carrying a CR 106.6 spend restriction lives in the
// parallel `restrictedMana` pool, so a cost the SERVER considers covered (it
// merges the eligible bucket in via `spendablePoolForSpell` /
// `spendablePoolForAbility`) read as unpaid client-side: the banner offered
// Auto-tap for a payment already made, and never surfaced the outstanding
// non-mana pick.
//
// These assertions run THROUGH the rendered component, not through the pool
// helpers directly — a test that calls `spendablePoolForAbility` itself is a
// re-implementation of the banner's logic that stays green while both banner
// reads are reverted to `props.me.manaPool` (proven: 24/24 passing with the
// bug fully re-introduced). Per `.claude/rules/gre-development.md` § Frontend
// wiring analysis item 4, the surface assertion must traverse the real path.
describe("PaymentBanner restricted-mana coverage (#1713, CR 106.6)", () => {
    const artifactSource = {
        id: "art1",
        card: { id: "artifact-source" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        types: ["Artifact"],
    } as never;

    it("activation: the source's own artifact-ability bucket covers the cost → no Auto-tap", () => {
        // Soldevi Machinist's {C}{C} paying an artifact's activated ability —
        // the server auto-commits this, so the banner must not beg for mana.
        const pa = activation({
            cardInstanceId: "art1",
            manaCost: { C: 2 },
        });
        const me = player({
            battlefield: [artifactSource],
            restrictedMana: [
                { color: "C", amount: 2, restriction: "artifact-ability" },
            ],
        });
        render(
            <PaymentBanner
                kind="activation"
                pendingActivation={pa}
                me={me}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(screen.queryByText("Auto-tap")).toBeNull();
    });

    it("activation: an artifact-ability bucket does NOT cover a non-artifact source's ability → Auto-tap still shown", () => {
        const pa = activation({ manaCost: { C: 2 } });
        const me = player({
            // default battlefield source is an Enchantment
            restrictedMana: [
                { color: "C", amount: 2, restriction: "artifact-ability" },
            ],
        });
        render(
            <PaymentBanner
                kind="activation"
                pendingActivation={pa}
                me={me}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(screen.getByText("Auto-tap")).toBeTruthy();
    });

    it("activation: a GRAVEYARD source is keyed on its own types (CR 113.6, mirrors activationSourceTypes) → no Auto-tap", () => {
        const pa = activation({ cardInstanceId: "gy1", manaCost: { C: 2 } });
        const me = player({
            graveyard: [
                {
                    id: "gy1",
                    card: { id: "artifact-source" },
                    controllerId: "me",
                    ownerId: "me",
                    zone: "graveyard",
                    isTapped: false,
                    types: ["Artifact"],
                } as never,
            ],
            restrictedMana: [
                { color: "C", amount: 2, restriction: "artifact-ability" },
            ],
        });
        render(
            <PaymentBanner
                kind="activation"
                pendingActivation={pa}
                me={me}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(screen.queryByText("Auto-tap")).toBeNull();
    });

    it("activation: a HAND source yields NO eligible types server-side (activationSourceTypes searches battlefield+graveyard only) → Auto-tap stays shown", () => {
        // Cycling / any `fromHand` ability. The card is still NAMED from the
        // hand, but keying eligibility on its types would let the banner
        // conclude "covered" and hide Auto-tap while the server refuses to
        // auto-commit — a dead banner with no way to pay.
        const pa = activation({ cardInstanceId: "hand1", manaCost: { C: 2 } });
        const me = player({
            hand: [
                {
                    id: "hand1",
                    card: { id: "artifact-spell" },
                    controllerId: "me",
                    ownerId: "me",
                    zone: "hand",
                    isTapped: false,
                    types: ["Artifact"],
                } as never,
            ],
            restrictedMana: [
                { color: "C", amount: 2, restriction: "artifact-ability" },
            ],
        });
        render(
            <PaymentBanner
                kind="activation"
                pendingActivation={pa}
                me={me}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(screen.getByText("Auto-tap")).toBeTruthy();
        // Still named from the hand — the fix narrows the TYPES key only.
        expect(screen.getByText("Card artifact-spell")).toBeTruthy();
    });

    it("cast: Mishra's Workshop mana covers an artifact spell → no Auto-tap, the sacrifice pick is named instead", () => {
        const pc = {
            playerId: "me",
            cardInstanceId: "hand1",
            manaCost: { C: 3 },
            tappedLandIds: [],
            sacrificeSelection: {
                playerId: "me",
                reason: "Cast",
                requirements: [{ filter: { types: "Creature" }, count: 1 }],
                picked: [],
            },
        } as unknown as PendingCast;
        const me = player({
            hand: [
                {
                    id: "hand1",
                    card: { id: "artifact-spell" },
                    controllerId: "me",
                    ownerId: "me",
                    zone: "hand",
                    isTapped: false,
                    types: ["Artifact"],
                } as never,
            ],
            restrictedMana: [
                { color: "C", amount: 3, restriction: "artifact-spell" },
            ],
        });
        render(
            <PaymentBanner
                kind="cast"
                pendingCast={pc}
                me={me}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(screen.queryByText("Auto-tap")).toBeNull();
        expect(screen.getByText("sacrifice a creature")).toBeTruthy();
    });

    it("cast: artifact-spell mana does NOT cover a non-artifact spell → Auto-tap shown", () => {
        const pc = {
            playerId: "me",
            cardInstanceId: "hand1",
            manaCost: { C: 3 },
            tappedLandIds: [],
            sacrificeSelection: {
                playerId: "me",
                reason: "Cast",
                requirements: [{ filter: { types: "Creature" }, count: 1 }],
                picked: [],
            },
        } as unknown as PendingCast;
        const me = player({
            hand: [
                {
                    id: "hand1",
                    card: { id: "some-spell" },
                    controllerId: "me",
                    ownerId: "me",
                    zone: "hand",
                    isTapped: false,
                    types: ["Instant"],
                } as never,
            ],
            restrictedMana: [
                { color: "C", amount: 3, restriction: "artifact-spell" },
            ],
        });
        render(
            <PaymentBanner
                kind="cast"
                pendingCast={pc}
                me={me}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(screen.getByText("Auto-tap")).toBeTruthy();
    });
});
