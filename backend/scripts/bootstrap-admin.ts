import { connect, source } from "../src/database/database";
import * as argon2 from "argon2";
import { register } from "../src/auth/auth.schemas";
async function main() {
  const d = register.parse({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
    displayName: "Administrator",
  });
  await connect();
  await source.query(
    "INSERT INTO users(email,password_hash,display_name,role,must_change_password) VALUES($1,$2,$3,$4,true)",
    [
      d.email.toLowerCase(),
      await argon2.hash(d.password),
      d.displayName,
      "ADMIN",
    ],
  );
  await source.destroy();
  console.log(
    "Administrator created. Password change is required on first login.",
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
