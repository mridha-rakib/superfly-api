export const LEGAL_CONTENT_SLUGS = [
  "privacy-policy",
  "terms-and-conditions",
] as const;

export type LegalContentSlug = (typeof LEGAL_CONTENT_SLUGS)[number];

export type LegalContentResponse = {
  slug: LegalContentSlug;
  title: string;
  content: string;
  updatedAt: Date;
  createdAt: Date;
};

export type LegalContentUpdatePayload = {
  title: string;
  content: string;
};
