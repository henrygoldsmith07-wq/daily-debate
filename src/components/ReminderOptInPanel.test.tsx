import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReminderOptInPanel from "./ReminderOptInPanel";

describe("ReminderOptInPanel", () => {
  it("defaults to an off offer and states the quiet hours", () => {
    const html = renderToStaticMarkup(<ReminderOptInPanel initialOptedIn={false} />);
    expect(html).toContain("Remind me when a retest is due");
    expect(html).toContain('data-opted-in="false"');
    expect(html).toContain("21:00");
  });
  it("shows the off switch when opted in", () => {
    const html = renderToStaticMarkup(<ReminderOptInPanel initialOptedIn />);
    expect(html).toContain("Turn reminders off");
  });
});
