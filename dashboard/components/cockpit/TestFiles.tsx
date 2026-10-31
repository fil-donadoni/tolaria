/** A row's failing test files, one per line; a dash with none. */
export function TestFiles({ files }: { files: readonly string[] }) {
    if (files.length === 0) return <>—</>;
    return (
        <span className="flex flex-col font-mono text-xs">
            {files.map((f) => (
                <span key={f}>{f}</span>
            ))}
        </span>
    );
}
