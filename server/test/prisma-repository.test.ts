import { describe, expect, it, vi } from "vitest";
import { PrismaPurchaseRepository } from "../src/prisma-repository.js";

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("../src/generated/prisma/client.js", () => ({
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
  PrismaClient: class { $transaction = transaction; },
}));

function driverError(kind: string) {
  const error = new Error(kind, { cause: { kind } });
  error.name = "DriverAdapterError";
  return error;
}

describe("Prisma purchasing transaction retries", () => {
  it("reruns the transaction when the PostgreSQL adapter reports a write conflict at commit", async () => {
    const repository = new PrismaPurchaseRepository("postgresql://localhost/test");
    const operation = vi.fn().mockResolvedValue("saved");
    transaction.mockReset()
      .mockImplementationOnce(async (run) => {
        await run({});
        throw driverError("TransactionWriteConflict");
      })
      .mockImplementationOnce((run) => run({}));

    await expect(repository.transaction(operation)).resolves.toBe("saved");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("propagates unrelated adapter errors without retrying", async () => {
    const repository = new PrismaPurchaseRepository("postgresql://localhost/test");
    const error = driverError("DatabaseAccessDenied");
    transaction.mockReset().mockRejectedValue(error);

    await expect(repository.transaction(vi.fn())).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
