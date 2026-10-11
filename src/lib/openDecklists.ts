// Open Decklists copy (issue #5386, `GLOSSARY.md`). One place for the words
// the create toggle, the event list row and the Join action all say, so the
// consequence a creator reads is the warning a joining player reads. The rule
// itself lives server-side (`convex/limited/eventProjection.ts`'s
// `areOtherSeatsRevealed`); this module only describes it.

/** Shown beside the create toggle: what turning it on does. */
export const OPEN_DECKLISTS_CONSEQUENCE =
    "Every seat's deck and pick order become visible to the whole table from the Games phase — never during the draft.";

/** Shown before Join on an event that has it on. */
export const OPEN_DECKLISTS_JOIN_WARNING =
    "Open Decklists: your deck and pick order will be visible to the whole table from the Games phase.";

/** The review banner while it applies. */
export const OPEN_DECKLISTS_REVIEW_NOTICE =
    "Open Decklists is on: every seat's deck and pick order is visible to the table.";

/** A hidden seat's note in the review. */
export const SEAT_LOCKED_NOTE = "Revealed when the event ends";
