import { Checkbox } from "~/components/ui/checkbox";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";
import type { ArchetypeCatalogueRow } from "@convex/limited/archetypeCatalogueCore";
import CardProfileHelpTip from "./card-profile-help-tip";
import CardProfileRelatedCards from "./card-profile-related-cards";
import { descriptionHalves } from "./card-profiles-model";

interface CardProfileArchetypeLineProps {
    id: string;
    /** The catalogue row, or `null` for a STORED name the catalogue does not
     *  have (a legacy free-text value): rendered checked and flagged, so the
     *  reviewer can see it and untick it — never offered as a choice. */
    row: ArchetypeCatalogueRow | null;
    checked: boolean;
    onToggle: () => void;
    disabled: boolean;
    cardName: string;
    related: readonly ScopeCardProfile[];
}

/** One Archetype line of the focus dialog (issue #8904): toggle · id · the
 *  row's one-line `gloss.when` · `?` (TAG WHEN / NOT + example) · related
 *  cards of the scope. Every word comes from the catalogue row itself. */
export default function CardProfileArchetypeLine({
    id,
    row,
    checked,
    onToggle,
    disabled,
    cardName,
    related,
}: CardProfileArchetypeLineProps) {
    const [when, not] = row
        ? descriptionHalves(row.description, "TAG WHEN:", "NOT:")
        : ["", ""];
    return (
        <div
            data-profile-line={id}
            className={
                "grid grid-cols-[1.25rem_8rem_minmax(0,1fr)_1.25rem_6.5rem] items-center gap-2 rounded-sm px-1 py-0.5 " +
                (checked ? "bg-accent/10" : "hover:bg-surface-elevated/30")
            }
        >
            <Checkbox
                checked={checked}
                disabled={disabled}
                aria-label={
                    row
                        ? `Archetype ${id} for ${cardName}`
                        : `Unregistered archetype ${id} for ${cardName}`
                }
                onCheckedChange={onToggle}
            />
            <span
                className={
                    "truncate font-mono text-xs " +
                    (row ? "text-text" : "text-danger-strong")
                }
            >
                {id}
            </span>
            <span className="truncate text-xs text-text-muted">
                {row
                    ? row.gloss.when
                    : "Not a catalogue row — untick it to make this profile saveable."}
            </span>
            {row ? (
                <CardProfileHelpTip
                    rowId={id}
                    first={{
                        label: "Tag when",
                        text: when,
                        example: row.example,
                    }}
                    second={{ label: "Not", text: not }}
                />
            ) : (
                <span />
            )}
            <CardProfileRelatedCards
                cards={related}
                field="archetypes"
                label={`Also tagged ${id}`}
            />
        </div>
    );
}
