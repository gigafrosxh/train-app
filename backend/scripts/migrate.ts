import { connect, source } from "../src/database/database";
connect()
  .then(() => source.destroy())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
