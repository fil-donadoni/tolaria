// CardProfilesAdminPanel + CardProfilesPage wiring (PRD #1607, ADR 0072,
// issue #1614): `CardProfilesAdminPanel` owns ONLY the admin gate (mirrors
// `PickRatingsAdminPanel`/`BanlistAdminPanel`); `CardProfilesPage` — mounted
// only once the gate passes — owns scope selection and the query/mutation
// hooks, handing plain data + callbacks down to the presentational
// `CardProfilesPage`'s table (its own dedicated test,
// `card-profiles-page.test.tsx`, drives the real query-shape rendering).
// convex/react is mocked so this wiring — admin gate, scope switch, mutation
// argument threading, and the admin-gated query never even being CONSTRUCTED
// for a non-admin — is exercised without a live backend.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ARCHETYPE_CATALOGUE_SEED } from "@convex/limited/archetypeCatalogueCore";
import CardProfilesAdminPanel from "../card-profiles-admin-panel";

let currentUser: { isAdmin?: boolean } | null | undefined;
const setCardCapabilities = vi.fn();
const setCardArchetypes = vi.fn();
const clearCardCapabilities = vi.fn();
const clearCardArchetypes = vi.fn();
const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    setCardCapabilities,
    setCardArchetypes,
    clearCardCapabilities,
    clearCardArchetypes,
};
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
    capabilitiesReviewed: false,
    archetypesReviewed: false,
};

const SCOPE_CARDS: Record<string, unknown[]> = {
    lea: [
        {
            cardId: "black-lotus",
            colours: [],
            name: "Black Lotus",
            dbProfile: null,
            seedProfile: null,
        },
    ],
    "vintage-cube": [
        {
            cardId: "griselbrand",
            colours: ["B"],
            name: "Griselbrand",
            dbProfile: null,
            seedProfile: SEEDED,
        },
        {
            cardId: "sol-ring",
            colours: [],
            name: "Sol Ring",
            dbProfile: {
                ...SEEDED,
                archetypes: ["artifacts"],
                archetypesReviewed: true,
            },
            seedProfile: SEEDED,
        },
    ],
};

/** The effective catalogue `listArchetypeCatalogue` returns: the seed plus
 *  one Admin-created DB row. */
const CATALOGUE = [
    ...ARCHETYPE_CATALOGUE_SEED,
    {
        id: "kicker",
        description:
            "TAG WHEN: the card has kicker. NOT: a card that merely costs a lot (`ramp`).",
        gloss: { when: "Kicker cards.", not: "Expensive cards (ramp)." },
        example: "Lightning Bolt",
    },
];

vi.mock("convex/react", () => ({
    // The rail's Export reads on click (issue #8907); never clicked here.
    useConvex: () => ({ query: vi.fn() }),
    useQuery: (query: { _name: string }, args: unknown) => {
        useQueryCalls.push({ name: query._name, args });
        if (query._name === "listLimitedDraftableSets") return DRAFTABLE_SETS;
        if (query._name === "listArchetypeCatalogue") return CATALOGUE;
        if (query._name === "listScopeCardProfilesForEditor") {
            if (args === "skip" || args === undefined) return undefined;
            return SCOPE_CARDS[(args as { scope: string }).scope] ?? [];
        }
        return undefined;
    },
    useMutation: (fn: { _name: string }) => MUTATIONS[fn._name] ?? vi.fn(),
}));

vi.mock("@convex/_generated/api", () => ({
    api: {
        limitedEvents: {
            listLimitedDraftableSets: { _name: "listLimitedDraftableSets" },
        },
        limited: {
            archetypeCatalogue: {
                listArchetypeCatalogue: { _name: "listArchetypeCatalogue" },
                createArchetypeRow: { _name: "createArchetypeRow" },
                updateArchetypeRow: { _name: "updateArchetypeRow" },
            },
            cardProfiles: {
                listScopeCardProfilesForEditor: {
                    _name: "listScopeCardProfilesForEditor",
                },
                setCardCapabilities: { _name: "setCardCapabilities" },
                setCardArchetypes: { _name: "setCardArchetypes" },
                clearCardCapabilities: { _name: "clearCardCapabilities" },
                clearCardArchetypes: { _name: "clearCardArchetypes" },
            },
        },
    },
}));

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => currentUser,
}));

describe("CardProfilesAdminPanel (PRD #1607, issue #1614)", () => {
    beforeEach(() => {
        currentUser = { isAdmin: true };
        for (const mutation of Object.values(MUTATIONS)) {
            mutation.mockReset().mockResolvedValue(null);
        }
        useQueryCalls.length = 0;
    });

    it("renders nothing for a non-admin user", () => {
        currentUser = { isAdmin: false };
        const { container } = render(<CardProfilesAdminPanel />);
        expect(container.firstChild).toBeNull();
    });

    it("renders nothing while the user is still loading (undefined) or signed out (null)", () => {
        currentUser = undefined;
        expect(
            render(<CardProfilesAdminPanel />).container.firstChild
        ).toBeNull();
        currentUser = null;
        expect(
            render(<CardProfilesAdminPanel />).container.firstChild
        ).toBeNull();
    });

    it("never even CONSTRUCTS the admin-gated profiles query for a non-admin", () => {
        currentUser = { isAdmin: false };
        render(<CardProfilesAdminPanel />);
        expect(
            useQueryCalls.some(
                (c) => c.name === "listScopeCardProfilesForEditor"
            )
        ).toBe(false);
    });

    it("lists only DRAFTABLE scopes and labels its own scope axis", () => {
        render(<CardProfilesAdminPanel />);
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
        render(<CardProfilesAdminPanel />);
        expect(screen.getByText("Black Lotus")).toBeTruthy();
        fireEvent.click(screen.getByRole("radio", { name: "Vintage Cube" }));
        expect(screen.getByText("Griselbrand")).toBeTruthy();
        expect(screen.queryByText("Black Lotus")).toBeNull();
    });

    it("the Archetypes tab saves ONLY the scope's Archetype layer: setCardArchetypes with the CURRENT scope + cardId", async () => {
        render(<CardProfilesAdminPanel />);
        fireEvent.click(screen.getByRole("radio", { name: "Vintage Cube" }));
        // Rows are name-sorted: Griselbrand, then Sol Ring.
        fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0]);
        fireEvent.click(screen.getByLabelText("Reviewed for Griselbrand"));
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() =>
            expect(setCardArchetypes).toHaveBeenCalledWith({
                scope: "vintage-cube",
                cardId: "griselbrand",
                archetypes: ["reanimator"],
                reviewed: true,
            })
        );
        expect(setCardCapabilities).not.toHaveBeenCalled();
    });

    it("the Capabilities tab saves ONLY the scope-free Capability layer: setCardCapabilities, no scope", async () => {
        render(<CardProfilesAdminPanel />);
        fireEvent.click(screen.getByRole("radio", { name: "Capabilities" }));
        fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0]);
        fireEvent.click(screen.getByLabelText("Reviewed for Griselbrand"));
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() =>
            expect(setCardCapabilities).toHaveBeenCalledWith({
                cardId: "griselbrand",
                provides: ["reanimatable"],
                requires: [],
                comboEdges: undefined,
                reviewed: true,
            })
        );
        expect(setCardArchetypes).not.toHaveBeenCalled();
    });

    it("offers an Archetype row that exists only in the DB catalogue — no code change", () => {
        render(<CardProfilesAdminPanel />);
        fireEvent.click(screen.getByRole("radio", { name: "Vintage Cube" }));
        fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0]);
        expect(
            screen.getByLabelText("Archetype kicker for Griselbrand")
        ).toBeTruthy();
    });

    it("clears the Archetype layer with the CURRENT scope + cardId for an overridden card", async () => {
        render(<CardProfilesAdminPanel />);
        fireEvent.click(screen.getByRole("radio", { name: "Vintage Cube" }));
        // Sol Ring is the only row with a database override, so its Clear is
        // the only enabled one.
        fireEvent.click(screen.getAllByRole("button", { name: "Open" })[1]);
        const clear = screen.getByRole("button", { name: "Clear" });
        expect(clear.hasAttribute("disabled")).toBe(false);
        fireEvent.click(clear);

        await waitFor(() =>
            expect(clearCardArchetypes).toHaveBeenCalledWith({
                scope: "vintage-cube",
                cardId: "sol-ring",
            })
        );
        expect(clearCardCapabilities).not.toHaveBeenCalled();
    });
});
