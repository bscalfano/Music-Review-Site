/** Why someone might report something. The slug is stored; the label is shown. */
export const REPORT_REASONS = [
  { slug: "spam", label: "Spam or advertising" },
  { slug: "harassment", label: "Harassment or bullying" },
  { slug: "hate", label: "Hate speech" },
  { slug: "sexual", label: "Sexual or graphic content" },
  { slug: "impersonation", label: "Impersonation" },
  { slug: "illegal", label: "Illegal content or copyright" },
  { slug: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["slug"];

export const REPORT_REASON_SLUGS = REPORT_REASONS.map((r) => r.slug) as [
  ReportReason,
  ...ReportReason[],
];

export const reasonLabel = (slug: string): string =>
  REPORT_REASONS.find((r) => r.slug === slug)?.label ?? slug;

export const MAX_REPORT_DETAILS = 1000;
