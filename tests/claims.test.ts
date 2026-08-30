import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { addEvidence, reviewSummary } from "../src/evidence.js";
import { loadState, saveState } from "../src/core.js";

test("claims start unreviewed and review summary tracks lifecycle", async () => {
  const root = await mkdtemp(join(tmpdir(), "applylocal-claims-"));
  process.env.APPLYLOCAL_DATA_DIR = join(root, "data");
  const file = join(root, "facts.md");
  await writeFile(file, "Built an AI product. Improved performance by 20%.");
  await addEvidence(file);
  assert.deepEqual(await reviewSummary(), { sources: 1, claims: 2, approved: 0, unreviewed: 2, rejected: 0 });
  const state = await loadState();
  state.claims[0].status = "approved";
  state.claims[1].status = "rejected";
  await saveState(state);
  assert.deepEqual(await reviewSummary(), { sources: 1, claims: 2, approved: 1, unreviewed: 0, rejected: 1 });
});
