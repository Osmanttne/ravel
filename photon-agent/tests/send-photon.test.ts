import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Dynamic URL imports keep this plain JavaScript operational script outside the
// TypeScript compilation graph. These tests never import or connect its SDK.
const scriptURL = new URL("../../../scripts/send_photon_test.mjs", import.meta.url);
const script = await import(scriptURL.href) as SendScript;
const RECIPIENT = "+12025550123";
const OTHER_RECIPIENT = "+12025550124";
const RAW_SECRET = "synthetic-project-secret-private-diagnostic";

interface SendResult {
  code: string;
  recipient: string;
  message: string;
  messages_sent: number;
  delivery_verified: boolean;
  sender_routing: string;
  sender_number: null;
}

interface SendDependencies {
  Spectrum: (options: unknown) => Promise<unknown>;
  imessage: ((application: unknown) => unknown) & { config: () => unknown };
  configuration: { projectId: string; projectSecret: string };
  sendTimeoutMilliseconds?: number;
}

interface SendScript {
  TEST_MESSAGE: string;
  classifyFailure(error: unknown): SafeDiagnostics;
  parseArguments(args: string[]): { recipient: string; send: boolean };
  sendOneTest(recipient: string, dependencies: SendDependencies): Promise<SendResult>;
  sendOneApprovedText(recipient: string, message: string, dependencies: SendDependencies): Promise<SendResult>;
  main(args: string[], options?: {
    send?: (recipient: string) => Promise<SendResult>;
    output?: (value: string) => void;
  }): Promise<number>;
}

interface SafeDiagnostics {
  error_type: string;
  provider_code: string;
  http_status: number | null;
  grpc_status: number | null;
}

const EMPTY_DIAGNOSTICS: SafeDiagnostics = {
  error_type: "unclassified", provider_code: "unclassified", http_status: null, grpc_status: null,
};

interface SafeError extends Error {
  code: string;
  attempted: boolean;
}

interface MockOptions {
  user?: unknown;
  route?: Record<string, unknown>;
  acknowledgement?: unknown;
  failAt?: "connect" | "user" | "create" | "send";
  failure?: unknown;
  cleanupFailure?: boolean;
  pendingSend?: boolean;
}

function createMock(options: MockOptions = {}) {
  const failure = Object.hasOwn(options, "failure") ? options.failure : new Error(RAW_SECRET);
  const calls = {
    connect: [] as unknown[], user: [] as string[], create: [] as unknown[],
    send: [] as string[], stop: 0, providerConfig: 0, platform: 0, forbidden: 0,
  };
  const forbiddenAccess = () => {
    calls.forbidden++;
    throw new Error(`Unexpected private SDK reader: ${RAW_SECRET}`);
  };
  const application = {
    async stop() {
      calls.stop++;
      if (options.cleanupFailure) throw new Error(RAW_SECRET);
    },
    get messages() { return forbiddenAccess(); },
    get on() { return forbiddenAccess(); },
    get listen() { return forbiddenAccess(); },
  };
  const user = Object.hasOwn(options, "user") ? options.user : { id: RECIPIENT, address: RECIPIENT };
  const route = {
    type: "dm", phone: "shared", id: `any;-;${RECIPIENT}`, ...options.route,
    get messages() { return forbiddenAccess(); },
    get getMembers() { return forbiddenAccess(); },
    get typing() { return forbiddenAccess(); },
    async send(message: string) {
      calls.send.push(message);
      if (options.failAt === "send") throw failure;
      if (options.pendingSend) return new Promise<never>(() => {});
      if (Object.hasOwn(options, "acknowledgement")) return options.acknowledgement;
      return {
        id: "synthetic-outbound-id", platform: "imessage", direction: "outbound",
        space: { id: route.id }, content: { type: "text", text: script.TEST_MESSAGE },
      };
    },
  };
  const platform = {
    get messages() { return forbiddenAccess(); },
    async user(recipient: string) {
      calls.user.push(recipient);
      if (options.failAt === "user") throw failure;
      return user;
    },
    space: {
      async create(resolvedUser: unknown) {
        calls.create.push(resolvedUser);
        if (options.failAt === "create") throw failure;
        return route;
      },
    },
  };
  const imessage = Object.assign((receivedApplication: unknown) => {
    calls.platform++;
    assert.equal(receivedApplication, application);
    return platform;
  }, { config: () => {
    calls.providerConfig++;
    return { provider: "synthetic-imessage-provider" };
  } });
  const dependencies: SendDependencies = {
    async Spectrum(connectionOptions: unknown) {
      calls.connect.push(connectionOptions);
      if (options.failAt === "connect") throw failure;
      return application;
    },
    imessage,
    configuration: { projectId: "synthetic-project", projectSecret: RAW_SECRET },
  };
  return { calls, dependencies, user };
}

async function expectSafeFailure(action: () => Promise<unknown>, code: string, attempted: boolean) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof Error);
    const safeError = error as SafeError;
    assert.equal(safeError.code, code);
    assert.equal(safeError.message, code);
    assert.equal(safeError.attempted, attempted);
    assert.doesNotMatch(String(error), /synthetic-project-secret|private-diagnostic/);
    return true;
  });
}

test("test message is fixed and preview requires no send approval inference", () => {
  assert.equal(script.TEST_MESSAGE, "Ravel test: Gemini + Photon setup check. No action is required.");
  assert.deepEqual(script.parseArguments(["--recipient", RECIPIENT]), { recipient: RECIPIENT, send: false });
  assert.deepEqual(script.parseArguments(["--send", "--recipient", RECIPIENT]), { recipient: RECIPIENT, send: true });
});

for (const args of [
  [], ["--recipient"], ["--recipient", "2025550123"], ["--recipient", `${RECIPIENT} `],
  ["--recipient", "+01234567"], ["--recipient", "+123456"], ["--recipient", "+1234567890123456"],
  ["--recipient", RECIPIENT, "--recipient", OTHER_RECIPIENT],
  ["--recipient", RECIPIENT, "--send", "--send"], ["--recipient", RECIPIENT, "--live"],
]) {
  test(`invalid send arguments fail before a sender can run: ${JSON.stringify(args)}`, async () => {
    let sendCount = 0;
    const output: string[] = [];
    const code = await script.main(args, {
      send: async () => { sendCount++; throw new Error(RAW_SECRET); },
      output: value => output.push(value),
    });
    assert.equal(code, 1);
    assert.equal(sendCount, 0);
    assert.equal(output.length, 1);
    const result = JSON.parse(output[0]!) as Record<string, unknown>;
    assert.ok(["invalid_arguments", "invalid_recipient"].includes(String(result.code)));
    assert.deepEqual({ ...result, code: "invalid" }, {
      code: "invalid", send_attempted: false, messages_sent: 0, delivery_verified: false,
      failure_stage: "arguments", ...EMPTY_DIAGNOSTICS,
    });
    assert.doesNotMatch(output.join(""), /private-diagnostic|synthetic-project-secret|\+1202555/);
  });
}

test("preview displays exact synthetic recipient and message without invoking sender", async () => {
  const output: string[] = [];
  let sends = 0;
  const exitCode = await script.main(["--recipient", RECIPIENT], {
    send: async () => { sends++; throw new Error("A preview must never send"); },
    output: value => output.push(value),
  });
  assert.equal(exitCode, 0);
  assert.equal(sends, 0);
  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]!), {
    code: "preview_only_requires_user_approval", recipient: RECIPIENT,
    message: script.TEST_MESSAGE, messages_sent: 0, network_connected: false,
    sender_routing: "photon_shared_line_recipient_dependent", sender_number: null,
  });
});

test("default preview forbids credential files, SDK imports and network access", () => {
  const child = `
    import fs from "node:fs";
    import { registerHooks, syncBuiltinESMExports } from "node:module";
    const readFile = fs.readFileSync;
    fs.readFileSync = (path, ...options) => {
      if (String(path).endsWith("/.env")) throw new Error("Credential file access forbidden");
      return readFile(path, ...options);
    };
    syncBuiltinESMExports();
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier.includes("@spectrum") || specifier.endsWith("/config.js")) {
        throw new Error("SDK and credential configuration imports forbidden");
      }
      return nextResolve(specifier, context);
    } });
    globalThis.fetch = async () => { throw new Error("Network forbidden"); };
    const { main } = await import(${JSON.stringify(scriptURL.href)});
    process.exitCode = await main(["--recipient", ${JSON.stringify(RECIPIENT)}]);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", child], {
    encoding: "utf8", env: {}, timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const preview = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(preview.code, "preview_only_requires_user_approval");
  assert.equal(preview.messages_sent, 0);
  assert.equal(preview.network_connected, false);
});

test("exact resolved user and shared DM GUID allow one logical send and stop once", async () => {
  const mock = createMock();
  const result = await script.sendOneTest(RECIPIENT, mock.dependencies);
  assert.deepEqual(mock.calls.connect, [{
    projectId: "synthetic-project", projectSecret: RAW_SECRET,
    providers: [{ provider: "synthetic-imessage-provider" }], telemetry: false,
    options: { logLevel: "silent", flattenGroups: false },
  }]);
  assert.deepEqual(mock.calls.user, [RECIPIENT]);
  assert.deepEqual(mock.calls.create, [mock.user]);
  assert.deepEqual(mock.calls.send, [script.TEST_MESSAGE]);
  assert.equal(mock.calls.providerConfig, 1);
  assert.equal(mock.calls.platform, 1);
  assert.equal(mock.calls.stop, 1);
  assert.equal(mock.calls.forbidden, 0);
  assert.deepEqual(result, {
    code: "send_accepted", recipient: RECIPIENT, message: script.TEST_MESSAGE,
    messages_sent: 1, delivery_verified: false,
    sender_routing: "photon_shared_line_recipient_dependent", sender_number: null,
  });
});

test("resolved exact user ID may omit an address but cannot substitute an alias", async () => {
  const mock = createMock({ user: { id: RECIPIENT } });
  await script.sendOneTest(RECIPIENT, mock.dependencies);
  assert.deepEqual(mock.calls.send, [script.TEST_MESSAGE]);
  assert.equal(mock.calls.stop, 1);
});

for (const user of [null, {}, { id: OTHER_RECIPIENT, address: RECIPIENT },
  { id: RECIPIENT, address: OTHER_RECIPIENT }, { id: RECIPIENT, address: "recipient-alias" }]) {
  test(`recipient resolution mismatch prevents sends: ${JSON.stringify(user)}`, async () => {
    const mock = createMock({ user });
    await expectSafeFailure(() => script.sendOneTest(RECIPIENT, mock.dependencies), "recipient_resolution_mismatch", false);
    assert.equal(mock.calls.create.length, 0);
    assert.equal(mock.calls.send.length, 0);
    assert.equal(mock.calls.stop, 1);
    assert.equal(mock.calls.forbidden, 0);
  });
}

for (const route of [
  { type: "group" }, { type: undefined }, { phone: "personal" }, { phone: undefined },
  { id: `any;-;${OTHER_RECIPIENT}` }, { id: `iMessage;-;${RECIPIENT}` }, { id: undefined },
]) {
  test(`unverified route prevents sends: ${JSON.stringify(route)}`, async () => {
    const mock = createMock({ route });
    await expectSafeFailure(() => script.sendOneTest(RECIPIENT, mock.dependencies), "unverified_destination_route", false);
    assert.equal(mock.calls.send.length, 0);
    assert.equal(mock.calls.stop, 1);
    assert.equal(mock.calls.forbidden, 0);
  });
}

for (const failAt of ["connect", "user", "create", "send"] as const) {
  test(`SDK ${failAt} error is scrubbed, has accurate attempted state, and never retries`, async () => {
    const mock = createMock({ failAt });
    const attempted = failAt === "send";
    const output: string[] = [];
    const exitCode = await script.main(["--recipient", RECIPIENT, "--send"], {
      send: recipient => script.sendOneTest(recipient, mock.dependencies),
      output: value => output.push(value),
    });
    assert.equal(exitCode, 1);
    assert.deepEqual(JSON.parse(output[0]!), {
      code: "send_failed", send_attempted: attempted,
      messages_sent: attempted ? null : 0, delivery_verified: false,
      failure_stage: { connect: "sdk_initialization", user: "recipient_resolution", create: "destination_route", send: "send" }[failAt],
      ...EMPTY_DIAGNOSTICS,
    });
    assert.equal(mock.calls.connect.length, 1);
    assert.equal(mock.calls.send.length, attempted ? 1 : 0);
    assert.equal(mock.calls.stop, failAt === "connect" ? 0 : 1);
    assert.equal(mock.calls.forbidden, 0);
    assert.doesNotMatch(output.join(""), /synthetic-project-secret|private-diagnostic|\+1202555/);
  });
}

const validAcknowledgement = {
  id: "synthetic-outbound-id", platform: "imessage", direction: "outbound",
  space: { id: `any;-;${RECIPIENT}` }, content: { type: "text", text: script.TEST_MESSAGE },
};
for (const acknowledgement of [
  undefined, null, {}, { ...validAcknowledgement, id: "" },
  { ...validAcknowledgement, platform: "sms" }, { ...validAcknowledgement, direction: "inbound" },
  { ...validAcknowledgement, space: { id: `any;-;${OTHER_RECIPIENT}` } },
  { ...validAcknowledgement, content: { type: "image", text: script.TEST_MESSAGE } },
  { ...validAcknowledgement, content: { type: "text", text: "different outgoing content" } },
]) {
  test(`unverified send acknowledgement reports unknown delivery: ${JSON.stringify(acknowledgement)}`, async () => {
    const mock = createMock({ acknowledgement });
    const output: string[] = [];
    assert.equal(await script.main(["--recipient", RECIPIENT, "--send"], {
      send: recipient => script.sendOneTest(recipient, mock.dependencies),
      output: value => output.push(value),
    }), 1);
    assert.deepEqual(JSON.parse(output[0]!), {
      code: "send_acknowledgement_unverified", send_attempted: true,
      messages_sent: null, delivery_verified: false,
      failure_stage: "acknowledgement_validation", ...EMPTY_DIAGNOSTICS,
    });
    assert.deepEqual(mock.calls.send, [script.TEST_MESSAGE]);
    assert.equal(mock.calls.stop, 1);
    assert.equal(mock.calls.forbidden, 0);
  });
}

test("pending send times out with unknown delivery, stops once, and does not retry", async () => {
  const mock = createMock({ pendingSend: true });
  const output: string[] = [];
  const exitCode = await script.main(["--recipient", RECIPIENT, "--send"], {
    send: recipient => script.sendOneTest(recipient, { ...mock.dependencies, sendTimeoutMilliseconds: 1 }),
    output: value => output.push(value),
  });
  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(output[0]!), {
    code: "send_timeout_delivery_unknown", send_attempted: true,
    messages_sent: null, delivery_verified: false,
    failure_stage: "send", ...EMPTY_DIAGNOSTICS,
  });
  assert.deepEqual(mock.calls.send, [script.TEST_MESSAGE]);
  assert.equal(mock.calls.stop, 1);
  assert.equal(mock.calls.forbidden, 0);
});

for (const sendTimeoutMilliseconds of [0, -1, 30_001, Number.NaN, Number.POSITIVE_INFINITY]) {
  test(`invalid timeout ${sendTimeoutMilliseconds} prevents provider connection`, async () => {
    const mock = createMock();
    await expectSafeFailure(() => script.sendOneTest(RECIPIENT, {
      ...mock.dependencies, sendTimeoutMilliseconds,
    }), "invalid_timeout", false);
    assert.equal(mock.calls.connect.length, 0);
    assert.equal(mock.calls.send.length, 0);
  });
}

test("invalid direct recipient prevents provider connection", async () => {
  const mock = createMock();
  await expectSafeFailure(() => script.sendOneTest("recipient-alias", mock.dependencies), "invalid_recipient", false);
  assert.equal(mock.calls.connect.length, 0);
  assert.equal(mock.calls.send.length, 0);
});

test("cleanup rejection cannot obscure acceptance or cause a second send", async () => {
  const mock = createMock({ cleanupFailure: true });
  const result = await script.sendOneTest(RECIPIENT, mock.dependencies);
  assert.equal(result.code, "send_accepted");
  assert.equal(result.delivery_verified, false);
  assert.equal(mock.calls.send.length, 1);
  assert.equal(mock.calls.stop, 1);
});

test("explicit send main emits only the fixed acknowledgement and calls sender once", async () => {
  const mock = createMock();
  const output: string[] = [];
  let sendCount = 0;
  assert.equal(await script.main(["--recipient", RECIPIENT, "--send"], {
    send: recipient => { sendCount++; return script.sendOneTest(recipient, mock.dependencies); },
    output: value => output.push(value),
  }), 0);
  assert.equal(sendCount, 1);
  assert.equal(output.length, 1);
  const result = JSON.parse(output[0]!) as SendResult;
  assert.equal(result.message, script.TEST_MESSAGE);
  assert.equal(result.recipient, RECIPIENT);
  assert.equal(result.messages_sent, 1);
  assert.equal(result.delivery_verified, false);
  assert.doesNotMatch(output.join(""), /synthetic-project-secret|private-diagnostic|synthetic-outbound-id/);
});

test("unexpected main dependency failure never publishes raw errors or invents a sent count", async () => {
  const output: string[] = [];
  assert.equal(await script.main(["--recipient", RECIPIENT, "--send"], {
    send: async () => { throw new Error(`${RAW_SECRET} ${RECIPIENT}`); },
    output: value => output.push(value),
  }), 1);
  assert.deepEqual(JSON.parse(output[0]!), {
    code: "configuration_or_cloud_unavailable", send_attempted: false,
    messages_sent: 0, delivery_verified: false,
    failure_stage: "sdk_initialization", ...EMPTY_DIAGNOSTICS,
  });
});

test("failure diagnostics accept only supported SDK and built-in error names", () => {
  const supported = [
    "IMessageError", "AuthenticationError", "NotFoundError", "RateLimitError", "ValidationError",
    "ConnectionError", "SpectrumCloudError", "UnsupportedError", "ZodError", "TypeError", "TimeoutError", "AbortError",
  ];
  for (const name of supported) {
    const ErrorClass = { [name]: class extends Error {} }[name]!;
    const error = new ErrorClass(RAW_SECRET);
    error.name = name;
    assert.deepEqual(script.classifyFailure(error), {
      error_type: name, provider_code: "unclassified", http_status: null, grpc_status: null,
    });
  }
  for (const name of ["Error", "UnknownVendorError", RAW_SECRET, RECIPIENT, `any;-;${RECIPIENT}`]) {
    const error = Object.assign(new Error(RAW_SECRET), { name });
    assert.equal(script.classifyFailure(error).error_type, "unclassified");
  }
});

test("failure diagnostics enforce integer HTTP and gRPC ranges without coercion", () => {
  const empty = { error_type: "unclassified", provider_code: "unclassified", http_status: null, grpc_status: null };
  for (const httpStatus of [100, 403, 599]) {
    assert.deepEqual(script.classifyFailure({ httpStatus }), { ...empty, http_status: httpStatus });
    assert.deepEqual(script.classifyFailure({ status: httpStatus }), { ...empty, http_status: httpStatus });
  }
  for (const grpcCode of [0, 7, 16]) {
    assert.deepEqual(script.classifyFailure({ grpcCode }), { ...empty, grpc_status: grpcCode });
    assert.deepEqual(script.classifyFailure({ code: grpcCode }), { ...empty, grpc_status: grpcCode });
  }
  for (const invalid of [null, undefined, "403", "7", 99, 600, -1, 16.5, Number.NaN, Number.POSITIVE_INFINITY, RAW_SECRET]) {
    assert.deepEqual(script.classifyFailure({ httpStatus: invalid, grpcCode: invalid }), empty);
  }
  assert.deepEqual(script.classifyFailure({ httpStatus: "403", status: 429, grpcCode: 17, code: 14 }), {
    ...empty, http_status: 429, grpc_status: 14,
  });
  assert.deepEqual(script.classifyFailure({ httpStatus: 403, status: 429, grpcCode: 7, code: 14 }), {
    ...empty, http_status: 403, grpc_status: 7,
  });
});

test("hostile unknown failure details never become diagnostic output", () => {
  const content = `${RAW_SECRET} ${RECIPIENT} any;-;${RECIPIENT} https://tickets.example/?token=private-token`;
  const error = {
    name: content, code: content, httpStatus: content, grpcCode: content,
    message: content, stack: content, cause: { code: "AUTH_FAILED", message: content },
    details: content, metadata: { authorization: content }, response: { body: content },
    toString() { throw new Error(content); },
  };
  assert.deepEqual(script.classifyFailure(error), {
    error_type: "unclassified", provider_code: "unclassified", http_status: null, grpc_status: null,
  });
  const throwing = Object.defineProperty({}, "name", { get() { throw new Error(content); } });
  assert.deepEqual(script.classifyFailure(throwing), {
    error_type: "unclassified", provider_code: "unclassified", http_status: null, grpc_status: null,
  });
});

test("failure diagnostics recognize installed SDK provider codes and reject arbitrary variants", () => {
  const supported = [
    "unauthenticated", "tokenExpired", "tokenBlocked", "unauthorized", "dailyLimitExceeded", "recipientLimitExceeded",
    "uploadRateExceeded", "contentDuplicateExceeded", "recipientCoolingDown", "recipientLocked", "burstRateExceeded",
    "newContactThrottled", "sendReceiveRatioExceeded", "duplicateMessage", "chatNotFound", "messageNotFound",
    "attachmentNotFound", "addressNotFound", "sharedFriendLocationNotFound", "groupIconNotFound", "pollNotFound",
    "invalidArgument", "preconditionFailed", "operationNotSupported", "attachmentNotReady", "privateApiUnavailable",
    "serviceUnavailable", "timeout", "internalError", "databaseError", "networkError",
  ];
  for (const code of supported) {
    assert.deepEqual(script.classifyFailure({ code, message: RAW_SECRET }), { ...EMPTY_DIAGNOSTICS, provider_code: code });
  }
  for (const code of ["UNAUTHENTICATED", "unauthenticated ", "notAProviderCode", RAW_SECRET, RECIPIENT, `any;-;${RECIPIENT}`]) {
    assert.deepEqual(script.classifyFailure({ code }), EMPTY_DIAGNOSTICS);
  }
});

test("allowlisted send diagnostics preserve uncertain delivery without leaking provider content", async () => {
  const secretDetails = `${RAW_SECRET} ${RECIPIENT} any;-;${RECIPIENT} https://tickets.example/?token=private-token`;
  const failure = Object.assign(new Error(secretDetails), {
    name: "IMessageError", code: "invalidArgument", httpStatus: 403, grpcCode: 7,
    details: secretDetails, metadata: { recipient: RECIPIENT, authorization: RAW_SECRET },
    cause: new Error(secretDetails), stack: secretDetails,
  });
  const mock = createMock({ failAt: "send", failure });
  const output: string[] = [];
  assert.equal(await script.main(["--recipient", RECIPIENT, "--send"], {
    send: recipient => script.sendOneTest(recipient, mock.dependencies),
    output: value => output.push(value),
  }), 1);
  assert.deepEqual(JSON.parse(output[0]!), {
    code: "send_failed", send_attempted: true, messages_sent: null, delivery_verified: false,
    failure_stage: "send", error_type: "IMessageError", provider_code: "invalidArgument", http_status: 403, grpc_status: 7,
  });
  assert.doesNotMatch(output.join(""), /synthetic-project-secret|private-diagnostic|\+1202555|any;-;|tickets\.example|private-token|metadata|cause|stack/);
  assert.deepEqual(mock.calls.send, [script.TEST_MESSAGE]);
  assert.equal(mock.calls.stop, 1);
});

test("malicious send diagnostic fields cannot override stage, count or error output", async () => {
  const content = `${RAW_SECRET} ${RECIPIENT} any;-;${RECIPIENT}`;
  const failure = {
    name: content, code: content, httpStatus: "403", grpcCode: 100,
    stage: content, diagnostics: { private: content }, attempted: false, messages_sent: 0,
    get message() { throw new Error(content); },
    get cause() { throw new Error(content); },
    get metadata() { throw new Error(content); },
    toJSON() { throw new Error(content); },
  };
  Object.defineProperty(failure, "status", { get() { throw new Error(content); } });
  const mock = createMock({ failAt: "send", failure });
  const output: string[] = [];
  assert.equal(await script.main(["--recipient", RECIPIENT, "--send"], {
    send: recipient => script.sendOneTest(recipient, mock.dependencies),
    output: value => output.push(value),
  }), 1);
  assert.deepEqual(JSON.parse(output[0]!), {
    code: "send_failed", send_attempted: true, messages_sent: null, delivery_verified: false,
    failure_stage: "send", ...EMPTY_DIAGNOSTICS,
  });
  assert.doesNotMatch(output.join(""), /synthetic-project-secret|private-diagnostic|\+1202555|any;-;/);
  assert.equal(mock.calls.send.length, 1);
  assert.equal(mock.calls.stop, 1);
});

test("reviewed assessment body is sent and acknowledged exactly, without substituting the setup test", async () => {
  const message = "Ravel private check\n\nA reviewed synthetic assessment.";
  const mock = createMock({ acknowledgement: { ...validAcknowledgement, content: { type: "text", text: message } } });
  const result = await script.sendOneApprovedText(RECIPIENT, message, mock.dependencies);
  assert.equal(result.message, message);
  assert.deepEqual(mock.calls.send, [message]);
  assert.equal(mock.calls.stop, 1);
  assert.equal(mock.calls.forbidden, 0);
});

test("reviewed assessment rejects a setup-text acknowledgement as unknown delivery", async () => {
  const message = "Ravel private check\n\nA reviewed synthetic assessment.";
  const mock = createMock();
  await expectSafeFailure(() => script.sendOneApprovedText(RECIPIENT, message, mock.dependencies), "send_acknowledgement_unverified", true);
  assert.deepEqual(mock.calls.send, [message]);
  assert.equal(mock.calls.stop, 1);
});

test("invalid reviewed bodies fail before SDK initialization", async () => {
  for (const message of ["", " ", "x".repeat(3_001), "\uD800"]) {
    const mock = createMock();
    await expectSafeFailure(() => script.sendOneApprovedText(RECIPIENT, message, mock.dependencies), "invalid_message", false);
    assert.equal(mock.calls.connect.length, 0);
    assert.equal(mock.calls.send.length, 0);
  }
});
