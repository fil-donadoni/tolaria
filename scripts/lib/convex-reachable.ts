// "Does the Convex deployment answer?" — one probe for every caller (issue
// #4945). `check:ui` asks it before a walk and refuses to start a backend;
// `convex:ensure` asks it before and after starting one; the health
// preflight (issue #4943) asks it to tell an `infra` failure from a RED tip.
// Three copies of a fetch-with-timeout would drift on what "answers" means.
import * as fs from "node:fs";
import * as path from "node:path";

/** Any HTTP response — whatever the status — means a server is listening. A
 *  refused connection, a reset or the timeout means it is not. */
export async function reachable(
    url: string,
    timeoutMs: number
): Promise<boolean> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        await fetch(url, { signal: ctrl.signal });
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(t);
    }
}

/** `.env.local` is gitignored and holds the deployment URL; the credentials go
 *  there too when they are not in the environment. Parsed, never echoed. */
export function readEnvLocal(root: string): Record<string, string> {
    const file = path.join(root, ".env.local");
    if (!fs.existsSync(file)) return {};
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
}

/** The local backend's `--instance-name`, from `CONVEX_DEPLOYMENT=local:<name>`
 *  (the CLI writes a trailing `# team: …` comment on the same line). `null`
 *  for a cloud deployment or none: there is no local process to look for. */
export function localInstanceName(
    deployment: string | undefined
): string | null {
    const m = /^local:(\S+)/.exec((deployment ?? "").trim());
    return m ? m[1] : null;
}
