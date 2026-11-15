import { loadEnvFile } from "node:process";

export function loadRootEnv(): void {
  try {
    loadEnvFile(new URL("../../.env", import.meta.url));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function databaseUrl(simulator = false): string | undefined {
  const configured = simulator ? process.env.SIMULATOR_DATABASE_URL : process.env.DATABASE_URL;
  if (configured) return configured;

  const password = process.env.POSTGRES_PASSWORD;
  if (!password) return undefined;
  const port = process.env.COSIGN_DB_PORT || "55432";
  const database = simulator ? "cosign_simulator" : "cosign";
  const url = new URL(`postgresql://cosign@127.0.0.1:${port}/${database}`);
  url.password = encodeURIComponent(password);
  return url.href;
}
