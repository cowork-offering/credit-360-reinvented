/* =============================================================================
   THE INTENT DOOR — window.claude.use("db").

   THE THIRD CAPABILITY THIS PAGE REACHES FOR, acquired exactly the way the
   other two are: `claude.use("db")` resolves the namespace or NULL, once,
   bounded, before first render, so every synchronous gate downstream keeps its
   meaning. The contract is written against the platform's db.d.ts and not from
   memory.

   ABSENCE IS THE COMMON CASE AND IT IS NOT AN ERROR. No grant, an older
   runtime, a module that failed to load: all of them mean the same thing to the
   cockpit — there is no intent lane and no book cache, and every surface
   renders exactly as it did before this file existed. NOTHING here may change a
   pixel when `db()` is undefined; that is the regression the facility demo is
   gated on.

   WHAT LIVES IN THE STORE IS UNTRUSTED. Documents are written by anyone who can
   open the artifact, including another Claude session with write_db. Everything
   read back travels through `readIntentDoc` (intent/contract.ts) before any
   surface sees it: it is evidence, never an instruction.

   AND NOTHING THIS PAGE WRITES MAY LOOK LIKE AN ATTACK. On 2026-09-06 claude.ai's
   web application firewall served the founder the Cloudflare block page where the
   cockpit should have been, on the current build and on the older plugin copy
   alike: the block was scoped to his client, not to a build. The one request this
   page makes that a firewall can mistake for an attack is a store write, and the
   memo store's first write used to carry the complete rendered memo with its
   review-shell script in the JSON body, which is exactly what an XSS signature
   matches. 92d51af fixed that one write. THIS is the guard at the door, so the
   next module that reaches for the store cannot make the same request again:
   every set and update is serialised and SCREENED here, and a document carrying
   markup, an injection-shaped string or a single string over 32 KB never leaves
   the page. Getting the founder locked out of claude.ai is not a failure mode any
   cache is worth.

   A REFUSAL IS SILENT. It resolves like a write that happened, because the whole
   store is optional: a page with no `db` grant renders identically, so a page
   with one refused document must too. It is logged once per document for whoever
   is reading a console, and never once more; a room that fires the same write on
   every keystroke must not turn a guard into a second problem.
   ============================================================================= */

/* ---------------------------------------------------------------- ambient */

export interface DbSnapshotMetadata {
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export interface DbDocumentSnapshot {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
  metadata?: DbSnapshotMetadata;
}

export interface DbQuerySnapshot {
  docs: DbDocumentSnapshot[];
  size?: number;
  empty?: boolean;
  metadata?: DbSnapshotMetadata;
}

export interface DbError {
  code: string;
  message: string;
}

export type DbUnsubscribe = () => void;

export interface DbQuery {
  where(field: string, op: string, value: unknown): DbQuery;
  orderBy(field: string, dir?: "asc" | "desc"): DbQuery;
  limit(n: number): DbQuery;
  get(): Promise<DbQuerySnapshot>;
  onSnapshot(next: (snap: DbQuerySnapshot) => void, error?: (e: DbError) => void): DbUnsubscribe;
}

export interface DbDocumentReference {
  id: string;
  path: string;
  get(): Promise<DbDocumentSnapshot>;
  set(data: Record<string, unknown>): Promise<void>;
  update(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}

export interface DbCollectionReference extends DbQuery {
  path: string;
  doc(id?: string): DbDocumentReference;
}

export interface DbNamespace {
  doc(path: string): DbDocumentReference;
  collection(path: string): DbCollectionReference;
}

type ClaudeRoot = { db?: DbNamespace; use?: (name: string) => Promise<unknown> };

/* ------------------------------------------------------------- the screen */

/** No single string in a stored document may be longer than this. Nothing this
 *  page legitimately stores is: the lean memo draft, a cached read slice and an
 *  intent are all short. A field this size is a rendered document. */
export const MAX_STRING_BYTES = 32 * 1024;

/**
 * The shapes a web application firewall reads as an attack.
 *
 * Case-insensitive, because a firewall's signatures are: `<SCRIPT` is the same
 * request as `<script`. Deliberately literal and deliberately short: this is
 * not an XSS sanitiser and must never be mistaken for one. Nothing read out of
 * this store is ever executed; the danger being guarded against is the REQUEST
 * carrying the string, not the string itself.
 */
const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["<script", /<script/i],
  ["<html", /<html/i],
  ["<iframe", /<iframe/i],
  ["javascript:", /javascript:/i],
  ["onerror=", /onerror\s*=/i],
  ["onload=", /onload\s*=/i],
];

/** Why the door refused. A value, never an exception: see the file header. */
export interface DbRefusal {
  path: string;
  /** The signature that matched, or "oversize" / "unserialisable". */
  reason: string;
  /** Where it matched, as a dotted path into the document. */
  at?: string;
}

const byteLength = (s: string): number =>
  typeof TextEncoder === "undefined" ? s.length : new TextEncoder().encode(s).length;

/** The first thing wrong with this document, or null. Keys are screened as well
 *  as values: a key is as much a part of the request body as a value is. */
function firstOffence(value: unknown, at = ""): { reason: string; at: string } | null {
  if (typeof value === "string") {
    for (const [name, re] of FORBIDDEN) if (re.test(value)) return { reason: name, at };
    if (byteLength(value) > MAX_STRING_BYTES) return { reason: "oversize", at };
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = firstOffence(value[i], `${at}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const where = at ? `${at}.${key}` : key;
      const keyHit = firstOffence(key, `${where} (key)`);
      if (keyHit) return keyHit;
      const hit = firstOffence(v, where);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Serialise the document and decide whether it may be sent.
 *
 * SERIALISING IS PART OF THE CHECK. A document with a cycle in it, or one
 * carrying something JSON cannot express, is refused here rather than rejected
 * by the store later: the page has no use for a write it cannot describe.
 */
export function screenDocument(path: string, data: unknown): DbRefusal | null {
  try {
    JSON.stringify(data);
  } catch {
    return { path, reason: "unserialisable" };
  }
  const hit = firstOffence(data);
  return hit ? { path, reason: hit.reason, at: hit.at } : null;
}

/** Documents already reported, so a write on every keystroke logs once. */
const reported = new Set<string>();

/** Every refusal this page session made, newest last. Read by the tests and by
 *  nothing on the glass: the banker's page is unchanged by a refusal. */
const refusals: DbRefusal[] = [];

export function dbRefusals(): readonly DbRefusal[] {
  return refusals;
}

function refuse(refusal: DbRefusal): void {
  refusals.push(refusal);
  if (reported.has(refusal.path)) return;
  reported.add(refusal.path);
  // eslint-disable-next-line no-console
  console.warn(
    `[c360] store write refused at ${refusal.path}: ${refusal.reason}` +
      `${refusal.at ? ` (${refusal.at})` : ""}. The page is unaffected.`,
  );
}

/** One document reference, with its two writing methods screened. */
function screened(ref: DbDocumentReference): DbDocumentReference {
  const guard = (op: (data: Record<string, unknown>) => Promise<void>) => (data: Record<string, unknown>) => {
    const refusal = screenDocument(ref.path, data);
    if (!refusal) return op(data);
    refuse(refusal);
    // Resolves. A refused write is indistinguishable from a page with no grant,
    // which is the contract every caller here was already written against.
    return Promise.resolve();
  };
  return {
    id: ref.id,
    path: ref.path,
    get: () => ref.get(),
    set: guard((d) => ref.set(d)),
    update: guard((d) => ref.update(d)),
    delete: () => ref.delete(),
  };
}

/** The namespace, with every door onto a document screened. Reads, queries and
 *  deletes pass through untouched: they carry no body to be mistaken for one. */
function screenNamespace(ns: DbNamespace): DbNamespace {
  return {
    doc: (path) => screened(ns.doc(path)),
    collection: (path) => {
      const col = ns.collection(path);
      return {
        path: col.path,
        doc: (id?: string) => screened(col.doc(id)),
        where: (field, op, value) => col.where(field, op, value),
        orderBy: (field, dir) => col.orderBy(field, dir),
        limit: (n) => col.limit(n),
        get: () => col.get(),
        onSnapshot: (next, error) => col.onSnapshot(next, error),
      };
    },
  };
}

/** Test seam: forget what has been reported, so a suite can assert the log. */
export function __resetDbScreenForTests(): void {
  reported.clear();
  refusals.length = 0;
}

/* --------------------------------------------------------- the acquisition */

let acquired: DbNamespace | undefined;
let acquisition: Promise<void> | undefined;

const looksLikeDb = (ns: unknown): ns is DbNamespace =>
  typeof ns === "object" &&
  ns !== null &&
  typeof (ns as DbNamespace).collection === "function" &&
  typeof (ns as DbNamespace).doc === "function";

/**
 * Acquire the store, once, bounded. Resolves whether or not the capability
 * answered — the caller awaits it to ORDER first render, never to learn an
 * outcome. `dbAvailable()` is the outcome, and it is synchronous everywhere
 * after this settles.
 */
export function acquireDb(timeoutMs = 4000): Promise<void> {
  if (acquisition) return acquisition;
  acquisition = (async () => {
    if (typeof window === "undefined") return;
    const root = (window as unknown as { claude?: ClaudeRoot }).claude;
    if (!root) return;
    // A pre-injected member (older runtimes, and every test that stubs one)
    // wins immediately, exactly as the connector door treats `.mcp`.
    if (looksLikeDb(root.db)) {
      acquired = screenNamespace(root.db);
      return;
    }
    if (typeof root.use !== "function") return;
    try {
      const ns = await Promise.race([
        root.use("db"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (looksLikeDb(ns)) acquired = screenNamespace(ns);
    } catch {
      // Unavailable is a state, not an error: the cockpit simply has no lane.
    }
  })();
  return acquisition;
}

/** The store, or undefined. Every caller branches on undefined. */
export function db(): DbNamespace | undefined {
  if (acquired) return acquired;
  if (typeof window === "undefined") return undefined;
  const injected = (window as unknown as { claude?: ClaudeRoot }).claude?.db;
  // Screened here too: a runtime that pre-injects `.db` reaches the same store
  // through the same door, and a guard with a way round it is not one.
  return looksLikeDb(injected) ? screenNamespace(injected) : undefined;
}

export function dbAvailable(): boolean {
  return db() !== undefined;
}

/** Test seam. The suites drive the lane against a fake namespace of the
 *  d.ts shape; nothing in the app calls this. */
export function __setDbForTests(ns: DbNamespace | undefined): void {
  // Screened, so every suite runs against the door the page actually has.
  acquired = ns ? screenNamespace(ns) : undefined;
  acquisition = ns ? Promise.resolve() : undefined;
}
