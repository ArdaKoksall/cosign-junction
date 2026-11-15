ALTER TABLE "PurchaseRequest" ADD COLUMN "rankingObjective" TEXT;

ALTER TABLE "PurchaseRequest"
ADD CONSTRAINT "PurchaseRequest_rankingObjective_check"
CHECK ("rankingObjective" IN ('cost', 'reliability', 'carbon'));
