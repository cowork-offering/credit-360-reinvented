/* The two reads around the spread, as the room imports them.
 *
 * `types.ts` is the shared contract and is re-exported whole, so a caller needs
 * one import for the shapes and the functions that produce them. */

export type {
  BoomFinancialStatement,
  DroppedFile,
  ExtractedDocument,
  FilePreRead,
  PeriodRead,
  PreReadLine,
  ProvisionalRead,
  SourceKind,
  StatementQuality,
  StatementType,
} from "./types";

export {
  classifyKind,
  extractDocument,
  MAX_FILE_BYTES,
  PDFJS_URL,
  PDFJS_VERSION,
  PDFJS_WORKER_URL,
  readDroppedFile,
  SCAN_CHARS_PER_PAGE,
  SHEETJS_URL,
  SHEETJS_VERSION,
  sha256Hex,
  type ExtractDeps,
} from "./extract";

export {
  detectCurrency,
  detectPeriods,
  detectQuality,
  detectStatementTypes,
  detectUnits,
  detectUnitsStatement,
  periodKey,
  unitsWord,
} from "./periods";

export {
  accountCodeFor,
  BOOM_ACCOUNT_CODES,
  cellFigure,
  deterministicLines,
  mapLineCodes,
  normaliseLabel,
  type MappedStatement,
} from "./lineMap";

export {
  companyCandidates,
  companyMatch,
  deterministicPreRead,
  DOOR_ABSENT_NOTE,
  MODEL_FAILED_NOTE,
  preReadFile,
  qualityWord,
  SCAN_NOTE,
  sentence,
  unitsStated,
  unitsStatedNote,
  validateModelPreRead,
  type PreReadDeps,
  type RelationshipSpreadContext,
} from "./preRead";

export {
  covenantDirection,
  covenantFigureKey,
  onFileBoomFigures,
  provisionalRead,
  thresholdSide,
  thresholdWord,
} from "./provisional";

export { figuresFromSpread, NOT_VERIFIED_LINE, postRead, postReadFacts, VERIFIED_LINE, type PostReadDeps } from "./postRead";
