// What a lowering could not carry, as a LIST (issue #3457, PRD #3397).
//
// The same disclosure on both halves of the quiz: over a refusal, where the
// notes are usually WHY it refused, and over a buildable quiz, where they are
// the gap between the board judged and the board played. One component rather
// than two copies — they were identical markup and would have drifted apart on
// the first change to either (PR review, issue #3457).
//
// CLOSED by default, always: a real capture runs to twenty-odd entries, and
// open they push the panel's own buttons off the 293px debug sheet.

export default function AiDecisionDroppedNotes({ notes }: { notes: string[] }) {
    if (notes.length === 0) return null;
    return (
        <details>
            <summary className="cursor-pointer text-[10px] text-text-disabled">
                Not captured in this position ({notes.length})
            </summary>
            <ul className="ml-3 list-disc text-[10px] text-text-muted">
                {notes.map((note, i) => (
                    <li key={i}>{note}</li>
                ))}
            </ul>
        </details>
    );
}
