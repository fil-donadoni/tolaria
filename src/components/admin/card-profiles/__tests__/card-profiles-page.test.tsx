// Card Profile Admin editor surface (PRD #1607, ADR 0072, issues #1614,
// #3597, #8903 and #8904 — the focus dialog). Drives the editor through the REAL query-projection pure functions
// (`listScopeCards` + `buildScopeCardProfiles` over the real checked-in
// census) rather than a hand-built `ScopeCardProfile` stub — the same
// discipline `pick-ratings-page.test.tsx` states: a synthetic view can't
// catch a field the projection drops.
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement } from "react";
import {
    act,
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
    SEED_PROFILE_LAYERS,
    type ProfileLayers,
} from "@convex/limited/cardProfilesCore";
import { listScopeCards } from "@convex/limited/cardRatingsCore";
import { CUBE_SOURCE_KEY } from "@convex/limited/cube";
import { CAPABILITY_REGISTRY } from "@convex/limited/capabilityRegistry";
import { ARCHETYPE_CATALOGUE_SEED } from "@convex/limited/archetypeCatalogueCore";
import { tryGetCardByName } from "@convex/cards";
import { TooltipProvider } from "~/components/ui/tooltip";
import CardProfilesPage from "../card-profiles-page";
import { descriptionHalves } from "../card-profiles-model";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";

// The page reads its data through three hooks; they are the seam, so the
// rows each test passes are the REAL `listScopeCardProfilesForEditor`
// projection and the page is driven exactly as the route drives it.
// Every write names its LAYER as the first field of the recorded profile:
// `{ layer: "archetypes", archetypes, reviewed }` (scope stripped) or
// `{ layer: "capabilities", provides, requires, comboEdges, reviewed }`.
const page = vi.hoisted(() => ({
    cards: undefined as unknown,
    onSave: undefined as unknown as (
        cardId: string,
        profile: Record<string, unknown>
    ) => Promise<unknown>,
    onClear: undefined as unknown as (
        cardId: string,
        layer: string
    ) => Promise<unknown>,
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

        useArchetypeCatalogueMutations: () => ({
            createRow: vi.fn(),
            updateRow: vi.fn(),
        }),
        useCardProfileMutations: () => ({
            setCapabilities: (args: { cardId: string }) => {
                const { cardId, ...profile } = args;
                return page.onSave(cardId, {
                    layer: "capabilities",
                    ...profile,
                });
            },
            setArchetypes: (args: { cardId: string; scope: string }) => {
                const { cardId, scope, ...profile } = args;
                void scope;
                return page.onSave(cardId, { layer: "archetypes", ...profile });
            },
            clearCapabilities: ({ cardId }: { cardId: string }) =>
                page.onClear(cardId, "capabilities"),
            clearArchetypes: ({ cardId }: { cardId: string }) =>
                page.onClear(cardId, "archetypes"),
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
    // The app mounts every page under `main.tsx`'s TooltipProvider.
    return render(
        <TooltipProvider>
            <CardProfilesPage />
        </TooltipProvider>
    );
}

function rerenderPage(
    rerender: (ui: ReactElement) => void,
    cards: ScopeCardProfile[] | undefined,
    onSave: unknown,
    onClear: unknown
) {
    setPage(cards, onSave, onClear);
    rerender(
        <TooltipProvider>
            <CardProfilesPage />
        </TooltipProvider>
    );
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
    db: ProfileLayers = EMPTY_PROFILE_LAYERS,
    seed: ProfileLayers = SEED_PROFILE_LAYERS
): ScopeCardProfile[] {
    const wanted = new Set<string>(SAMPLE.map(cardId));
    const cards = listScopeCards(CUBE_SOURCE_KEY).filter((card) =>
        wanted.has(card.cardId)
    );
    return buildScopeCardProfiles(CUBE_SOURCE_KEY, cards, db, seed).sort(
        (a, b) => a.name.localeCompare(b.name)
    );
}

/** Open the `n`-th row of the table (name-sorted by default) in the focus
 *  dialog. */
function openRow(n = 0) {
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[n]);
}

/** Hover a base-ui tooltip trigger open — it takes BOTH events in
 *  happy-dom (one alone opens nothing). */
function hover(el: HTMLElement) {
    fireEvent.pointerEnter(el, { pointerType: "mouse" });
    fireEvent.mouseEnter(el);
}

function closeDialog() {
    fireEvent.click(
        document.querySelector("[data-game-dialog-close]") as HTMLElement
    );
}

const editor = (name: string) =>
    screen.queryByRole("group", { name: `Profile for ${name}` });

/** A reviewed save of both layers for one card — the DB state a finished
 *  pass leaves behind. */
function reviewedBoth(name: string) {
    const effective = cubeRows().find((row) => row.name === name)!.seedProfile!;
    return buildCardProfileRows(CUBE_SOURCE_KEY, cardId(name), {
        archetypes: effective.archetypes,
        provides: effective.provides,
        requires: effective.requires,
        reviewed: true,
    });
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
        renderPage(
            cubeRows(dbAfterSaves(reviewedBoth("Griselbrand"))),
            vi.fn(),
            vi.fn()
        );
        expect(screen.getByText("Griselbrand")).toBeTruthy();
        pickFilter("Status", "Unreviewed");
        expect(screen.queryByText("Griselbrand")).toBeNull();
        expect(screen.getByText("Worldspine Wurm")).toBeTruthy();
    });

    it("the Status column reads the TAB's layer: an Archetype-only review is still Unreviewed on Capabilities", () => {
        const archetypesOnly = buildDbProfileLayers({
            capabilities: [],
            archetypes: [reviewedBoth("Griselbrand").archetypes],
        });
        renderPage(cubeRows(archetypesOnly), vi.fn(), vi.fn());
        const status = () =>
            screen.getByText("Griselbrand").closest("tr")?.textContent ?? "";
        expect(status()).toContain("Reviewed");
        expect(status()).not.toContain("Unreviewed");
        fireEvent.click(screen.getByRole("radio", { name: "Capabilities" }));
        expect(status()).toContain("Unreviewed");
    });

    it("filters by card name", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        fireEvent.change(screen.getByLabelText("Search cards"), {
            target: { value: "grisel" },
        });
        expect(screen.getByText("Griselbrand")).toBeTruthy();
        expect(screen.queryByText("Reanimate")).toBeNull();
    });

    it("only offers Capability names from the closed registry; a derived row has no Provides toggle", () => {
        renderPageOnCapabilities();
        openRow();
        for (const row of CAPABILITY_REGISTRY) {
            expect(
                screen.getByLabelText(`Requires ${row.id} for Griselbrand`),
                row.id
            ).toBeTruthy();
            const provides = screen.queryByLabelText(
                `Provides ${row.id} for Griselbrand`
            );
            if (row.bound === undefined) {
                expect(provides, row.id).toBeTruthy();
            } else {
                expect(provides, row.id).toBeNull();
                expect(
                    document.querySelector(
                        `[data-derived-capability="${row.id}"]`
                    ),
                    row.id
                ).toBeTruthy();
            }
        }
    });

    it("the Archetypes tab saves the Archetype layer only — the clicked row added, the review flag", async () => {
        const onSave = vi.fn().mockResolvedValue(null);
        renderPage(cubeRows(), onSave, vi.fn());
        // Rows are name-sorted; Griselbrand is the first of the four.
        openRow();
        fireEvent.click(
            screen.getByLabelText("Archetype control for Griselbrand")
        );
        fireEvent.click(screen.getByLabelText("Reviewed for Griselbrand"));
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave).toHaveBeenCalledWith(cardId("Griselbrand"), {
            layer: "archetypes",
            // The census seeds Griselbrand `["reanimator"]`; the click adds
            // `control` to it rather than replacing a typed string.
            archetypes: ["reanimator", "control"],
            reviewed: true,
        });
    });

    it("the Capabilities tab saves the Capability layer only — provides, requires, the review flag", async () => {
        const onSave = vi.fn().mockResolvedValue(null);
        renderPage(cubeRows(), onSave, vi.fn());
        fireEvent.click(screen.getByRole("radio", { name: "Capabilities" }));
        openRow();
        fireEvent.click(
            screen.getByLabelText("Requires value-on-etb for Griselbrand")
        );
        fireEvent.click(screen.getByLabelText("Reviewed for Griselbrand"));
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave).toHaveBeenCalledWith(cardId("Griselbrand"), {
            layer: "capabilities",
            provides: ["reanimatable"],
            requires: ["value-on-etb"],
            comboEdges: undefined,
            reviewed: true,
        });
    });

    it("Clear is disabled until there is a database override to clear, and clears the TAB's layer", async () => {
        const onClear = vi.fn().mockResolvedValue(null);
        const { rerender } = renderPage(cubeRows(), vi.fn(), onClear);
        openRow();
        expect(
            screen
                .getByRole("button", { name: "Clear" })
                .hasAttribute("disabled")
        ).toBe(true);

        rerenderPage(
            rerender,
            cubeRows(dbAfterSaves(reviewedBoth("Griselbrand"))),
            vi.fn(),
            onClear
        );
        const clear = screen.getByRole("button", { name: "Clear" });
        expect(clear.hasAttribute("disabled")).toBe(false);
        fireEvent.click(clear);
        await waitFor(() =>
            expect(onClear).toHaveBeenCalledWith(
                cardId("Griselbrand"),
                "archetypes"
            )
        );
    });
});

describe("CardProfilesPage — shaped for the review pass (issue #3597)", () => {
    it("only offers Archetype names from the catalogue — no free-text field", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        openRow();
        for (const row of ARCHETYPE_CATALOGUE_SEED) {
            expect(
                screen.getByLabelText(`Archetype ${row.id} for Griselbrand`),
                row.id
            ).toBeTruthy();
        }
        expect(
            screen.queryByLabelText("Archetypes for Griselbrand")
        ).toBeNull();
    });

    it("shows progress against the scope, counting the WHOLE scope, not the filtered view", () => {
        renderPage(
            cubeRows(dbAfterSaves(reviewedBoth("Griselbrand"))),
            vi.fn(),
            vi.fn()
        );
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

    it("shows each card's art in the table, and the card image in the dialog — no Oracle text", () => {
        const { container } = renderPage(cubeRows(), vi.fn(), vi.fn());
        // One art slot per row, addressed by cardId — happy-dom has no layout
        // so the `<img>` inside is not asserted here; `bun run check:ui` is
        // what measures whether it actually paints.
        expect(
            container.querySelectorAll("[data-card-profile-art]").length
        ).toBe(SAMPLE.length);
        openRow();
        expect(
            document.querySelector(
                `[data-card-profile-focus-art="${cardId("Griselbrand")}"]`
            )
        ).toBeTruthy();
        // The verdict: no Oracle column — the image carries the text.
        expect(screen.queryByText(/Pay 7 life/)).toBeNull();
    });

    it("states the provides/requires distinction, and that an empty Requires is normal", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        expect(screen.getByText(/what a card OFFERS a partner/)).toBeTruthy();
        expect(screen.getByText(/what it NEEDS from one/)).toBeTruthy();
        expect(screen.getByText(/An empty Requires is the norm/)).toBeTruthy();
    });

    it("'Mark reviewed & next' saves the card reviewed and opens the following card", async () => {
        const onSave = vi.fn().mockResolvedValue(null);
        renderPage(cubeRows(), onSave, vi.fn());
        openRow();
        expect(editor("Griselbrand")).toBeTruthy();

        fireEvent.click(
            screen.getByRole("button", { name: "Mark reviewed & next" })
        );
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][0]).toBe(cardId("Griselbrand"));
        expect(onSave.mock.calls[0][1].reviewed).toBe(true);

        // Name-sorted walk: Lightning Bolt is next.
        await waitFor(() => expect(editor("Lightning Bolt")).toBeTruthy());
        expect(editor("Griselbrand")).toBeNull();
    });

    it("⌘/Ctrl+Enter inside the dialog does the same thing from the keyboard", async () => {
        const onSave = vi.fn().mockResolvedValue(null);
        renderPage(cubeRows(), onSave, vi.fn());
        openRow();
        fireEvent.keyDown(editor("Griselbrand")!, {
            key: "Enter",
            metaKey: true,
        });
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][1].reviewed).toBe(true);
        await waitFor(() => expect(editor("Lightning Bolt")).toBeTruthy());
    });

    it("a REJECTED save leaves the reviewer on the card, with the error", async () => {
        const onSave = vi.fn().mockRejectedValue(new Error("nope"));
        renderPage(cubeRows(), onSave, vi.fn());
        openRow();
        fireEvent.click(
            screen.getByRole("button", { name: "Mark reviewed & next" })
        );
        await waitFor(() => expect(screen.getByText("nope")).toBeTruthy());
        expect(editor("Griselbrand")).toBeTruthy();
        expect(editor("Lightning Bolt")).toBeNull();
    });
});

describe("CardProfilesPage — review findings (issue #3597)", () => {
    it("re-seeds a revisited card from the stored profile, never from abandoned edits", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        openRow();
        const control = () =>
            screen.getByLabelText("Archetype control for Griselbrand");
        expect(control().getAttribute("aria-checked")).toBe("false");
        fireEvent.click(control());
        expect(control().getAttribute("aria-checked")).toBe("true");

        // Step away and back: the edit was never saved.
        fireEvent.click(screen.getByRole("button", { name: "Skip →" }));
        expect(editor("Lightning Bolt")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "← Prev" }));
        expect(control().getAttribute("aria-checked")).toBe("false");
    });

    it("shows a STORED archetype the catalogue does not have, and lets it be removed", async () => {
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
        openRow();
        const stray = screen.getByLabelText(
            "Unregistered archetype cheat-into-play for Griselbrand"
        );
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
        openRow();
        const row = screen.getByLabelText("Archetype kicker for Griselbrand");
        expect(row.getAttribute("aria-checked")).toBe("true");
        expect(
            screen.queryByLabelText(
                "Unregistered archetype kicker for Griselbrand"
            )
        ).toBeNull();
    });

    it("focus lands in the dialog's editor on open", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        openRow();
        expect(document.activeElement).toBe(editor("Griselbrand"));
    });

    it("advances correctly with 'the Unreviewed status filter' on, including after the saved card leaves the list", async () => {
        const onSave = vi.fn().mockResolvedValue(null);
        const { rerender } = renderPage(cubeRows(), onSave, vi.fn());
        pickFilter("Status", "Unreviewed");
        openRow();
        fireEvent.click(
            screen.getByRole("button", { name: "Mark reviewed & next" })
        );
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(editor("Lightning Bolt")).toBeTruthy());

        // The reactive query now lands the saved card as reviewed, and the
        // filter drops it — the successor must stay open through that.
        rerenderPage(
            rerender,
            cubeRows(dbAfterSaves(reviewedBoth("Griselbrand"))),
            onSave,
            vi.fn()
        );
        expect(editor("Lightning Bolt")).toBeTruthy();
        // …and the walk still steps to the card AFTER it, not one further.
        fireEvent.click(screen.getByRole("button", { name: "Skip →" }));
        expect(editor("Reanimate")).toBeTruthy();
    });
});

describe("CardProfilesPage — the focus dialog (issue #8904)", () => {
    it("walks the filtered, SORTED list in order, says where it is, and closes past the last card", () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        // Card descending: Worldspine Wurm, Reanimate, Lightning Bolt, Griselbrand.
        const card = screen.getByRole("columnheader", { name: "Card" });
        fireEvent.click(within(card).getByRole("button"));
        openRow();
        expect(editor("Worldspine Wurm")).toBeTruthy();
        expect(
            screen.getAllByText(/1 of 4 in the current list/).length
        ).toBeGreaterThan(0);
        expect(
            screen
                .getByRole("button", { name: "← Prev" })
                .hasAttribute("disabled")
        ).toBe(true);
        for (const next of ["Reanimate", "Lightning Bolt", "Griselbrand"]) {
            fireEvent.click(screen.getByRole("button", { name: "Skip →" }));
            expect(editor(next), next).toBeTruthy();
        }
        expect(
            screen.getAllByText(/4 of 4 in the current list/).length
        ).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole("button", { name: "Skip →" }));
        expect(
            screen.queryByRole("group", { name: /^Profile for/ })
        ).toBeNull();
    });

    it("Mark reviewed & next writes ONLY the current tab's layer, on either tab", async () => {
        const onSave = vi.fn().mockResolvedValue(null);
        renderPage(cubeRows(), onSave, vi.fn());
        openRow();
        fireEvent.click(
            screen.getByRole("button", { name: "Mark reviewed & next" })
        );
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][1]).toEqual({
            layer: "archetypes",
            archetypes: ["reanimator"],
            reviewed: true,
        });

        closeDialog();
        fireEvent.click(screen.getByRole("radio", { name: "Capabilities" }));
        openRow();
        fireEvent.click(
            screen.getByRole("button", { name: "Mark reviewed & next" })
        );
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
        expect(onSave.mock.calls[1][1]).toEqual({
            layer: "capabilities",
            provides: ["reanimatable"],
            requires: [],
            comboEdges: undefined,
            reviewed: true,
        });
    });

    it("shows the census rationale of the TAB's layer", () => {
        const id = cardId("Griselbrand");
        const seed: ProfileLayers = {
            getCapabilities: (cid) =>
                cid === id
                    ? {
                          ...SEED_PROFILE_LAYERS.getCapabilities(cid)!,
                          rationale: "oracle: an 8-drop worth cheating",
                      }
                    : SEED_PROFILE_LAYERS.getCapabilities(cid),
            getArchetypes: (scope, cid) =>
                cid === id
                    ? {
                          ...SEED_PROFILE_LAYERS.getArchetypes(scope, cid)!,
                          rationale: "cube-list: the classic reanimator target",
                      }
                    : SEED_PROFILE_LAYERS.getArchetypes(scope, cid),
        };
        renderPage(cubeRows(EMPTY_PROFILE_LAYERS, seed), vi.fn(), vi.fn());
        openRow();
        const block = () => document.querySelector("[data-census-rationale]");
        expect(block()?.textContent).toContain("the classic reanimator target");
        closeDialog();
        fireEvent.click(screen.getByRole("radio", { name: "Capabilities" }));
        openRow();
        expect(block()?.textContent).toContain("an 8-drop worth cheating");
    });

    it("each line renders its gloss, and its ? the registry text split in two halves with the example — read from the registry", async () => {
        renderPageOnCapabilities();
        openRow();
        const row = CAPABILITY_REGISTRY.find((r) => r.id === "reanimatable")!;
        const line = document.querySelector(
            '[data-profile-line="reanimatable"]'
        ) as HTMLElement;
        expect(line.textContent).toContain(row.gloss.provides);

        const [provides, requires] = descriptionHalves(
            row.description,
            "PROVIDES:",
            "REQUIRES:"
        );
        hover(
            within(line).getByRole("button", {
                name: "What reanimatable means",
            })
        );
        const halves = await waitFor(() => {
            const found = document.querySelectorAll("[data-help-half]");
            expect(found.length).toBe(2);
            return found;
        });
        expect(halves[0].textContent).toContain(provides);
        expect(halves[0].textContent).toContain(row.example.provider!);
        expect(halves[1].textContent).toContain(requires);
        expect(halves[1].textContent).toContain(row.example.requirer);
        expect(provides).not.toContain("REQUIRES:");
    });

    it("an Archetype line's ? splits TAG WHEN / NOT and names the catalogue example", async () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        openRow();
        const row = ARCHETYPE_CATALOGUE_SEED.find(
            (r) => r.id === "reanimator"
        )!;
        const line = document.querySelector(
            '[data-profile-line="reanimator"]'
        ) as HTMLElement;
        expect(line.textContent).toContain(row.gloss.when);
        hover(
            within(line).getByRole("button", { name: "What reanimator means" })
        );
        const [when, not] = descriptionHalves(
            row.description,
            "TAG WHEN:",
            "NOT:"
        );
        const halves = await waitFor(() => {
            const found = document.querySelectorAll("[data-help-half]");
            expect(found.length).toBe(2);
            return found;
        });
        expect(halves[0].textContent).toContain(when);
        expect(halves[0].textContent).toContain(row.example);
        expect(halves[1].textContent).toContain(not);
    });

    it("related cards: hover previews, right-click opens the app's CardPreview, click opens a peek", async () => {
        renderPage(cubeRows(), vi.fn(), vi.fn());
        openRow();
        // Griselbrand's reanimator line lists the other reanimator cards of
        // the scope — never Griselbrand itself.
        const group = screen.getByRole("group", {
            name: "Also tagged reanimator",
        });
        const thumbs = within(group).getAllByRole("button", {
            name: /^Peek at /,
        });
        expect(thumbs.length).toBeGreaterThan(0);
        expect(
            within(group).queryByRole("button", { name: "Peek at Griselbrand" })
        ).toBeNull();
        const thumb = thumbs[0];
        const relatedId = thumb.getAttribute("data-related-card")!;

        hover(thumb);
        await waitFor(() =>
            expect(
                document.querySelector(
                    `[data-related-card-hover="${relatedId}"]`
                )
            ).toBeTruthy()
        );

        act(() => {
            fireEvent.pointerDown(thumb, { button: 2 });
        });
        act(() => {
            fireEvent(window, new Event("pointerup"));
        });
        await waitFor(() =>
            expect(
                document.querySelector("[data-card-preview-anchored]")
            ).toBeTruthy()
        );

        fireEvent.click(thumb);
        await waitFor(() =>
            expect(
                document.querySelector(
                    `[data-related-card-peek="${relatedId}"]`
                )
            ).toBeTruthy()
        );
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
        renderPage(
            cubeRows(dbAfterSaves(reviewedBoth("Griselbrand"))),
            vi.fn(),
            vi.fn()
        );

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
            layer: "archetypes",
            archetypes: [...(seed?.archetypes ?? []), "reanimator"],
            reviewed: seed?.archetypesReviewed ?? false,
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
                layer: "archetypes",
                archetypes: seed?.archetypes,
                reviewed: true,
            });
        }
        const written = onSave.mock.calls.map(([id]) => id as string);
        expect(written).not.toContain(cardId("Lightning Bolt"));

        // The query echoes the writes; the board re-derives its lanes.
        const saves = onSave.mock.calls.map(([id, write]) => {
            const seed = proposed.find(
                (card) => card.cardId === id
            )?.seedProfile;
            const { archetypes, reviewed } = write as {
                archetypes: string[];
                reviewed: boolean;
            };
            return buildCardProfileRows(CUBE_SOURCE_KEY, id as string, {
                archetypes,
                provides: seed?.provides ?? [],
                requires: seed?.requires ?? [],
                reviewed,
            });
        });
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
            { layer: string; provides: string[]; archetypes?: string[] },
        ];
        expect(id).toBe(cardId("Griselbrand"));
        expect(profile.layer).toBe("capabilities");
        expect(profile.provides).not.toContain("reanimatable");
        // A Capability sweep never touches the Archetype layer.
        expect(profile.archetypes).toBeUndefined();
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
