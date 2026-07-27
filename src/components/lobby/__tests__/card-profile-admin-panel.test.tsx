// CardProfileAdminPanel + CardProfilePanel wiring (PRD #1607, ADR 0072,
// issue #1614): `CardProfileAdminPanel` owns ONLY the admin gate (mirrors
// `PickRatingAdminPanel`/`BanlistAdminPanel`); `CardProfilePanel` — mounted
// only once the gate passes — owns scope selection and the query/mutation
// hooks, handing plain data + callbacks down to the presentational
// `CardProfileEditor` (its own dedicated test,
// `card-profile-editor.test.tsx`, drives the real query-shape rendering).
// convex/react is mocked so this wiring — admin gate, scope switch, mutation
// argument threading, and the admin-gated query never even being CONSTRUCTED
// for a non-admin — is exercised without a live backend.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CardProfileAdminPanel from "../card-profile-admin-panel";

let currentUser: { isAdmin?: boolean } | null | undefined;
const setCardProfile = vi.fn();
const clearCardProfile = vi.fn();
const useQueryCalls: { name: string; args: unknown }[] = [];

const DRAFTABLE_SETS = [
    { setCode: "lea", draftable: true, missingCardCount: 0, sheets: [] },
    { setCode: "ice", draftable: false, missingCardCount: 50, sheets: [] },
    {
        setCode: "vintage-cube",
        draftable: true,
        missingCardCount: 0,
        sheets: [],
        isCube: true,
        availableCardCount: 283,
    },
];

const SEEDED = {
    archetypes: ["reanimator"],
    provides: ["reanimatable"],
    requires: [],
    reviewed: false,
};

const SCOPE_CARDS: Record<string, unknown[]> = {
    lea: [
        {
            cardId: "black-lotus",
            name: "Black Lotus",
            dbProfile: null,
            seedProfile: null,
        },
    ],
    "vintage-cube": [
        {
            cardId: "griselbrand",
            name: "Griselbrand",
            dbProfile: null,
            seedProfile: SEEDED,
        },
        {
            cardId: "sol-ring",
            name: "Sol Ring",
            dbProfile: { ...SEEDED, archetypes: ["artifacts"], reviewed: true },
            seedProfile: SEEDED,
        },
    ],
};

vi.mock("convex/react", () => ({
    useQuery: (query: { _name: string }, args: unknown) => {
        useQueryCalls.push({ name: query._name, args });
        if (query._name === "listLimitedDraftableSets") return DRAFTABLE_SETS;
        if (query._name === "listScopeCardProfilesForEditor") {
            if (args === "skip" || args === undefined) return undefined;
            return SCOPE_CARDS[(args as { scope: string }).scope] ?? [];
        }
        return undefined;
    },
    useMutation: (fn: { _name: string }) => {
        if (fn._name === "setCardProfile") return setCardProfile;
        if (fn._name === "clearCardProfile") return clearCardProfile;
        return vi.fn();
    },
}));

vi.mock("@convex/_generated/api", () => ({
    api: {
        limitedEvents: {
            listLimitedDraftableSets: { _name: "listLimitedDraftableSets" },
        },
        limited: {
            cardProfiles: {
                listScopeCardProfilesForEditor: {
                    _name: "listScopeCardProfilesForEditor",
                },
                setCardProfile: { _name: "setCardProfile" },
                clearCardProfile: { _name: "clearCardProfile" },
            },
        },
    },
}));

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => currentUser,
}));

describe("CardProfileAdminPanel (PRD #1607, issue #1614)", () => {
    beforeEach(() => {
        currentUser = { isAdmin: true };
        setCardProfile.mockReset().mockResolvedValue(null);
        clearCardProfile.mockReset().mockResolvedValue(null);
        useQueryCalls.length = 0;
    });

    it("renders nothing for a non-admin user", () => {
        currentUser = { isAdmin: false };
        const { container } = render(<CardProfileAdminPanel />);
        expect(container.firstChild).toBeNull();
    });

    it("renders nothing while the user is still loading (undefined) or signed out (null)", () => {
        currentUser = undefined;
        expect(
            render(<CardProfileAdminPanel />).container.firstChild
        ).toBeNull();
        currentUser = null;
        expect(
            render(<CardProfileAdminPanel />).container.firstChild
        ).toBeNull();
    });

    it("never even CONSTRUCTS the admin-gated profiles query for a non-admin", () => {
        currentUser = { isAdmin: false };
        render(<CardProfileAdminPanel />);
        expect(
            useQueryCalls.some(
                (c) => c.name === "listScopeCardProfilesForEditor"
            )
        ).toBe(false);
    });

    it("lists only DRAFTABLE scopes and labels its own scope axis", () => {
        render(<CardProfileAdminPanel />);
        expect(
            screen.getByRole("radiogroup", { name: "Profile Scope" })
        ).toBeTruthy();
        expect(screen.getByRole("radio", { name: "LEA" })).toBeTruthy();
        expect(
            screen.getByRole("radio", { name: "Vintage Cube" })
        ).toBeTruthy();
        expect(screen.queryByRole("radio", { name: "ICE" })).toBeNull();
    });

    it("switches the rendered cards when a different scope is selected", () => {
        render(<CardProfileAdminPanel />);
        expect(screen.getByText("Black Lotus")).toBeTruthy();
        fireEvent.click(screen.getByRole("radio", { name: "Vintage Cube" }));
        expect(screen.getByText("Griselbrand")).toBeTruthy();
        expect(screen.queryByText("Black Lotus")).toBeNull();
    });

    it("submits setCardProfile with the CURRENT scope + cardId + edited profile", async () => {
        render(<CardProfileAdminPanel />);
        fireEvent.click(screen.getByRole("radio", { name: "Vintage Cube" }));
        // Rows are name-sorted: Griselbrand, then Sol Ring.
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        fireEvent.click(screen.getByLabelText("Reviewed for Griselbrand"));
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() =>
            expect(setCardProfile).toHaveBeenCalledWith({
                scope: "vintage-cube",
                cardId: "griselbrand",
                archetypes: ["reanimator"],
                provides: ["reanimatable"],
                requires: [],
                comboEdges: undefined,
                reviewed: true,
            })
        );
    });

    it("submits clearCardProfile with the CURRENT scope + cardId for an overridden card", async () => {
        render(<CardProfileAdminPanel />);
        fireEvent.click(screen.getByRole("radio", { name: "Vintage Cube" }));
        // Sol Ring is the only row with a database override, so its Clear is
        // the only enabled one.
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]);
        const clear = screen.getByRole("button", { name: "Clear" });
        expect(clear.hasAttribute("disabled")).toBe(false);
        fireEvent.click(clear);

        await waitFor(() =>
            expect(clearCardProfile).toHaveBeenCalledWith({
                scope: "vintage-cube",
                cardId: "sol-ring",
            })
        );
    });
});
