ALTER TABLE "PurchaseRequest" ADD COLUMN "freeFromAllergen" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
