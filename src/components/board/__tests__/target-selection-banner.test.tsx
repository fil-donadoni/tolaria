// Target-selection banner source-name resolution. The banner title is the
// SOURCE of the pending target — a spell's card name, or (for an activated
// ability, CR 602.1) the name of the permanent on the battlefield whose
// ability is being activated. `PendingTarget.cardInstanceId` is a hand card id
// for a cast but a BATTLEFIELD permanent id for `kind: "ability"`, so a
// hand-only lookup falls through to the literal "spell" (the Arcum's Whistle
// bug). This asserts both branches resolve correctly.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { PendingTarget, Player } from "~/types/game";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const noop = vi.fn<MutFn>(() => Promise.resolve());

vi.mock("convex/react", () => ({
    useMutation: () => noop,
    useQuery: () => undefined,
}));

vi.mock("@convex/_generated/api", () => ({
    api: { game: { cancelTarget: {}, confirmTargets: {} } },
}));

const CARD_NAMES: Record<string, string> = {
    "73c07c87-0e44-4a5a-92b7-728350cd02de": "Arcum's Whistle",
    "some-spell": "Lightning Bolt",
};

vi.mock("@convex/cards", () => ({
    getDefinition: (id: string) => ({
        id,
        name: CARD_NAMES[id] ?? `Card ${id}`,
    }),
    // Non-throwing lookup: undefined for a non-card id (e.g. an emblem key), so
    // the banner falls through to the emblem registry.
    tryGetDefinition: (id: string) =>
        CARD_NAMES[id] ? { id, name: CARD_NAMES[id] } : undefined,
}));

vi.mock("@convex/cards/emblems", () => ({
    tryGetEmblemDefinition: (id: string) =>
        id === "chandra-torch-of-defiance-emblem"
            ? { id, name: "Chandra, Torch of Defiance emblem" }
            : undefined,
}));

import TargetSelectionBanner from "../target-selection-banner";

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
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...over,
    };
}

function pending(over: Partial<PendingTarget> = {}): PendingTarget {
    return {
        playerId: "me",
        cardInstanceId: "inst",
        targetType: "Creature",
        count: 1,
        selected: [],
        ...over,
    } as PendingTarget;
}

afterEach(cleanup);

describe("TargetSelectionBanner source-name resolution", () => {
    it("activated ability (kind: 'ability') → names the battlefield source, not 'spell'", () => {
        const me = player({
            battlefield: [
                {
                    id: "whistle-inst",
                    card: { id: "73c07c87-0e44-4a5a-92b7-728350cd02de" },
                    controllerId: "me",
                    ownerId: "me",
                    zone: "battlefield",
                    isTapped: false,
                    types: ["Artifact"],
                } as never,
            ],
        });
        render(
            <TargetSelectionBanner
                pendingTarget={pending({
                    kind: "ability",
                    abilityId: "arcums-whistle-force",
                    cardInstanceId: "whistle-inst",
                })}
                me={me}
                stack={[]}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(screen.getByText("Arcum's Whistle")).toBeTruthy();
        expect(screen.queryByText("spell")).toBeNull();
    });

    it("spell cast → names the hand card", () => {
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
            <TargetSelectionBanner
                pendingTarget={pending({
                    kind: "cast",
                    cardInstanceId: "hand1",
                })}
                me={me}
                stack={[]}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(screen.getByText("Lightning Bolt")).toBeTruthy();
    });

    it("emblem-sourced trigger (kind: 'trigger') → names the emblem, not 'spell'", () => {
        const stack = [
            {
                id: "emb-trig",
                card: { id: "chandra-torch-of-defiance-emblem" },
                controllerId: "me",
                ownerId: "me",
                zone: "stack",
                isTapped: false,
                types: [],
                emblemSourceId: "chandra-torch-of-defiance-emblem",
            } as never,
        ];
        render(
            <TargetSelectionBanner
                pendingTarget={pending({
                    kind: "trigger",
                    cardInstanceId: "emb-trig",
                    targetType: "any",
                })}
                me={player()}
                stack={stack}
                gameId={"g1" as never}
                playerId="me"
            />
        );

        expect(
            screen.getByText("Chandra, Torch of Defiance emblem")
        ).toBeTruthy();
        expect(screen.queryByText("spell")).toBeNull();
    });
});
