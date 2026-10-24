// Runs `playMisses` over a synthetic miss set under Bun and prints what a
// test compares (issue #6686): the verdicts in CORPUS order — what
// `buildLockfile` walks — and the order the pool's map iterates in, which the
// lockfile must never depend on.
import { playMisses } from "../../lib/bot-reach-shard";

const [, , workers, count, ...extra] = process.argv;
const ids = [
    ...Array.from({ length: Number(count) }, (_, i) => `card-${i}`),
    ...extra,
];
const misses = new Map(ids.map((id) => [id, { id } as never]));
const verdicts = await playMisses(misses, {
    workers: Number(workers),
    playerModule: new URL(
        process.env.SHARD_PLAYER ?? "./fake-bot-player.ts",
        import.meta.url
    ).href,
});
console.log(
    JSON.stringify({
        corpusOrder: ids.map((id) => [id, verdicts.get(id) ?? null]),
        arrivalOrder: [...verdicts.keys()],
    })
);
