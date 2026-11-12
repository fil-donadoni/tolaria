/**
 * The blade suite's search-variant name → `SearchVariant` resolution, shared
 * by the shard runner (`BLADE_VARIANT=<name> bun run test:blade`) and the
 * census runner (`bun run blade:census --variant <name>`), so both read one
 * name the same way.
 *
 * A name is either a `LADDER_VARIANTS` entry or the synthetic
 * `no-rule:<mechanism>[,<mechanism>]` (the root-rule moratorium's removal
 * test). An unknown name THROWS rather than falling back to "no variant": a
 * typo'd variant that silently ran the baseline would report "the variant
 * breaks nothing", which is indistinguishable from the real answer and wrong.
 */
import {
    LADDER_VARIANTS,
    NO_RULE_VARIANT_PREFIX,
    noRuleVariant,
    type SearchVariant,
} from "../searchVariant";

/** `null` for an unset or empty name (the production defaults). */
export function resolveBladeVariant(
    name: string | undefined
): SearchVariant | null {
    if (!name) return null;
    if (name.startsWith(NO_RULE_VARIANT_PREFIX)) return noRuleVariant(name);
    const variant = LADDER_VARIANTS[name];
    if (!variant) {
        throw new Error(
            `BLADE_VARIANT "${name}" is not in LADDER_VARIANTS — known: ${Object.keys(
                LADDER_VARIANTS
            ).join(", ")}`
        );
    }
    return variant;
}
