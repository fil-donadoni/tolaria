import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

interface CubeFilterProps {
    /** Selected cube slug, or `""` for no cube. */
    value: string;
    onChange: (slug: string) => void;
    /** Locked when the deck's Format is fixed to a non-Freeform format (edit
     *  mode, ADR 0036): Cube and Format are mutually exclusive discovery scopes,
     *  so a fixed non-Freeform Format disables the Cube selector entirely. */
    disabled?: boolean;
}

/**
 * Cube discovery filter (single-select). Restricts the builder's card pool to
 * a named cube's members (the built ∩ cube list). Sourced from the `cubeLists`
 * DB table via `api.cubes.list`; each option shows the cube's built-member
 * count. Mutually exclusive with the deck's Format (they sit side by side):
 * selecting a cube forces the Format to Freeform, and a fixed non-Freeform
 * Format disables this selector. Renders nothing until at least one cube exists.
 */
export default function CubeFilter({
    value,
    onChange,
    disabled = false,
}: CubeFilterProps) {
    const cubes = useQuery(api.cubes.list, {});
    if (!cubes || cubes.length === 0) return null;

    return (
        <label className="flex items-center gap-2 text-sm">
            <span className="text-label tracking-wide text-text-muted">
                Cube
            </span>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                title={
                    disabled
                        ? "Cube is unavailable while the deck's Format is fixed to a non-Freeform format"
                        : undefined
                }
                className="input-field px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Cube filter"
            >
                <option value="">None</option>
                {cubes.map((cube) => (
                    <option key={cube.slug} value={cube.slug}>
                        {cube.name} ({cube.count})
                    </option>
                ))}
            </select>
        </label>
    );
}
