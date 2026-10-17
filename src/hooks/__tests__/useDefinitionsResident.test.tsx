import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

/**
 * The board's on-demand hold (issue #5615): a definition the state names
 * whose Set is not resident loads that Set with the board held back, and
 * the board renders once it is — never a throw out of `getDefinition`.
 */

const resident = new Set<string>();
const setBySuffix = (id: string) => id.split(":")[0]!;
const installSets = vi.fn<(codes: Iterable<string>) => Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;
const becameResident = () => {
    version++;
    for (const l of listeners) l();
};
vi.mock("~/lib/catalogue/definitionShards", () => ({
    installShards: installSets,
    residencyVersion: () => version,
    subscribeResidency: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
    },
    // `<set>:<n>` ids; a `tok:` id needs no Set.
    shardsNeededFor: (ids: Iterable<string>) => {
        const out = new Set<string>();
        for (const id of ids) {
            const set = setBySuffix(id);
            if (set !== "tok" && !resident.has(set)) out.add(set);
        }
        return [...out];
    },
}));

const { useDefinitionsResident } = await import("../useDefinitionsResident");

function Probe({ ids }: { ids: string[] | null }) {
    const { ready, error, retry } = useDefinitionsResident(ids);
    if (error)
        return (
            <button type="button" onClick={retry}>
                retry: {error.message}
            </button>
        );
    return <p>{ready ? "ready" : "holding"}</p>;
}

beforeEach(() => {
    resident.clear();
    installSets.mockImplementation(async (codes) => {
        // A chunk arrives later, never within the effect that asked for it.
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (const code of codes) resident.add(code);
        becameResident();
    });
});
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe("useDefinitionsResident", () => {
    it("is ready at once with no state, and with ids whose Sets are resident", () => {
        resident.add("lea");
        const view = render(<Probe ids={null} />);
        expect(screen.getByText("ready")).toBeTruthy();
        view.rerender(<Probe ids={["lea:1", "tok:1"]} />);
        expect(screen.getByText("ready")).toBeTruthy();
        expect(installSets).not.toHaveBeenCalled();
    });

    it("holds on a non-resident Set, installs it once, then is ready", async () => {
        render(<Probe ids={["lea:1", "arn:2", "lea:3"]} />);
        expect(screen.getByText("holding")).toBeTruthy();
        await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
        expect(installSets).toHaveBeenCalledTimes(1);
        expect([...installSets.mock.calls[0]![0]]).toEqual(["lea", "arn"]);
    });

    it("holds again when a later state names a new Set", async () => {
        const view = render(<Probe ids={["lea:1"]} />);
        await screen.findByText("ready");
        view.rerender(<Probe ids={["lea:1", "arn:1"]} />);
        expect(screen.getByText("holding")).toBeTruthy();
        await screen.findByText("ready");
        expect([...installSets.mock.calls[1]![0]]).toEqual(["arn"]);
    });

    it("names a failed load and re-installs on retry", async () => {
        installSets.mockRejectedValueOnce(new Error("chunk 503"));
        render(<Probe ids={["lea:1"]} />);
        await screen.findByText("retry: chunk 503");
        screen.getByRole("button").click();
        await screen.findByText("ready");
        expect(installSets).toHaveBeenCalledTimes(2);
    });
});

describe("useDefinitionsResident — a failure belongs to its own Sets", () => {
    it("reports a failed load only while those Sets are the missing ones", async () => {
        installSets.mockRejectedValueOnce(new Error("chunk 503"));
        const view = render(<Probe ids={["lea:1"]} />);
        await screen.findByText("retry: chunk 503");
        // A later snapshot needing a different Set loads fine: the old
        // failure is not shown over it.
        view.rerender(<Probe ids={["arn:1"]} />);
        await screen.findByText("ready");
        expect(screen.queryByText(/retry:/)).toBeNull();
    });
});
