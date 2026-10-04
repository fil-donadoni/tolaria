import { Button } from "@/components/ui/button";
import { PAIR_FILTERS, type PairFilter } from "./verdict-review-model";

/** The admin's pair filter (issue #4801, user story 35): complete pairs,
 *  incomplete Conditional Verdicts, Absolute Verdicts — each with its count. */
export default function VerdictPairFilter({
    value,
    counts,
    onChange,
}: {
    value: PairFilter;
    counts: Record<PairFilter, number>;
    onChange: (next: PairFilter) => void;
}) {
    return (
        <div
            role="group"
            aria-label="Filter verdicts by pair"
            className="flex flex-wrap gap-2"
        >
            {PAIR_FILTERS.map((filter) => (
                <Button
                    key={filter.id}
                    type="button"
                    size="sm"
                    variant={filter.id === value ? "primary" : "secondary"}
                    aria-pressed={filter.id === value}
                    onClick={() => onChange(filter.id)}
                >
                    {filter.label} ({counts[filter.id]})
                </Button>
            ))}
        </div>
    );
}
