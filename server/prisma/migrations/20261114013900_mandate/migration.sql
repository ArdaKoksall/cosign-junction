CREATE TABLE "BuyerMandate" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL,
    "maxTotalCents" BIGINT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "BuyerMandate_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SimulatedOrder"
ADD COLUMN "mandateId" TEXT,
ADD COLUMN "mandatePeriod" TEXT;

CREATE UNIQUE INDEX "SimulatedOrder_mandateId_mandatePeriod_key" ON "SimulatedOrder"("mandateId", "mandatePeriod");

ALTER TABLE "SimulatedOrder" ADD CONSTRAINT "SimulatedOrder_mandateId_fkey"
FOREIGN KEY ("mandateId") REFERENCES "BuyerMandate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
