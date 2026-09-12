// Test-only bridge between a suite's `convex/react` mock and `useQueries`.
//
// `useResilientQuery` (issue #3266) is built on `useQueries` rather than
// `useQuery` — that is the whole point of it, since `useQuery` re-throws a
// failed execution during render and tears the board down. A suite that mocks
// `convex/react` therefore has to answer BOTH entry points, or every
// subscription the board holds resolves to nothing.
//
// One resolver feeds both, so a mock can never end up answering `useQuery` and
// `useQueries` differently for the same query.

/** What a mocked deployment answers for one subscription. `ref` is whatever
 *  the suite's `api` is (the real generated proxy, or a plain string when the
 *  suite discriminates by name). */
export type MockQueryResolver = (ref: unknown, args: unknown) => unknown;

type QueryRequests = Record<string, { query: unknown; args: unknown }>;

/** The `useQueries` half of a `convex/react` mock. A skipped subscription
 *  never appears here at all — `useResilientQuery` expresses "skip" as an
 *  EMPTY request, exactly as `useQuery` does — so a resolver that special-cases
 *  `"skip"` keeps working untouched. */
export function mockUseQueries(resolve: MockQueryResolver) {
    return (requests: QueryRequests): Record<string, unknown> =>
        Object.fromEntries(
            Object.entries(requests).map(([key, request]) => [
                key,
                resolve(request.query, request.args),
            ])
        );
}
