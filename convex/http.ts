import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { VERDICT_FORWARD_PATH } from "./verdictForward";
import { forwardVerdicts } from "./verdictForwardHttp";

const http = httpRouter();

auth.addHttpRoutes(http);

// A deployment without the Verdict Store's write key forwards its outbox here
// (issue #3745).
http.route({
    path: VERDICT_FORWARD_PATH,
    method: "POST",
    handler: forwardVerdicts,
});

export default http;
