import { createApp } from "./bootstrap";
async function main() {
  const { app } = await createApp();
  await app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? "127.0.0.1");
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
