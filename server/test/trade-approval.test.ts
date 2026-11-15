import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createFixtureAdapter } from "@cosign/adapters";
import { TradeDb, type Actor } from "../src/trade/db.js";
import { SCOPES } from "../src/trade/oauth.js";
import { TradeService } from "../src/trade/service.js";
import { NemotronWorker } from "../src/trade/worker.js";

const connection = process.env.TEST_TRADE_DATABASE_URL;
describe.skipIf(!connection)("purchase draft approval", () => {
  const schema = `trade_approval_${process.pid}_${randomBytes(4).toString("hex")}`;
  const buyer: Actor = { accountId: "buyer", actorId: "buyer", source: "web", scopes: SCOPES };
  const policy = { automaticLimitCents: 0, requiredClaims: [], freeFromAllergens: [] };
  let admin: Pool;
  let db: TradeDb;
  let service: TradeService;

  const instant = (offset: number) => new Date(Date.now() + offset).toISOString();
  const requirements = (deadline: string) => ({
    query: "milk", quantity: 1, unit: "L", deadline, budgetCents: 500,
    requirements: [], freeFromAllergen: [],
  });
  const draftLine = (observedAt: string, closingTime?: string) => ({
    productId: "milk", name: "Milk", salesUnits: 1, salesUnit: "ST", totalCents: 130,
    unitPriceCents: 130, observedAt, closingTime, caveats: ["DELIVERY_TIME_UNVERIFIED"],
  });
  const observation = (closingTime: string) => ({
    productId: "milk", name: "Milk", salesUnit: "ST", salesUnitPriceCents: 130,
    availableSellUnits: 10, closingTime, issues: ["DELIVERY_TIME_UNVERIFIED"],
    estimate: { salesUnits: 1, totalCents: 130, stockFit: "reported_sufficient", budgetFit: "within_budget" },
  });

  beforeAll(async () => {
    admin = new Pool({ connectionString: connection });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const scoped = new URL(connection!);
    scoped.searchParams.set("options", `-c search_path=${schema}`);
    db = new TradeDb(scoped.href);
    for (const migration of [
      "20261114190000_trade_platform",
      "20261115010000_trade_workflow_state",
      "20261115030000_order_rehearsal",
      "20261115050000_trade_request_changes",
    ]) {
      await db.rows(await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url), "utf8"));
    }
    await db.rows(
      "INSERT INTO trade_accounts(id,name,email,password_hash,customer_id) VALUES($1,'Buyer','buyer@test.invalid','test-only','fixture')",
      [buyer.accountId],
    );
    service = new TradeService(db, createFixtureAdapter(), "http://localhost");
  });
  afterAll(async () => {
    await db?.pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  it("reports blocked approval and rejects expired evidence while allowing decline", async () => {
    const observedAt = instant(-5_000);
    const draft = {
      items: [
        { ...draftLine(observedAt, instant(60_000)), itemId: "item_1" },
        { ...draftLine(observedAt, instant(-1_000)), itemId: "item_2" },
      ],
      policy,
      totalCents: 260,
      observedAt,
      caveats: ["DELIVERY_TIME_UNVERIFIED"],
    };
    await db.rows(
      "INSERT INTO trade_runs(id,account_id,actor_id,source,title,status,requirements,draft,revision) VALUES('expired-cutoff',$1,'buyer','web','Basket','awaiting_approval',$2,$3,2)",
      [buyer.accountId, JSON.stringify({ deadline: instant(60_000), items: [] }), JSON.stringify(draft)],
    );
    expect(await service.visibleRun(buyer, "expired-cutoff")).toMatchObject({
      approvalEligibility: { eligible: false, reasons: [expect.stringContaining("cutoff expired")] },
    });
    await expect(service.decide(buyer, "expired-cutoff", 2, true)).rejects.toMatchObject({ code: "stale_evidence" });
    expect(await service.run(buyer, "expired-cutoff")).toMatchObject({ status: "awaiting_approval", approved_revision: null });
    expect(await service.decide(buyer, "expired-cutoff", 2, false)).toMatchObject({ status: "rejected" });
  });

  it.each([
    ["expired-deadline", -1_000, -5_000, "past_deadline"],
    ["stale-price", 600_000, -310_000, "stale_evidence"],
  ])("rejects approval for %s", async (runId, deadlineOffset, observationOffset, code) => {
    const draft = { ...draftLine(instant(observationOffset), instant(60_000)), policy };
    await db.rows(
      "INSERT INTO trade_runs(id,account_id,actor_id,source,title,status,requirements,draft,revision) VALUES($1,$2,'buyer','web','Milk','awaiting_approval',$3,$4,2)",
      [runId, buyer.accountId, JSON.stringify(requirements(instant(deadlineOffset))), JSON.stringify(draft)],
    );
    await expect(service.decide(buyer, runId, 2, true)).rejects.toMatchObject({ code });
  });

  it("rejects approval if the draft's policy differs from the current account policy", async () => {
    const draft = {
      ...draftLine(instant(0), instant(60_000)),
      policy: { ...policy, automaticLimitCents: 100 },
    };
    await db.rows(
      "INSERT INTO trade_runs(id,account_id,actor_id,source,title,status,requirements,draft,revision) VALUES('changed-policy',$1,'buyer','web','Milk','awaiting_approval',$2,$3,2)",
      [buyer.accountId, JSON.stringify(requirements(instant(60_000))), JSON.stringify(draft)],
    );
    await expect(service.decide(buyer, "changed-policy", 2, true)).rejects.toMatchObject({ code: "policy_changed" });
  });

  it("uses a matching comparison for a legacy draft that did not store its cutoff", async () => {
    const observedAt = instant(-5_000);
    const draft = { ...draftLine(observedAt), policy };
    const comparison = { observedAt, observations: [observation(instant(60_000))] };
    await db.rows(
      "INSERT INTO trade_runs(id,account_id,actor_id,source,title,status,requirements,comparison,draft,revision) VALUES('legacy',$1,'buyer','web','Milk','awaiting_approval',$2,$3,$4,2)",
      [buyer.accountId, JSON.stringify(requirements(instant(60_000))), JSON.stringify(comparison), JSON.stringify(draft)],
    );
    expect(await service.decide(buyer, "legacy", 2, true)).toMatchObject({ status: "approved", approved_revision: 2 });
  });

  it("resumes when the buyer approves between reading the pending draft and pausing the agent job", async () => {
    const runId = "race-draft";
    const comparison = { observedAt: instant(0), observations: [observation(instant(60_000))] };
    await db.rows(
      "INSERT INTO trade_runs(id,account_id,actor_id,source,title,requirements,comparison,revision) VALUES($1,$2,'buyer','web','Milk',$3,$4,1)",
      [runId, buyer.accountId, JSON.stringify(requirements(instant(60_000))), JSON.stringify(comparison)],
    );

    let modelCalls = 0;
    const model = createServer((req, res) => {
      req.resume();
      req.once("end", () => {
        const message = modelCalls++ === 0 ? {
          role: "assistant",
          tool_calls: [{
            id: "prepare-one", type: "function", function: {
              name: "prepare_order",
              arguments: JSON.stringify({ runId, revision: 1, productId: "milk" }),
            },
          }],
        } : { role: "assistant", content: "The buyer reviewed the draft." };
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ choices: [{ message }] }));
      });
    });
    await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${(model.address() as { port: number }).port}`;
    const worker = new NemotronWorker(db, service, "fixture-only", endpoint);
    const originalOne = db.one.bind(db);
    let approvedDuringPause = false;
    const query = vi.spyOn(db, "one").mockImplementation(async (sql, args, tx) => {
      const result = await originalOne(sql, args, tx);
      if (!approvedDuringPause && sql.includes("AS pending") && result?.pending) {
        approvedDuringPause = true;
        await service.decide(buyer, runId, 2, true);
      }
      return result;
    });
    try {
      const job = await worker.enqueue(buyer, "Prepare the milk purchase draft.");
      worker.start();
      await expect.poll(async () => (await service.run(buyer, job.runId)).status, {
        timeout: 8_000,
      }).toBe("completed");
      expect(approvedDuringPause).toBe(true);
      expect(modelCalls).toBe(2);
      expect(await service.run(buyer, runId)).toMatchObject({ status: "approved" });
      expect(await db.rows(
        "SELECT status FROM trade_events WHERE run_id=$1 AND action='agent_job' ORDER BY id",
        [job.runId],
      )).toEqual([
        { status: "queued" },
        { status: "running" },
        { status: "awaiting_approval" },
        { status: "running" },
        { status: "completed" },
      ]);
    } finally {
      await worker.stop();
      query.mockRestore();
      model.closeAllConnections();
      await new Promise<void>(resolve => model.close(() => resolve()));
    }
  });
});
