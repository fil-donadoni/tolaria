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

vi.mock("@convex/cards", () => ({
    getDefinition: (id: string) => ({ id, name: `Card ${id}` }),
}));

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
            sacrificeChoice: { filter: { types: "Creature" } },
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
            sacrificeChoice: { filter: { types: "Creature" } },
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
            sacrificeChoice: { filter: { types: "Land" } },
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
