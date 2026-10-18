// The Brain worker's script URL (issue #5617), a virtual module the bundler
// writes (`scripts/lib/vite-brain-worker-chunk.ts`): under `vite build` the
// hashed entry chunk the page's own build emits for `src/lib/ai/brain.worker.ts`,
// under the dev server and vitest the source module's dev URL. Read only by
// `src/lib/ai/brain-client.ts`.
declare module "virtual:brain-worker-url" {
    const url: string;
    export default url;
}
