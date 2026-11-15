import type { Diet } from "./types";

export const rehearsalMilkBudgetEuros = 1750;

export interface KitchenBrief {
  id: string;
  title: string;
  product: string;
  description: string;
  query: string;
  quantityLiters: number;
  budgetEuros: number;
  diet: Diet;
  tone: "peach" | "butter" | "rose" | "lilac";
  mondayMilk?: boolean;
}

export const kitchenBriefs: KitchenBrief[] = [
  {
    id: "juice",
    title: "Café breakfast",
    product: "Orange juice",
    description: "Stock the breakfast counter with 100% orange juice.",
    query: "100% orange juice",
    quantityLiters: 36,
    budgetEuros: 150,
    diet: "none",
    tone: "peach",
  },
  {
    id: "stock",
    title: "Lunch service",
    product: "Vegetable stock",
    description: "Prep a batch of soup with lactose-free vegetable bouillon.",
    query: "Puljonki vegetable bouillon",
    quantityLiters: 24,
    budgetEuros: 180,
    diet: "lactose-free",
    tone: "butter",
  },
  {
    id: "ice-cream",
    title: "Dessert service",
    product: "Vanilla ice cream",
    description: "Find catering packs of lactose-free vanilla ice cream.",
    query: "vanilla 5l ice cream",
    quantityLiters: 25,
    budgetEuros: 200,
    diet: "lactose-free",
    tone: "rose",
  },
  {
    id: "milk",
    title: "Monday restock",
    product: "Drinking milk",
    description: "Plan a bulk delivery of lactose-free drinking milk.",
    query: "plain drinking milk",
    quantityLiters: 1000,
    budgetEuros: 1450,
    diet: "lactose-free",
    tone: "lilac",
    mondayMilk: true,
  },
];

export const simulatorBrief: KitchenBrief = {
  id: "rehearsal",
  title: "Price change rehearsal",
  product: "Simulated milk basket",
  description: "Review a fixture basket, change the price, then approve the revised total.",
  query: "milk",
  quantityLiters: 1000,
  budgetEuros: 1450,
  diet: "lactose-free",
  tone: "lilac",
};
