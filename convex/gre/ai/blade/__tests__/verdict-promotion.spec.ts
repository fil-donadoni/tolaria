// `bun run verdicts:validate` / `verdicts:promote` / `verdicts:testers` — the engine step
// (issue #3583). Not a test: a runner the promotion script spawns, gated on
// the two paths it is handed, for the reason `verdictPromotion.ts` gives (the
// engine reaches `lib.dom`, which a `scripts/` entry cannot import). Its
// behaviour is asserted in the bot suite, `verdictPromotion.bot.test.ts`.
//
// Unset — every `bun run test:blade` — it skips.
import { describe, expect, it } from "vitest";
import {
    VERDICT_PROMOTION_IN_ENV,
    VERDICT_PROMOTION_OUT_ENV,
    type VerdictPromotionInput,
} from "../../verdicts/promotion";
import { runVerdictPromotionStep } from "../verdictPromotion";

const ENV: Record<string, string | undefined> =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};

const IN = ENV[VERDICT_PROMOTION_IN_ENV];
const OUT = ENV[VERDICT_PROMOTION_OUT_ENV];

describe.runIf(Boolean(IN && OUT))("verdict promotion — engine step", () => {
    it("classifies the store snapshot and, for a promotion, fits it", async () => {
        const fs = (await import(/* @vite-ignore */ "node" + ":fs")) as {
            readFileSync: (p: string, enc: string) => string;
            writeFileSync: (p: string, d: string) => void;
        };
        const input = JSON.parse(
            fs.readFileSync(IN as string, "utf8")
        ) as VerdictPromotionInput;
        const output = runVerdictPromotionStep(input);
        fs.writeFileSync(OUT as string, JSON.stringify(output));
        expect(output.mode).toBe(input.mode);
    }, 3_600_000);
});
