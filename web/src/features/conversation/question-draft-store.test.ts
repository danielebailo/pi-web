import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearQuestionDraft,
  readQuestionDraft,
  writeQuestionDraft,
  type StoredQuestionDraft,
} from "./question-draft-store.ts";

/** A `localStorage` good enough for the store, with no browser behind it. */
function fakeStorage(overrides: Partial<Storage> = {}): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
    ...overrides,
  } as Storage;
}

const DRAFT: StoredQuestionDraft = {
  index: 1,
  drafts: [
    { selected: ["Postgres"], custom: "", skipped: false },
    { selected: [], custom: "keep it small", skipped: false },
  ],
};

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("question drafts", () => {
  it("round-trips a card's progress", () => {
    writeQuestionDraft("ui_1", DRAFT);
    expect(readQuestionDraft("ui_1", 2)).toEqual(DRAFT);
  });

  it("keeps two cards' drafts apart", () => {
    writeQuestionDraft("ui_1", DRAFT);
    writeQuestionDraft("ui_2", { index: 0, drafts: DRAFT.drafts });
    expect(readQuestionDraft("ui_1", 2)?.index).toBe(1);
    expect(readQuestionDraft("ui_2", 2)?.index).toBe(0);
  });

  it("forgets a draft once the answer is submitted", () => {
    writeQuestionDraft("ui_1", DRAFT);
    clearQuestionDraft("ui_1");
    expect(readQuestionDraft("ui_1", 2)).toBeNull();
  });

  it("ignores progress that does not match the batch it is read against", () => {
    writeQuestionDraft("ui_1", DRAFT);
    // One answer too few: this draft belongs to a different batch, and applying
    // it would put a choice on a question the user never saw.
    expect(readQuestionDraft("ui_1", 3)).toBeNull();
    expect(readQuestionDraft("ui_1", 1)).toBeNull();
  });

  it("ignores an index that is not a question of the batch", () => {
    writeQuestionDraft("ui_1", { ...DRAFT, index: 7 });
    expect(readQuestionDraft("ui_1", 2)).toBeNull();
    writeQuestionDraft("ui_1", { ...DRAFT, index: -1 });
    expect(readQuestionDraft("ui_1", 2)).toBeNull();
  });

  it("ignores stored bytes it cannot read, rather than throwing", () => {
    localStorage.setItem("pi-web-simple.question-draft.v1:ui_1", "{not json");
    expect(readQuestionDraft("ui_1", 2)).toBeNull();

    localStorage.setItem("pi-web-simple.question-draft.v1:ui_1", JSON.stringify({ index: 0, drafts: [{ selected: "x" }] }));
    expect(readQuestionDraft("ui_1", 1)).toBeNull();
  });

  it("works with no storage at all, which is what a static render gets", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => writeQuestionDraft("ui_1", DRAFT)).not.toThrow();
    expect(readQuestionDraft("ui_1", 2)).toBeNull();
    expect(() => clearQuestionDraft("ui_1")).not.toThrow();
  });

  it("survives a storage that refuses to read or write", () => {
    vi.stubGlobal("localStorage", fakeStorage({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    }));
    expect(() => writeQuestionDraft("ui_1", DRAFT)).not.toThrow();
    expect(readQuestionDraft("ui_1", 2)).toBeNull();
  });
});
