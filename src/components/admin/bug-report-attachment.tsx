// The bug report's optional attachment: an image (usually a board
// screenshot) renders inline, anything else is a download link. The
// `bugReports` row stores only a storage id — `attachmentUrl` is minted at
// read time by `getBugReport` (`convex/bugReports.ts`), never persisted.
const IMAGE_EXTENSIONS = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
    "avif",
]);

function isImageName(name: string): boolean {
    const ext = name.split(".").pop()?.toLowerCase();
    return ext !== undefined && IMAGE_EXTENSIONS.has(ext);
}

export default function BugReportAttachment({
    url,
    name,
}: {
    url: string;
    name?: string;
}) {
    if (name && isImageName(name)) {
        return (
            <a href={url} target="_blank" rel="noreferrer">
                <img
                    src={url}
                    alt={name}
                    className="max-h-96 max-w-full rounded-sm border border-border-subtle"
                />
            </a>
        );
    }

    return (
        <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-accent-strong underline underline-offset-2 hover:text-accent"
        >
            Download {name ?? "attachment"}
        </a>
    );
}
