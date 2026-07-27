import { CAPABILITY_REGISTRY } from "@convex/limited/capabilityRegistry";

interface CardProfileCapabilityPickerProps {
    /** Visible group label — "Provides" or "Requires". Also the accessible
     *  name of the checkbox group. */
    legend: string;
    /** Currently selected Capability ids. */
    value: string[];
    onChange: (next: string[]) => void;
    disabled: boolean;
}

/** Checkbox group over the CLOSED Capability vocabulary
 *  (`convex/limited/capabilityRegistry.ts`, ADR 0072) — rendered from
 *  `CAPABILITY_REGISTRY` itself rather than a hand-copied list, so the
 *  editor can only ever offer names the `setCardProfile` mutation will
 *  accept and a registry row added/removed in code shows up here with no UI
 *  change. Used twice per card row (Provides, Requires) — the two directions
 *  of ADR 0072's matching — which is exactly why it is its own component
 *  rather than inlined markup. Each row's `description` becomes the
 *  checkbox's tooltip so the precise provides/requires meaning is available
 *  at the point of review. */
export default function CardProfileCapabilityPicker({
    legend,
    value,
    onChange,
    disabled,
}: CardProfileCapabilityPickerProps) {
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
                {CAPABILITY_REGISTRY.map((row) => (
                    <label
                        key={row.id}
                        title={row.description}
                        className="flex items-center gap-1 text-[11px] text-text"
                    >
                        <input
                            type="checkbox"
                            checked={value.includes(row.id)}
                            disabled={disabled}
                            aria-label={`${legend} ${row.id}`}
                            onChange={() => toggle(row.id)}
                        />
                        {row.id}
                    </label>
                ))}
            </div>
        </fieldset>
    );
}
