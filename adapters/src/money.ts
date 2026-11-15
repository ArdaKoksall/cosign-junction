import type { Money, MoneyBasis } from "./types.js";

export function eurosToCents(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("non-finite money amount");
  }
  return Math.round(value * 100);
}

export function eur(cents: number, basis: MoneyBasis): Money {
  if (!Number.isInteger(cents)) {
    throw new Error("money cents must be an integer");
  }
  return { currency: "EUR", basis, cents };
}
