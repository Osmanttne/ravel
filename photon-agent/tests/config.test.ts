import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfiguration } from "../src/config.js";
import { CheckFailure } from "../src/ravel-client.js";

// Every environment file below is synthetic and belongs to this temporary test
// directory. The repository and user's real .env are never read by these tests.
function configurationDirectory(): { root: string; agent: string } {
  const root = mkdtempSync(join(tmpdir(), "ravel-photon-config-test-"));
  const agent = join(root, "photon-agent");
  mkdirSync(agent);
  return { root, agent };
}
const values: NodeJS.ProcessEnv = {
  SPECTRUM_PROJECT_ID: "synthetic-project", SPECTRUM_PROJECT_SECRET: "synthetic-secret",
  RAVEL_API_BASE_URL: "https://backend.example",
};

test("explicit process values override synthetic agent and root environment files", (context) => {
  const directory = configurationDirectory();
  context.after(() => rmSync(directory.root, { recursive: true, force: true }));
  writeFileSync(join(directory.root, ".env"), "SPECTRUM_PROJECT_ID=root-demo\nSPECTRUM_PROJECT_SECRET=root-demo-secret\nRAVEL_API_BASE_URL=https://root.example\n");
  writeFileSync(join(directory.agent, ".env"), "SPECTRUM_PROJECT_ID=agent-demo\nSPECTRUM_PROJECT_SECRET=agent-demo-secret\nRAVEL_API_BASE_URL=https://agent.example\n");
  assert.deepEqual(loadConfiguration(values, directory.agent), {
    projectId: "synthetic-project", projectSecret: "synthetic-secret",
    backend: { baseURL: "https://backend.example", allowLocalHTTP: false, timeoutSeconds: 45 },
  });
  assert.equal(loadConfiguration({}, directory.agent).projectId, "agent-demo");
});

test("configuration accepts an explicitly allowed synthetic LAN development server", (context) => {
  const directory = configurationDirectory();
  context.after(() => rmSync(directory.root, { recursive: true, force: true }));
  const configuration = loadConfiguration({
    ...values, RAVEL_API_BASE_URL: "http://192.168.10.8:8002",
    RAVEL_ALLOW_LOCAL_HTTP: "true", RAVEL_CHECK_TIMEOUT_SECONDS: "7.5",
  }, directory.agent);
  assert.deepEqual(configuration.backend, {
    baseURL: "http://192.168.10.8:8002", allowLocalHTTP: true, timeoutSeconds: 7.5,
  });
});

for (const [name, overrides] of [
  ["missing project ID", { SPECTRUM_PROJECT_ID: "" }],
  ["missing project secret", { SPECTRUM_PROJECT_SECRET: "" }],
  ["missing backend", { RAVEL_API_BASE_URL: "" }],
  ["credential whitespace", { SPECTRUM_PROJECT_SECRET: "synthetic private-secret" }],
  ["credential format control", { SPECTRUM_PROJECT_SECRET: "synthetic\u200bprivate-secret" }],
  ["unapproved HTTP", { RAVEL_API_BASE_URL: "http://192.168.10.8:8002" }],
  ["invalid HTTP opt-in", { RAVEL_ALLOW_LOCAL_HTTP: "yes" }],
  ["zero timeout", { RAVEL_CHECK_TIMEOUT_SECONDS: "0" }],
  ["oversized timeout", { RAVEL_CHECK_TIMEOUT_SECONDS: "121" }],
  ["nonfinite timeout", { RAVEL_CHECK_TIMEOUT_SECONDS: "Infinity" }],
] satisfies [string, NodeJS.ProcessEnv][]) {
  test(`configuration failure is fixed and content-free: ${name}`, (context) => {
    const directory = configurationDirectory();
    context.after(() => rmSync(directory.root, { recursive: true, force: true }));
    assert.throws(() => loadConfiguration({ ...values, ...overrides }, directory.agent), (error: unknown) => {
      assert.ok(error instanceof CheckFailure);
      assert.equal(error.code, "configuration");
      assert.doesNotMatch(error.message, /synthetic|private-secret|192\.168|backend\.example/);
      return true;
    });
  });
}
