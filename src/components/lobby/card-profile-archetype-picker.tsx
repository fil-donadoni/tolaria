import type { ArchetypeCatalogueRow } from "@convex/limited/archetypeCatalogueCore";

interface CardProfileArchetypePickerProps {
    /** Visible group label — also the accessible name of the checkbox group. */
    legend: string;
    /** Currently selected Archetype ids. */
    value: string[];
    onChange: (next: string[]) => void;
    disabled: boolean;
    /** Card name, so each checkbox's accessible name is unique on a page
     *  rendering the whole scope — the Capability picker gets uniqueness from
     *  its own legend (Provides/Requires) because only one row is ever
     *  expanded; this group has no such second axis. */
    cardName: string;
    /** The effective Archetype Catalogue (seed ∪ DB, `listArchetypeCatalogue`)
     *  — the choices offered, in order. */
    catalogue: readonly ArchetypeCatalogueRow[];
}

/** Checkbox group over the CLOSED Archetype vocabulary — the Archetype
 *  Catalogue (`convex/limited/archetypeCatalogueCore.ts`, ADR 0167, issue
 *  #8892) — the twin of `CardProfileCapabilityPicker`, rendered from the
 *  catalogue it is handed (seed ∪ DB) rather than a hand-copied list, so the
 *  editor offers exactly the names the `setCardProfile` mutation accepts and
 *  a row an Admin adds shows up here with no code change.
 *
 *  Replaces the free-text comma-separated field this editor shipped with.
 *  That field was the one place in the whole model where a reviewer could
 *  mint vocabulary by typing, and `archetypeFitTerm` groups Pool commitment by
 *  EXACT STRING EQUALITY — so `reanimator`, `reanimate` and
 *  `graveyard-reanimator` were three plans to the scorer and one to the human
 *  who typed them. Each row's `description` becomes the checkbox's tooltip:
 *  it carries the `TAG WHEN:` / `NOT:` boundary, which is the judgement being
 *  captured, at the point it is captured.
 *
 *  UNREGISTERED STORED VALUES GET A ROW OF THEIR OWN. Closing a vocabulary
 *  that was open for a whole release cannot assume the stored data already
 *  obeys it: a `cardArchetypes` row written through the old free-text field may
 *  carry a name the catalogue does not have, and a picker that rendered only
 *  catalogue rows would leave that name INVISIBLE while still submitting it —
 *  so every save of that row would fail server-side (`cardProfileWriteErrors`
 *  rejects it) naming a string the reviewer cannot see or untick, with Clear,
 *  which discards the whole override, the only escape. Rendering it as a
 *  checked, removable, visibly-flagged entry turns that dead end into the one
 *  action the reviewer wants: see the stray name, untick it, save. */
export default function CardProfileArchetypePicker({
    legend,
    value,
    onChange,
    disabled,
    cardName,
    catalogue,
}: CardProfileArchetypePickerProps) {
    function toggle(id: string) {
        onChange(
            value.includes(id)
                ? value.filter((entry) => entry !== id)
                : [...value, id]
        );
    }

    // Stored names the catalogue does not have — legacy free-text values, or
    // a row written before a catalogue row was retired. Never offered as a
    // CHOICE: they can only be unticked, so the vocabulary still only grows
    // through the catalogue.
    const ids = new Set(catalogue.map((row) => row.id));
    const unregistered = value.filter((entry) => !ids.has(entry));

    return (
        <fieldset className="flex flex-col gap-1">
            <legend className="text-[11px] font-medium text-text-muted">
                {legend}
            </legend>
            {unregistered.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {unregistered.map((entry) => (
                        <label
                            key={entry}
                            title={`"${entry}" is not a row of the Archetype Catalogue — it predates the closed vocabulary. Untick it to make this profile saveable.`}
                            className="flex items-center gap-1 rounded-sm bg-danger-strong/20 px-1 text-[11px] text-danger-strong"
                        >
                            <input
                                type="checkbox"
                                checked
                                disabled={disabled}
                                aria-label={`Unregistered archetype ${entry} for ${cardName}`}
                                onChange={() => toggle(entry)}
                            />
                            {entry} (unregistered)
                        </label>
                    ))}
                </div>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-1">
                {catalogue.map((row) => (
                    <label
                        key={row.id}
                        title={row.description}
                        className="flex items-center gap-1 text-[11px] text-text"
                    >
                        <input
                            type="checkbox"
                            checked={value.includes(row.id)}
                            disabled={disabled}
                            aria-label={`Archetype ${row.id} for ${cardName}`}
                            onChange={() => toggle(row.id)}
                        />
                        {row.id}
                    </label>
                ))}
            </div>
        </fieldset>
    );
}
