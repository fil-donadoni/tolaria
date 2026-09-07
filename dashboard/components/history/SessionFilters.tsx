import type { SessionRow } from "../../lib/historyPayload";
import {
    sessionCommands,
    type SessionFilterState,
} from "../../lib/historyRows";
import { FilterSelect } from "./FilterSelect";
import { SearchField } from "./SearchField";

/**
 * The Sessions card's own filter row (PRD #3148 S3).
 *
 * One picker — the COMMAND FAMILY, the first word of the command line, so
 * `/next-issue 3152` and `/next-issue 3153` are one bucket — plus a search
 * over title, command and session id. Same scope call as `IssueFilters`: this
 * state is the table's own and does not round-trip through the URL.
 */
export function SessionFilters({
    rows,
    value,
    onChange,
}: {
    rows: readonly SessionRow[];
    value: SessionFilterState;
    onChange: (next: SessionFilterState) => void;
}) {
    return (
        <div className="mb-3 flex flex-wrap items-center gap-3">
            <FilterSelect
                label="command"
                value={value.cmd}
                options={sessionCommands(rows)}
                onChange={(cmd) => onChange({ ...value, cmd })}
            />
            <SearchField
                value={value.text}
                placeholder="title / command / id"
                onChange={(text) => onChange({ ...value, text })}
            />
        </div>
    );
}
