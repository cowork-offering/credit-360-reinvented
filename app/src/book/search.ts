import { TOOLS, unwrapInvocable } from "../channel/mcp";
import { readThroughEitherLane } from "../channel/gateway/lane";

/* =============================================================================
   FINDING A RELATIONSHIP THE SNAPSHOT NEVER BAKED.

   `Customer360SearchAccounts` is a READ. Observed shape:
     input  { name: string (partial match), industry?: string, maxResults?: number }
     output { count: number, results: [{ accountId, name, industry, naicsCode,
              annualRevenue }] }
   travelling in the Salesforce invocable envelope every other Customer 360 tool
   uses, so it is unwrapped positionally like the rest.

   ZERO MATCHES IS AN ANSWER, not a failure. The palette says so and offers
   nothing; it never invents a relationship to open.
   ============================================================================= */

export interface AccountMatch {
  accountId: string;
  name: string;
  industry?: string;
  naicsCode?: string;
  annualRevenue?: number;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The shortest query worth a connector call. Two letters would match the book. */
export const MIN_QUERY = 3;
/** The org's own default is 25; the palette shows a handful and says the count. */
export const MAX_RESULTS = 25;

function toMatch(raw: unknown): AccountMatch | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const accountId = str(r.accountId);
  const name = str(r.name);
  // A row with no id cannot be opened and a row with no name cannot be shown.
  if (!accountId || !name) return null;
  const out: AccountMatch = { accountId, name };
  const industry = str(r.industry);
  const naicsCode = str(r.naicsCode);
  const annualRevenue = num(r.annualRevenue);
  if (industry) out.industry = industry;
  if (naicsCode) out.naicsCode = naicsCode;
  if (annualRevenue !== undefined) out.annualRevenue = annualRevenue;
  return out;
}

/**
 * Search the org's accounts by partial name.
 *
 * Rejects with the normalized {@link McpFailure} the rest of the cockpit
 * branches on, so a caller can tell "no connector" from "no matches" — which is
 * the difference between an offline chip and an honest empty result.
 */
export async function searchAccounts(
  name: string,
  opts: { industry?: string; maxResults?: number; signal?: AbortSignal } = {},
): Promise<{ count: number; results: AccountMatch[] }> {
  const query = name.trim();
  if (query.length < MIN_QUERY) return { count: 0, results: [] };

  const input: Record<string, unknown> = { name: query, maxResults: opts.maxResults ?? MAX_RESULTS };
  if (opts.industry) input.industry = opts.industry;

  const { value: res } = await readThroughEitherLane(
    TOOLS.searchAccounts,
    [input],
    // A name search is stable for the length of a palette session; the platform
    // cache keeps a banker retyping one letter off the connector budget.
    { cache: { staleTime: 30_000 }, signal: opts.signal },
  );
  const slot = unwrapInvocable<Record<string, unknown>>(res.payload, 1)[0];
  if (!slot.ok) throw { code: "tool_error", message: slot.error, fix: slot.error };

  const rows = Array.isArray(slot.data.results) ? slot.data.results : [];
  const results = rows.map(toMatch).filter((m): m is AccountMatch => m !== null);
  const count = num(slot.data.count) ?? results.length;
  return { count, results };
}
