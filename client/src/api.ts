import type {
  ApproveResponse,
  CommitResponse,
  CompareResponse,
  CreateRequestBody,
  CreateRequestResponse,
  OrderResponse,
  RecentOrder,
  Capabilities,
  CatalogSearchResult,
  CatalogFilters,
  CatalogProductEvidence,
  SavedRequest,
  SavedRequestsPage,
  DecisionEvent,
  IntakeDraft,
  RoutineMilkStatus,
} from "./types";
import { ApiError } from "./types";

export const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ?? "http://localhost:3001";

export const MODE_LABEL = "Valio Aimo · connected catalog";

let simulatorToken = "";

export function setSimulatorToken(token: string) {
  simulatorToken = token;
}

export function getSimulatorSession(token?: string) {
  return requestJson<{ actorId: string }>("/api/session", token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
}

export function getRoutineMilk() {
  return requestJson<RoutineMilkStatus>("/api/simulator/routine-milk");
}

export function setRoutineMilkMandate(active: boolean, maxTotalCents: number) {
  return requestJson<NonNullable<RoutineMilkStatus["mandate"]>>("/api/simulator/routine-milk/mandate", {
    method: "POST", body: JSON.stringify({ active, maxTotalCents }),
  });
}

export function getCapabilities() {
  return requestJson<Capabilities>("/api/capabilities");
}

export function getCatalogProducts(query: string, limit: number, filters: CatalogFilters, signal: AbortSignal, { closest = false } = {}) {
  const params = new URLSearchParams({ query, limit: String(limit) });
  if (closest) params.set("closest", "true");
  for (const requirement of filters.requirements) params.append("requirements", requirement);
  if (filters.amountDimension) params.set("amountDimension", filters.amountDimension);
  for (const code of filters.freeFromAllergen) params.append("freeFromAllergen", code);
  return requestJson<CatalogSearchResult>(
    `/api/valio/catalog?${params}`, { signal },
  );
}

export function getCatalogProductEvidence(id: string, signal: AbortSignal) {
  return requestJson<CatalogProductEvidence>(`/api/valio/catalog/${encodeURIComponent(id)}`, { signal });
}

function messageFromBody(body: unknown, fallback: string): { message: string; code?: string } {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const message =
      (typeof record.message === "string" && record.message) ||
      (typeof record.error === "string" && record.error) ||
      fallback;
    const code = typeof record.code === "string" ? record.code : undefined;
    return { message, code };
  }
  if (typeof body === "string" && body.trim()) {
    return { message: body };
  }
  return { message: fallback };
}

export async function requestJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(simulatorToken ? { Authorization: `Bearer ${simulatorToken}` } : {}),
        ...init?.headers,
      },
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "Network request failed";
    throw new ApiError(
      `Cannot reach the Cosign API at ${API_BASE || "this address"}. ${reason}.`,
      0,
    );
  }

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const { message, code } = messageFromBody(
      parsed,
      `Request failed (${response.status})`,
    );
    throw new ApiError(message, response.status, parsed, code);
  }

  return parsed as T;
}

export function createRequest(body: CreateRequestBody) {
  return requestJson<CreateRequestResponse>("/api/requests", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getSavedRequests(
  { query, cursor, limit }: { query?: string; cursor?: string; limit?: number } = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (cursor) params.set("cursor", cursor);
  if (limit !== undefined) params.set("limit", String(limit));
  const search = params.size ? `?${params}` : "";
  return requestJson<SavedRequestsPage>(`/api/requests${search}`, { signal });
}

export function analyzeKitchenIntake(note: string, image?: { mimeType: string; base64: string }) {
  return requestJson<IntakeDraft>("/api/intake", {
    method: "POST",
    body: JSON.stringify({ note, image }),
  });
}

export function getSavedRequest(id: string, signal?: AbortSignal) {
  return requestJson<{
    request: SavedRequest;
    comparison: CompareResponse | null;
    approvedVersion: number | null;
    placedOrderId: string | null;
    events: DecisionEvent[];
  }>(`/api/requests/${encodeURIComponent(id)}`, { signal });
}

export function compareRequest(requestId: string) {
  return requestJson<CompareResponse>(
    `/api/requests/${encodeURIComponent(requestId)}/compare`,
    { method: "POST" },
  );
}

export function createRehearsalQuote(requestId: string, version: number, productId: string) {
  return requestJson<CompareResponse>(`/api/requests/${encodeURIComponent(requestId)}/rehearsal`, {
    method: "POST", body: JSON.stringify({ version, productId }),
  });
}

export function getRehearsalQuote(requestId: string, signal?: AbortSignal) {
  return requestJson<{ quote: CompareResponse | null; approvedVersion: number | null; placedOrderId: string | null; events: DecisionEvent[] }>(
    `/api/requests/${encodeURIComponent(requestId)}/rehearsal`, { signal },
  );
}

export function approveProposal(proposalId: string, version: number) {
  return requestJson<ApproveResponse>(
    `/api/proposals/${encodeURIComponent(proposalId)}/approve`,
    { method: "POST", body: JSON.stringify({ version }) },
  );
}

export function commitProposal(
  proposalId: string,
  version: number,
  idempotencyKey: string,
) {
  return requestJson<CommitResponse>(
    `/api/proposals/${encodeURIComponent(proposalId)}/commit`,
    {
      method: "POST",
      body: JSON.stringify({ version, idempotencyKey }),
    },
  );
}

export function getOrder(orderId: string) {
  return requestJson<OrderResponse>(
    `/api/orders/${encodeURIComponent(orderId)}`,
  );
}

export function getRecentOrders(signal?: AbortSignal) {
  return requestJson<{ orders: RecentOrder[] }>("/api/orders", { signal });
}

export function injectPriceChange(proposalId: string) {
  return requestJson<unknown>("/api/demo/price-change", {
    method: "POST",
    body: JSON.stringify({ proposalId }),
  });
}

export function resetDemo() {
  return requestJson<unknown>("/api/demo/reset", { method: "POST" });
}

export function formatEuro(cents: number, locale: "en" | "fi" = "en"): string {
  return new Intl.NumberFormat(locale === "fi" ? "fi-FI" : "en-FI", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

export function sourceKind(source: string): "fixture" | "live" | "unknown" {
  const value = source.toLowerCase();
  if (value.includes("live") || value.includes("valio")) return "live";
  if (value.includes("fixture") || value.includes("seed") || value.includes("demo")) {
    return "fixture";
  }
  return "unknown";
}
