ALTER TABLE "PurchaseRequest" ADD COLUMN "requirements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
