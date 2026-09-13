/* THE BOOK A DRIVE RUNS ON (backlog row 51, founder 2026-09-13:
   "it is not only Hartwell, it needs to work everywhere").

   ONE RESOLVER, THREE DRIVES. `workroom-e2e.mjs`, `spread-e2e.mjs` and
   `gate.mjs` all take `--book <accountId|name>` and all read the answer from
   here, so a drive can never disagree with another about which relationship it
   opened, which package it stands in, or which facility a scenario line names.

   EVERY FIGURE IS DERIVED, NOTHING IS TYPED. The parameters below are computed
   off `artifact/live-data.json` with the SAME rules the app uses:

     isActive       `data/worklist.ts:isActiveFacility`  (blank, Active, Open)
     isBooked       `data/facilityStage.ts:BOOKED`
     product        `data/facilityStage.ts:facilityProduct` (strip the
                    relationship prefix, then drop the trailing money segment)
     fmtMoney       `data/format.ts:fmtMoney`            ("$15M")
     moneyName      nCino's own loan-name money ("$15,000,000.00")

   A COPY OF A RULE IS A RULE THAT DRIFTS, and these five are copied on purpose:
   the drive must be able to say what the page SHOULD show without importing the
   page's own TypeScript. Each one is small, each one names the file it mirrors,
   and the drive asserts against the glass rather than against this file.

   WHAT A BOOK CANNOT DO IS A PARAMETER TOO. `ambiguousMember` is false on a
   book carrying one facility of the product a scenario names; `multiPackage` is
   false on a one-package relationship; `canVersion` is false where no package
   holds a booked member, because nCino takes a credit action only against a
   booked loan and therefore no modification version can exist. The scenarios
   read those flags and assert the SIMPLE path (silent bind, direct staging, the
   honest refusal) rather than skipping. */

/* ------------------------------------------------------------- the app's rules */

/** `data/worklist.ts:isActiveFacility`. Paid Off, Closed, Withdrawn, Superseded
 *  and Hold are all real states and none of them is a facility you can act on. */
export const isActive = (f) => {
  const s = String((f && f.status) || "").trim().toLowerCase();
  return s === "" || s === "active" || s === "open";
};

/** `data/facilityStage.ts`. Booked is the only committed. */
export const isBooked = (f) => String((f && f.stage) || "").trim().toLowerCase() === "booked";

/** `data/format.ts:fmtMoney`. */
export function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return "$" + (n / 1e9).toFixed(2).replace(/\.00$/, "") + "B";
  if (abs >= 1e6) return "$" + (n / 1e6).toFixed(2).replace(/\.00$/, "") + "M";
  if (abs >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** nCino writes the money into the loan name as "$15,000,000.00". */
export function moneyName(n) {
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** `data/facilityStage.ts:shortFacilityName`. */
export function shortName(name, relationship) {
  const full = String(name || "").trim();
  const rel = String(relationship || "").trim();
  if (!full) return "";
  if (!rel || full.length <= rel.length) return full;
  if (full.slice(0, rel.length).toLowerCase() !== rel.toLowerCase()) return full;
  const rest = full.slice(rel.length).match(/^\s*[-–—:·|]\s*(\S.*)$/);
  return rest ? rest[1].trim() : full;
}

/** `data/facilityStage.ts:facilityProduct`. The product is the middle segment of
 *  the org's own loan name; a name that does not fit the convention falls back
 *  to the whole short label and then to the regulatory classification. */
export function facilityProduct(f, relationship) {
  const short = shortName(f && f.name, relationship).trim();
  if (short) {
    const cut = short.replace(/\s*[-–—]\s*\$[\d,.]+\s*$/, "").trim();
    if (cut) return cut;
  }
  return String((f && f.productType) || "").trim() || String((f && f.name) || "");
}

/* ----------------------------------------------------------- the read mapping

   EVERY `Customer360*` BODY THE BOOK CARRIES. The probe lane serves a fixed
   LIVE table (`lib/stub-lanes.js`); `livePatch` is what puts the chosen
   relationship's own reads behind it. A book key missing from the bundle is
   simply not patched, and the lane's own body stands. */
export const BOOK_READS = {
  snapshot: "Customer360Snapshot",
  graph: "Customer360RelationshipGraph",
  exposure: "Customer360Exposure",
  covenants: "Customer360Covenants",
  opportunities: "Customer360Opportunities",
  signals: "Customer360StructuralSignals",
};

/** Which relationship `--book` names. An id, or any unambiguous part of a name. */
export function resolveBook(live, key) {
  const borrowers = live.borrowers || {};
  const want = String(key || "").trim();
  if (borrowers[want]) return want;
  const lower = want.toLowerCase();
  const hits = Object.keys(borrowers).filter((id) =>
    String(((borrowers[id] || {}).snapshot || {}).name || "").toLowerCase().includes(lower),
  );
  if (hits.length === 1) return hits[0];
  const named = Object.keys(borrowers).map((id) => `${id} (${((borrowers[id] || {}).snapshot || {}).name})`);
  throw new Error(
    hits.length
      ? `--book "${want}" names ${hits.length} relationships. Say which: ${hits.join(", ")}`
      : `--book "${want}" names no relationship in artifact/live-data.json. Known: ${named.join(", ")}`,
  );
}

/* --------------------------------------------------------------- the parameters */

/** A guarantor's name reads as a PERSON where it is two or three words and
 *  carries no company suffix. Only a person has a first name to be asked by. */
const COMPANY = /\b(llc|l\.l\.c|inc|inc\.|incorporated|corp|corporation|co|company|trust|holdings?|group|partners?|lp|llp|ltd|plc|foundation|association)\b/i;
const isPerson = (name) => {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 3 && !COMPANY.test(name);
};

/**
 * EVERY PARAMETER A SCENARIO NEEDS, derived from one relationship's bundle.
 *
 * The shape is deliberately flat: a scenario reads `book.product`,
 * `book.pickLine`, `book.ambiguousMember` and composes its own sentence. No
 * scenario reaches into `live-data.json` itself.
 */
export function bookParams(live, accountId) {
  const bundle = (live.borrowers || {})[accountId];
  if (!bundle) throw new Error(`no bundle for ${accountId}`);
  const relationship = String((bundle.snapshot || {}).name || "").trim();
  const all = ((bundle.exposure || {}).facilities || []).slice();
  const active = all.filter(isActive);
  const booked = active.filter(isBooked);

  /* THE PACKAGE ROSTER, `book/packages.ts:packageRoster` order: the snapshot's
     anchor leads, then the distinct package ids over the active facilities. */
  const anchorId = (bundle.snapshot || {}).productPackageId || null;
  const ids = [];
  if (anchorId) ids.push(anchorId);
  for (const f of active) if (f.productPackageId && !ids.includes(f.productPackageId)) ids.push(f.productPackageId);
  const packages = ids.map((id) => {
    const members = active.filter((f) => f.productPackageId === id);
    return {
      id,
      members,
      booked: members.filter(isBooked),
      committed: members.reduce((n, f) => n + (typeof f.committed === "number" ? f.committed : 0), 0),
    };
  });

  /* THE PACKAGE THE MODIFY SCENARIOS RUN IN: the one carrying the most booked
     members, because a modification only runs against a booked facility. Ties
     go to the larger member count and then to the roster's own order. */
  const ranked = packages.slice().sort((a, b) => b.booked.length - a.booked.length || b.members.length - a.members.length);
  const pkg = ranked[0] || { id: null, members: [], booked: [], committed: 0 };

  /* THE FACILITY THE SCRIPTS ACT ON: the largest LINE OF CREDIT on that package
     where it carries one, and the largest facility otherwise. "Line of credit"
     is read off the org's own product word and off `productType`, so a book
     that calls it a revolver is found too. */
  const byCommitted = (a, b) => (b.committed || 0) - (a.committed || 0);
  const pool = pkg.booked.length ? pkg.booked.slice() : pkg.members.slice();
  const lineLike = (f) =>
    /line of credit|revolv|revolver/i.test(`${facilityProduct(f, relationship)} ${f.productType || ""}`);
  const lines = pool.filter(lineLike).sort(byCommitted);
  const target = (lines[0] || pool.slice().sort(byCommitted)[0]) || null;

  const product = target ? facilityProduct(target, relationship) : "";
  /* WHICH SIBLINGS SHARE THAT PRODUCT WORD. This is the ambiguity
     `parseModify.ts:resolveTarget` raises: a singular reference that fits
     several members names none of them, and the room asks which. */
  const siblings = pool.filter((f) => facilityProduct(f, relationship).toLowerCase() === product.toLowerCase());
  const ambiguousMember = siblings.length > 1;
  const committed = target && typeof target.committed === "number" ? target.committed : 0;
  const shortMoney = fmtMoney(committed);

  /* THE FIGURES A SCENARIO QUOTES, all off the target facility. */
  const raisedTo = committed + 5_000_000;
  const rate = target && typeof target.interestRate === "number" ? target.interestRate : null;

  /* THE PARTIES, off the relationship graph. `removeParty` is the guarantor
     attached to the FEWEST facilities, because that is the one a removal can
     narrow on; `addParty` is any other party on the book. */
  const entities = ((bundle.graph || {}).legalEntities || []).filter((e) => /guarantor/i.test(String(e.borrowerType || "")));
  const byName = new Map();
  for (const e of entities) {
    const name = String(e.accountName || "").trim();
    if (!name) continue;
    const row = byName.get(name) || { name, loans: new Set(), type: e.borrowerType };
    if (e.loanId) row.loans.add(e.loanId);
    byName.set(name, row);
  }
  const guarantors = [...byName.values()];
  const people = guarantors.filter((g) => isPerson(g.name));
  const ranking = (a, b) => a.loans.size - b.loans.size;
  const removeParty = (people.slice().sort(ranking)[0] || guarantors.slice().sort(ranking)[0] || null);
  const other = (g) => !removeParty || g.name !== removeParty.name;
  const addParty = people.find(other) || guarantors.find(other) || null;

  /* THE VERSION FIXTURE. A modification version is a clone of the source
     package's ACTIVE members, so a book with no booked package cannot carry one
     at all: `book/packages.ts` reads a fork as an all-unbooked package that
     mirrors a BOOKED one, and with no booked package there is nothing to
     mirror. */
  const canVersion = pkg.booked.length > 0 && !!target;
  const movedCommitted = raisedTo;
  const movedCloneName = target && target.name ? String(target.name).replace(moneyName(committed), moneyName(movedCommitted)) : "";
  const otherClone = pkg.members.find((f) => f.loanId !== (target && target.loanId)) || null;

  const patch = {};
  for (const [key, tool] of Object.entries(BOOK_READS)) if (bundle[key]) patch[tool] = bundle[key];

  return {
    accountId,
    relationship,
    patch,
    bundle,
    packages,
    /** The package the Modify / Renew scenarios stand in. */
    packageId: pkg.id,
    packageMembers: pkg.members,
    packageBooked: pkg.booked,
    /** More than one package on the relationship, so the room ASKS which. One
     *  package binds silently (`book/packages.ts:mustChoosePackage`). */
    multiPackage: packages.length > 1,
    /** No booked facility anywhere: a credit action has nothing to run against. */
    hasBooked: booked.length > 0,
    target,
    product,
    siblings,
    ambiguousMember,
    committed,
    /** "$15M". */
    shortMoney,
    /** "15M", for the sentences a banker writes without the dollar sign. */
    bareMoney: shortMoney.replace(/^\$/, ""),
    /** "the $15M line of credit", the answer to the room's "which one?". */
    pickLine: `the ${shortMoney} ${product.toLowerCase()}`,
    raisedTo,
    /** "20M". */
    raisedToPhrase: fmtMoney(raisedTo).replace(/^\$/, ""),
    rate,
    /** The rate the banker holds, and the one they then push it to. */
    holdRate: rate === null ? null : Number(rate.toFixed(2)),
    pushRate: rate === null ? null : Number((rate + 0.67).toFixed(2)),
    /** The rate the amend room is asked for. Always a real move off the book's
     *  own pricing, and on Hartwell it lands on the 7.10 the org proof used. */
    amendRate: rate === null ? 7.1 : Number((rate + 0.52).toFixed(2)),
    removeParty: removeParty ? removeParty.name : null,
    removeFirstName: removeParty && isPerson(removeParty.name) ? removeParty.name.split(/\s+/)[0] : null,
    addParty: addParty ? addParty.name : null,
    guarantorCount: guarantors.length,
    canVersion,
    version: canVersion
      ? {
          source: pkg.id,
          id: "a5Fbb0000009TESTV1",
          name: `${relationship} credit package`,
          moved: { loanId: target.loanId, committed: movedCommitted },
        }
      : null,
    /** What the discard inventory must name: the renamed clone, one sibling
     *  clone, and the version package itself. */
    inventoryWants: canVersion
      ? [movedCloneName, otherClone ? otherClone.name : null, `${relationship} credit package`].filter(Boolean)
      : [],
  };
}
