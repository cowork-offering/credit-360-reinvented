/**
 * c360-relay - the execution relay for Customer 360 writes.
 *
 * WHY THIS EXISTS. The Salesforce-hosted MCP dispatcher runs ExecuteLoanModification in a context
 * that cannot host nCino's credit-action engine: the managed LoanTrigger dies uncatchably on
 * session APIs there. The SAME Apex runs cleanly when invoked through the REST Actions API. The
 * dispatcher context CAN make HTTP callouts (probed 2026-08-30, status 200). So the org calls out
 * to this service, and this service re-enters the org through REST, where the engine is healthy.
 *
 * WHICH ACTION (2026-09-15). ExecuteDiscardVersion takes the same door for the same reason: deleting
 * a revision-1 renewal chain row makes nCino recompute the renewal state on the booked parent, which
 * is a Loan update, which wakes the same managed trigger and dies the same way. So the action is no
 * longer pinned: the caller names it in the x-c360-action header and this service refuses anything
 * that is not on ALLOWED_ACTIONS. A call that names nothing is read as ExecuteLoanModification, the
 * only action this service carried before that header existed, so an org still running the older
 * Apex keeps working across the deploy window.
 *
 * It forwards a body it does not interpret. The org owns validation, the token gate and the
 * verification; this process owns three things the org cannot do for itself: proving the caller
 * holds the shared secret, holding the allow-list of actions it may re-enter on, and minting a
 * fresh org access token.
 *
 * NEVER LOG THE BODY. It carries the single-use decision token that proves a named human confirmed
 * a specific plan. Request id, method, path, status and duration only.
 */

const PORT = Number(process.env.C360_RELAY_PORT ?? 8461);
const SECRET = process.env.C360_RELAY_SECRET ?? "";
const API_VERSION = process.env.C360_SF_API_VERSION ?? "v61.0";
const TOKEN_HELPER = process.env.C360_TOKEN_HELPER ?? "/home/fabian/.local/bin/bankinggpt-rest";
const TOKEN_TTL_MS = 10 * 60 * 1000;
const ACTION_HEADER = "x-c360-action";
const DEFAULT_ACTION = "ExecuteLoanModification";
/** The only actions this door may re-enter the org on. A write door with an open action list is not a door. */
const ALLOWED_ACTIONS = new Set(["ExecuteLoanModification", "ExecuteDiscardVersion"]);
const actionPath = (action: string) => `/services/data/${API_VERSION}/actions/custom/apex/${action}`;

if (!SECRET) {
  console.error("C360_RELAY_SECRET is unset. Refusing to start: an unauthenticated relay is a write door.");
  process.exit(1);
}

const startedAt = Date.now();
let cached: { token: string; instance: string; mintedAt: number } | null = null;

/** Constant-time compare, so a wrong secret cannot be walked byte by byte off response timing. */
function secretMatches(presented: string | null): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(SECRET);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Mints an org access token, reusing one for TOKEN_TTL_MS. The helper prints "TOKEN INSTANCE" and
 * nothing else; neither half is ever logged.
 */
async function orgAuth(): Promise<{ token: string; instance: string }> {
  if (cached && Date.now() - cached.mintedAt < TOKEN_TTL_MS) {
    return { token: cached.token, instance: cached.instance };
  }
  const proc = Bun.spawn([TOKEN_HELPER], { stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(proc.stdout).text()).trim();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`token helper exited ${code}`);
  const [token, instance] = out.split(/\s+/);
  if (!token || !instance) throw new Error("token helper printed an unexpected shape");
  cached = { token, instance, mintedAt: Date.now() };
  return { token, instance };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 180,
  async fetch(req) {
    const url = new URL(req.url);
    const id = crypto.randomUUID().slice(0, 8);
    const began = Date.now();
    const done = (status: number, note = "") => {
      console.log(`[${new Date().toISOString()}] ${id} ${req.method} ${url.pathname} -> ${status} ${Date.now() - began}ms ${note}`.trimEnd());
    };

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/healthz") {
      done(200);
      return json(
        {
          ok: true,
          service: "c360-relay",
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
          apiVersion: API_VERSION,
          actions: [...ALLOWED_ACTIONS],
          tokenCached: cached !== null,
        },
        200,
      );
    }

    if (req.method !== "POST" || url.pathname !== "/relay") {
      done(404);
      return json({ ok: false, error: "Not found. This service answers GET /healthz and POST /relay." }, 404);
    }

    if (!secretMatches(req.headers.get("x-c360-relay-secret"))) {
      done(401, "bad-secret");
      return json({ ok: false, error: "Unauthorized." }, 401);
    }

    // The allow-list is checked before the body is even read: an action this door does not carry is
    // refused without touching a payload that holds a decision token. 403 rather than 400 because
    // the Apex side reads 401 and 403 as "this request provably did not run", which is the truth.
    const action = req.headers.get(ACTION_HEADER) ?? DEFAULT_ACTION;
    if (!ALLOWED_ACTIONS.has(action)) {
      done(403, "action-refused");
      return json({ ok: false, error: `This relay does not carry the action ${action}.` }, 403);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      done(400, "unparseable-body");
      return json({ ok: false, error: "Body must be JSON." }, 400);
    }

    let auth: { token: string; instance: string };
    try {
      auth = await orgAuth();
    } catch (e) {
      cached = null;
      done(502, "mint-failed");
      return json({ ok: false, error: `Could not mint an org access token: ${(e as Error).message}` }, 502);
    }

    // Signed no-op: proves secret, token mint and org reachability without invoking the action.
    if (body && typeof body === "object" && (body as { noop?: unknown }).noop === true) {
      const probe = await fetch(`${auth.instance}/services/data/${API_VERSION}/limits`, {
        headers: { authorization: `Bearer ${auth.token}` },
      });
      done(probe.ok ? 200 : 502, `noop org=${probe.status}`);
      return json({ ok: probe.ok, noop: true, orgStatus: probe.status, instance: auth.instance }, probe.ok ? 200 : 502);
    }

    const upstream = await fetch(`${auth.instance}${actionPath(action)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    // A 401 means the cached token died early; drop it so the next call re-mints.
    if (upstream.status === 401) cached = null;
    done(upstream.status, action);
    return new Response(text, { status: upstream.status, headers: { "content-type": "application/json" } });
  },
});

console.log(`c360-relay listening on 127.0.0.1:${server.port}, org api ${API_VERSION}`);
