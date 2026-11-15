import type { RecentOrder } from "./types";

const KEY = "cosign.recent-orders";
const LEGACY_KEY = "order-guard.recent-orders";

export function loadRecentOrders(): RecentOrder[] {
  try {
    const raw = sessionStorage.getItem(KEY) ?? sessionStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentOrder[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecentOrder(order: RecentOrder): RecentOrder[] {
  const next = [order, ...loadRecentOrders().filter((item) => item.orderId !== order.orderId)].slice(
    0,
    8,
  );
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
    sessionStorage.removeItem(LEGACY_KEY);
  } catch {
    // The order remains recoverable from the server if this browser disallows storage.
  }
  return next;
}

export function clearRecentOrders(): void {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(LEGACY_KEY);
  } catch {
    // Clearing the server remains authoritative.
  }
}
