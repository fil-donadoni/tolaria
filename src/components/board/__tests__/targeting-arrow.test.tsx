// Issue #9163 — Arena-parity targeting arrow. While the viewer chooses a
// target — an attacker's attack target (CR 508.1b) or a spell / ability
// target (CR 601.2c, `pendingTarget`) — the overlay mounts with the right
// source and the state-derived legal target set, the arrow rides the cursor
// and snaps to a legal target, and Escape / right-click cancels.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { makePlayer } from "@convex/cards/__tests__/setup.helper";
import { GameContext } from "~/hooks/useGameContext";
import { AttackSequenceContext } from "~/hooks/useAttackSequence";
import { ArrowAnchorProvider } from "~/hooks/useArrowAnchors";
import { ArrowHighlightProvider } from "~/hooks/ArrowHighlightProvider";
import { useArrowAnchors, type AnchorKind } from "~/hooks/arrowAnchorContext";
import { useArrowHighlight } from "~/hooks/arrowHighlightContext";
import type { AnchorPoint } from "~/lib/target-arrow-geometry";
import type { CardInstance, PendingTarget, Player } from "~/types/game";
import { makeAttackSequence } from "~/hooks/__tests__/attack-sequence.fixture";
import BoardArrowLayers from "../board-arrow-layers";

const cancelTarget = vi.fn<(args?: Record<string, unknown>) => Promise<void>>(
    () => Promise.resolve()
);
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "cancelTarget" ? cancelTarget : async () => {},
}));
vi.mock("@convex/_generated/api", () => ({
    api: new Proxy(
        {},
        {
            get: () =>
                new Proxy({}, { get: (_t, name) => ({ _name: String(name) }) }),
        }
    ),
}));

type Ctx = NonNullable<React.ContextType<typeof GameContext>>;

function permanent(
    id: string,
    controllerId: string,
    types: string[]
): CardInstance {
    return {
        id,
        card: { id: `${id}-def` },
        types,
        subtypes: [],
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        isTapped: false,
        staticAbilities: [],
        power: types.includes("Creature") ? 2 : undefined,
        toughness: types.includes("Creature") ? 2 : undefined,
    } as unknown as CardInstance;
}

type Published = { kind: AnchorKind; id: string; point: AnchorPoint };

function Publisher({ entries }: { entries: Published[] }) {
    const registry = useArrowAnchors();
    useEffect(() => {
        for (const e of entries) registry?.publish(e.kind, e.id, e.point);
    }, [registry, entries]);
    return null;
}

/** Reads the highlight channel's lit set back out, for the dim assertion. */
function LitProbe() {
    const nodes = useArrowHighlight()?.nodes;
    return (
        <div
            data-testid="lit"
            data-nodes={nodes ? [...nodes].sort().join(" ") : ""}
        />
    );
}

function renderBoard({
    players,
    ctx,
    awaiting = [],
    anchors = [],
    children,
}: {
    players: Player[];
    ctx: Partial<Ctx>;
    awaiting?: string[];
    anchors?: Published[];
    children?: ReactNode;
}) {
    const seq = makeAttackSequence({ awaiting });
    const value = {
        gameId: "game-id",
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        engineTurn: 3,
        allPlayers: players,
        stackItems: [],
        ...ctx,
    } as unknown as Ctx;
    const utils = render(
        <div data-board-root>
            <GameContext value={value}>
                <AttackSequenceContext value={seq}>
                    <ArrowAnchorProvider>
                        <ArrowHighlightProvider>
                            <Publisher entries={anchors} />
                            <BoardArrowLayers stack={[]} />
                            <LitProbe />
                            {children}
                        </ArrowHighlightProvider>
                    </ArrowAnchorProvider>
                </AttackSequenceContext>
            </GameContext>
        </div>
    );
    return { ...utils, seq };
}

const overlay = (root: ParentNode) =>
    root.querySelector<SVGSVGElement>('[data-testid="targeting-arrow"]');

const keys = (attr: string | null | undefined) =>
    (attr ?? "").split(" ").filter(Boolean).sort();

function attackBoard() {
    const me = makePlayer("me", {
        battlefield: [permanent("a1", "me", ["Creature"])],
    }) as unknown as Player;
    const opp = makePlayer("opp", {
        battlefield: [
            permanent("pw1", "opp", ["Planeswalker"]),
            permanent("bear", "opp", ["Creature"]),
        ],
    }) as unknown as Player;
    return [me, opp];
}

const ATTACK_CTX: Partial<Ctx> = {
    phase: "DECLARE_ATTACKERS",
    combat: {
        attackerIds: [],
        confirmed: false,
        blockerAssignments: {},
        blockersConfirmed: false,
    } as never,
};

function spellBoard() {
    const me = makePlayer("me", {
        battlefield: [permanent("mine", "me", ["Creature"])],
    }) as unknown as Player;
    const opp = makePlayer("opp", {
        battlefield: [
            permanent("bear", "opp", ["Creature"]),
            permanent("land", "opp", ["Land"]),
        ],
    }) as unknown as Player;
    return [me, opp];
}

const pendingCreatureTarget = (
    overrides: Partial<PendingTarget> = {}
): PendingTarget =>
    ({
        playerId: "me",
        cardInstanceId: "bolt",
        kind: "cast",
        targetType: "Creature",
        count: 1,
        selected: [],
        ...overrides,
    }) as unknown as PendingTarget;

describe("TargetingArrow (issue #9163)", () => {
    beforeEach(() => {
        cleanup();
        cancelTarget.mockClear();
    });

    it("no open choice: no overlay, nothing dimmed", () => {
        const { container, getByTestId } = renderBoard({
            players: spellBoard(),
            ctx: {},
        });
        expect(overlay(container)).toBeNull();
        expect(getByTestId("lit").dataset.nodes).toBe("");
    });

    it("attack awaiting (CR 508.1b): source = the attacker; targets = the defending player + their planeswalker", () => {
        const { container } = renderBoard({
            players: attackBoard(),
            ctx: ATTACK_CTX,
            awaiting: ["a1"],
        });
        const svg = overlay(container);
        expect(svg).not.toBeNull();
        expect(svg!.dataset.targetingMode).toBe("attack");
        expect(keys(svg!.dataset.targetingSources)).toEqual(["permanent:a1"]);
        expect(keys(svg!.dataset.targetingTargets)).toEqual([
            "permanent:pw1",
            "player:opp",
        ]);
    });

    it("attack: the rest of the board dims — only source and targets stay lit", () => {
        const { getByTestId } = renderBoard({
            players: attackBoard(),
            ctx: ATTACK_CTX,
            awaiting: ["a1"],
        });
        expect(getByTestId("lit").dataset.nodes).toBe("a1 opp pw1");
    });

    it("attack: Escape resets the awaiting attackers", () => {
        const { seq } = renderBoard({
            players: attackBoard(),
            ctx: ATTACK_CTX,
            awaiting: ["a1"],
        });
        fireEvent.keyDown(window, { key: "Escape" });
        expect(seq.reset).toHaveBeenCalledTimes(1);
    });

    it("pendingTarget (CR 601.2c): source = the card being cast; targets = the legal creatures only", () => {
        const { container } = renderBoard({
            players: spellBoard(),
            ctx: { pendingTarget: pendingCreatureTarget() },
        });
        const svg = overlay(container);
        expect(svg).not.toBeNull();
        expect(svg!.dataset.targetingMode).toBe("target");
        expect(keys(svg!.dataset.targetingSources)).toEqual(["card:bolt"]);
        expect(keys(svg!.dataset.targetingTargets)).toEqual([
            "permanent:bear",
            "permanent:mine",
        ]);
    });

    it("pendingTarget for an activated ability: the arrow leaves the source permanent", () => {
        const { container } = renderBoard({
            players: spellBoard(),
            ctx: {
                pendingTarget: pendingCreatureTarget({
                    kind: "ability",
                    cardInstanceId: "mine",
                }),
            },
        });
        expect(keys(overlay(container)!.dataset.targetingSources)).toEqual([
            "permanent:mine",
        ]);
    });

    it("pendingTarget 'any target': players join the target set", () => {
        const { container } = renderBoard({
            players: spellBoard(),
            ctx: {
                pendingTarget: pendingCreatureTarget({ targetType: "any" }),
            },
        });
        const targets = keys(overlay(container)!.dataset.targetingTargets);
        expect(targets).toContain("player:me");
        expect(targets).toContain("player:opp");
        expect(targets).not.toContain("permanent:land");
    });

    it("another seat's pendingTarget opens nothing for this viewer", () => {
        const { container } = renderBoard({
            players: spellBoard(),
            ctx: {
                pendingTarget: pendingCreatureTarget({ playerId: "opp" }),
            },
        });
        expect(overlay(container)).toBeNull();
    });

    it("pendingTarget: Escape is the banner's Cancel (cancelTarget)", () => {
        renderBoard({
            players: spellBoard(),
            ctx: { pendingTarget: pendingCreatureTarget() },
        });
        fireEvent.keyDown(window, { key: "Escape" });
        expect(cancelTarget).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
        });
    });

    it("pendingTarget: right-click cancels too", () => {
        renderBoard({
            players: spellBoard(),
            ctx: { pendingTarget: pendingCreatureTarget() },
        });
        fireEvent.contextMenu(window);
        expect(cancelTarget).toHaveBeenCalledTimes(1);
    });

    it("Escape inside an open dialog is the dialog's, not the choice's", () => {
        renderBoard({
            players: spellBoard(),
            ctx: { pendingTarget: pendingCreatureTarget() },
            children: <div data-slot="dialog-content" />,
        });
        fireEvent.keyDown(window, { key: "Escape" });
        expect(cancelTarget).not.toHaveBeenCalled();
    });

    it("the arrow rides the cursor and snaps onto a hovered legal target", async () => {
        const raf = vi
            .spyOn(window, "requestAnimationFrame")
            .mockImplementation((cb) => {
                // Synchronous frame; id 0 so the hook's "frame pending"
                // latch reads as clear once it has run.
                cb(0);
                return 0;
            });
        const { container } = renderBoard({
            players: spellBoard(),
            ctx: {
                pendingTarget: pendingCreatureTarget({
                    kind: "ability",
                    cardInstanceId: "mine",
                }),
            },
            anchors: [
                { kind: "permanent", id: "mine", point: { x: 10, y: 20 } },
                { kind: "permanent", id: "bear", point: { x: 300, y: 40 } },
            ],
            children: (
                <>
                    <div data-arrow-anchor-permanent="bear" />
                    <div data-arrow-anchor-permanent="land" />
                </>
            ),
        });
        const path = () =>
            container.querySelector<SVGPathElement>("[data-targeting-path]");

        // Over a non-target: the tip is the cursor, unlocked.
        await act(async () => {
            fireEvent.pointerMove(
                container.querySelector(
                    '[data-arrow-anchor-permanent="land"]'
                )!,
                { clientX: 123, clientY: 77, pointerType: "mouse" }
            );
        });
        expect(path()!.dataset.locked).toBe("false");
        expect(path()!.getAttribute("d")).toMatch(/ 123 77$/);

        // Over the legal target: snapped to its anchor, locked.
        await act(async () => {
            fireEvent.pointerMove(
                container.querySelector(
                    '[data-arrow-anchor-permanent="bear"]'
                )!,
                { clientX: 5, clientY: 5, pointerType: "mouse" }
            );
        });
        expect(path()!.dataset.locked).toBe("true");
        expect(path()!.getAttribute("d")).toMatch(/ 300 40$/);
        raf.mockRestore();
    });

    it("touch: no cursor, so no arrow — the target pips still mark the choice", async () => {
        const raf = vi
            .spyOn(window, "requestAnimationFrame")
            .mockImplementation((cb) => {
                // Synchronous frame; id 0 so the hook's "frame pending"
                // latch reads as clear once it has run.
                cb(0);
                return 0;
            });
        const { container } = renderBoard({
            players: spellBoard(),
            ctx: {
                pendingTarget: pendingCreatureTarget({
                    kind: "ability",
                    cardInstanceId: "mine",
                }),
            },
            anchors: [
                { kind: "permanent", id: "mine", point: { x: 10, y: 20 } },
                { kind: "permanent", id: "bear", point: { x: 300, y: 40 } },
            ],
        });
        await act(async () => {
            fireEvent.pointerMove(window, {
                clientX: 50,
                clientY: 50,
                pointerType: "touch",
            });
        });
        expect(container.querySelector("[data-targeting-path]")).toBeNull();
        expect(
            container.querySelector('[data-targeting-pip="permanent:bear"]')
        ).not.toBeNull();
        raf.mockRestore();
    });
});
