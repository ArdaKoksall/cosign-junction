BEGIN;

ALTER TABLE "PurchaseRequest"
    ADD COLUMN "quantity" DOUBLE PRECISION,
    ADD COLUMN "unit" TEXT;

UPDATE "PurchaseRequest"
SET "quantity" = "quantityLiters", "unit" = 'L';

ALTER TABLE "PurchaseRequest"
    ALTER COLUMN "quantity" SET NOT NULL,
    ALTER COLUMN "unit" SET NOT NULL,
    ALTER COLUMN "quantityLiters" DROP NOT NULL;

ALTER TABLE "Proposal"
    ALTER COLUMN "uncoveredLiters" TYPE DOUBLE PRECISION,
    ALTER COLUMN "uncoveredLiters" DROP NOT NULL,
    ADD COLUMN "uncoveredQuantity" DOUBLE PRECISION,
    ADD COLUMN "uncoveredUnit" TEXT;

UPDATE "Proposal"
SET "uncoveredQuantity" = "uncoveredLiters", "uncoveredUnit" = 'L';

COMMIT;
