import { createServer } from "node:http";

const fixtures = new Map([
  ["900001", { price: 1.65, salesUnit: "ST" }], // Lactose-free milk, 1 L
  ["900002", { price: 10.00, salesBlock: true }], // Parboiled rice
  ["900003", { price: 34.95, salesUnit: "ST" }], // Boneless chicken breast, 5 kg
  ["900004", { price: 2.65, salesUnit: "KG" }], // Whole apples, sold by weight
]);
const availableAmount = Number(process.env.VALIO_STUB_AVAILABLE_AMOUNT ?? "999999");

function price(customer, requestedDate, productIds) {
  return {
    customerId: customer, currency: "EUR", pricingDate: requestedDate,
    products: productIds.map((productId) => {
      const fixture = fixtures.get(productId);
      if (!fixture) return { productId, quantity: 1, netPriceFound: false, error: true };
      return {
        productId, quantity: 1, netPriceFound: true, error: false,
        catalogPrice: { value: fixture.price, currency: "EUR", validFrom: requestedDate, validTo: requestedDate },
      };
    }),
  };
}

function availability(requestedDate, productIds) {
  return {
    timeNow: new Date().toISOString(), requestedDate,
    products: productIds.map((productId) => {
      const fixture = fixtures.get(productId);
      if (!fixture?.salesUnit) {
        return { productId, salesBlock: fixture?.salesBlock ?? false, logisticModel: "Stock", scheduleLines: [] };
      }
      return {
        productId, salesBlock: false, logisticModel: "Stock", closingTime: `${requestedDate}T00:00:00Z`,
        scheduleLines: [{ availableDate: requestedDate, availableAmount, salesBlock: false, salesUnit: fixture.salesUnit }],
      };
    }),
  };
}

createServer(async (request, response) => {
  const send = (status, data) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(data));
  };
  if (request.method === "GET" && request.url === "/healthz") return send(200, { ready: true });
  if (request.method !== "POST" || !["/api/price", "/api/availability"].includes(request.url)) {
    return send(404, { error: "Unsupported Valio stub route" });
  }
  if (request.headers["x-api-key"] !== "cosign-ci-stub") return send(401, { error: "Wrong stub key" });

  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { customer, requestedDate, products } = JSON.parse(body);
    if (typeof customer !== "string" || typeof requestedDate !== "string" || !/^\d{4}-\d\d-\d\d$/.test(requestedDate)
      || !Array.isArray(products) || !products.length || new Set(products).size !== products.length
      || products.some((productId) => typeof productId !== "string" || !/^\d+$/.test(productId))) {
      return send(422, { error: "Provide distinct product IDs and a calendar day" });
    }
    return send(200, request.url === "/api/price"
      ? price(customer, requestedDate, products) : availability(requestedDate, products));
  } catch {
    return send(400, { error: "Invalid stub request" });
  }
}).listen(8080, "0.0.0.0");
