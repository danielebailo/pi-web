import { beforeEach, describe, expect, it } from "vitest";
import { SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT } from "./columns.ts";
import { layoutActions, layoutStore, sidebarGeometry, type LayoutState } from "./layout-state.ts";

const WIDE = SIDEBAR_AUTO_COLLAPSE + 400;
const NARROW = SIDEBAR_AUTO_COLLAPSE - 400;

/** The store is a module singleton; every test starts from a known frame. */
function reset(overrides: Partial<LayoutState> = {}): void {
  layoutStore.set({
    viewportWidth: WIDE,
    narrowExpanded: false,
    sidebarWidth: SIDEBAR_DEFAULT,
    ...overrides,
  });
}

beforeEach(() => {
  reset();
});

describe("toggleSidebar", () => {
  it("collapses and restores the column on a wide frame", () => {
    layoutActions.toggleSidebar();
    expect(layoutStore.get().sidebarWidth).toBe(0);

    layoutActions.toggleSidebar();
    expect(layoutStore.get().sidebarWidth).toBe(SIDEBAR_DEFAULT);
  });

  it("flips only the override on a narrow frame, leaving the preference alone", () => {
    reset({ viewportWidth: NARROW });

    layoutActions.toggleSidebar();
    expect(layoutStore.get().narrowExpanded).toBe(true);
    expect(layoutStore.get().sidebarWidth).toBe(SIDEBAR_DEFAULT);

    layoutActions.toggleSidebar();
    expect(layoutStore.get().narrowExpanded).toBe(false);
  });
});

describe("setViewportWidth", () => {
  it("treats the first measurement as a reading, not as a crossing", () => {
    // 0 means "not measured"; arriving at a narrow width from it must not be
    // read as the frame having just shrunk across the breakpoint.
    reset({ viewportWidth: 0, narrowExpanded: true });

    layoutActions.setViewportWidth(NARROW);

    expect(layoutStore.get().viewportWidth).toBe(NARROW);
    expect(layoutStore.get().narrowExpanded).toBe(true);
  });

  it("drops the narrow override when the frame crosses the breakpoint", () => {
    reset({ viewportWidth: NARROW, narrowExpanded: true });
    layoutActions.setViewportWidth(WIDE);
    expect(layoutStore.get().narrowExpanded).toBe(false);

    reset({ viewportWidth: WIDE, narrowExpanded: true });
    layoutActions.setViewportWidth(NARROW);
    expect(layoutStore.get().narrowExpanded).toBe(false);
  });

  it("keeps the override while the frame stays on the same side", () => {
    reset({ viewportWidth: NARROW, narrowExpanded: true });
    layoutActions.setViewportWidth(NARROW - 40);
    expect(layoutStore.get().narrowExpanded).toBe(true);
  });

  it("ignores a repeated reading", () => {
    const before = layoutStore.get();
    layoutActions.setViewportWidth(WIDE);
    expect(layoutStore.get()).toBe(before);
  });
});

describe("collapseNarrow", () => {
  it("puts the drawer away without touching the width preference", () => {
    reset({ viewportWidth: NARROW, narrowExpanded: true });

    layoutActions.collapseNarrow();

    expect(layoutStore.get().narrowExpanded).toBe(false);
    expect(layoutStore.get().sidebarWidth).toBe(SIDEBAR_DEFAULT);
  });

  it("is a no-op on a wide frame", () => {
    const before = layoutStore.get();
    layoutActions.collapseNarrow();
    expect(layoutStore.get()).toBe(before);
  });
});

describe("sidebarGeometry", () => {
  it("gives the column a track on a wide frame", () => {
    expect(sidebarGeometry({ viewportWidth: WIDE, narrowExpanded: false, sidebarWidth: 320 })).toEqual({
      width: 320,
      overlay: false,
    });
  });

  it("takes the track away and hands back a drawer on a narrow frame", () => {
    expect(sidebarGeometry({ viewportWidth: NARROW, narrowExpanded: true, sidebarWidth: 320 })).toEqual({
      width: 0,
      overlay: true,
    });
    expect(sidebarGeometry({ viewportWidth: NARROW, narrowExpanded: false, sidebarWidth: 320 })).toEqual({
      width: 0,
      overlay: false,
    });
  });
});
