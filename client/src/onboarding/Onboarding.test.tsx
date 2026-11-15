import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { OnboardingGate, ProfileRecommendations } from "./Onboarding";

it("keeps answered setup questions and uses them for recommendations on later visits", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const plan = vi.fn();
  const search = vi.fn();
  const workspace = () => (
    <OnboardingGate>
      <ProfileRecommendations onSearch={search} onAsk={plan} />
    </OnboardingGate>
  );
  const click = async (text: string) => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (control) => control.textContent === text,
    );
    expect(button, text).toBeDefined();
    await act(async () => button?.click());
  };
  const answer = async (value: string) => {
    const choice = container.querySelector<HTMLInputElement>(`input[value="${value}"]`);
    const form = container.querySelector("form");
    expect(choice).not.toBeNull();
    await act(async () => choice?.click());
    await act(async () => form?.requestSubmit());
  };

  try {
    await act(async () => root.render(workspace()));
    expect(container.textContent).toContain("Question 1 of 5");
    await answer("restaurant");
    await click("Skip question");
    await answer("under500");
    await click("Skip question");
    await answer("vegan");

    await act(async () => root.render(null));
    await act(async () => root.render(workspace()));
    expect(container.textContent).not.toContain("Question 1 of 5");
    await click("Oat drinks");
    expect(search).toHaveBeenCalledWith("vegan oat drink");
    await click("Tomatoes");
    expect(search).toHaveBeenCalledWith("tomato");
    await click("Plan my next purchase");
    const instruction = plan.mock.calls[0][0];
    expect(instruction).toContain("Restaurant");
    expect(instruction).toContain("Under €500");
    expect(instruction).toContain("monthly purchasing budget");
    expect(instruction).toContain("Vegan");
    expect(instruction).toContain("per-order budget before creating a request");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
