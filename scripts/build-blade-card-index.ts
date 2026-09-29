/**
 * `bun run blade:card-index` — regenerate `data/blade-card-index.json`
 * (issue #4177): card name → the `must`/`stretch` blade entries that assert
 * the bot's CORRECT move acts with it, so the Bot Findings admin page can
 * show a class's proof without Blade growing an entry per card (ADR 0102)
 * and without the Convex bundle dragging in the whole search engine
 * `convex/gre/ai/blade/registry.ts` imports — the index is a committed JSON
 * artifact, exactly like `data/bot-reach-findings.json` (ADR 0141 § 4).
 *
 * Thin by design (issue #4177 review, finding S2): `buildBladeCardIndex` and
 * its types live in the registry-free `scripts/lib/blade-card-index.ts`, so
 * only THIS file and the drift test ever load the real registry — a VALUE
 * import that pulls in `search`/`moves`/`evaluate`/the card catalogue.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BLADE_SCENARIOS } from "../convex/gre/ai/blade/registry";
import {
    BLADE_CARD_INDEX_PATH,
    buildBladeCardIndex,
} from "./lib/blade-card-index";

if (import.meta.main) {
    const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
    const index = buildBladeCardIndex(BLADE_SCENARIOS);
    writeFileSync(
        join(ROOT, BLADE_CARD_INDEX_PATH),
        `${JSON.stringify(index, null, 2)}\n`
    );
    console.log(
        `blade:card-index: ${Object.keys(index).length} card(s) over ${BLADE_SCENARIOS.length} scenario(s)`
    );
}
