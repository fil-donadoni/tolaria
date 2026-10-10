// PROTOTYPE — throwaway. Incompleteness Notice for the mock sources.
import { Banner } from "~/components/ui/banner";
import type { PackSource } from "./setup-data";

export default function SetupNotice({ source }: { source: PackSource }) {
    if (source.missing === 0) return null;
    return (
        <Banner tone="info" title="Incompleteness Notice" role="status">
            {source.codes} is missing {source.missing} cards with no implemented
            definition yet. They are dropped from the print run and weights are
            renormalized, so no booster ever shows a placeholder.
        </Banner>
    );
}
