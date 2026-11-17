import { describe, expect, it } from "vitest";
import { buildNotificationEmail } from "@/lib/social/notification-email";
import { NOTIFICATION_LABELS } from "@/lib/social/notifications";

describe("notification emails", () => {
  it("says who did what and links to it", () => {
    const mail = buildNotificationEmail(
      "comment",
      "Maya",
      "Kid A",
      "https://x.test/u/bri/kid-a#comment-1",
    );
    expect(mail.subject).toBe("Maya commented on your review of Kid A.");
    expect(mail.text).toContain("https://x.test/u/bri/kid-a#comment-1");
    expect(mail.text).toContain("/settings");
  });

  it("has wording for every notification type", () => {
    for (const type of Object.keys(NOTIFICATION_LABELS) as Array<
      keyof typeof NOTIFICATION_LABELS
    >) {
      const mail = buildNotificationEmail(type, "Someone", null, "https://x.test");
      expect(mail.subject.length).toBeGreaterThan(10);
      expect(mail.subject).toContain("Someone");
    }
  });
});
