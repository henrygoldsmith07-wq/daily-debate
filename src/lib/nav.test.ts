import { describe, expect, it } from "vitest";
import {
  NAV_ITEMS,
  NAV_SECTIONS,
  PRIMARY_NAV_ITEMS,
  activeNavItem,
  isActivePath,
} from "./nav";

describe("nav configuration", () => {
  it("has no duplicate destinations", () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("keeps the mobile tab bar to five slots including More", () => {
    // Four links plus the More button; beyond that the tabs stop being tappable.
    expect(PRIMARY_NAV_ITEMS.length).toBeLessThanOrEqual(4);
  });

  it("gives every item a label and a description for the More sheet", () => {
    for (const item of NAV_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.description.length).toBeGreaterThan(0);
    }
  });

  it("groups every item under exactly one section", () => {
    const grouped = NAV_SECTIONS.flatMap((section) => section.items);
    expect(grouped).toHaveLength(NAV_ITEMS.length);
  });
});

describe("isActivePath", () => {
  it("matches a section and its nested routes", () => {
    expect(isActivePath("/pvp", "/pvp")).toBe(true);
    expect(isActivePath("/pvp/abc-123", "/pvp")).toBe(true);
  });

  it("does not match a route that merely shares a prefix", () => {
    expect(isActivePath("/pvponboarding", "/pvp")).toBe(false);
  });

  it("only lights the dashboard on the dashboard itself", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/history", "/")).toBe(false);
  });
});

describe("activeNavItem", () => {
  it("resolves a nested route to its nav entry", () => {
    expect(activeNavItem("/pvp/match-1")?.href).toBe("/pvp");
  });

  it("returns nothing for routes outside the nav", () => {
    // /debate/:id is reached from Today and History, not from a nav entry —
    // the mobile bar falls back to highlighting "More" for these.
    expect(activeNavItem("/debate/abc")).toBeUndefined();
    expect(activeNavItem("/login")).toBeUndefined();
  });
});
