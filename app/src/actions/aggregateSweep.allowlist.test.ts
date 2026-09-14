import { describe, expect, it } from "vitest";
import { DISCARD_VERSION_OBJECTS, TRANSITION_ALLOWLIST, validateDiscardPlan, validatePlan, validateStep } from "./transitionAllowlist";

/**
 * THE AGGREGATE SHELL ON THE FENCE (0.9.26, after the founder's live filing on 0.9.25).
 *
 * The org's version creation carries `sweep_aggregates`, a write-type step on
 * `LLC_BI__Loan_Collateral_Aggregate__c` that removes the shells nCino's own triggers mint
 * and leave unlinked while pledges are copied onto the clones. 0.9.25 taught the org that and
 * not this mirror, so the confirm gate refused every modification plan with "not on the
 * transition allowlist". These tests hold the mirror to the org's plan, and to nothing wider.
 */

const AGG = "LLC_BI__Loan_Collateral_Aggregate__c";
const sweep = { id: "sweep_aggregates", type: "write", objectName: AGG, fields: ["Id"] };

describe("the collateral aggregate shell on the transition allowlist", () => {
  it("is on the table and is neither creatable nor updatable by this cockpit", () => {
    const policy = TRANSITION_ALLOWLIST[AGG];
    expect(policy).toBeTruthy();
    expect(policy.mayCreate).toBe(false);
    expect(policy.mayUpdate).toBe(false);
    expect(policy.removesOwnRows?.steps).toEqual(["sweep_aggregates"]);
  });

  it("lets the org's own sweep step through, so a modification plan confirms again", () => {
    const plan = [
      { id: "roll_package", type: "write", objectName: "LLC_BI__Product_Package__c", fields: [] },
      { id: "carry_junctions", type: "write", objectName: "LLC_BI__Loan_Collateral2__c", fields: ["LLC_BI__Loan__c"] },
      sweep,
      { id: "verify_clone_0", type: "verification", objectName: "LLC_BI__Loan__c", fields: [] },
    ];
    expect(validatePlan(plan)).toEqual([]);
  });

  it("still refuses any other write on the object: a create or an update is not a sweep", () => {
    const create = { id: "create_aggregate", type: "write", objectName: AGG, fields: ["LLC_BI__lookupKey__c"] };
    const violations = validateStep(create);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/may never be written/);
  });

  it("the discard fence names the object, in the order the org deletes it: after the facilities, before the package", () => {
    const i = DISCARD_VERSION_OBJECTS.indexOf(AGG);
    expect(i).toBeGreaterThan(DISCARD_VERSION_OBJECTS.indexOf("LLC_BI__Loan__c"));
    expect(i).toBeLessThan(DISCARD_VERSION_OBJECTS.indexOf("LLC_BI__Product_Package__c"));
    expect(
      validateDiscardPlan([{ id: "delete_aggregates", type: "write", objectName: AGG, fields: ["Id"] }]),
    ).toEqual([]);
  });
});
