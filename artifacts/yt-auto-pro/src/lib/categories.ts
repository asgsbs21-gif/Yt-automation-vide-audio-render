export const VIDEO_CATEGORIES = [
  "fish cutting",
  "cooking",
  "cake making",
  "woodwork",
  "satisfying",
  "custom",
] as const;

export type VideoCategory = (typeof VIDEO_CATEGORIES)[number];
