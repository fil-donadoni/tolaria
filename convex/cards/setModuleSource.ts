// Where the catalogue reads a hand-written Set module from (issue #5615, PRD
// #5602, ADR 0113 Amendment V). A LEAF: types only, so both sides of the
// seam — `./setModules` on the server, `src/lib/catalogue/set-modules.browser.ts`
// in a client graph — implement one contract and `catalogue.ts` reads neither
// side's shape.
//
// The server imports every Set statically: a Convex mutation cannot load
// code, and the per-call heap is bounded elsewhere (ADR 0113 Amendment IV).
// The client installs a Set on demand, as ONE lazily imported chunk per Set,
// so a game downloads the Sets of its Definition Manifest and nothing else.
// `getDefinition` stays synchronous (ADR 0113 §1): a definition is asked for
// only once its Set is resident, which is the gate's job, never this one's.

/** A Set module's exports: its `defineCard` factories and whatever helpers
 *  it shares (`convex/cards/sets/<code>/index.cards.ts`). */
export type SetModuleExports = Readonly<Record<string, unknown>>;

export interface SetModuleSource {
    /** Every Set code this graph can serve, in catalogue order: the order
     *  the Definition Index lists hand-written definitions in. */
    readonly codes: readonly string[];
    /** The Set's exports when RESIDENT in this graph, else `undefined`. On
     *  the server every known Set is resident from load. */
    resident(code: string): SetModuleExports | undefined;
    /** Make the Set resident: resolves once {@link resident} answers. A
     *  rejection is not memoised, so a retry really re-loads. Rejects on a
     *  code this graph does not serve. */
    install(code: string): Promise<SetModuleExports>;
}
