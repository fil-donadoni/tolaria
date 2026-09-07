import { useMetaLine } from "../lib/metaLine";

/**
 * The store line in the header (PRD #3148 S3) — how many rows the telemetry
 * store holds, over what range, and when it was last ingested. Or why it could
 * not be read at all.
 *
 * It reads a STORE rather than a prop because it is chrome and its content is
 * History's: the lazily-imported History chunk publishes, this subscribes.
 * Threading it as a prop would mean the header's own graph knowing about
 * `/api/meta`, which is exactly the static edge the Now/History data boundary
 * forbids.
 */
export function MetaLine() {
    return (
        <span className="text-muted-foreground text-xs" id="meta-line">
            {useMetaLine()}
        </span>
    );
}
