import { issueUrl } from "../lib/format";

/**
 * `#N`, linked to its GitHub issue (#2635 AC). Opens in a new tab: following a
 * reference to the issue that produced a row is never meant to navigate the
 * operator away from the dashboard they were reading.
 */
export function IssueLink({ issue }: { issue: number }) {
    return (
        <a
            className="text-primary underline-offset-2 hover:underline"
            href={issueUrl(issue)}
            target="_blank"
            rel="noopener noreferrer"
        >
            #{issue}
        </a>
    );
}
