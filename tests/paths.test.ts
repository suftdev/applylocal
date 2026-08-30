import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { displayPath, expandPath, validatePath } from "../src/paths.js";

test("expands and displays home-relative paths", () => {
  const absolute = join(homedir(), "Documents", "resume.pdf");
  assert.equal(expandPath("~/Documents/resume.pdf"), absolute);
  assert.equal(displayPath(absolute), "~/Documents/resume.pdf");
});

test("validates selected files and directories", async () => {
  const root = await mkdtemp(join("/tmp", "applylocal-paths-"));
  const file = join(root, "resume.pdf");
  const directory = join(root, "projects");
  await writeFile(file, "resume");
  await mkdir(directory);
  assert.equal(await validatePath(file, "file"), file);
  assert.equal(await validatePath(directory, "directory"), directory);
  await assert.rejects(() => validatePath(file, "directory"), /folder/);
  await assert.rejects(() => validatePath(directory, "file"), /file/);
});
