import chalk from "chalk";
import boxen from "boxen";

export const c = {
  brand: (text: string) => chalk.yellow(text),
  ok: (text: string) => chalk.green(text),
  bad: (text: string) => chalk.red(text),
  warn: (text: string) => chalk.yellow(text),
  dim: (text: string) => chalk.dim(text),
  name: (text: string) => chalk.bold.white(text),
  cmd: (text: string) => chalk.cyan(text),
  label: (text: string) => chalk.bold(text.toUpperCase()),
  bold: (text: string) => chalk.bold(text),
};

export const glyphs = {
  dot: (status: string): string => {
    if (status === "submitted") return c.ok("●");
    if (status === "waiting_for_user" || status === "ready_to_submit") return c.warn("●");
    if (status === "failed" || status === "unknown") return c.bad("●");
    return c.dim("○");
  },
  check: c.ok("✓"),
  cross: c.bad("✗"),
  arrow: c.dim("→"),
  mark: c.brand("◆"),
};

export function brandLine(subtitle?: string): string {
  return `${glyphs.mark} ${c.name("ApplyLocal")}${subtitle ? ` ${c.dim(subtitle)}` : ""}`;
}

export function ledgerLine(left: string, status?: string): string {
  const stamp = status ? ` ${glyphs.dot(status)} ${status}` : "";
  const text = `─ ${left}${c.dim(stamp)} `;
  const width = Math.max(0, 64 - left.length - (status ?? "").length - 4);
  return c.dim(text + "─".repeat(width));
}

export function section(label: string): string {
  return `\n${c.label(label)}\n`;
}

export function kv(key: string, value: string, keyWidth = 18): string {
  return `  ${c.dim(key.padEnd(keyWidth))}${value}`;
}

export function table(rows: string[][], headers?: string[]): string {
  if (!rows.length) return c.dim("  (none)");
  const widths: number[] = [];
  const allRows: string[][] = headers ? [headers, ...rows] : rows;
  for (const row of allRows) {
    row.forEach((cell, i) => {
      const visible = cell.replace(/\u001b\[[0-9;]*m/g, "").length;
      widths[i] = Math.max(widths[i] ?? 0, visible);
    });
  }
  const line = (cells: string[]) => {
    const safe = cells ?? [];
    return "  " + safe.map((cell, i) => cell + " ".repeat(Math.max(0, (widths[i] ?? 0) - cell.replace(/\u001b\[[0-9;]*m/g, "").length))).join("  ");
  };
  const out: string[] = [];
  if (headers) out.push(c.dim(line(headers)));
  if (headers) out.push(c.dim("  " + widths.map((w) => "─".repeat(w)).join("  ")));
  for (const row of rows) out.push(line(row));
  return out.join("\n");
}

export function panel(content: string, options?: { borderColor?: "yellow" | "green" | "red" }): string {
  return boxen(content.trim(), { padding: { top: 0, bottom: 0, left: 1, right: 1 }, borderStyle: "round", borderColor: options?.borderColor ?? "gray", dimBorder: true });
}

export function success(message: string): string {
  return `${glyphs.check} ${message}`;
}

export function nextStep(command: string): string {
  return `\n${glyphs.arrow} ${c.cmd(command)}`;
}

export { nextStep as arrowStep };

export async function withSpinner<T>(message: string, work: (spinnerText: (text: string) => string) => Promise<T>): Promise<T> {
  if (process.env.APPLYLOCAL_NO_SPINNER === "1" || !process.stdout.isTTY) {
    console.log(c.dim(`… ${message}`));
    return work((text) => text);
  }
  const { default: Ora } = await import("ora");
  const spinner = Ora({ text: c.dim(message), spinner: "dots", color: "yellow" });
  spinner.start();
  try {
    const result = await work((text) => { spinner.text = c.dim(text); return text; });
    spinner.stop();
    return result;
  } catch (error) {
    spinner.stop();
    throw error;
  }
}

export function humanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${glyphs.cross} ${c.bad(message)}`;
}

const SHADOW: Record<string, string[]> = {
  A: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
  P: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔═══╝ ", "██║     ", "╚═╝     "],
  L: ["██╗     ", "██║     ", "██║     ", "██║     ", "███████╗", "╚══════╝"],
  Y: ["██╗   ██╗", "╚██╗ ██╔╝", " ╚████╔╝ ", "  ╚██╔╝  ", "   ██║   ", "   ╚═╝   "],
  O: [" ██████╗ ", "██╔═══██╗", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
  C: [" ██████╗", "██╔════╝", "██║     ", "██║     ", "╚██████╗", " ╚═════╝"],
};

const HEADER_RAMP = ["#fde68a", "#fcd34d", "#fbbf24", "#f59e0b", "#d97706", "#b45309"];

export function bigHeader(subtitle: string, version?: string): string {
  const word = "APPLYLOCAL";
  const needsWide = word.length * 9 + 4;
  if (!process.stdout.isTTY || (process.stdout.columns && process.stdout.columns < needsWide)) {
    return `${brandLine(version ? `v${version}` : undefined)}\n${c.dim(`  ${subtitle}`)}`;
  }
  const rows = ["", "", "", "", "", ""];
  for (const ch of word) {
    const glyphRows = SHADOW[ch] ?? [];
    const width = Math.max(...glyphRows.map((row) => row.length));
    glyphRows.forEach((row, i) => { rows[i] += row.padEnd(width) + " "; });
  }
  const art = rows.map((row, i) => chalk.hex(HEADER_RAMP[i])(row.trimEnd())).join("\n");
  const tagline = c.dim(`  ${subtitle}${version ? c.dim(`  ·  ${c.dim(`v${version}`)}`) : ""}`);
  return `${art}\n${tagline}`;
}
