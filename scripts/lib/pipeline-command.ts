/**
 * The opening slash command of an ADR 0110 pipeline session.
 *
 * The skill was `/next-issue` until it became `/next-ticket` (issue #5105);
 * sessions already recorded in telemetry carry the old name as DATA. Every
 * reader that classifies a session by its opening command goes through this
 * one predicate, so both names are one population.
 */
const PIPELINE_COMMAND = /^\/next-(?:ticket|issue)\b/;

/** True for a session opened with `/next-ticket` or its former name `/next-issue`. */
export function isPipelineCommand(cmd: string | null | undefined): boolean {
    return PIPELINE_COMMAND.test(cmd ?? "");
}
