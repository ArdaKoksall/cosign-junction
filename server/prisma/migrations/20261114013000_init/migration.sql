-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "deadline" TIMESTAMPTZ(3) NOT NULL,
    "quantityLiters" INTEGER NOT NULL,
    "budgetCents" BIGINT NOT NULL,
    "diet" TEXT NOT NULL,
    "query" TEXT,
    "preset" TEXT,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "approvedVersion" INTEGER,
    "status" TEXT NOT NULL,
    "totalCents" BIGINT NOT NULL,
    "uncoveredLiters" INTEGER NOT NULL,
    "offers" JSONB NOT NULL,
    "comparisonMode" TEXT,
    "source" TEXT,
    "observedAt" TIMESTAMPTZ(3),
    "checkoutSupported" BOOLEAN,
    "observations" JSONB,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulatedOrder" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalCents" BIGINT NOT NULL,
    "uncoveredLiters" INTEGER NOT NULL,
    "placedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SimulatedOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionEvent" (
    "id" BIGSERIAL NOT NULL,
    "proposalId" TEXT NOT NULL,
    "revision" INTEGER,
    "actorId" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" TEXT NOT NULL,

    CONSTRAINT "DecisionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseRequest_createdAt_id_idx" ON "PurchaseRequest"("createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_requestId_key" ON "Proposal"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "SimulatedOrder_requestId_key" ON "SimulatedOrder"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "SimulatedOrder_proposalId_key" ON "SimulatedOrder"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "SimulatedOrder_idempotencyKey_key" ON "SimulatedOrder"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SimulatedOrder_placedAt_id_idx" ON "SimulatedOrder"("placedAt", "id");

-- CreateIndex
CREATE INDEX "DecisionEvent_proposalId_id_idx" ON "DecisionEvent"("proposalId", "id");

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulatedOrder" ADD CONSTRAINT "SimulatedOrder_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulatedOrder" ADD CONSTRAINT "SimulatedOrder_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionEvent" ADD CONSTRAINT "DecisionEvent_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

