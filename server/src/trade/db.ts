import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { randomBytes, createHash } from "node:crypto";

export const secret = () => randomBytes(32).toString("base64url");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const id = (prefix: string) =>
  `${prefix}_${randomBytes(16).toString("hex")}`;
export type Actor = {
  accountId: string;
  actorId: string;
  source: "mcp" | "nemotron" | "web";
  scopes: string[];
};
export class TradeError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireValue<T>(
  value: T | undefined | null,
  message = "Not found",
): T {
  if (value == null) throw new TradeError(404, "not_found", message);
  return value;
}
export class TradeDb {
  readonly pool: Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 12 });
  }
  async rows<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    args: unknown[] = [],
    client?: PoolClient,
  ): Promise<T[]> {
    return (await (client ?? this.pool).query<T>(sql, args)).rows;
  }
  async one<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    args: unknown[] = [],
    client?: PoolClient,
  ): Promise<T | undefined> {
    return (await this.rows<T>(sql, args, client))[0];
  }
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async event(
    actor: Actor,
    runId: string | null,
    action: string,
    status: string,
    data: unknown,
    client?: PoolClient,
  ) {
    await this.rows(
      "INSERT INTO trade_events(account_id,run_id,actor_id,action,status,data) VALUES($1,$2,$3,$4,$5,$6)",
      [
        actor.accountId,
        runId,
        actor.actorId,
        action,
        status,
        JSON.stringify(data),
      ],
      client,
    );
  }
}
