// Card Profile Admin editor surface (PRD #1607, ADR 0072, issues #1614 and
// #3597). Drives the editor through the REAL query-projection pure functions
// (`listScopeCards` + `buildScopeCardProfiles` over the real checked-in
// census) rather than a hand-built `ScopeCardProfile` stub — the same
// discipline `pick-rating-editor.test.tsx` states: a synthetic view can't
// catch a field the projection drops.
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement } from "react";
import {
    render,
    screen,
    fireEvent,
    waitFor,
    within,
} from "@testing-library/react";
import {
    buildCardProfileRows,
    buildDbProfileLayers,
    buildScopeCardProfiles,
    EMPTY_PROFILE_LAYERS,
    type ProfileLayers,
} from "@convex/limited/cardProfilesCore";
import { listScopeCards } from "@convex/limited/cardRatingsCore";
import { CUBE_SOURCE_KEY } from "@convex/limited/cube";
import { CAPABILITY_REGISTRY } from "@convex/limited/capabilityRegistry";
import { ARCHETYPE_CATALOGUE_SEED } from "@convex/limited/archetypeCatalogueCore";
import { tryGetCardByName } from "@convex/cards";
import CardProfilesPage from "../card-profiles-page";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";

// The page reads its data through three hooks; they are the seam, so the
// rows each test passes are the REAL `listScopeCardProfilesForEditor`
// projection and the page is driven exactly as the route drives it.
const page = vi.hoisted(() => ({
    cards: undefined as unknown,
    onSave: undefined as unknown as (
        cardId: string,
        profile: unknown
    ) => Promise<unknown>,
    onClear: undefined as unknown as (cardId: string) => Promise<unknown>,
    catalogue: null as unknown,
    scopesAsked: [] as (string | undefined)[],
    exports: [] as [string, string | undefined][],
    downloads: [] as [string, string][],
}));

vi.mock("~/lib/downloadTextFile", () => ({
    downloadTextFile: (fileName: string, text: string) => {
        page.downloads.push([fileName, text]);
    },
}));

vi.mock("~/hooks/useLimitedEvent", () => ({
    useDraftableSets: () => [
        { setCode: "lea", draftable: true, missingCardCount: 0, sheets: [] },
        {
            setCode: "vintage-cube",
            draftable: true,
            missingCardCount: 0,
            sheets: [],
            isCube: true,
            availableCardCount: 283,
        },
    ],
}));

vi.mock("~/hooks/useCardProfiles", async () => {
    const { ARCHETYPE_CATALOGUE_SEED: seed } =
        await import("@convex/limited/archetypeCatalogueCore");
    return {
        useScopeCardProfiles: (scope: string | undefined) => {
            page.scopesAsked.push(scope);
            return page.cards;
        },
        useArchetypeCatalogue: () => page.catalogue ?? seed,
        // The export query's handler, minus `ctx`: the REAL seed-file
        // builders over the checked-in seed with no DB override.
        useCardProfileExport: () => {
            return async (layer: string, scope: string | undefined) => {
                page.exports.push([layer, scope]);
                const core = await import("@convex/limited/cardProfilesCore");
                const files =
                    await import("@convex/limited/cardProfileSeedFiles");
                const seedFile =
                    layer === "capabilities"
                        ? {
                              layer: "capabilities" as const,
                              file: files.buildCapabilityExportFile(
                                  core.getCardCapabilityFile(),
                                  []
                              ),
                          }
                        : {
                              layer: "archetypes" as const,
                              file: files.buildArchetypeExportFile(
                                  scope ?? "",
                                  core.getCardArchetypeFile(scope ?? ""),
                                  []
                              ),
                          };
                return {
                    fileName: files.seedFileName(seedFile),
                    text: files.serializeSeedFile(seedFile),
                };
            };
        },
        useCardProfileMutations: () => ({
            setProfile: (args: { cardId: string; scope: string }) => {
                const { cardId, scope, ...profile } = args;
                void scope;
                return page.onSave(cardId, profile);
            },
            clearProfile: ({ cardId }: { cardId: string }) =>
                page.onClear(cardId),
        }),
    };
});

function setPage(
    cards: ScopeCardProfile[] | undefined,
    onSave: unknown,
    onClear: unknown
) {
    page.cards = cards;
    page.onSave = onSave as typeof page.onSave;
    page.onClear = onClear as typeof page.onClear;
}

function renderPage(
    cards: ScopeCardProfile[] | undefined,
    onSave: unknown,
    onClear: unknown
) {
    setPage(cards, onSave, onClear);
    return render(<CardProfilesPage />);
}

function rerenderPage(
    rerender: (ui: ReactElement) => void,
    cards: ScopeCardProfile[] | undefined,
    onSave: unknown,
    onClear: unknown
) {
    setPage(cards, onSave, onClear);
    rerender(<CardProfilesPage />);
}

function renderPageOnCapabilities() {
    renderPage(cubeRows(), vi.fn(), vi.fn());
    fireEvent.click(screen.getByRole("radio", { name: "Capabilities" }));
}

/** Tick one option of a MultiCombobox filter (Status, Archetype, …). */
function pickFilter(filter: string, option: string) {
    // The filter's trigger, not the column header of the same name.
    const trigger = screen
        .getAllByRole("button", { name: new RegExp(`^${filter}`) })
        .find((button) => button.hasAttribute("aria-expanded"));
    if (!trigger) throw new Error(`no ${filter} filter`);
    if (!screen.queryByRole("option", { name: option }))
        fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: option }));
}

afterEach(() => {
    page.catalogue = null;
    page.scopesAsked = [];
});

const SAMPLE = [
    "Worldspine Wurm",
    "Griselbrand",
    "Reanimate",
    "Lightning Bolt",
] as const;

function cardId(name: string): string {
    const def = tryGetCardByName(name);
    if (!def) throw new Error(`test fixture: no card named "${name}"`);
    return def.id;
}

/** The DB layers the given editor saves leave behind. */
function dbAfterSaves(
    ...saves: ReturnType<typeof buildCardProfileRows>[]
): ProfileLayers {
    return buildDbProfileLayers({
        capabilities: saves.map((save) => save.capabilities),
        archetypes: saves.map((save) => save.archetypes),
    });
}

/** A handful of real cube cards, projected through the REAL editor-query
 *  core against the REAL census seed. `db` layers whatever database
 *  overrides the test wants on top. */
function cubeRows(
    db: ProfileLayers = EMPTY_PROFILE_LAYERS
): ScopeCardProfile[] {
    const wanted = new Set<string>(SAMPLE.map(cardId));
    const cards = listScopeCards(CUBE_SOURCE_KEY).filter((card) =>
        wanted.has(card.cardId)
    );
    return buildScopeCardProfiles(CUBE_SOURCE_KEY, cards, db).sort((a, b) =>
        a.name.localeCompare(b.name)
    );
}

describe("CardProfilesPage (issue #1614)", () => {
    it("renders a loading state while the query is in flight", () => {
        renderPage(undefined, vi.fn(), vi.fn());
        expect(screen.getByText("Loading…")).toBeTruthy();
    });

    it("shows the census seed as the effective profile, flagged Unreviewed", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        expect(screen.getByText("Worldspine Wurm")).toBeTruthy();
        // Every census row lands unreviewed — the reviewer's whole queue.
        expect(screen.getAllByText("Unreviewed").length).toBe(SAMPLE.length);
    });

    it("surfaces the census verdict per card — Worldspine Wurm's value-on-death, and no reanimatable", () => {
        renderPageOnCapabilities();
        const row = screen.getByText("Worldspine Wurm").closest("tr");
        expect(row?.textContent).toContain("value-on-death");
        expect(row?.textContent).not.toContain("reanimatable");
    });

    it("'the Unreviewed status filter' hides a row an Admin has already reviewed", () => {
        const reviewedRow = buildCardProfileRows(
            CUBE_SOURCE_KEY,
            cardId("Griselbrand"),
            {
                archetypes: ["reanimator"],
                provides: ["reanimatable"],
                requires: [],
                reviewed: true,
            }
        );
        renderPage(cubeRows(dbAfterSaves(reviewedRow)), vi.fn(), vi.fn());
        expect(screen.getByText("Griselbrand")).toBeTruthy();
        pickFilter("Status", "Unreviewed");
        expect(screen.queryByText("Griselbrand")).toBeNull();
        expect(screen.getByText("Worldspine Wurm")).toBeTruthy();
    });

    it("filters by card name", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        fireEvent.change(screen.getByLabelText("Search cards"), {
            target: { value: "grisel" },
        });
        expect(screen.getByText("Griselbrand")).toBeTruthy();
        expect(screen.queryByText("Reanimate")).toBeNull();
    });

    it("only offers Capability names from the closed registry", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        for (const row of CAPABILITY_REGISTRY) {
            expect(
                screen.getByLabelText(`Provides ${row.id}`),
                row.id
            ).toBeTruthy();
            expect(
                screen.getByLabelText(`Requires ${row.id}`),
                row.id
            ).toBeTruthy();
        }
    });

    it("saves an Admin's correction — archetypes, Capabilities and the review flag", async () => {
        const onSave = vi.fn().mockResolvedValue(null);
        renderPage(cubeRows(), onSave, vi.fn());
        // Rows are name-sorted; Griselbrand is the first of the four.
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        fireEvent.click(
            screen.getByLabelText("Archetype control for Griselbrand")
        );
        fireEvent.click(screen.getByLabelText("Requires value-on-etb"));
        fireEvent.click(screen.getByLabelText("Reviewed for Griselbrand"));
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave).toHaveBeenCalledWith(cardId("Griselbrand"), {
            // The census seeds Griselbrand `["reanimator"]`; the click adds
            // `control` to it rather than replacing a typed string.
            archetypes: ["reanimator", "control"],
            provides: ["reanimatable"],
            requires: ["value-on-etb"],
            comboEdges: undefined,
            reviewed: true,
        });
    });

    it("Clear is disabled until there is a database override to clear", () => {
        const override = buildCardProfileRows(
            CUBE_SOURCE_KEY,
            cardId("Griselbrand"),
            {
                archetypes: [],
                provides: [],
                requires: [],
                reviewed: true,
            }
        );
        const { rerender } = renderPage(cubeRows(), vi.fn(), vi.fn());
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        expect(
            screen
                .getByRole("button", { name: "Clear" })
                .hasAttribute("disabled")
        ).toBe(true);

        rerenderPage(
            rerender,
            cubeRows(dbAfterSaves(override)),
            vi.fn(),
            vi.fn()
        );
        expect(
            screen
                .getByRole("button", { name: "Clear" })
                .hasAttribute("disabled")
        ).toBe(false);
    });
});

describe("CardProfilesPage — shaped for the review pass (issue #3597)", () => {
    it("only offers Archetype names from the catalogue — no free-text field", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        for (const row of ARCHETYPE_CATALOGUE_SEED) {
            expect(
                screen.getByLabelText(`Archetype ${row.id} for Griselbrand`),
                row.id
            ).toBeTruthy();
        }
        // The comma-separated text field this editor shipped with is the one
        // control that could mint vocabulary by typing. It must be gone, not
        // merely supplemented.
        expect(
            screen.queryByLabelText("Archetypes for Griselbrand")
        ).toBeNull();
    });

    it("shows progress against the scope, counting the WHOLE scope, not the filtered view", () => {
        const reviewedRow = buildCardProfileRows(
            CUBE_SOURCE_KEY,
            cardId("Griselbrand"),
            {
                archetypes: ["reanimator"],
                provides: ["reanimatable"],
                requires: [],
                reviewed: true,
            }
        );
        renderPage(cubeRows(dbAfterSaves(reviewedRow)), vi.fn(), vi.fn());
        const bar = screen.getByRole("progressbar", {
            name: "Human review pass",
        });
        expect(bar.getAttribute("aria-valuenow")).toBe("1");
        expect(bar.getAttribute("aria-valuemax")).toBe(String(SAMPLE.length));
        expect(screen.getByText(/1 of 4 \(25%\)/)).toBeTruthy();

        // Hiding the done rows must not move the denominator — that is the
        // whole point of measuring the scope rather than the list.
        pickFilter("Status", "Unreviewed");
        expect(
            screen
                .getByRole("progressbar", { name: "Human review pass" })
                .getAttribute("aria-valuemax")
        ).toBe(String(SAMPLE.length));
        expect(screen.getByText(/1 of 4 \(25%\)/)).toBeTruthy();
    });

    it("shows each card's art, and its rules text once the row is open", () => {
        const { container } = renderPage(cubeRows(), vi.fn(), vi.fn());
        // One art slot per row, addressed by cardId — happy-dom has no layout
        // so the `<img>` inside is not asserted here; `bun run check:ui` is
        // what measures whether it actually paints.
        expect(
            container.querySelectorAll("[data-card-profile-art]").length
        ).toBe(SAMPLE.length);
        expect(
            container.querySelector(
                `[data-card-profile-art="${cardId("Griselbrand")}"]`
            )
        ).toBeTruthy();

        // Rules text is behind the expansion, where the judgement is made.
        expect(screen.queryByText(/Pay 7 life/)).toBeNull();
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        expect(screen.getByText(/Pay 7 life/)).toBeTruthy();
    });

    it("states the provides/requires distinction, and that an empty Requires is normal", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        expect(screen.getByText(/what a card OFFERS a partner/)).toBeTruthy();
        expect(screen.getByText(/what it NEEDS from one/)).toBeTruthy();
        expect(screen.getByText(/An empty Requires is the norm/)).toBeTruthy();
    });

    it("'Mark reviewed & next' saves the row reviewed and opens the following card", async () => {
        const onSave = vi.fn().mockResolvedValue(null);
        renderPage(cubeRows(), onSave, vi.fn());
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        expect(
            screen.getByRole("group", { name: "Profile for Griselbrand" })
        ).toBeTruthy();

        fireEvent.click(
            screen.getByRole("button", { name: "Mark reviewed & next" })
        );
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][0]).toBe(cardId("Griselbrand"));
        expect(onSave.mock.calls[0][1].reviewed).toBe(true);

        // Name-sorted queue: Lightning Bolt is next, and it is now the open
        // row — the pass never has to point at anything.
        await waitFor(() =>
            expect(
                screen.getByRole("group", {
                    name: "Profile for Lightning Bolt",
                })
            ).toBeTruthy()
        );
        expect(
            screen.queryByRole("group", { name: "Profile for Griselbrand" })
        ).toBeNull();
    });

    it("⌘/Ctrl+Enter inside an open row does the same thing from the keyboard", async () => {
        const onSave = vi.fn().mockResolvedValue(null);
        renderPage(cubeRows(), onSave, vi.fn());
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        fireEvent.keyDown(
            screen.getByRole("group", { name: "Profile for Griselbrand" }),
            { key: "Enter", metaKey: true }
        );
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][1].reviewed).toBe(true);
        await waitFor(() =>
            expect(
                screen.getByRole("group", {
                    name: "Profile for Lightning Bolt",
                })
            ).toBeTruthy()
        );
    });

    it("a REJECTED save leaves the reviewer on the card, with the error", async () => {
        const onSave = vi.fn().mockRejectedValue(new Error("nope"));
        renderPage(cubeRows(), onSave, vi.fn());
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        fireEvent.click(
            screen.getByRole("button", { name: "Mark reviewed & next" })
        );
        await waitFor(() => expect(screen.getByText("nope")).toBeTruthy());
        expect(
            screen.getByRole("group", { name: "Profile for Griselbrand" })
        ).toBeTruthy();
        expect(
            screen.queryByRole("group", { name: "Profile for Lightning Bolt" })
        ).toBeNull();
    });

    it("is a single-open accordion — opening one row closes the other", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        const editButtons = screen.getAllByRole("button", { name: "Edit" });
        fireEvent.click(editButtons[0]);
        expect(
            screen.getByRole("group", { name: "Profile for Griselbrand" })
        ).toBeTruthy();
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        expect(
            screen.getByRole("group", { name: "Profile for Lightning Bolt" })
        ).toBeTruthy();
        expect(
            screen.queryByRole("group", { name: "Profile for Griselbrand" })
        ).toBeNull();
    });
});

describe("CardProfilesPage — review findings (issue #3597)", () => {
    it("re-seeds a reopened row from the stored profile, never from abandoned edits", () => {
        // The row no longer unmounts when it closes (the editor owns `open`),
        // so without an explicit re-seed the local picker state survived
        // being navigated away from — and "Mark reviewed & next" then wrote
        // those abandoned values and flagged the row reviewed.
        renderPage(cubeRows(), vi.fn(), vi.fn());
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        const control = screen.getByLabelText(
            "Archetype control for Griselbrand"
        );
        expect(control.getAttribute("aria-checked")).toBe("false");
        fireEvent.click(control);
        expect(
            screen
                .getByLabelText("Archetype control for Griselbrand")
                .getAttribute("aria-checked")
        ).toBe("true");

        // Navigate away (opening another row closes this one), then back.
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        // Griselbrand is name-first, so it is still the FIRST collapsed row.
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        expect(
            screen
                .getByLabelText("Archetype control for Griselbrand")
                .getAttribute("aria-checked")
        ).toBe("false");
    });

    it("shows a STORED archetype the catalogue does not have, and lets it be removed", async () => {
        // Closing a vocabulary that was open for a release cannot assume the
        // stored rows obey it: a profile written through the old free-text
        // field carries a name the catalogue lacks. Rendered nowhere, it
        // would still be submitted — and rejected server-side — naming a
        // string the reviewer could neither see nor untick.
        const legacy = buildCardProfileRows(
            CUBE_SOURCE_KEY,
            cardId("Griselbrand"),
            {
                archetypes: ["cheat-into-play"],
                provides: ["reanimatable"],
                requires: [],
                reviewed: false,
            }
        );
        const onSave = vi.fn().mockResolvedValue(null);
        renderPage(cubeRows(dbAfterSaves(legacy)), onSave, vi.fn());
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        const stray = screen.getByLabelText(
            "Unregistered archetype cheat-into-play for Griselbrand"
        ) as HTMLInputElement;
        expect(stray.getAttribute("aria-checked")).toBe("true");

        fireEvent.click(stray);
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][1].archetypes).toEqual([]);
    });

    it("treats a stored archetype from a DB catalogue row as a catalogue row, not a stray", () => {
        const kicker = {
            id: "kicker",
            description:
                "TAG WHEN: the card has kicker. NOT: a card that merely costs a lot (`ramp`).",
            gloss: { when: "Kicker cards.", not: "Expensive cards (ramp)." },
            example: "Lightning Bolt",
        };
        const tagged = buildCardProfileRows(
            CUBE_SOURCE_KEY,
            cardId("Griselbrand"),
            {
                archetypes: ["kicker"],
                provides: [],
                requires: [],
                reviewed: false,
            }
        );
        page.catalogue = [...ARCHETYPE_CATALOGUE_SEED, kicker];
        renderPage(cubeRows(dbAfterSaves(tagged)), vi.fn(), vi.fn());
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        const row = screen.getByLabelText("Archetype kicker for Griselbrand");
        expect(row.getAttribute("aria-checked")).toBe("true");
        expect(
            screen.queryByLabelText(
                "Unregistered archetype kicker for Griselbrand"
            )
        ).toBeNull();
    });

    it("hands focus back to the toggle when a row closes, and wires aria-controls", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        const toggle = screen.getAllByRole("button", { name: "Edit" })[0];
        const toggleId = toggle.id;
        expect(toggleId).not.toBe("");
        const panelId = toggle.getAttribute("aria-controls");
        expect(panelId).toBeTruthy();

        fireEvent.click(toggle);
        const panel = screen.getByRole("group", {
            name: "Profile for Griselbrand",
        });
        expect(panel.id).toBe(panelId);
        expect(document.activeElement).toBe(panel);

        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        // Not `<body>`: a keyboard reviewer mid-pass must not be returned to
        // the top of the document on the next Tab.
        expect((document.activeElement as HTMLElement | null)?.id).toBe(
            toggleId
        );
    });

    it("advances correctly with 'the Unreviewed status filter' on, including after the saved row leaves the list", async () => {
        const onSave = vi.fn().mockResolvedValue(null);
        const { rerender } = renderPage(cubeRows(), onSave, vi.fn());
        pickFilter("Status", "Unreviewed");
        fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        fireEvent.click(
            screen.getByRole("button", { name: "Mark reviewed & next" })
        );
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        await waitFor(() =>
            expect(
                screen.getByRole("group", {
                    name: "Profile for Lightning Bolt",
                })
            ).toBeTruthy()
        );

        // The reactive query now lands the saved row as reviewed, and the
        // filter drops it — the successor must stay open through that.
        const saved = buildCardProfileRows(
            CUBE_SOURCE_KEY,
            cardId("Griselbrand"),
            {
                archetypes: ["reanimator"],
                provides: ["reanimatable"],
                requires: [],
                reviewed: true,
            }
        );
        rerenderPage(rerender, cubeRows(dbAfterSaves(saved)), onSave, vi.fn());
        expect(
            screen.getByRole("group", { name: "Profile for Lightning Bolt" })
        ).toBeTruthy();
    });
});

describe("CardProfilesPage — the desktop tool (issue #8903)", () => {
    function cardOrder(): string[] {
        return screen
            .getAllByRole("row")
            .slice(1)
            .map((row) => row.querySelector("span.text-sm")?.textContent ?? "")
            .filter(Boolean);
    }

    it("sorts on every column of the tab, and a second click reverses", () => {
        renderPageOnCapabilities();
        for (const label of ["Status", "Provides", "Requires"]) {
            const head = screen.getByRole("columnheader", { name: label });
            expect(head.getAttribute("aria-sort"), label).toBe("none");
        }
        const card = () => screen.getByRole("columnheader", { name: "Card" });
        expect(card().getAttribute("aria-sort")).toBe("ascending");
        fireEvent.click(within(card()).getByRole("button"));
        expect(card().getAttribute("aria-sort")).toBe("descending");
        expect(cardOrder()).toEqual(
            [...cardOrder()].sort((a, b) => b.localeCompare(a))
        );

        const provides = screen.getByRole("columnheader", {
            name: "Provides",
        });
        fireEvent.click(within(provides).getByRole("button"));
        expect(provides.getAttribute("aria-sort")).toBe("ascending");
        expect(card().getAttribute("aria-sort")).toBe("none");
    });

    it("the Archetypes tab shows the Archetypes column only, the Capabilities tab Provides and Requires", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        expect(
            screen.getByRole("columnheader", { name: "Archetypes" })
        ).toBeTruthy();
        expect(
            screen.queryByRole("columnheader", { name: "Provides" })
        ).toBeNull();
        fireEvent.click(screen.getByRole("radio", { name: "Capabilities" }));
        expect(
            screen.getByRole("columnheader", { name: "Provides" })
        ).toBeTruthy();
        expect(
            screen.getByRole("columnheader", { name: "Requires" })
        ).toBeTruthy();
        expect(
            screen.queryByRole("columnheader", { name: "Archetypes" })
        ).toBeNull();
    });

    it("the Capabilities tab has no scope — no rail, the catalogue-wide cube; Archetypes asks for its rail's scope", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        expect(
            screen.getByRole("radiogroup", { name: "Profile Scope" })
        ).toBeTruthy();
        fireEvent.click(screen.getByRole("radio", { name: "Capabilities" }));
        expect(
            screen.queryByRole("radiogroup", { name: "Profile Scope" })
        ).toBeNull();
        expect(screen.queryByLabelText("Scope rail")).toBeNull();
        expect(page.scopesAsked.at(-1)).toBe("vintage-cube");
        // Back on Archetypes the rail's first scope is asked for instead.
        fireEvent.click(screen.getByRole("radio", { name: "Archetypes" }));
        expect(page.scopesAsked.at(-1)).toBe("lea");
    });

    it("the rail collapses to its toggle and expands again", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        expect(
            screen.getByRole("progressbar", { name: "Human review pass" })
        ).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Collapse rail" }));
        expect(screen.queryByRole("progressbar")).toBeNull();
        expect(
            screen.queryByRole("radiogroup", { name: "Profile Scope" })
        ).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Expand rail" }));
        expect(
            screen.getByRole("radiogroup", { name: "Profile Scope" })
        ).toBeTruthy();
    });

    it("filters OR within one filter and AND across filters", () => {
        // Griselbrand: reviewed, reanimator. Everything else: seeded, unreviewed.
        const reviewed = buildCardProfileRows(
            CUBE_SOURCE_KEY,
            cardId("Griselbrand"),
            {
                archetypes: ["reanimator"],
                provides: ["reanimatable"],
                requires: [],
                reviewed: true,
            }
        );
        renderPage(cubeRows(dbAfterSaves(reviewed)), vi.fn(), vi.fn());

        pickFilter("Archetype", "reanimator");
        const reanimator = cardOrder();
        expect(reanimator).toContain("Griselbrand");
        expect(reanimator).not.toContain("Lightning Bolt");

        // OR within: adding a second archetype only widens the list.
        const second = ARCHETYPE_CATALOGUE_SEED.map((row) => row.id).find(
            (id) => id !== "reanimator"
        ) as string;
        pickFilter("Archetype", second);
        expect(cardOrder().length).toBeGreaterThanOrEqual(reanimator.length);
        expect(cardOrder()).toEqual(expect.arrayContaining(reanimator));

        // AND across: Status = Unreviewed removes the reviewed Griselbrand.
        pickFilter("Status", "Unreviewed");
        expect(cardOrder()).not.toContain("Griselbrand");
        expect(cardOrder()).toEqual(
            expect.arrayContaining(
                reanimator.filter((n) => n !== "Griselbrand")
            )
        );
    });

    it("a catalogue row of the rail filters the table to it", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        fireEvent.click(screen.getByRole("button", { name: /^reanimator\d/ }));
        expect(cardOrder()).toContain("Griselbrand");
        expect(cardOrder()).not.toContain("Lightning Bolt");
    });
});

describe("CardProfilesPage — the sweep board (issue #8905)", () => {
    function lane(name: string) {
        return within(screen.getByRole("region", { name }));
    }

    function laneCards(name: string): string[] {
        return lane(name)
            .queryAllByRole("checkbox")
            .map((box) =>
                (box.getAttribute("aria-label") ?? "").replace(/^.* for /, "")
            )
            .sort();
    }

    /** Cards the fixture carries as reanimator, read straight off the rows. */
    function reanimatorCards(cards: ScopeCardProfile[]) {
        return cards.filter((card) =>
            (card.dbProfile ?? card.seedProfile)?.archetypes.includes(
                "reanimator"
            )
        );
    }

    it("opens from the rail's catalogue row in three lanes computed from the layer rows", () => {
        const reviewed = buildCardProfileRows(
            CUBE_SOURCE_KEY,
            cardId("Griselbrand"),
            {
                archetypes: ["reanimator"],
                provides: ["reanimatable"],
                requires: [],
                reviewed: true,
            }
        );
        const cards = cubeRows(dbAfterSaves(reviewed));
        renderPage(cards, vi.fn(), vi.fn());
        fireEvent.click(
            screen.getByRole("button", { name: "Sweep reanimator" })
        );

        expect(screen.queryByRole("table")).toBeNull();
        expect(laneCards("Tagged · reviewed")).toEqual(["Griselbrand"]);
        const proposed = reanimatorCards(cards)
            .filter((card) => card.name !== "Griselbrand")
            .map((card) => card.name)
            .sort();
        expect(laneCards("Proposed by the census")).toEqual(proposed);
        expect(laneCards("Not tagged")).toContain("Lightning Bolt");

        fireEvent.click(screen.getByRole("button", { name: "Back to table" }));
        expect(screen.getByRole("table")).toBeTruthy();
    });

    it("a tile's toggle writes the row into the Archetype layer only", async () => {
        const onSave = vi.fn().mockResolvedValue(null);
        const cards = cubeRows();
        renderPage(cards, onSave, vi.fn());
        fireEvent.click(
            screen.getByRole("button", { name: "Sweep reanimator" })
        );
        fireEvent.click(
            lane("Not tagged").getByRole("checkbox", {
                name: "reanimator for Lightning Bolt",
            })
        );
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        const bolt = cards.find((card) => card.name === "Lightning Bolt");
        const seed = bolt?.seedProfile;
        expect(onSave).toHaveBeenCalledWith(cardId("Lightning Bolt"), {
            archetypes: [...(seed?.archetypes ?? []), "reanimator"],
            provides: seed?.provides ?? [],
            requires: seed?.requires ?? [],
            reviewed: seed?.reviewed ?? false,
        });
    });

    it("'Confirm all proposed' writes only the middle lane, then the lanes refresh", async () => {
        const onSave = vi.fn().mockResolvedValue(null);
        const cards = cubeRows();
        const { rerender } = renderPage(cards, onSave, vi.fn());
        fireEvent.click(
            screen.getByRole("button", { name: "Sweep reanimator" })
        );
        const proposed = reanimatorCards(cards);
        expect(proposed.length).toBeGreaterThan(1);
        expect(laneCards("Tagged · reviewed")).toEqual([]);

        fireEvent.click(
            screen.getByRole("button", {
                name: `Confirm all proposed (${proposed.length})`,
            })
        );
        await waitFor(() =>
            expect(onSave).toHaveBeenCalledTimes(proposed.length)
        );
        for (const card of proposed) {
            const seed = card.seedProfile;
            expect(onSave).toHaveBeenCalledWith(card.cardId, {
                ...seed,
                reviewed: true,
            });
        }
        const written = onSave.mock.calls.map(([id]) => id as string);
        expect(written).not.toContain(cardId("Lightning Bolt"));

        // The query echoes the writes; the board re-derives its lanes.
        const saves = onSave.mock.calls.map(([id, profile]) =>
            buildCardProfileRows(
                CUBE_SOURCE_KEY,
                id as string,
                profile as Parameters<typeof buildCardProfileRows>[2]
            )
        );
        rerenderPage(
            rerender,
            cubeRows(dbAfterSaves(...saves)),
            onSave,
            vi.fn()
        );
        expect(laneCards("Proposed by the census")).toEqual([]);
        expect(laneCards("Tagged · reviewed")).toEqual(
            proposed.map((card) => card.name).sort()
        );
        expect(laneCards("Not tagged")).toContain("Lightning Bolt");
    });

    it("the Capabilities rail sweeps one side of a Capability and writes that side", async () => {
        const onSave = vi.fn().mockResolvedValue(null);
        renderPage(cubeRows(), onSave, vi.fn());
        fireEvent.click(screen.getByRole("radio", { name: "Capabilities" }));
        expect(screen.queryByLabelText("Scope rail")).toBeNull();
        fireEvent.click(
            screen.getByRole("button", { name: "Sweep Provides reanimatable" })
        );
        expect(laneCards("Proposed by the census")).toContain("Griselbrand");
        fireEvent.click(
            screen.getByRole("checkbox", {
                name: "Provides reanimatable for Griselbrand",
            })
        );
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        const [id, profile] = onSave.mock.calls[0] as [
            string,
            { provides: string[]; archetypes: string[] },
        ];
        expect(id).toBe(cardId("Griselbrand"));
        expect(profile.provides).not.toContain("reanimatable");
        expect(profile.archetypes).toEqual(["reanimator"]);
    });

    it("each rail's Export downloads its tab's layer in seed-file format (issue #8907)", async () => {
        page.exports.length = 0;
        page.downloads.length = 0;
        renderPage(cubeRows(), vi.fn(), vi.fn());
        fireEvent.click(
            within(screen.getByLabelText("Scope rail")).getByRole("button", {
                name: "Export seed file",
            })
        );
        await waitFor(() => expect(page.downloads).toHaveLength(1));
        expect(page.exports).toEqual([["archetypes", "lea"]]);
        expect(page.downloads[0][0]).toBe("lea.json");
        expect(JSON.parse(page.downloads[0][1])).toEqual({
            scope: "lea",
            archetypes: {},
        });

        fireEvent.click(screen.getByRole("radio", { name: "Capabilities" }));
        fireEvent.click(
            within(screen.getByLabelText("Catalogue rail")).getByRole(
                "button",
                { name: "Export seed file" }
            )
        );
        await waitFor(() => expect(page.downloads).toHaveLength(2));
        expect(page.exports[1]).toEqual(["capabilities", undefined]);
        expect(page.downloads[1][0]).toBe("capabilities.json");
        const { getCardCapabilityFile } =
            await import("@convex/limited/cardProfilesCore");
        expect(JSON.parse(page.downloads[1][1])).toEqual(
            getCardCapabilityFile()
        );
    });
});
