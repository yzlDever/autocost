import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const port = "3010";
process.env.BASE_URL = `http://127.0.0.1:${port}`;
const acceptanceStatePath = `/tmp/auto-cost-e2e-${randomUUID()}.json`;
process.env.ACCEPTANCE_STATE_PATH = acceptanceStatePath;

const server = spawn(
  "./node_modules/.bin/next",
  ["dev", "-H", "127.0.0.1", "-p", port],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_BACKEND: "local",
      LOCAL_DATA_PATH: acceptanceStatePath,
      AUTH_SECRET: "local-acceptance-secret",
      DINGTALK_CLIENT_ID: "",
      DINGTALK_CLIENT_SECRET: "",
      DINGTALK_REDIRECT_URI: "",
      DINGTALK_ALLOWED_USER_IDS: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let output = "";
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Dev server timeout\n${output}`)), 20_000);
  const onData = (chunk) => {
    const text = String(chunk);
    output += text;
    if (text.includes("Ready in")) {
      clearTimeout(timeout);
      resolve();
    }
  };
  server.stdout.on("data", onData);
  server.stderr.on("data", onData);
  server.once("exit", (code) => {
    clearTimeout(timeout);
    reject(new Error(`Dev server exited with ${code}\n${output}`));
  });
});

try {
  await ready;
  await import("./e2e-acceptance.mjs");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  server.kill("SIGINT");
}
