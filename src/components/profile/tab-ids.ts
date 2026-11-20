export const PROFILE_TABS = ["reviews", "shelves", "queue", "stats"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export const parseTab = (v: unknown): ProfileTab => PROFILE_TABS.find((t) => t === v) ?? "reviews";
