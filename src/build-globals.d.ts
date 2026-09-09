// Build-identity constants substituted by the bundler (`scripts/lib/build-define.ts`,
// issue #3256). Declared as ambient globals rather than read off
// `import.meta.env` because they are not environment variables — they are
// values the BUILD knows and the client cannot: a client-computed commit is a
// client-forgeable commit.
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;
