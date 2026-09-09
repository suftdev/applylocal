# Changelog

All notable changes to ApplyLocal. Versions follow semver.

## 0.3.0 — Interactive dashboard, evaluation harness, fabrication gate

### Added
- Interactive home screen: `applylocal` with no arguments opens a dashboard (live status, next-step suggestion, numbered action menu) with inline flows for applying, continuing paused runs, resolving attention items, and reviewing evidence claims. Every menu level supports Back (Esc / Ctrl+C). Set `APPLYLOCAL_NO_HOME=1` to skip it in scripts.
- `applylocal evals`: live LLM-in-the-loop safety evaluation writing measured reports (pass rate, refusal rate, fabrication incidents, median latency) per provider and model.
- Fabrication gate in the runtime: model answers that cannot be grounded in registered evidence are downgraded to `needs_user` before reaching any form or the user. Eval reports distinguish gate-blocked from reached outputs.
- Sensitive-topic guard and evidence-selection fallback in reasoning.
- Terminal UI system: amber ledger identity (`◆` brand mark, status dots, ledger line headers, aligned tables), spinner progress on long operations, `--json` on all user-facing commands.

### Changed
- Handoff output is terminal-native: field-state table (✓ filled / ▲ needs you) with numbered resolution steps.
- Provider compatibility: providers without native JSON response formats fall back to prompted JSON with local schema validation and one corrective retry.

### Fixed
- Radio groups are judged per-group, not per-button; answered groups no longer block finalize.
- Sensitive-field detection skips hidden inputs and honors user-completed fields.
- Multi-question forms surface one attention item per question; resolve → continue loops terminate.
- Provider failures pause runs with an attention item instead of crashing.
- Browser launches without automation flags so site scripts (hCaptcha) behave; challenges remain human-solved.

## 0.2.0 — First public release

- Published to npm. Validated end to end on a live Lever ATS: evidence-backed fill → human review → captcha handoff → confirmed submission → local ledger record.
- Provider-agnostic reasoning (Anthropic, OpenAI, Google, Vercel AI Gateway, any OpenAI-compatible endpoint) with live model listing, `setup --section reasoning`, and the `~/.config/applylocal/env` credential file.
- ATS behaviors: Lever, Greenhouse, Ashby, Workday, Workable, generic fallback.
- `runs recover --confirmed-not-submitted` escape hatch; `browser attach` self-starts the worker; `runs continue` rescans after manual login.
