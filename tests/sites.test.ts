import assert from "node:assert/strict";
import { test } from "node:test";
import { siteBehavior } from "../src/sites.js";

test("selects known ATS behavior and falls back to generic", () => {
  assert.equal(siteBehavior("https://boards.greenhouse.io/acme/jobs/1").name, "greenhouse");
  assert.equal(siteBehavior("https://jobs.lever.co/acme/1").name, "lever");
  assert.equal(siteBehavior("https://example.test/jobs/1").name, "generic");
});
