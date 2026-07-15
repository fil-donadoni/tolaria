import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

interface CubeFilterProps {
    /** Selected cube slug, or `""` for no cube. */
    value: string;
    onChange: (slug: string) => void;
}

/**
 * Cube discovery filter (single-select). Restricts the builder's card pool to
 * a named cube's members (the built ∩ cube list). Sourced from the `cubeLists`
 * DB table via `api.cubes.list`; each option shows the cube's built-member
 * count. Orthogonal to the deck's Format — a pure discovery narrowing, it never
 * affects deck legality. Renders nothing until at least one cube exists.
 */
export default function CubeFilter({ value, onChange }: CubeFilterProps) {
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
                className="input-field px-2 py-1"
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
