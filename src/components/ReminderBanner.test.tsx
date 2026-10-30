import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReminderBanner from "./ReminderBanner";
import { decideDispatch, DEFAULT_REMINDER_PREFS, reminderMessage } from "@/lib/reminderDelivery";

describe("ReminderBanner", () => {
  it("renders the dispatched retest message without effectiveness claims", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const d = decideDispatch(
      [{ kind: "retest", availableAt: "2026-10-28T09:00:00Z" }],
      { ...DEFAULT_REMINDER_PREFS, optedIn: true },
      null,
      now,
    );
    expect(d.send).toBe(true);
    if (!d.send) return;
    const html = renderToStaticMarkup(<ReminderBanner message={reminderMessage(d)} />);
    expect(html).toContain("Your retest is ready");
    expect(html).toContain("not a score");
    expect(html).toContain("See what is due");
  });
});
