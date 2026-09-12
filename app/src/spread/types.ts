/* =============================================================================
   SPREAD FINANCIALS — THE CONTRACT.

   Shared by the three pieces built in parallel: the Spreading room (drop zone,
   guided flow, the live financials panel), the pre-read + post-read analysis
   (files → understanding → relationship context), and the Boom adapter (the
   one module that talks to Boom; a stub today, Noland's connector tomorrow as
   a mapping in one file).

   DATA SHAPES FOLLOW BOOM'S OWN OUTPUT (api.boom.build, OpenAPI snapshot
   2026-09-09 in /opt/connectry/projects/boom-spreading/docs), which is what
   the cockpit's on-file boom-spread.json already carries. Boom does the
   spreading: it classifies the statement, finds the periods, maps every line
   to an account code, and an analyst VERIFIES it in Boom's own UI. Its file
   ladder is waiting_for_upload → processing → failed | completed → verified.
   The TRANSPORT is ours: the cockpit calls Noland's read + write Boom MCP
   server as tools through the viewer's "Boom" connector (see BoomAdapter);
   the earlier Salesforce-side LWC/Apex POC is not the target and nothing of
   its mechanics (presigned S3, process calls) belongs in this layer.

   DOCTRINE. Boom stays the spreading system of record. This layer does two
   things Boom does not: (1) the PRE-READ, before anything is sent: what the
   file is, whose it is, which periods, what quality (audited / reviewed /
   compiled / internal), so the banker confirms a plan instead of guessing; and
   (2) the POST-READ, once Boom has spread it: what changed for THIS
   relationship (against the period on file, against the covenant thresholds
   nCino carries), in prose a credit committee would accept. Pre-read figures
   are PROVISIONAL and labelled so; the room never presents them as the spread.
   Deterministic where it can be (text layers, cell grids, deltas); the model
   only for understanding. Golden rule: the room knows the book, leads with
   what it found, offers the real options, recommends only what is grounded,
   one thing at a time, never loops.
   ============================================================================= */

/** Boom's statement types (FileFinancialStatement.statementType). */
export type StatementType =
  | "income_statement"
  | "balance_sheet"
  | "cash_flow_statement"
  | "shareholders_equity"
  | "personal_statement";

/** Boom's period types (FileFinancialStatementPeriod.periodType). */
export type PeriodType =
  | "monthly"
  | "quarterly"
  | "annual"
  | "year_to_date"
  | "trailing_twelve_months"
  | "semi_annual"
  | "unknown"
  | "none";

/** Boom's statement quality (File.statementQuality). Asked of the banker; pre-read proposes it. */
export type StatementQuality = "cpa_audited" | "cpa_reviewed" | "cpa_compiled" | "internal";

/** Boom's file ladder (File.status). */
export type BoomFileStatus = "waiting_for_upload" | "processing" | "failed" | "completed" | "verified";

export type SourceKind = "pdf-text" | "pdf-scan" | "xlsx" | "csv" | "image" | "unknown";

/** One dropped file, as the room holds it. */
export interface DroppedFile {
  /** Stable per drop; the key everywhere below. */
  id: string;
  name: string;
  mime: string;
  bytes: number;
  /** The content, for the Boom upload and the artifact asset store. */
  base64: string;
  sha256: string;
  kind: SourceKind;
}

/* ------------------------------------------------------------- pre-read */

/** What extraction got out of one file, deterministically: no model here. */
export interface ExtractedDocument {
  fileId: string;
  kind: SourceKind;
  /** The PDF text layer, or a cell grid rendered to TSV (XLSX/CSV). Empty for a scan. */
  text: string;
  /** Tables where the source has structure (a sheet, or a detected grid). */
  tables: Array<{ name?: string; rows: string[][] }>;
  pages?: number;
  /** No text layer: Boom will OCR it; the room asks the banker for type, period and quality. */
  isScan: boolean;
  warnings: string[];
}

/** One period the pre-read found, in Boom's terms. */
export interface PeriodRead {
  /** The room's display key: "FY2025", "Q2 2026", "TTM Jun 2026". */
  key: string;
  endDate: string | null;
  periodType: PeriodType;
}

/** A line the pre-read could place, mapped to Boom's account codes where confident
 *  (the codes the on-file spread uses: net_sales_revenue, cost_of_sales, gross_profit,
 *  operating_profit, long_term_debt_bank, …). Values in absolute currency units. */
export interface PreReadLine {
  label: string;
  accountCode: string | null;
  /** period key → value; null where the statement prints none. */
  values: Record<string, number | null>;
  confidence: "high" | "medium" | "low";
}

/** The model's structured understanding of ONE file before it goes anywhere
 *  (askSessionJson, strict schema, relationship context in the prompt). */
export interface FilePreRead {
  fileId: string;
  /** A file can carry several statements (an annual report does). */
  statements: Array<{
    statementType: StatementType;
    periods: PeriodRead[];
    lines: PreReadLine[];
  }>;
  /** As printed in the file. Compared with the anchored relationship; a mismatch is an ask, never silent. */
  company: string | null;
  companyMatchesRelationship: boolean | null;
  currency: string;
  /** As printed: 1, 1_000, 1_000_000. `values` above are already multiplied out. */
  unitsMultiplier: number;
  /** Proposed from the text (an auditor's report, a review report, "prepared by management"). */
  statementQuality: StatementQuality | null;
  /** Unbalanced balance sheet, subtotal that does not foot, missing pages, period gap vs on file. */
  quality: Array<{ level: "info" | "warn" | "bad"; text: string }>;
  confidence: "high" | "medium" | "low";
}

/** Provisional, deterministic deltas against the on-file Boom spread (pre-read only). */
export interface ProvisionalRead {
  period: string;
  /** Only what the pre-read lines support: revenue, ebitda, ebitdaMarginPct, totalDebt, … */
  figures: Record<string, number | null>;
  onFile: Record<string, number | null>;
  onFilePeriod: string | null;
  /** Grounded, sober: "Revenue $64.5M, up 8% on FY2024 on file." */
  lines: string[];
  provisional: true;
}

/** Everything the room shows before the plan. */
export interface SpreadAnalysis {
  accountId: string;
  company: string;
  files: FilePreRead[];
  read: ProvisionalRead | null;
  /** What the room could not determine; asked one at a time, with chips. */
  asks: Array<{
    fileId: string;
    field: "statementType" | "periods" | "company" | "units" | "statementQuality";
    reason: string;
    options?: string[];
  }>;
}

/* ---------------------------------------------------------------- plan */

/** The governed plan: exactly what goes to Boom, confirmed by the banker. */
export interface SpreadPlan {
  accountId: string;
  company: string;
  /** Consolidate into one Boom file group (one set of aggregated financials) or file by file. */
  consolidate: boolean;
  items: Array<{
    fileId: string;
    name: string;
    mime: string;
    base64: string;
    sha256: string;
    statementTypes: StatementType[];
    periods: PeriodRead[];
    statementQuality: StatementQuality;
  }>;
  /** "3 statements → Boom, Hartwell Precision: FY2025 audited income statement, balance sheet, cash flow." */
  summary: string;
}

/* --------------------------------------------------------- the adapter */

export interface BoomUploadRequest {
  accountId: string;
  /** Boom's Company.externalUniqueId: the Salesforce Account id, so the same borrower never forks. */
  company: { externalUniqueId: string; name: string; fullAddress?: string | null };
  file: { name: string; mime: string; base64: string; sha256: string };
  /** Boom's File.externalUniqueId: the sha256, so a re-drop never duplicates a period. */
  externalUniqueId: string;
  statementQuality: StatementQuality;
  /** Present when the plan consolidates; the adapter creates the group once per plan. */
  fileGroupId?: string | null;
}

/** What comes back, Boom-shaped. `financialStatements` is present once status is completed/verified. */
export interface BoomUploadResult {
  fileId: string;
  companyId: string | null;
  fileGroupId: string | null;
  status: BoomFileStatus;
  /** Boom's own words on failure; shown verbatim. (Boom has no structured reason yet: Q&A tracker #14.) */
  message?: string;
  financialStatements?: BoomFinancialStatement[];
  /** The analyst verification page (POST /auth/file-validation-session): URL, 60-minute token. */
  validationUrl?: string | null;
}

/** Boom's spread of one statement, as the cockpit's on-file `boom-spread.json` already carries it. */
export interface BoomFinancialStatement {
  id: string;
  statementType: StatementType;
  endDate: string | null;
  validationStatus: "not_validated" | "validated";
  periods: Array<{ id: string; endDate: string | null; periodType: PeriodType }>;
  lineItems: Array<{
    id: string;
    name: string;
    hierarchy: "line_item" | "subtotal" | "total" | "header";
    accountCode: string | null;
    flipSign: boolean;
    /** period id → value */
    periodValues: Record<string, number | null>;
    adjustedPeriodValues?: Record<string, { asGiven: number | null; asAllowed: number | null }>;
    childLineItems?: Array<unknown>;
  }>;
  /** Rolled up to account-code level: what ratios are computed from. */
  aggregatedFinancials?: Array<{ accountCode: string; accountName: string; periodValues: Record<string, number | null> }>;
}

/** THE ADAPTER: what the COCKPIT expects from Noland's read + write Boom MCP server, as
 *  MCP tool calls through the viewer's own "Boom" connector (`callTool(SERVERS.boom, …)`),
 *  exactly like every other lane here. Bytes in, Boom's spread out. How the server talks
 *  to Boom behind that (company upsert, presigned upload, process, polling) is the server's
 *  business and never appears in the cockpit. The stub implements this today; when the real
 *  tools land, `channel/boomUpload.ts` maps tool names + argument names in one place. */
export interface BoomAdapter {
  /** One tool call: send the file (base64) for this relationship; returns Boom's file id + status,
   *  and the spread itself when the server answers synchronously. */
  upload(req: BoomUploadRequest, opts?: { signal?: AbortSignal }): Promise<BoomUploadResult>;
  /** One tool call: the file's current status + spread; the room polls it, bounded by its settle discipline. */
  status(fileId: string, opts?: { signal?: AbortSignal }): Promise<BoomUploadResult>;
  /** Optional, when the server supports consolidation: one group id per plan. */
  createGroup?(companyExternalId: string): Promise<{ fileGroupId: string }>;
  /** Optional: the analyst verification page link ("Verify in Boom"). */
  validationSession?(fileId: string): Promise<{ url: string; expiresAt: string }>;
}

/** Per-file progress the room renders. */
export type UploadState = "pending" | "sending" | "processing" | "completed" | "verified" | "failed";
