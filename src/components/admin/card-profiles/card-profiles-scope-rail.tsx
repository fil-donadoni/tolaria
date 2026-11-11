import type { DraftableSetInfo } from "~/hooks/useLimitedEvent";
import type { ArchetypeCatalogueRow } from "@convex/limited/archetypeCatalogueCore";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";
import AdminReviewProgress from "../tool/admin-review-progress";
import LimitedScopePicker from "~/components/lobby/limited-scope-picker";
import { useState } from "react";
import type { CensusResidueFile } from "@convex/limited/cardProfilesCore";
import CardProfilesCatalogueForm from "./card-profiles-catalogue-form";
import CardProfilesCatalogueRow from "./card-profiles-catalogue-row";
import CardProfilesInfoTip from "./card-profiles-info-tip";
import CardProfilesResidue from "./card-profiles-residue";
import {
    BLANK_CATALOGUE_ROW,
    catalogueCounts,
    reviewProgress,
} from "./card-profiles-model";

interface CardProfilesScopeRailProps {
    scopes: DraftableSetInfo[];
    scope: string | undefined;
    onScopeChange: (scope: string) => void;
    cards: ScopeCardProfile[] | undefined;
    catalogue: readonly ArchetypeCatalogueRow[];
    /** Archetype filter selection — a catalogue row toggles itself in it. */
    selectedArchetypes: readonly string[];
    onToggleArchetype: (id: string) => void;
    /** Opens the sweep board on one catalogue row (issue #8905). */
    onSweep: (id: string) => void;
    onCreateRow: (row: ArchetypeCatalogueRow) => Promise<unknown>;
    onUpdateRow: (row: ArchetypeCatalogueRow) => Promise<unknown>;
    /** Census residue to show as pending Capability proposals. */
    residues: readonly CensusResidueFile[];
}

type FormState =
    | { mode: "create" }
    | { mode: "edit"; row: ArchetypeCatalogueRow }
    | null;

/** The Archetypes tab's rail body: the scope, the scope's review progress and
 *  its catalogue rows with tagged counts and computed colour bars (prototype
 *  D, PRD #8772). A row click filters the table to it; its Sweep button
 *  opens the sweep board on it (issue #8905). */
export default function CardProfilesScopeRail({
    scopes,
    scope,
    onScopeChange,
    cards,
    catalogue,
    selectedArchetypes,
    onToggleArchetype,
    onSweep,
    onCreateRow,
    onUpdateRow,
    residues,
}: CardProfilesScopeRailProps) {
    const [form, setForm] = useState<FormState>(null);
    const progress = reviewProgress(cards, "archetypes");
    const rows = cards ? catalogueCounts(cards, catalogue) : [];
    return (
        <div className="flex flex-col gap-4">
            <LimitedScopePicker
                scopes={scopes}
                value={scope}
                onChange={onScopeChange}
                ariaLabel="Profile Scope"
            />
            <AdminReviewProgress
                label="Human review pass"
                done={progress.reviewed}
                total={progress.profiled}
                emptyText="No profiled cards in this scope"
            />
            <div className="flex flex-col gap-1">
                <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 text-label">
                        Catalogue rows in this scope
                        <CardProfilesInfoTip label="About the counts">
                            Each row shows reviewed cards, then proposed cards
                            with a question mark. Example: 127 · 77? is 127
                            reviewed and 77 the census proposed.
                        </CardProfilesInfoTip>
                    </span>
                    <button
                        type="button"
                        className="text-xs text-text-muted hover:text-text"
                        onClick={() => setForm({ mode: "create" })}
                    >
                        Add row
                    </button>
                </span>
                {form && (
                    <CardProfilesCatalogueForm
                        key={form.mode === "edit" ? form.row.id : "create"}
                        mode={form.mode}
                        initial={
                            form.mode === "edit"
                                ? form.row
                                : BLANK_CATALOGUE_ROW
                        }
                        catalogue={catalogue}
                        onSubmit={(row) =>
                            form.mode === "edit"
                                ? onUpdateRow(row)
                                : onCreateRow(row)
                        }
                        onCancel={() => setForm(null)}
                    />
                )}
                {rows.length === 0 && (
                    <p className="text-xs text-text-muted">
                        No card here is tagged with a catalogue row yet.
                    </p>
                )}
                {rows.map((entry) => (
                    <CardProfilesCatalogueRow
                        key={entry.row.id}
                        entry={entry}
                        active={selectedArchetypes.includes(entry.row.id)}
                        onToggle={() => onToggleArchetype(entry.row.id)}
                        onEdit={() => setForm({ mode: "edit", row: entry.row })}
                        onSweep={() => onSweep(entry.row.id)}
                    />
                ))}
            </div>
            <CardProfilesResidue residues={residues} />
        </div>
    );
}
