import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { updateState } from "../src/core.js";

test("serializes concurrent state updates without losing records", async () => {
  process.env.APPLYLOCAL_DATA_DIR = await mkdtemp(join(tmpdir(), "applylocal-concurrent-"));
  await Promise.all(Array.from({ length: 8 }, (_, index) => updateState((state) => { state.evidence.push({ id: `ev-${index}`, input: `file-${index}`, kind: "file", addedAt: new Date().toISOString() }); state.claims ??= []; })));
  const { loadState } = await import("../src/core.js");
  assert.equal((await loadState()).evidence.length, 8);
});
