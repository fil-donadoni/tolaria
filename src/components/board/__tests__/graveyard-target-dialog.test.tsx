// Graveyard target dialog routing + cancel + disable-while-pending (#314).
// Mirrors the board targeting-choice test's mutation-capture pattern.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance, PendingTarget, Player } from "~/types/game";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
// selectTarget stays pending (promise never resolves) so the dialog's
// in-flight `isPending` state is observable in the disable-while-pending test.
const selectTarget = vi.fn<MutFn>(() => new Promise<void>(() => {}));
const cancelTarget = vi.fn<MutFn>(() => Promise.resolve());
const noop = vi.fn<MutFn>(() => Promise.resolve());

const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    selectTarget,
    cancelTarget,
};

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) => MUTATIONS[ref._name] ?? noop,
    useQuery: () => undefined,
}));

vi.mock("@convex/_generated/api", () => {
    const game: Record<string, { _name: string }> = {};
    for (const n of ["selectTarget", "cancelTarget"]) game[n] = { _name: n };
    return { api: { game } };
});

vi.mock("@convex/cards", () => ({
    getDefinition: (id: string) => ({ id, name: `Card ${id}` }),
    tryGetDefinition: (id: string) => ({ id, name: `Card ${id}` }),
}));

// Inert card image so the picker renders a clickable node without art loading.
vi.mock("~/components/cards/card-image", () => ({
    default: ({ card }: { card: { id: string } }) => (
        <div data-testid={`card-img-${card.id}`} />
    ),
}));

import GraveyardTargetDialog from "../graveyard-target-dialog";

function gyCard(id: string, ownerId: string): CardInstance {
    return {
        id,
        card: { id: `def-${id}` },
        controllerId: ownerId,
        ownerId,
        zone: "graveyard",
        isTapped: false,
        types: ["Creature"],
    } as CardInstance;
}

function player(id: string, name: string, graveyard: CardInstance[]): Player {
    return {
        id,
        name,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard,
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

function pending(over: Partial<PendingTarget>): PendingTarget {
    return {
        playerId: "me",
        cardInstanceId: "src",
        targetType: "Creature",
        count: 1,
        zone: "graveyard",
        selected: [],
        ...over,
    } as PendingTarget;
}

function renderDialog(
    pt: PendingTarget,
    players: Player[],
    me: Player | undefined
) {
    return render(
        <GraveyardTargetDialog
            pendingTarget={pt}
            me={me}
            allPlayers={players}
            gameId={"g1" as never}
            playerId="me"
            activePlayerId="me"
        />
    );
}

beforeEach(() => {
    selectTarget.mockClear();
    cancelTarget.mockClear();
});
afterEach(cleanup);

describe("GraveyardTargetDialog routing (#314)", () => {
    it("single eligible graveyard → card picker opens directly (no tab strip)", () => {
        const me = player("me", "Me", [gyCard("m1", "me")]);
        const opp = player("opp", "Opp", []);
        renderDialog(pending({ controller: "you" }), [me, opp], me);

        // No graveyard tabs; the card is directly pickable.
        expect(screen.queryByText("My graveyard")).toBeNull();
        expect(screen.getByTestId("card-img-m1")).toBeTruthy();
    });

    it("two eligible graveyards (controller: any) → persistent tabs, first shown by default", () => {
        const me = player("me", "Me", [gyCard("m1", "me")]);
        const opp = player("opp", "Opp", [gyCard("o1", "opp")]);
        renderDialog(pending({ controller: "any" }), [me, opp], me);

        // Both tabs are always visible AND the first graveyard's cards show
        // immediately (Arena parity — no separate choice step).
        expect(screen.getByText("My graveyard")).toBeTruthy();
        expect(screen.getByText("Opponent's graveyard")).toBeTruthy();
        expect(screen.getByTestId("card-img-m1")).toBeTruthy();
        expect(screen.queryByTestId("card-img-o1")).toBeNull();

        // Switch to the opponent's graveyard → its card replaces the previous.
        // The tabs stay visible so the chooser can switch back at any time.
        fireEvent.click(screen.getByText("Opponent's graveyard"));
        expect(screen.getByTestId("card-img-o1")).toBeTruthy();
        expect(screen.queryByTestId("card-img-m1")).toBeNull();
        expect(screen.getByText("My graveyard")).toBeTruthy();

        // Switch back — the first graveyard's card returns without any cancel.
        fireEvent.click(screen.getByText("My graveyard"));
        expect(screen.getByTestId("card-img-m1")).toBeTruthy();
        expect(screen.queryByTestId("card-img-o1")).toBeNull();
        expect(cancelTarget).not.toHaveBeenCalled();
    });

    it("picking a card submits selectTarget with the owning player's id", () => {
        const me = player("me", "Me", [gyCard("m1", "me")]);
        const opp = player("opp", "Opp", [gyCard("o1", "opp")]);
        renderDialog(pending({ controller: "any" }), [me, opp], me);

        fireEvent.click(screen.getByText("Opponent's graveyard"));
        fireEvent.click(screen.getByTestId("card-img-o1"));

        expect(selectTarget).toHaveBeenCalledTimes(1);
        expect(selectTarget.mock.calls[0][0]).toMatchObject({
            gameId: "g1",
            playerId: "me",
            targetType: "graveyard-card",
            targetId: "o1",
            targetPlayerId: "opp",
        });
    });

    it("cancelling the dialog (ESC) cancels target selection with no select call", () => {
        const me = player("me", "Me", [gyCard("m1", "me")]);
        renderDialog(pending({ controller: "you" }), [me], me);

        fireEvent.keyDown(document, { key: "Escape" });
        expect(cancelTarget).toHaveBeenCalledTimes(1);
        expect(cancelTarget.mock.calls[0][0]).toMatchObject({
            gameId: "g1",
            playerId: "me",
        });
        expect(selectTarget).not.toHaveBeenCalled();
    });

    it("subtitle reflects the real remaining count for a 2-target spell (Restock)", () => {
        const me = player("me", "Me", [gyCard("m1", "me"), gyCard("m2", "me")]);
        renderDialog(
            pending({ controller: "you", count: 2, selected: [] }),
            [me],
            me
        );

        expect(screen.getAllByText("Select 2 targets").length).toBeGreaterThan(
            0
        );
        expect(screen.queryByText(/Choose a card/i)).toBeNull();
    });

    it("subtitle falls back to the singular label once only one target remains", () => {
        const me = player("me", "Me", [gyCard("m1", "me"), gyCard("m2", "me")]);
        renderDialog(
            pending({
                controller: "you",
                count: 2,
                selected: [{ type: "graveyard-card", id: "m1" } as never],
            }),
            [me],
            me
        );

        expect(
            screen.getAllByText(/Select a creature from your graveyard/i).length
        ).toBeGreaterThan(0);
    });

    it("buttons disable while the selectTarget mutation is in flight", () => {
        const me = player("me", "Me", [gyCard("m1", "me"), gyCard("m2", "me")]);
        renderDialog(pending({ controller: "you" }), [me], me);

        const firstBtn = screen.getByTestId("card-img-m1").closest("button")!;
        const secondBtn = screen.getByTestId("card-img-m2").closest("button")!;
        expect(firstBtn.disabled).toBe(false);

        // Fire the mutation — it stays pending (promise unresolved).
        fireEvent.click(firstBtn);
        expect(selectTarget).toHaveBeenCalledTimes(1);
        // Both picker buttons must now be disabled.
        expect(firstBtn.disabled).toBe(true);
        expect(secondBtn.disabled).toBe(true);

        // A second click while pending is a no-op.
        fireEvent.click(secondBtn);
        expect(selectTarget).toHaveBeenCalledTimes(1);
    });
});
