import { Term } from "./Term";
import type { TermId } from "../glossary";

/**
 * The `ⓘ` beside a section heading or a traffic light (issue #3135, ported in
 * PRD #3148 S2).
 *
 * The glyph is the visual, so it carries an accessible name of its own — a
 * bare `ⓘ` announces as "circled latin small letter i", which tells a screen
 * reader nothing about what it opens. The glossary tip is the tooltip; this
 * says which explanation it is.
 */
export function InfoMark({ id, what }: { id: TermId; what: string }) {
    return (
        <Term id={id}>
            <span role="img" aria-label={`What ${what} shows`}>
                ⓘ
            </span>
        </Term>
    );
}
