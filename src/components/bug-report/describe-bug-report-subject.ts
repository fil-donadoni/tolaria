import type { BugReportSubject } from "~/lib/bug-report-requests";

/** The line that opens a filed report made from a card (issue #9162): card
 *  name first, then the print id a maintainer greps for (`CardDefinition.id`
 *  is a Scryfall print id, ADR 0108). */
export function describeBugReportSubject(subject: BugReportSubject): string {
    return subject.cardId
        ? `**Card:** ${subject.cardName} (\`${subject.cardId}\`)`
        : `**Card:** ${subject.cardName}`;
}
