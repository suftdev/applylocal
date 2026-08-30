import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSponsorship, resolveWorkAuthorization, WorkPolicy } from "../src/policy.js";

const policy: WorkPolicy = { currentCountry: "Nigeria", authorizedCountries: ["Nigeria"], outsideAuthorized: "not_authorized", sponsorshipOutsideAuthorized: "required", contractor: "not_applicable", unknown: "pause" };

test("resolves country-aware employee policies", () => {
  assert.deepEqual(resolveWorkAuthorization(policy, { country: "Nigeria", employmentType: "employee", question: "Are you authorized?" }).status, "answer");
  assert.equal(resolveWorkAuthorization(policy, { country: "United States", employmentType: "employee", question: "Are you authorized?" }).answer, "No");
  assert.equal(resolveSponsorship(policy, { country: "United States", employmentType: "employee", question: "Need sponsorship?" }).answer, "Yes");
});

test("pauses for unknown country and handles contractors", () => {
  assert.equal(resolveWorkAuthorization(policy, { employmentType: "employee", question: "Are you authorized?" }).status, "pause");
  assert.equal(resolveWorkAuthorization(policy, { employmentType: "contractor", question: "Are you authorized?" }).status, "not_applicable");
});
