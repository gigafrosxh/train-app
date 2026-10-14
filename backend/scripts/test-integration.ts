import "dotenv/config";
import { DataSource } from "typeorm";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
async function main() {
  const name = "train_app_test_" + randomBytes(5).toString("hex");
  const url = new URL(process.env.DATABASE_URL!);
  const admin = new DataSource({ type: "postgres", url: url.toString() });
  await admin.initialize();
  await admin.query("CREATE DATABASE " + name);
  url.pathname = "/" + name;
  const env = {
    ...process.env,
    DATABASE_URL: url.toString(),
    DISABLE_JOBS: "true",
  };
  try {
    for (const args of [
      ["tsx", "scripts/seed.ts"],
      ["tsx", "--test", "test/integration/api.test.ts"],
    ]) {
      const result = spawnSync("npx", ["--no-install", ...args], {
        env,
        stdio: "inherit",
        timeout: 300000,
      });
      if (result.status !== 0) {
        process.exitCode = 1;
        break;
      }
    }
  } finally {
    await admin.query("DROP DATABASE " + name + " WITH (FORCE)");
    await admin.destroy();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
