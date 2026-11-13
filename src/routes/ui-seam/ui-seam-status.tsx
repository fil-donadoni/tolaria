// A seam page's one status line (issue #9272, ADR 0180): pending text while
// its action runs, the refusal once it fails — `<testId>-error`, the element
// the lane reads a refusal from.
interface UiSeamStatusProps {
    testId: string;
    pending: string;
    error: string | null;
}

export default function UiSeamStatus({
    testId,
    pending,
    error,
}: UiSeamStatusProps) {
    return (
        <div className="p-6 text-text" data-testid={testId}>
            {error === null ? (
                <p>{pending}</p>
            ) : (
                <p role="alert" data-testid={`${testId}-error`}>
                    {error}
                </p>
            )}
        </div>
    );
}
