#!/usr/bin/env bun
// `bun run corpus:ensure` — give THIS tree a Card Corpus cache matching its
// pin (issue #6381): keep it, copy the primary checkout's only if that matches
// this tree's pin, else download the pinned bulk (never `--repin`). The one
// entry point for `worktree:init`, the housekeeping refresh of the primary
// and the skills' step 0; `derive-sync` shares the decision
// (`lib/corpus-cache.ts`). Exit 1 when no matching cache can be had.
import { dirname, join } from "node:path";
import {
    pinnedSha,
    realCorpusSeedDeps,
    seedPinnedCorpus,
} from "./lib/corpus-cache";
import { primaryCheckout } from "./lib/primary-checkout";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

const seed = seedPinnedCorpus(
    ROOT,
    primaryCheckout(ROOT),
    pinnedSha(ROOT),
    realCorpusSeedDeps
);
if (!seed.ok) {
    console.error(`corpus:ensure — ${seed.why}`);
    process.exit(1);
}
console.error(`corpus:ensure — cache ${seed.how} for the pin`);
