import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCases } from "../src/evaluate.js";

test("evaluation dataset passes the evidence safety baseline", async () => {
  const result = await evaluateCases(new URL("../evaluation/cases.json", import.meta.url).pathname);
  assert.equal(result.failed.length, 0);
  assert.equal(result.passed, result.total);
});
