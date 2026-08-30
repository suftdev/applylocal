import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir, loadState } from "./core.js";

export async function exportState(output: string): Promise<void> { await writeFile(output, `${JSON.stringify(await loadState(), null, 2)}\n`, { mode: 0o600 }); }
export async function backupState(): Promise<string> { const source = join(dataDir(), "state.json"); const output = join(dataDir(), `state.backup.${Date.now()}.json`); await copyFile(source, output); return output; }
export async function deleteState(): Promise<void> { await rm(dataDir(), { recursive: true, force: true }); }
