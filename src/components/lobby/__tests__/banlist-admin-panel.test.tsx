import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";
import BanlistAdminPanel from "../banlist-admin-panel";

// BanlistAdminPanel (PRD #1138 User Stories 5-9, issue #1146). convex/react
// is mocked so the component's wiring — admin gating, per-format counts +
// last-synced display, pending-disable, added/removed summary — is exercised
// without a live backend, mirroring `bug-report-dialog.test.tsx`'s pattern.

let currentUser: { isAdmin?: boolean } | null | undefined;
const syncBanlist = vi.fn();

type BanlistEntry = {
    cardName: string;
    status: "banned" | "restricted";
    scryfallId?: string;
};
type BanlistMeta = { syncedAt: number | null; source: string | null };

const BANLIST_ENTRIES: Record<string, BanlistEntry[]> = {
    premodern: [
        { cardName: "Balance", status: "banned" },
        { cardName: "Recall", status: "banned" },
    ],
    "old-school": [
        // Amulet of Quoz — never built in our engine — carries a synced
        // scryfallId, so its tile renders the Scryfall image (PRD #1138
        // image follow-up).
        {
            cardName: "Amulet of Quoz",
            status: "banned",
            scryfallId: "amulet-sid",
        },
        { cardName: "Time Walk", status: "restricted" },
    ],
};

const BANLIST_META: Record<string, BanlistMeta> = {
    premodern: { syncedAt: null, source: null },
    "old-school": { syncedAt: 1700000000000, source: "scryfall" },
};

vi.mock("convex/react", () => ({
    useQuery: (query: { _name: string }, args: { format: string }) => {
        if (query._name === "getBanlist") return BANLIST_ENTRIES[args.format];
        if (query._name === "getBanlistMeta") return BANLIST_META[args.format];
        return undefined;
    },
    useAction: () => syncBanlist,
}));

vi.mock("@convex/_generated/api", () => ({
    api: {
        banlists: {
            getBanlist: { _name: "getBanlist" },
            getBanlistMeta: { _name: "getBanlistMeta" },
        },
        banlistSync: {
            syncBanlist: { _name: "syncBanlist" },
        },
    },
}));

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => currentUser,
}));

describe("BanlistAdminPanel (issue #1146)", () => {
    beforeEach(() => {
        currentUser = { isAdmin: true };
        syncBanlist.mockReset();
        syncBanlist.mockResolvedValue({ added: [], removed: [] });
    });

    it("renders nothing for a non-admin user", () => {
        currentUser = { isAdmin: false };
        const { container } = render(<BanlistAdminPanel />);
        expect(container.firstChild).toBeNull();
    });

    it("renders nothing while the user is still loading (undefined)", () => {
        currentUser = undefined;
        const { container } = render(<BanlistAdminPanel />);
        expect(container.firstChild).toBeNull();
    });

    it("renders nothing when signed out (null)", () => {
        currentUser = null;
        const { container } = render(<BanlistAdminPanel />);
        expect(container.firstChild).toBeNull();
    });

    it("shows per-format banned/restricted counts for an admin", () => {
        const { getByText } = render(<BanlistAdminPanel />);
        expect(getByText("Premodern")).toBeTruthy();
        expect(getByText("Old School")).toBeTruthy();
        expect(getByText("2 banned, 0 restricted")).toBeTruthy();
        expect(getByText("1 banned, 1 restricted")).toBeTruthy();
    });

    it("shows a never-synced state and a last-synced timestamp per format", () => {
        const { getByText } = render(<BanlistAdminPanel />);
        expect(getByText("Never synced (showing seed data)")).toBeTruthy();
        expect(
            getByText(`Last synced ${new Date(1700000000000).toLocaleString()}`)
        ).toBeTruthy();
    });

    it("disables the Sync button for the row being synced while pending, and leaves the other row untouched", async () => {
        let resolveSync: (value: {
            added: string[];
            removed: string[];
        }) => void = () => {};
        syncBanlist.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveSync = resolve;
                })
        );
        const { getAllByText } = render(<BanlistAdminPanel />);
        const buttons = getAllByText("Sync from Scryfall").map(
            (el) => el.closest("button") as HTMLButtonElement
        );
        expect(buttons).toHaveLength(2);
        fireEvent.click(buttons[0]);

        await waitFor(() =>
            expect(getAllByText("Syncing…").length).toBeGreaterThan(0)
        );
        const pendingButton = getAllByText("Syncing…")[0].closest(
            "button"
        ) as HTMLButtonElement;
        expect(pendingButton.disabled).toBe(true);
        // The other (Old School) row's Sync button is untouched.
        expect(getAllByText("Sync from Scryfall")).toHaveLength(1);
        expect(buttons[1].disabled).toBe(false);

        resolveSync({ added: ["New Ban"], removed: [] });
        await waitFor(() =>
            expect(getAllByText("Sync from Scryfall")).toHaveLength(2)
        );
    });

    it("shows the added/removed summary after a resolved sync", async () => {
        syncBanlist.mockResolvedValue({
            added: ["Card A", "Card B"],
            removed: ["Card C"],
        });
        const { getAllByText, findByText } = render(<BanlistAdminPanel />);
        const button = getAllByText("Sync from Scryfall")[0].closest(
            "button"
        ) as HTMLButtonElement;
        fireEvent.click(button);

        expect(await findByText("Added 2, removed 1.")).toBeTruthy();
        expect(syncBanlist).toHaveBeenCalledWith({ format: "premodern" });
    });

    it("surfaces a sync error without crashing", async () => {
        syncBanlist.mockRejectedValue(new Error("Forbidden: admin only"));
        const { getAllByText, findByText } = render(<BanlistAdminPanel />);
        const button = getAllByText("Sync from Scryfall")[0].closest(
            "button"
        ) as HTMLButtonElement;
        fireEvent.click(button);

        expect(await findByText("Forbidden: admin only")).toBeTruthy();
    });

    it("opens a dialog with the format's banned + restricted card piles when View cards is clicked", async () => {
        const { getAllByText } = render(<BanlistAdminPanel />);
        const viewButtons = getAllByText("View cards").map(
            (el) => el.closest("button") as HTMLButtonElement
        );
        // One per DB-backed format (Premodern, Old School).
        expect(viewButtons).toHaveLength(2);

        // Open the Old School pile: 1 banned (Amulet of Quoz), 1 restricted
        // (Time Walk). The dialog renders into a portal, so assert via `screen`.
        fireEvent.click(viewButtons[1]);
        expect(await screen.findByText("Old School banlist")).toBeTruthy();
        expect(screen.getByText("Banned (1)")).toBeTruthy();
        expect(screen.getByText("Restricted (1)")).toBeTruthy();
        // Each card name appears (tile caption) — assert presence, not count.
        expect(screen.getAllByText("Amulet of Quoz").length).toBeGreaterThan(0);
        expect(screen.getAllByText("Time Walk").length).toBeGreaterThan(0);
    });

    it("renders the Scryfall image for a banlist card with no CardDefinition (PRD #1138 image follow-up)", async () => {
        const { getAllByText } = render(<BanlistAdminPanel />);
        // Old School row holds Amulet of Quoz — never built, but synced with a
        // scryfallId, so its tile must show the Scryfall image, not a name
        // placeholder.
        fireEvent.click(getAllByText("View cards")[1].closest("button")!);
        const img = (await screen.findByRole("img", {
            name: "Amulet of Quoz",
        })) as HTMLImageElement;
        expect(img.getAttribute("src")).toContain("amulet-sid");
    });
});
