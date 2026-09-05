/* =============================================================================
   Customer360Catalog: THE CHIPS COME FROM THE ORG, NOT FROM A MIRROR.

   Founder, 2026-09-02: "picklist values, fee types, it shows them up." Every
   create chip in this room came from a SHELL MIRROR of the org's deployed maps.
   Accurate for this org on the day it was written, a copy all the same, and
   Case.Type and Case.Origin had never been read off this org at all. A mirror
   drifts silently and the first anyone hears of the drift is a refusal at the
   confirm gate.

   ONE READ, ONCE PER VIEW. The tool takes no input at all in its normal call and
   returns every chip set in one pass; `objectNames` exists only because two of
   the eleven entries are 43 and 71 RECORDS. The room reads it once and caches
   it, exactly like the rest of the read layer.

   THE MIRROR IS THE FALLBACK, NOT THE SOURCE. With no connector there is no
   catalog and every chip set falls back to what the shell holds, which is the
   channel-none doctrine applied to picklists: a room with no bridge behaves as
   it always did. Where the difference MATTERS to the banker (a value the org
   offers that the write path will refuse) the sentence says so; where it does
   not, nothing extra is said.
   ============================================================================= */

import { TOOLS, mcpAvailable, unwrapInvocableOne } from "./mcp";
import { readThroughEitherLane } from "./gateway/lane";

/** One value the org offers. `value` is what travels; for a CATALOG entry that
 *  is a record id and the two are not interchangeable. */
export interface CatalogValue {
  label: string;
  value: string;
}

/** One field's live value set, as the tool returns it. */
export interface CatalogField {
  objectName: string;
  fieldName: string;
  /** `picklist` is the field's own active values; `catalog` is the records of
   *  the object a LOOKUP points at, because two of these fields are lookups and
   *  have no picklist at all. */
  source: "picklist" | "catalog";
  /** What the ORG offers. Active values only. */
  values: CatalogValue[];
  /** The subset the WRITE PATH accepts, populated only where that is NARROWER
   *  than what the org offers. Empty means the write path accepts them all. */
  acceptedValues: string[];
  /** The org fact a chip builder would otherwise get wrong. */
  note?: string;
}

export interface OrgCatalog {
  fields: CatalogField[];
  note?: string;
}

/** The eleven entries, by the `object.field` key the tool returns them under. */
export const CATALOG = {
  feeType: "LLC_BI__Fee__c.LLC_BI__Fee_Type__c",
  feeRecordType: "LLC_BI__Fee__c.LLC_BI__Record_Type__c",
  feeCalculationType: "LLC_BI__Fee__c.LLC_BI__Calculation_Type__c",
  feePaidBy: "LLC_BI__Fee__c.LLC_BI__Paid_By__c",
  exceptionStatus: "LLC_BI__Policy_Exception__c.LLC_BI__Status__c",
  borrowerType: "LLC_BI__Legal_Entities__c.LLC_BI__Borrower_Type__c",
  lienPosition: "LLC_BI__Loan_Collateral2__c.LLC_BI__Lien_Position__c",
  caseType: "Case.Type",
  caseOrigin: "Case.Origin",
  collateralType: "LLC_BI__Collateral__c.LLC_BI__Collateral_Type__c",
  covenantType: "LLC_BI__Covenant2__c.LLC_BI__Covenant_Type__c",
} as const;

export type CatalogKey = keyof typeof CATALOG;

/* ------------------------------------------------------------ reading it */

/** ONCE PER VIEW. The promise is the cache, so two callers on the same frame
 *  share one round trip and a re-render never re-reads. */
let pending: Promise<OrgCatalog | null> | null = null;

/** Tests, and a view that genuinely starts again. Never called by the room. */
export function resetCatalog(): void {
  pending = null;
}

interface CatalogOutput {
  fields?: Array<Partial<CatalogField> & { values?: unknown; acceptedValues?: unknown }>;
  note?: string;
}

const asValues = (raw: unknown): CatalogValue[] =>
  Array.isArray(raw)
    ? raw
        .map((v) => {
          const row = (v ?? {}) as { label?: unknown; value?: unknown };
          const value = typeof row.value === "string" ? row.value : "";
          const label = typeof row.label === "string" && row.label ? row.label : value;
          return { label, value };
        })
        .filter((v) => v.value)
    : [];

/**
 * The org's live chip sets, or null.
 *
 * NULL IS A STATE, NOT AN ERROR. No connector, an unpublished tool (the client's
 * tool-schema cache needs a fresh session after the definition deploys), a
 * refusal: every one of them leaves the room on its mirror, which is exactly
 * where it has been since it shipped.
 */
export async function readCatalog(): Promise<OrgCatalog | null> {
  if (pending) return pending;
  const run = (async () => {
    if (!mcpAvailable()) return null;
    try {
      // THE NORMAL CALL CARRIES NO INPUT. Omitting `objectNames` returns
      // everything, which is what a room caching one read per view wants.
      // EITHER DOOR, and this wrap is pure upside: the chip sets already fall
      // back to the shell's mirror on any failure, so the backup simply gets
      // asked before the mirror is settled for.
      const { value: res } = await readThroughEitherLane(TOOLS.catalog, [{}]);
      const slot = unwrapInvocableOne<CatalogOutput>(res.payload);
      if (!slot.ok) return null;
      const fields = (slot.data.fields ?? [])
        .map((f) => ({
          objectName: String(f.objectName ?? ""),
          fieldName: String(f.fieldName ?? ""),
          source: f.source === "catalog" ? ("catalog" as const) : ("picklist" as const),
          values: asValues(f.values),
          acceptedValues: Array.isArray(f.acceptedValues) ? f.acceptedValues.map(String) : [],
          note: typeof f.note === "string" ? f.note : undefined,
        }))
        .filter((f) => f.objectName && f.fieldName);
      return fields.length ? { fields, note: slot.data.note } : null;
    } catch {
      return null;
    }
  })();
  pending = run;
  /* NULL IS NOT AN ANSWER TO CACHE (2026-09-02). A room that mounts before the
     connector registers its tools read null once and stayed on the mirror for
     the life of the view, with no retry and `resetCatalog` never called outside
     a test. The promise is still the cache while it is in flight, so two
     callers on one frame share the round trip; it is dropped the moment it
     resolves to nothing, and the next read asks again. */
  const out = await run;
  if (out === null && pending === run) pending = null;
  return out;
}

/* ------------------------------------------------------------- reading it */

export function catalogField(catalog: OrgCatalog | null | undefined, key: CatalogKey): CatalogField | null {
  if (!catalog) return null;
  const [object, field] = CATALOG[key].split(".");
  return catalog.fields.find((f) => f.objectName === object && f.fieldName === field) ?? null;
}

/** What the org offers, as labels. Empty where the catalog is not in hand. */
export function orgValues(catalog: OrgCatalog | null | undefined, key: CatalogKey): string[] {
  return (catalogField(catalog, key)?.values ?? []).map((v) => v.label);
}

/** What the WRITE PATH accepts, as labels. Falls back to everything the org
 *  offers, because an empty `acceptedValues` means the write path takes them
 *  all rather than none. */
export function orgAccepted(catalog: OrgCatalog | null | undefined, key: CatalogKey): string[] {
  const entry = catalogField(catalog, key);
  if (!entry) return [];
  if (!entry.acceptedValues.length) return entry.values.map((v) => v.label);
  /* A lookup-backed field keeps its accepted list as record IDS (the catalog
     read says so on its note); the room speaks labels, so each accepted entry
     resolves through the value list. Founder, 2026-09-03: eight chips rendered
     as a33... ids on the intake's asset question. */
  const byId = new Map(entry.values.map((v) => [v.value, v.label] as const));
  return entry.acceptedValues.map((a) => byId.get(a) ?? a);
}

/** The values the org offers that the write path will REFUSE. Named rather than
 *  hidden: a banker who says "grantor" is answered by name. */
export function orgRefused(catalog: OrgCatalog | null | undefined, key: CatalogKey): string[] {
  const entry = catalogField(catalog, key);
  if (!entry || !entry.acceptedValues.length) return [];
  /* Accepted entries can be ids (lookup catalogs) or labels; a value is refused
     only when neither its id nor its label is on the list. */
  const ok = new Set(entry.acceptedValues);
  return entry.values.filter((v) => !ok.has(v.value) && !ok.has(v.label)).map((v) => v.label);
}

/**
 * THE ORG'S SET, OR THE MIRROR.
 *
 * One rule in one place: the live set wins wherever the read carries one, and
 * the shell's own list stands where it does not. `fromOrg` is what a sentence
 * keys on where the difference is worth saying out loud.
 */
export function chipSet(
  catalog: OrgCatalog | null | undefined,
  key: CatalogKey,
  mirror: string[],
): { values: string[]; fromOrg: boolean } {
  const live = orgAccepted(catalog, key);
  return live.length ? { values: live, fromOrg: true } : { values: mirror, fromOrg: false };
}

/* ------------------------------------------------- reconciling a fenced set */

export interface Chip {
  label: string;
  say: string;
}

/**
 * A CHIP SET THE ENGINE COMPOSED, HELD AGAINST THE ORG'S OWN.
 *
 * Some chip sets are composed behind the engine fence, so the room cannot build
 * them from the catalog: it can only CHECK them. The check is narrow on
 * purpose. It runs only where every label the engine offered is a value this
 * field actually holds, which is what identifies the set as that field's at all.
 *
 * Then two corrections, and they are not symmetrical. A value the org offers and
 * the engine did not is ADDED silently: an org that gained a value is an org the
 * room should be able to say. A value the engine offers and the write path
 * REFUSES comes off and is SAID, because that is a chip that would have ended in
 * a refusal at the confirm gate.
 */
export function reconcileChips(
  options: Chip[] | undefined,
  catalog: OrgCatalog | null | undefined,
  key: CatalogKey,
  say: (label: string) => string,
): { options: Chip[] | undefined; said: string | null } {
  const entry = catalogField(catalog, key);
  if (!options?.length || !entry) return { options, said: null };
  const offered = new Set(entry.values.map((v) => v.label));
  // NOT THIS FIELD'S SET. A chip set carrying a label this field does not hold
  // is some other question's, and correcting it would be the room overwriting
  // an answer it never read.
  if (!options.every((o) => offered.has(o.label))) return { options, said: null };

  const live = orgAccepted(catalog, key);
  if (!live.length) return { options, said: null };
  const ok = new Set(live);
  const kept = options.filter((o) => ok.has(o.label));
  const dropped = options.filter((o) => !ok.has(o.label)).map((o) => o.label);
  const held = new Set(kept.map((o) => o.label));
  const added = live.filter((label) => !held.has(label));
  const next = [...kept, ...added.map((label) => ({ label, say: say(label) }))];

  const one = dropped.length === 1;
  return {
    options: next,
    said: dropped.length
      ? `${dropped.join(" and ")} ${one ? "is on the org's own list and the write path refuses it" : "are on the org's own list and the write path refuses them"}, so ${one ? "it is" : "they are"} not offered here.`
      : null,
  };
}
