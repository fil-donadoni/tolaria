import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { NowSection } from "./NowSection";
import { ActionButton } from "./ActionButton";
import { ClaimSessionCell } from "./ClaimSessionCell";
import { StateBadge } from "../StateBadge";
import { Term } from "../Term";
import { Unavailable } from "../Unavailable";
import { EmptyNote } from "../EmptyNote";
import { IssueLink } from "../IssueLink";
import { fmtAgo, plural } from "../../lib/format";
import { SECTION_IDS, claimsHeaderCount } from "../../lib/nowLights";
import {
    MIN_AGE_HOURS,
    STAGE_SENTENCE,
    STAGE_TERM,
    VERDICT_TERM,
    VERDICT_TONE,
    VERDICT_WORD,
    dependentsTitle,
} from "../../lib/nowClaims";
import type { NowPayload } from "../../lib/nowPayload";

/**
 * The claimed-issues table (#2519/#2632/#3135, ported in PRD #3148 S2).
 *
 * THREE UNAVAILABLE STATES, each degrading exactly what it owns and nothing
 * more:
 *
 *   - `claimsError` — the whole table. Never an empty section: at 0/5000
 *     GraphQL quota this panel used to say "no claimed issues", reading as an
 *     idle, drained loop.
 *   - `dependentsError` — ONE note, not a per-row absence nobody could
 *     distinguish from "checked, blocks nothing". The claims themselves are
 *     still known and still render.
 *   - `liveError` — likewise for the session column.
 *
 * The Release button is offered on exactly the rows `classifyClaim` has
 * already called `orphan` — "a button whose action is not currently sensible
 * is not shown" (#2636 AC). That predicate is consumed, never re-derived.
 */
export function ClaimsTable({
    data,
    nowMs,
}: {
    data: NowPayload;
    nowMs: number;
}) {
    const count = claimsHeaderCount(data);
    const claims = data.claims;

    let body;
    if (data.claimsError != null) {
        body = (
            <Unavailable
                reason={data.claimsError}
                consequence='cannot tell whether anything is claimed — not the same as "no claimed issues"'
            />
        );
    } else if (!claims || claims.length === 0) {
        body = <EmptyNote>No claimed issues.</EmptyNote>;
    } else {
        body = (
            <div className="flex flex-col gap-3">
                {data.dependentsError != null ? (
                    <Unavailable
                        reason={`blocked-by counts unavailable — ${data.dependentsError}`}
                        consequence='cannot tell whether any claim blocks others — not the same as "blocks nothing"'
                    />
                ) : null}
                {data.liveError != null ? (
                    <Unavailable
                        reason={`session lookup unavailable — ${data.liveError}`}
                        consequence="cannot tell which session is on each claim — not the same as none"
                    />
                ) : null}
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>
                                    <Term id="claim.live">status</Term>
                                </TableHead>
                                <TableHead>
                                    <Term id="issue" />
                                </TableHead>
                                <TableHead>
                                    <Term id="pri">Priority</Term>
                                </TableHead>
                                <TableHead>
                                    <Term id="stage.claimed">stage</Term>
                                </TableHead>
                                <TableHead>
                                    <Term id="first_ts">age</Term>
                                </TableHead>
                                <TableHead>
                                    <Term id="claim.session" />
                                </TableHead>
                                <TableHead>
                                    <Term id="issue">title</Term>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {claims.map((c) => {
                                const state = c.verdict?.state ?? "live";
                                const reason = c.verdict?.reason ?? "";
                                const amber =
                                    typeof c.ageHours === "number" &&
                                    c.ageHours >= MIN_AGE_HOURS;
                                return (
                                    <TableRow key={c.issue}>
                                        <TableCell>
                                            <span className="flex flex-wrap items-center gap-1.5">
                                                {/*
                                                    The classifier's own
                                                    REASON rides on the mark
                                                    ("no branch after 6h"),
                                                    the way the vanilla table
                                                    carried it: the glossary
                                                    says what `orphaned`
                                                    means, this says why THIS
                                                    row is one, and only the
                                                    row knows that.
                                                */}
                                                <StateBadge
                                                    tone={VERDICT_TONE[state]}
                                                    term={VERDICT_TERM[state]}
                                                    title={reason}
                                                    label={
                                                        reason
                                                            ? `${VERDICT_WORD[state]}: ${reason}`
                                                            : undefined
                                                    }
                                                >
                                                    {VERDICT_WORD[state]}
                                                </StateBadge>
                                                {state === "orphan" ? (
                                                    <ActionButton
                                                        action="claim.release"
                                                        issue={c.issue}
                                                    />
                                                ) : null}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <IssueLink issue={c.issue} />
                                        </TableCell>
                                        <TableCell>
                                            {c.priority ? (
                                                <StateBadge
                                                    tone={
                                                        c.priority === "P0"
                                                            ? "bad"
                                                            : c.priority ===
                                                                "P1"
                                                              ? "warn"
                                                              : "neutral"
                                                    }
                                                    term="pri"
                                                >
                                                    {c.priority}
                                                </StateBadge>
                                            ) : (
                                                <span className="text-muted-foreground">
                                                    —
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Term id={STAGE_TERM[c.stage]}>
                                                {STAGE_SENTENCE[c.stage] ??
                                                    c.stage}
                                            </Term>
                                        </TableCell>
                                        <TableCell
                                            className={cn(
                                                "tabular-nums",
                                                amber && "text-state-warn"
                                            )}
                                        >
                                            {fmtAgo(c.ageHours)}
                                        </TableCell>
                                        <TableCell>
                                            <ClaimSessionCell
                                                claim={c}
                                                data={data}
                                                nowMs={nowMs}
                                            />
                                        </TableCell>
                                        {/*
                                            The title WRAPS — shadcn's cell is
                                            `whitespace-nowrap`, and the
                                            vanilla table gave this column its
                                            own `prose` rule for the same
                                            reason: one long issue title
                                            otherwise widens the whole table
                                            and pushes every column after it
                                            out of view.
                                        */}
                                        <TableCell className="max-w-md whitespace-normal">
                                            {c.title}
                                            {typeof c.dependents === "number" &&
                                            c.dependents > 0 ? (
                                                <span
                                                    className="text-muted-foreground ml-1.5 text-xs"
                                                    title={dependentsTitle(
                                                        c.issue,
                                                        c.dependents
                                                    )}
                                                >
                                                    blocks {c.dependents}{" "}
                                                    {plural(
                                                        c.dependents,
                                                        "other",
                                                        "others"
                                                    )}
                                                </span>
                                            ) : null}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </div>
        );
    }

    return (
        <NowSection
            id={SECTION_IDS.claims}
            term="section.claims"
            title="Claimed issues"
            meta={`${count} ${count === 1 ? "issue" : "issues"} in progress`}
        >
            {body}
        </NowSection>
    );
}
