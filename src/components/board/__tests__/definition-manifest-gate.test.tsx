import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";

/**
 * The game route's Definition Manifest gate (issue #5615, PRD #5602).
 *
 * What it must get right, each asserted on the DOM — the children are not
 * MOUNTED until the Sets are resident, since a mounted child reads
 * `getDefinition` against a half-empty catalogue:
 *   - the Sets the viewer's rows name are installed, nothing more, and only
 *     the codes this client's index knows (a Manifest code is a hint);
 *   - a solo client installs the union of BOTH seats' rows;
 *   - the own row `null` on a playing Game is the whole-catalogue fallback,
 *     never a gate that waits forever; the opponent's `null` is ignored;
 *   - every seat's row settles before the first install, and a widened
 *     Manifest installs in the background: the board is held ONCE, never
 *     unmounted by a widen;
 *   - a failed load, and a failed query, are named and retried.
 */

const rows = new Map<
    string,
    { entries: { definitionId: string; setCode: string }[] } | null | undefined
>();
const errors = new Map<string, Error>();
const retry = vi.fn();
vi.mock("~/hooks/useResilientQuery", () => ({
    useResilientQuery: (
        _query: unknown,
        args: { playerId: string } | "skip"
    ) => ({
        data: args === "skip" ? undefined : rows.get(args.playerId),
        error: args === "skip" ? null : (errors.get(args.playerId) ?? null),
        retry,
    }),
}));

const installSets = vi.fn<(codes: Iterable<string>) => Promise<void>>();
const known = new Set(["lea", "leb", "arn"]);
vi.mock("~/lib/catalogue/definitionShards", () => ({
    installSets,
    isKnownSetCode: (code: string) => known.has(code),
}));

const hydrateCatalogue = vi.fn<() => Promise<number>>();
vi.mock("~/lib/catalogueArtifact", () => ({ hydrateCatalogue }));

const { default: DefinitionManifestGate } =
    await import("../definition-manifest-gate");

const gameId = "game1" as Id<"games">;
const entry = (setCode: string) => ({
    definitionId: `${setCode}-card`,
    setCode,
});
const CHILD = <p>the board</p>;

function renderGate(playerId: string, seatIds: string[]) {
    return render(
        <DefinitionManifestGate
            gameId={gameId}
            playerId={playerId}
            seatIds={seatIds}
        >
            {CHILD}
        </DefinitionManifestGate>
    );
}

beforeEach(() => {
    rows.clear();
    errors.clear();
    installSets.mockResolvedValue(undefined);
    hydrateCatalogue.mockResolvedValue(0);
});
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe("DefinitionManifestGate", () => {
    it("mounts nothing while any seat's row is loading", () => {
        rows.set("p1", { entries: [entry("lea")] });
        rows.set("p2", undefined);
        renderGate("p1", ["p1", "p2"]);
        expect(screen.queryByText("the board")).toBeNull();
        expect(screen.getByText("Loading cards...")).toBeTruthy();
        expect(installSets).not.toHaveBeenCalled();
        expect(hydrateCatalogue).not.toHaveBeenCalled();
    });

    it("installs exactly the Sets the viewer's row names, then renders the board", async () => {
        rows.set("p1", { entries: [entry("lea"), entry("leb"), entry("lea")] });
        rows.set("p2", null); // the opponent's seat: not ours
        renderGate("p1", ["p1", "p2"]);
        expect(screen.queryByText("the board")).toBeNull();
        await waitFor(() => expect(screen.getByText("the board")).toBeTruthy());
        expect(installSets).toHaveBeenCalledTimes(1);
        expect([...installSets.mock.calls[0]![0]]).toEqual(["lea", "leb"]);
        expect(hydrateCatalogue).not.toHaveBeenCalled();
    });

    it("drops a Set code this client's index does not know — the Manifest is a hint", async () => {
        rows.set("p1", { entries: [entry("lea"), entry("zzz")] });
        renderGate("p1", ["p1"]);
        await screen.findByText("the board");
        expect([...installSets.mock.calls[0]![0]]).toEqual(["lea"]);
    });

    it("solo: installs the union of both seats' rows", async () => {
        rows.set("u-p1", { entries: [entry("lea")] });
        rows.set("u-p2", { entries: [entry("arn"), entry("lea")] });
        renderGate("u-p2", ["u-p1", "u-p2"]);
        await screen.findByText("the board");
        expect([...installSets.mock.calls[0]![0]]).toEqual(["lea", "arn"]);
    });

    it("falls back to the whole catalogue when the viewer's own row is null on a playing Game", async () => {
        rows.set("p1", null);
        rows.set("p2", null);
        renderGate("p1", ["p1", "p2"]);
        await screen.findByText("the board");
        expect(hydrateCatalogue).toHaveBeenCalledTimes(1);
        expect(installSets).not.toHaveBeenCalled();
    });

    it("installs a widened Manifest's Sets in the background — the board is held once, never unmounted", async () => {
        rows.set("p1", { entries: [entry("lea")] });
        const view = renderGate("p1", ["p1"]);
        await screen.findByText("the board");

        installSets.mockImplementationOnce(() => new Promise<void>(() => {}));
        rows.set("p1", { entries: [entry("lea"), entry("arn")] });
        view.rerender(
            <DefinitionManifestGate
                gameId={gameId}
                playerId="p1"
                seatIds={["p1"]}
            >
                {CHILD}
            </DefinitionManifestGate>
        );
        // Still mounted while the new Set loads; the install was asked for.
        expect(screen.getByText("the board")).toBeTruthy();
        expect([...installSets.mock.calls[1]![0]]).toEqual(["lea", "arn"]);
    });

    it("names a failed query and retries both subscriptions", async () => {
        rows.set("p1", undefined);
        errors.set("p1", new Error("query timeout"));
        renderGate("p1", ["p1", "p2"]);
        await screen.findByText("query timeout");
        expect(screen.queryByText("the board")).toBeNull();
        screen.getByRole("button", { name: "Retry" }).click();
        expect(retry).toHaveBeenCalledTimes(2);
    });

    it("names a failed load and re-installs on retry", async () => {
        rows.set("p1", { entries: [entry("lea")] });
        installSets.mockRejectedValueOnce(new Error("chunk 503"));
        renderGate("p1", ["p1"]);
        await screen.findByText("chunk 503");
        expect(screen.queryByText("the board")).toBeNull();

        installSets.mockResolvedValueOnce(undefined);
        screen.getByRole("button", { name: "Retry" }).click();
        await screen.findByText("the board");
        expect(installSets).toHaveBeenCalledTimes(2);
    });
});
