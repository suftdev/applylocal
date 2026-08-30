import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { saveState } from "../src/core.js";
import { backupState, deleteState, exportState } from "../src/state-ops.js";

test("backs up, exports, and deletes local state", async () => {
  const root = await mkdtemp(join(tmpdir(), "applylocal-state-ops-"));
  process.env.APPLYLOCAL_DATA_DIR = join(root, "data");
  await saveState({ schemaVersion: 2, evidence: [], claims: [], runs: [], attention: [], applications: [], traces: [] });
  const backup = await backupState();
  await access(backup);
  const exported = join(root, "export.json");
  await exportState(exported);
  assert.match(await readFile(exported, "utf8"), /schemaVersion/);
  await deleteState();
  await assert.rejects(() => access(join(root, "data")));
});
