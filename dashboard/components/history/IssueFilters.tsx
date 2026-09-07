import type { IssueRow } from "../../lib/historyPayload";
import {
    issueFamilies,
    issueStates,
    issueTiers,
    type IssueFilterState,
} from "../../lib/historyRows";
import { FilterSelect } from "./FilterSelect";
import { SearchField } from "./SearchField";

/**
 * The Issues card's own filter row (PRD #3148 S3).
 *
 * The options are derived from the ROWS, not from `/api/meta`: these three
 * columns are computed per issue by the `/api/issues` route and are not
 * dimensions of any fact table, so the only place their value set exists is
 * the payload on screen. That also means the pickers can never offer a value
 * that filters to zero.
 *
 * DELIBERATELY OUTSIDE THE URL ROUND TRIP, carried over from #2635's round-2
 * review: `sliceToParams` / `paramsToSlice` (`historyState.ts`) round-trip the
 * SHARED filter bar — dataset, metric, split, range, chips — and this table's
 * own sort and filters are separate state that does not survive a bookmark.
 * That was a scope call, not an oversight; it is noted here so the next reader
 * does not mistake the gap for a bug in the round trip itself.
 */
export function IssueFilters({
    rows,
    value,
    onChange,
}: {
    rows: readonly IssueRow[];
    value: IssueFilterState;
    onChange: (next: IssueFilterState) => void;
}) {
    return (
        <div className="mb-3 flex flex-wrap items-center gap-3">
            <FilterSelect
                label="family"
                value={value.family}
                options={issueFamilies(rows)}
                onChange={(family) => onChange({ ...value, family })}
            />
            <FilterSelect
                label="tier"
                value={value.tier}
                options={issueTiers(rows)}
                onChange={(tier) => onChange({ ...value, tier })}
            />
            <FilterSelect
                label="state"
                value={value.state}
                options={issueStates(rows)}
                onChange={(state) => onChange({ ...value, state })}
            />
            <SearchField
                value={value.text}
                placeholder="#N / title"
                onChange={(text) => onChange({ ...value, text })}
            />
        </div>
    );
}
