import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import type { IntakeDraft } from "../types";
import { KitchenIntake } from "./KitchenIntake";

const partialDraft: IntakeDraft = {
  model: "local",
  status: "clarify",
  question: "What total quantity and unit does the kitchen need?",
  draft: { query: "cooking cream", quantity: null, unit: null, quantityLiters: null, deadline: null, budgetCents: null, diet: "lactose-free" },
  evidence: [{ field: "query", source: "note", excerpt: "cooking cream" }],
};

class BrowserSpeech {
  static instances: BrowserSpeech[] = [];
  lang = "";
  continuous = false;
  interimResults = true;
  onresult?: (event: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void;
  onerror?: (event: { error: string }) => void;
  onend?: () => void;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() { BrowserSpeech.instances.push(this); }

  result(resultIndex: number, ...transcripts: string[]) {
    this.onresult?.({ resultIndex, results: transcripts.map((transcript) => ({ isFinal: true, 0: { transcript } })) });
  }
}

describe("Kitchen intake", () => {
  let container: HTMLElement;
  let root: Root | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    BrowserSpeech.instances = [];
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function fillNote(onApply: (result: IntakeDraft) => void, onReview = vi.fn(), onIncomplete?: () => void) {
    act(() => root?.render(<KitchenIntake onApply={onApply} onIncomplete={onIncomplete} onReading={() => {}} onReview={onReview}
      disabled={false} photoEnabled={false} />));
    const textarea = container.querySelector("textarea")!;
    act(() => {
      // Use the native setter so React sees an input event rather than a programmatic value assignment.
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "lactose-free cooking cream");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function button(label: string) {
    return [...container.querySelectorAll("button")].find(({ textContent }) => textContent === label)!;
  }

  it("applies a partial draft and displays the question about missing details", async () => {
    vi.spyOn(api, "analyzeKitchenIntake").mockResolvedValue(partialDraft);
    const onApply = vi.fn();
    fillNote(onApply);

    await act(async () => container.querySelector("button")!.click());

    expect(onApply).toHaveBeenCalledWith(partialDraft);
    expect(container.querySelector("[aria-live='polite']")?.textContent).toContain(partialDraft.question);
    expect(container.textContent).not.toContain("Read by NVIDIA Nemotron");
  });

  it("shows Nemotron provenance and supplies a sourced requirement and comparison priority", async () => {
    const suggestions: IntakeDraft = {
      ...partialDraft,
      model: "nvidia/nemotron-3.5-super-vl-120b-a12b",
      draft: { ...partialDraft.draft, requirements: ["vegan"], rankingObjective: "reliability" },
      evidence: [],
      requirementEvidence: [{ requirement: "vegan", source: "image", excerpt: "vegan only" }],
      rankingEvidence: { source: "image", excerpt: "prefer the most reliable deliveries" },
    };
    vi.spyOn(api, "analyzeKitchenIntake").mockResolvedValue(suggestions);
    const onApply = vi.fn();
    fillNote(onApply);

    await act(async () => container.querySelector("button")!.click());

    expect(onApply).toHaveBeenCalledWith(suggestions);
    expect(container.textContent).toContain("Read by NVIDIA Nemotron");
    expect(container.textContent).toContain("VeganPhoto · “vegan only”");
    expect(container.textContent).toContain("Highest historical reliability");
    expect(container.textContent).toContain("Photo · “prefer the most reliable deliveries”");
  });

  it("invalidates previous suggestions as soon as the note changes", async () => {
    vi.spyOn(api, "analyzeKitchenIntake").mockResolvedValue(partialDraft);
    const onIncomplete = vi.fn();
    fillNote(vi.fn(), vi.fn(), onIncomplete);
    await act(async () => button("Fill request fields").click());

    const textarea = container.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "another request");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onIncomplete).toHaveBeenCalledOnce();
    expect(container.querySelector(".intake-result")).toBeNull();
  });

  it("does not apply a draft that arrives after leaving the form", async () => {
    let resolveDraft!: (draft: IntakeDraft) => void;
    const request = new Promise<IntakeDraft>((resolve) => { resolveDraft = resolve; });
    const analyze = vi.spyOn(api, "analyzeKitchenIntake").mockReturnValue(request);
    const onApply = vi.fn();
    fillNote(onApply);

    await act(async () => container.querySelector("button")!.click());
    expect(analyze).toHaveBeenCalledOnce();
    act(() => root?.unmount());
    root = undefined;
    await act(async () => resolveDraft(partialDraft));

    expect(onApply).not.toHaveBeenCalled();
  });

  it("shows both conflict sources and lets the buyer return to the manual fields", async () => {
    const conflict: IntakeDraft = {
      ...partialDraft,
      status: "review_conflict",
      question: "The note and photo give different quantities. Confirm the quantity in the request form.",
      conflictEvidence: [{ source: "note", excerpt: "12 L" }, { source: "image", excerpt: "20 L" }],
    };
    vi.spyOn(api, "analyzeKitchenIntake").mockResolvedValue(conflict);
    const onApply = vi.fn();
    const onReview = vi.fn();
    fillNote(onApply, onReview);

    await act(async () => container.querySelector("button")!.click());

    expect(onApply).not.toHaveBeenCalled();
    expect(container.textContent).toContain(conflict.question);
    expect(container.textContent).toContain("Note“12 L”");
    expect(container.textContent).toContain("Photo“20 L”");
    expect(container.querySelector(".intake-result")?.textContent).not.toContain("cooking cream");
    const review = [...container.querySelectorAll("button")].find((button) => button.textContent === "Review request fields");
    expect(review).toBeDefined();
    act(() => review!.click());
    expect(onReview).toHaveBeenCalledOnce();
  });

  it("appends final dictation to the editable note and waits for the buyer to read it", async () => {
    vi.stubGlobal("webkitSpeechRecognition", BrowserSpeech);
    const analyze = vi.spyOn(api, "analyzeKitchenIntake").mockResolvedValue(partialDraft);
    const apply = vi.fn();
    fillNote(apply);
    const language = container.querySelector("select")!;
    act(() => {
      language.value = "fi-FI";
      language.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => button("Dictate note").click());
    const capture = BrowserSpeech.instances[0];
    expect(capture.lang).toBe("fi-FI");
    expect(capture.continuous).toBe(true);
    expect(button("Fill request fields").disabled).toBe(true);
    act(() => capture.result(0, "12 kiloa"));
    act(() => capture.result(0, "12 kiloa", "huomenna klo 10"));
    act(() => button("Stop dictation").click());
    expect(capture.stop).toHaveBeenCalledOnce();
    expect(button("Fill request fields").disabled).toBe(true);
    act(() => capture.onend?.());
    const note = container.querySelector("textarea")!;
    expect(note.value).toBe("lactose-free cooking cream 12 kiloa huomenna klo 10");
    expect(note.disabled).toBe(false);
    expect(analyze).not.toHaveBeenCalled();
    await act(async () => button("Fill request fields").click());
    expect(analyze).toHaveBeenCalledWith(note.value, undefined);
    expect(apply).toHaveBeenCalledWith(partialDraft);
  });

  it("keeps a typed note after microphone denial and stops listening when leaving", () => {
    vi.stubGlobal("SpeechRecognition", BrowserSpeech);
    fillNote(vi.fn());
    act(() => button("Dictate note").click());
    act(() => BrowserSpeech.instances[0].onerror?.({ error: "not-allowed" }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Check your browser permissions");
    expect(container.querySelector("textarea")?.value).toBe("lactose-free cooking cream");
    act(() => button("Dictate note").click());
    const capture = BrowserSpeech.instances[1];
    act(() => root?.unmount());
    root = undefined;
    expect(capture.abort).toHaveBeenCalledOnce();
    act(() => capture.result(0, "a late transcript"));
  });
});
