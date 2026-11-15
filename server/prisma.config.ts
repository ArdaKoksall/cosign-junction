import { defineConfig } from "prisma/config";
import { databaseUrl, loadRootEnv } from "./src/environment.ts";

loadRootEnv();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: databaseUrl(process.env.COSIGN_ENABLE_SIMULATOR === "true") },
});
