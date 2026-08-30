import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { addEvidence, removeEvidence } from "../src/evidence.js";
import { loadState } from "../src/core.js";

test("re-indexes and removes an evidence source", async () => {
  const root = await mkdtemp(join(tmpdir(), "applylocal-evidence-ops-"));
  process.env.APPLYLOCAL_DATA_DIR = join(root, "data");
  const file = join(root, "profile.md");
  await writeFile(file, "first version");
  const first = await addEvidence(file);
  await writeFile(file, "second version");
  const second = await addEvidence(file);
  assert.equal(second.id, first.id);
  assert.equal((await loadState()).evidence.length, 1);
  await removeEvidence(first.id);
  assert.equal((await loadState()).evidence.length, 0);
});
