import { Layers } from "lucide-react";
import type { DraftableSetInfo } from "~/hooks/useLimitedEvent";
import type { ArchetypeCatalogueRow } from "@convex/limited/archetypeCatalogueCore";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";
import { Button } from "~/components/ui/button";
import AdminReviewProgress from "../tool/admin-review-progress";
import LimitedScopePicker from "~/components/lobby/limited-scope-picker";
import CardProfilesColourBar from "./card-profiles-colour-bar";
import { catalogueCounts, reviewProgress } from "./card-profiles-model";

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
}

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
}: CardProfilesScopeRailProps) {
    const progress = reviewProgress(cards);
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
                <span className="text-label">Catalogue rows in this scope</span>
                {rows.length === 0 && (
                    <p className="text-xs text-text-muted">
                        No card here is tagged with a catalogue row yet.
                    </p>
                )}
                {rows.map(({ row, tagged, signature }) => {
                    const active = selectedArchetypes.includes(row.id);
                    return (
                        <div key={row.id} className="flex items-stretch gap-1">
                            <button
                                type="button"
                                aria-pressed={active}
                                title={row.description}
                                onClick={() => onToggleArchetype(row.id)}
                                className={`flex min-w-0 flex-1 flex-col gap-1 rounded-sm border px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-elevated/40 ${
                                    active
                                        ? "border-accent text-parchment"
                                        : "border-border-subtle/30 text-text"
                                }`}
                            >
                                <span className="flex items-baseline justify-between gap-2">
                                    <span>{row.id}</span>
                                    <span className="text-text-muted">
                                        {tagged} tagged
                                    </span>
                                </span>
                                <CardProfilesColourBar signature={signature} />
                            </button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Sweep ${row.id}`}
                                title={`Sweep ${row.id}`}
                                onClick={() => onSweep(row.id)}
                                className="self-center"
                            >
                                <Layers aria-hidden="true" />
                            </Button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
