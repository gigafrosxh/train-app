import { writeFile } from "node:fs/promises";
import { createApp } from "../src/bootstrap";
async function main() {
  process.env.DISABLE_JOBS = "true";
  const { app, document } = await createApp({ database: false, logger: false });
  await writeFile("openapi.json", JSON.stringify(document, null, 2) + "\n");
  await app.close();
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
