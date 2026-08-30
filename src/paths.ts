import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { input, select } from "@inquirer/prompts";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

export function expandPath(value: string): string {
  const expanded = value.trim().replace(/^~(?=$|\/)/, homedir());
  return resolve(expanded);
}

async function nativePicker(kind: "file" | "directory"): Promise<string | undefined> {
  const commands: Array<[string, string[]]> = kind === "file"
    ? [["zenity", ["--file-selection", "--title=Choose your resume"]], ["kdialog", ["--getopenfilename", homedir()]], ["yad", ["--file-selection", "--title=Choose your resume"]]]
    : [["zenity", ["--file-selection", "--directory", "--title=Choose an evidence folder"]], ["kdialog", ["--getexistingdirectory", homedir()]], ["yad", ["--file-selection", "--directory", "--title=Choose an evidence folder"]]];
  for (const [command, args] of commands) {
    try {
      const result = await execFileAsync(command, args, { timeout: 120_000, encoding: "utf8" });
      const selected = result.stdout.trim();
      if (selected) return expandPath(selected);
    } catch {
      continue;
    }
  }
  return undefined;
}

export async function choosePath(kind: "file" | "directory", label: string, existing?: string): Promise<string> {
  const picked = await nativePicker(kind);
  if (picked) return validatePath(picked, kind);
  const value = await input({ message: label, default: existing ? displayPath(existing) : undefined, validate: async (answer) => {
    try { await validatePath(answer, kind); return true; } catch (error) { return error instanceof Error ? error.message : "Path is not valid"; }
  } });
  return validatePath(value, kind);
}

export async function chooseEvidenceSource(): Promise<string> {
  const kind = await select({ message: "Add evidence from", choices: [{ name: "A file", value: "file" as const }, { name: "A project folder", value: "directory" as const }, { name: "A URL", value: "url" as const }] });
  if (kind === "url") return input({ message: "Evidence URL", validate: (value) => /^https?:\/\//.test(value) || "Enter a URL starting with http:// or https://" });
  return choosePath(kind, kind === "file" ? "Choose an evidence file" : "Choose an evidence folder");
}

export async function validatePath(value: string, kind: "file" | "directory"): Promise<string> {
  const path = expandPath(value);
  await access(path);
  const details = await stat(path);
  if (kind === "file" && !details.isFile()) throw new Error("Choose a file, not a folder");
  if (kind === "directory" && !details.isDirectory()) throw new Error("Choose a folder, not a file");
  return path;
}

export function displayPath(value: string): string {
  const path = expandPath(value);
  return path.startsWith(`${homedir()}/`) ? `~/${path.slice(homedir().length + 1)}` : path;
}
