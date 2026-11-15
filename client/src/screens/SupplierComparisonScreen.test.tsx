import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CompareResponse } from "../types";
import { ApprovalScreen } from "./ApprovalScreen";
import { SupplierComparisonScreen } from "./SupplierComparisonScreen";

const proposal: CompareResponse = {
  requestId: "req_1", proposalId: "obs_1", version: 2, offers: [], totalCents: 0,
  uncoveredLiters: null, status: "observed", comparisonMode: "supplier_observations",
  rehearsalCandidates: ["eligible"],
  observations: ["eligible", "blocked"].map((productId) => ({
    productId, name: productId, salesUnit: "BOX", litersPerSellUnit: null,
    salesUnitPriceCents: 1300, availableSellUnits: null, stockUnknown: true, closingTime: null,
    availableDate: null, reliability: null, carbon: null, issues: [],
  })),
};
const noop = () => {};

describe("connected checkout rehearsal", () => {
  it("only offers server-eligible SKUs in the quote selector", () => {
    const html = renderToStaticMarkup(<SupplierComparisonScreen proposal={proposal} mondayMilk={false} productQuery="Pasta"
      quantity={4} unit="kg" requirements={[]} budgetCents={5000} deadline="2080-11-24T09:00:00Z" busy={false}
      onEdit={noop} onRefresh={noop} onCheckDates={noop} onInspectProduct={noop}
      rehearsal={{ signedIn: true, quote: null, hasOrder: false, onSignIn: noop, onCreate: noop, onReview: noop, onReceipt: noop }} />);
    expect(html).toContain("Create simulated quote");
    expect(html).toContain('<option value="eligible" selected=""');
    expect(html).not.toContain('<option value="blocked"');
    expect(html).toContain("The test order is saved locally");
  });

  it("labels observed evidence, fixed test price, and order quantities in their proper unit", () => {
    const html = renderToStaticMarkup(<ApprovalScreen proposal={{
      ...proposal, proposalId: "quote_1", version: 1, totalCents: 2600, status: "proposed",
      rehearsal: {
        productId: "eligible", name: "Pasta", requestedQuantity: 4, quantity: 5, unit: "kg", salesUnit: "BOX", salesUnits: 2,
        salesUnitPriceCents: 1300, supplierComparisonId: "obs_1", supplierComparisonVersion: 2,
        observedAt: "2026-11-14T06:00:00Z", closingTime: "2080-11-24T09:00:00Z",
        caveats: ["STOCK_UNKNOWN", "DELIVERY_TIME_UNVERIFIED"],
      },
    }} eligible={[]} busy={false} hasOrder={false} approved={false} approvedVersion={null} overBudget={false}
    previousProposal={null} priceDrift={false} deltaCents={null} onApprove={noop} onCommit={noop} />);
    expect(html).toContain("Review the simulated quote");
    expect(html).toContain("Fixed rehearsal total");
    expect(html).toContain("4 kg");
    expect(html).toContain("5 kg");
    expect(html).toContain("Stock quantity is unverified");
    expect(html).toContain("Delivery hour has not been confirmed");
    expect(html).toContain("Approve this revision");
    expect(html).not.toContain("Demo controls");
  });
});
