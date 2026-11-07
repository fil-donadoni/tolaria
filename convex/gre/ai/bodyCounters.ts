/** Counter types that ARE the body they sit on (CR 122.1a): spending one
 *  lowers the power and toughness the evaluation already reads. */
export const BODY_COUNTER_TYPES: ReadonlySet<string> = new Set([
    "+1/+1",
    "-1/-1",
]);
