/**
 * The work-directory claim protocol shared by the blade's pooled workers
 * (`census.spec.ts`, `probe.spec.ts`): a claim is an atomic `mkdir`, so any
 * number of vitest processes share one job list with no coordinator.
 *
 * `node:fs` is handed in, never imported: the blade config's environment
 * resolves a static `node:` import for the browser build.
 */
export type WorkFs = {
    readFileSync: (p: string, enc: "utf8") => string;
    writeFileSync: (p: string, d: string) => void;
    mkdirSync: (p: string, o?: { recursive?: boolean }) => void;
    existsSync: (p: string) => boolean;
};

/** `node:fs`, loaded the way the blade config allows. */
export async function loadWorkFs(): Promise<WorkFs> {
    return (await import(/* @vite-ignore */ "node" + ":fs")) as WorkFs;
}

/** `mkdir` as an atomic claim: true for the one caller that created it. */
export function claimPath(fs: WorkFs, path: string): boolean {
    try {
        fs.mkdirSync(path);
        return true;
    } catch (e) {
        if ((e as { code?: string }).code === "EEXIST") return false;
        throw e;
    }
}
