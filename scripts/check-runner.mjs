import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import process from "node:process";
import { run } from "node:test";
import { spec } from "node:test/reporters";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);

const GLOBS = ["scripts/**/*.test.mjs", "src/**/*.test.ts"];

function runTypecheck() {
  mkdirSync("node_modules/.cache", { recursive: true });
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/typescript/bin/tsc",
        "--noEmit",
        "--incremental",
        "--tsBuildInfoFile",
        "node_modules/.cache/tsc.tsbuildinfo",
      ],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("error", (err) => {
      resolve({ code: 1, ms: Date.now() - started, out: String(err) });
    });
    child.on("exit", (code) => {
      resolve({
        code: code ?? 1,
        ms: Date.now() - started,
        out: Buffer.concat(chunks).toString("utf8").trim(),
      });
    });
  });
}

function runTests() {
  const started = Date.now();
  const stream = run({
    globPatterns: GLOBS,
    concurrency: Math.max(1, availableParallelism() - 1),
    execArgv: ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"],
  });
  let total;
  const files = [];
  stream.on("test:summary", (summary) => {
    if (summary.file) files.push(summary);
    else total = summary;
  });
  const reported = stream.compose(spec);
  reported.pipe(process.stdout);
  return new Promise((resolve, reject) => {
    reported.on("end", () => resolve({ total, files, ms: Date.now() - started }));
    reported.on("error", reject);
    stream.on("error", reject);
  });
}

const [types, tests] = await Promise.all([runTypecheck(), runTests()]);
const summary = tests.total ?? null;
const fileCounts = tests.files.reduce(
  (acc, file) => {
    acc.tests += file.counts.tests;
    acc.passed += file.counts.passed;
    acc.failed += file.success ? 0 : 1;
    return acc;
  },
  { tests: 0, passed: 0, failed: 0 },
);
const counts = summary?.counts ?? fileCounts;
const ran = (summary?.counts.tests ?? fileCounts.tests) > 0;
const testsOk = ran && (summary ? summary.success : fileCounts.failed === 0);
const typesOk = types.code === 0;

if (types.out) process.stdout.write(`\n${types.out}\n`);

const passed = counts.passed ?? 0;
const totalTests = summary?.counts.tests ?? fileCounts.tests;
process.stdout.write(
  `\ntypecheck: ${typesOk ? "ok" : "failed"} (${(types.ms / 1000).toFixed(1)}s)\n` +
    `tests: ${testsOk ? `${passed} passed` : "failed"} (${totalTests} tests, ${(tests.ms / 1000).toFixed(1)}s)\n`,
);

if (!typesOk || !testsOk) process.exit(1);
