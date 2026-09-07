/**
 * A cell whose text is longer than its column (PRD #3148 S3).
 *
 * The vanilla tables each hand-rolled this as a character count —
 * `esc((r.title ?? "").slice(0, 42))` in Issues, `.slice(0, 38)` in Sessions —
 * with the full string in a `title` attribute beside it. Three different
 * numbers, none of them related to how wide the column actually is: at a
 * narrow viewport the 42-character title still overflowed, and at a wide one
 * it was cut with room to spare.
 *
 * One CSS truncation instead, so the ellipsis lands where the column really
 * ends. The `title` attribute stays and carries the WHOLE string — that is the
 * half the treatment existed for, and the half a person uses.
 */
export function TruncatedCell({
    text,
    className,
}: {
    text: string;
    className?: string;
}) {
    return (
        <span
            className={`block max-w-full truncate ${className ?? ""}`}
            title={text}
        >
            {text}
        </span>
    );
}
