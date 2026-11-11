// Catalogue rows in the Card Profiles scope rail (PRD #8772, issue #8906):
// tagged · proposed? counts, the add/edit form refusing what the mutation
// refuses, and the census residue rendered from the residue file schema.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
    ARCHETYPE_CATALOGUE_SEED,
    type ArchetypeCatalogueRow,
} from "@convex/limited/archetypeCatalogueCore";
import {
    validateCensusResidue,
    type CensusResidueFile,
} from "@convex/limited/cardProfilesCore";
import residueFixture from "../../../../../scripts/__tests__/fixtures/profile-census/residue.fixture.json";
import CardProfilesCatalogueForm from "../card-profiles-catalogue-form";
import { BLANK_CATALOGUE_ROW } from "../card-profiles-model";
import CardProfilesResidue from "../card-profiles-residue";
import CardProfilesScopeRail from "../card-profiles-scope-rail";
import { catalogueCounts } from "../card-profiles-model";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";

const SEED_ROW = ARCHETYPE_CATALOGUE_SEED[0];

function card(
    id: string,
    archetypes: string[],
    reviewed: boolean
): ScopeCardProfile {
    return {
        cardId: id,
        name: id,
        colours: ["R"],
        dbProfile: null,
        seedProfile: {
            provides: [],
            requires: [],
            archetypes,
            capabilitiesReviewed: reviewed,
            archetypesReviewed: reviewed,
        },
    } as unknown as ScopeCardProfile;
}

describe("catalogueCounts", () => {
    it("splits tagged (reviewed) from proposed (unreviewed)", () => {
        const [entry] = catalogueCounts(
            [
                card("a", [SEED_ROW.id], true),
                card("b", [SEED_ROW.id], false),
                card("c", [SEED_ROW.id], false),
            ],
            ARCHETYPE_CATALOGUE_SEED
        );
        expect(entry.tagged).toBe(1);
        expect(entry.proposed).toBe(2);
        expect(entry.signature.R).toBe(1);
    });
});

describe("CardProfilesCatalogueForm", () => {
    function renderForm(
        onSubmit: (row: ArchetypeCatalogueRow) => Promise<unknown>
    ) {
        render(
            <CardProfilesCatalogueForm
                mode="create"
                initial={BLANK_CATALOGUE_ROW}
                catalogue={ARCHETYPE_CATALOGUE_SEED}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
            />
        );
    }

    it("refuses a row without clauses and shows the reason, no write", async () => {
        const onSubmit = vi.fn().mockResolvedValue(null);
        renderForm(onSubmit);
        fireEvent.change(screen.getByLabelText("Row id"), {
            target: { value: "Bad Id" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Add row" }));
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain("id must be lowercase kebab-case");
        expect(alert.textContent).toContain('the "TAG WHEN:" clause is empty');
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("refuses an id already in the catalogue", async () => {
        const onSubmit = vi.fn();
        renderForm(onSubmit);
        fireEvent.change(screen.getByLabelText("Row id"), {
            target: { value: SEED_ROW.id },
        });
        fireEvent.click(screen.getByRole("button", { name: "Add row" }));
        expect((await screen.findByRole("alert")).textContent).toContain(
            "already exists"
        );
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("submits a valid row and surfaces the mutation's own refusal", async () => {
        const onSubmit = vi.fn().mockRejectedValue(new Error("server says no"));
        renderForm(onSubmit);
        fireEvent.change(screen.getByLabelText("Row id"), {
            target: { value: "new-plan" },
        });
        fireEvent.change(screen.getByLabelText(/^Description/), {
            target: { value: "TAG WHEN: a plan NOT: another plan" },
        });
        fireEvent.change(screen.getByLabelText("Gloss: when"), {
            target: { value: "when" },
        });
        fireEvent.change(screen.getByLabelText("Gloss: not"), {
            target: { value: "not" },
        });
        fireEvent.change(screen.getByLabelText("Example card"), {
            target: { value: SEED_ROW.example },
        });
        fireEvent.click(screen.getByRole("button", { name: "Add row" }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect((await screen.findByRole("alert")).textContent).toContain(
            "server says no"
        );
    });
});

describe("CardProfilesResidue", () => {
    it("renders a residue fixture's candidates read-only", () => {
        expect(validateCensusResidue(residueFixture).valid).toBe(true);
        render(
            <CardProfilesResidue
                residues={[residueFixture as CensusResidueFile]}
            />
        );
        expect(screen.getByText("graveyard-card-types")).toBeTruthy();
        expect(screen.getByText(/Providers:/).textContent).toContain(
            "Providers: "
        );
        expect(screen.getByText(/cube-writeup/)).toBeTruthy();
        expect(screen.queryByRole("button")).toBeNull();
    });

    it("says so when there is no residue", () => {
        render(<CardProfilesResidue residues={[]} />);
        expect(screen.getByText("The census left no residue.")).toBeTruthy();
    });
});

describe("CardProfilesScopeRail catalogue rows", () => {
    it("shows tagged · proposed? and opens the edit form on a row", () => {
        render(
            <CardProfilesScopeRail
                scopes={[]}
                scope={undefined}
                onScopeChange={vi.fn()}
                cards={[
                    card("a", [SEED_ROW.id], true),
                    card("b", [SEED_ROW.id], false),
                ]}
                catalogue={ARCHETYPE_CATALOGUE_SEED}
                selectedArchetypes={[]}
                onToggleArchetype={vi.fn()}
                onSweep={vi.fn()}
                onCreateRow={vi.fn()}
                onUpdateRow={vi.fn()}
                residues={[]}
            />
        );
        expect(screen.getByText("1 · 1?")).toBeTruthy();
        fireEvent.click(
            screen.getByRole("button", { name: `Edit ${SEED_ROW.id}` })
        );
        expect(
            (screen.getByLabelText("Row id") as HTMLInputElement).disabled
        ).toBe(true);
    });
});
