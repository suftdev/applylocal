import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addEvidence } from "../src/evidence.js";

test("indexes only readable files from an explicitly registered directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "applylocal-evidence-"));
  process.env.APPLYLOCAL_DATA_DIR = join(root, "state");
  await writeFile(join(root, "README.md"), "Verified project evidence");
  await writeFile(join(root, ".env"), "SECRET=hidden");
  await mkdir(join(root, "node_modules"));
  await writeFile(join(root, "node_modules", "ignored.js"), "ignored");
  const source = await addEvidence(root);
  assert.match(source.content ?? "", /Verified project evidence/);
  assert.doesNotMatch(source.content ?? "", /SECRET=hidden|ignored/);
});
