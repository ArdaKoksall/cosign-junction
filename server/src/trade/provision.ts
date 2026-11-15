// Run with administrator database credentials. Input is JSON on stdin; never put passwords in argv.
import { z } from "zod";
import { TradeDb, id } from "./db.js";
import { passwordHash } from "./password.js";
import { databaseUrl, loadRootEnv } from "../environment.js";

loadRootEnv();
const connection = databaseUrl();
if (!connection) throw new Error("Set DATABASE_URL or POSTGRES_PASSWORD in the repository-root .env or the process environment");
let data = "";
for await (const chunk of process.stdin) {
  data += chunk;
  if (data.length > 16384) throw new Error("Input too large");
}
const account = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.email().max(254),
    password: z.string().min(14).max(256),
    customerId: z.string().min(1).max(100),
  })
  .parse(JSON.parse(data));
const db = new TradeDb(connection);
try {
  const accountId = id("account");
  await db.rows(
    "INSERT INTO trade_accounts(id,name,email,password_hash,customer_id) VALUES($1,$2,$3,$4,$5)",
    [
      accountId,
      account.name,
      account.email.toLowerCase(),
      await passwordHash(account.password),
      account.customerId,
    ],
  );
  console.log(JSON.stringify({ accountId, created: true }));
} finally {
  await db.pool.end();
}
