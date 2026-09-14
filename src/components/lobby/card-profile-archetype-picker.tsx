import { ARCHETYPE_REGISTRY } from "@convex/limited/archetypeRegistry";

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
}

/** Checkbox group over the CLOSED Archetype vocabulary
 *  (`convex/limited/archetypeRegistry.ts`, ADR 0072, issue #3597) — the exact
 *  twin of `CardProfileCapabilityPicker`, rendered from `ARCHETYPE_REGISTRY`
 *  itself rather than a hand-copied list, so the editor can only ever offer
 *  names the `setCardProfile` mutation will accept.
 *
 *  Replaces the free-text comma-separated field this editor shipped with.
 *  That field was the one place in the whole model where a reviewer could
 *  mint vocabulary by typing, and `archetypeFitTerm` groups Pool commitment by
 *  EXACT STRING EQUALITY — so `reanimator`, `reanimate` and
 *  `graveyard-reanimator` were three plans to the scorer and one to the human
 *  who typed them. Each row's `description` becomes the checkbox's tooltip:
 *  it carries the `TAG WHEN:` / `NOT:` boundary, which is the judgement being
 *  captured, at the point it is captured. */
export default function CardProfileArchetypePicker({
    legend,
    value,
    onChange,
    disabled,
    cardName,
}: CardProfileArchetypePickerProps) {
    function toggle(id: string) {
        onChange(
            value.includes(id)
                ? value.filter((entry) => entry !== id)
                : [...value, id]
        );
    }

    return (
        <fieldset className="flex flex-col gap-1">
            <legend className="text-[11px] font-medium text-text-muted">
                {legend}
            </legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
                {ARCHETYPE_REGISTRY.map((row) => (
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
