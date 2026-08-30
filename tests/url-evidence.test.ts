import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { addEvidence } from "../src/evidence.js";

let server: ReturnType<typeof createServer>;
let url: string;

before(async () => {
  process.env.APPLYLOCAL_DATA_DIR = await mkdtemp(join(tmpdir(), "applylocal-url-state-"));
  server = createServer((_request, response) => { response.end("Portfolio evidence"); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("URL fixture did not start");
  url = `http://127.0.0.1:${address.port}/evidence`;
});

after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

test("fetches explicitly registered URL evidence", async () => {
  const source = await addEvidence(url);
  assert.equal(source.kind, "url");
  assert.equal(source.content, "Portfolio evidence");
});
