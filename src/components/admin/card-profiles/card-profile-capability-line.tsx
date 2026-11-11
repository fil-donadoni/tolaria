import { Checkbox } from "~/components/ui/checkbox";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";
import type { CapabilityRow } from "@convex/limited/capabilityRegistry";
import CardProfileHelpTip from "./card-profile-help-tip";
import CardProfileRelatedCards from "./card-profile-related-cards";
import { descriptionHalves } from "./card-profiles-model";

interface CardProfileCapabilityLineProps {
    row: CapabilityRow;
    provides: boolean;
    requires: boolean;
    onToggleProvides: () => void;
    onToggleRequires: () => void;
    disabled: boolean;
    cardName: string;
    /** Scope cards that PROVIDE the row, and those that REQUIRE it. */
    offers: readonly ScopeCardProfile[];
    needs: readonly ScopeCardProfile[];
}

/** One Capability line of the focus dialog (issue #8904): provides and
 *  requires toggles · id · the row's one-line `gloss.provides` · `?`
 *  (PROVIDES / REQUIRES, each with its example card) · related cards — those
 *  offering it, then those needing it. A DERIVED row (`bound`, a mana-value
 *  ceiling over its base capability) is never provided by hand: its provides
 *  slot says so instead of offering a toggle. Every word comes from the
 *  registry row itself. */
export default function CardProfileCapabilityLine({
    row,
    provides,
    requires,
    onToggleProvides,
    onToggleRequires,
    disabled,
    cardName,
    offers,
    needs,
}: CardProfileCapabilityLineProps) {
    const derived = row.bound !== undefined;
    const [providesText, requiresText] = descriptionHalves(
        row.description,
        "PROVIDES:",
        "REQUIRES:"
    );
    return (
        <div
            data-profile-line={row.id}
            className={
                "grid grid-cols-[1.25rem_1.25rem_9rem_minmax(0,1fr)_1.25rem_6.5rem] items-center gap-2 rounded-sm px-1 py-0.5 " +
                (provides || requires
                    ? "bg-surface-elevated/40"
                    : "hover:bg-surface-elevated/30")
            }
        >
            {derived ? (
                <span
                    data-derived-capability={row.id}
                    title={`Derived: a card providing ${row.bound?.capability} with mana value ≤ ${row.bound?.maxManaValue} satisfies it — never set by hand`}
                    className="inline-flex size-5 items-center justify-center font-mono text-xs text-text-muted"
                >
                    ∂<span className="sr-only">derived, never set by hand</span>
                </span>
            ) : (
                <Checkbox
                    checked={provides}
                    disabled={disabled}
                    aria-label={`Provides ${row.id} for ${cardName}`}
                    onCheckedChange={onToggleProvides}
                />
            )}
            <Checkbox
                checked={requires}
                disabled={disabled}
                aria-label={`Requires ${row.id} for ${cardName}`}
                onCheckedChange={onToggleRequires}
            />
            <span className="truncate font-mono text-xs text-text">
                {row.id}
            </span>
            <span className="truncate text-xs text-text-muted">
                {row.gloss.provides}
            </span>
            <CardProfileHelpTip
                rowId={row.id}
                first={{
                    label: "Provides",
                    text: providesText,
                    example: row.example.provider ?? undefined,
                }}
                second={{
                    label: "Requires",
                    text: requiresText,
                    example: row.example.requirer,
                }}
            />
            <span className="flex items-center justify-end gap-1">
                <CardProfileRelatedCards
                    cards={offers}
                    field="provides"
                    label={`Provide ${row.id}`}
                />
                <span className="h-4 w-px bg-border-subtle" />
                <CardProfileRelatedCards
                    cards={needs}
                    field="requires"
                    label={`Require ${row.id}`}
                />
            </span>
        </div>
    );
}
