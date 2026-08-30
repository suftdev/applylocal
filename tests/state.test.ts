import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { loadState } from "../src/core.js";

test("rejects malformed and unsupported state", async () => {
  const root = await mkdtemp(join(tmpdir(), "applylocal-state-"));
  process.env.APPLYLOCAL_DATA_DIR = root;
  await writeFile(join(root, "state.json"), "not-json");
  await assert.rejects(() => loadState(), /JSON/);
  await writeFile(join(root, "state.json"), JSON.stringify({ schemaVersion: 99 }));
  await assert.rejects(() => loadState(), /Unsupported ApplyLocal state version/);
});

test("upgrades legacy state without a version in memory", async () => {
  const root = await mkdtemp(join(tmpdir(), "applylocal-legacy-"));
  process.env.APPLYLOCAL_DATA_DIR = root;
  await writeFile(join(root, "state.json"), JSON.stringify({ evidence: [], runs: [], attention: [], applications: [] }));
  assert.equal((await loadState()).schemaVersion, 2);
});

test("uses one stable user data directory when launched from another directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "applylocal-stable-"));
  const previous = process.env.APPLYLOCAL_DATA_DIR;
  delete process.env.APPLYLOCAL_DATA_DIR;
  process.env.XDG_DATA_HOME = root;
  const state = await import("../src/core.js");
  assert.equal(state.dataDir(), join(root, "applylocal"));
  if (previous) process.env.APPLYLOCAL_DATA_DIR = previous; else delete process.env.APPLYLOCAL_DATA_DIR;
});
