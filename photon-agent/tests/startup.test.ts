import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The approval gate precedes configuration/SDK startup, including for --live.
// The child also refuses environment-file reads and network calls so a future
// regression cannot turn this startup assertion into a connected test.
for (const args of [[], ["--help"], ["--live=false"], ["--live", "unexpected-extra-argument"], ["--live"]]) {
  test(`cloud startup stays disabled for arguments ${JSON.stringify(args)}`, () => {
    const entry = fileURLToPath(new URL("../src/index.js", import.meta.url));
    const script = `
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      const readFile = fs.readFileSync;
      fs.readFileSync = (path, ...options) => {
        if (String(path).endsWith("/.env")) throw new Error("Test forbids environment-file access");
        return readFile(path, ...options);
      };
      syncBuiltinESMExports();
      globalThis.fetch = async () => { throw new Error("Test forbids network access"); };
      process.argv = [process.execPath, ${JSON.stringify(entry)}, ...${JSON.stringify(args)}];
      await import(${JSON.stringify(new URL("../src/index.js", import.meta.url).href)});
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      encoding: "utf8", env: {}, timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Live Photon replies are disabled/);
    assert.doesNotMatch(result.stderr, /cloud_session_ready|projectSecret|GEMINI_API_KEY|SPECTRUM_PROJECT_SECRET/);
  });
}
