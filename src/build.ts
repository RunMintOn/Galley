declare const __REVIEW_BUILD__: string;
export const BUILD = typeof __REVIEW_BUILD__ === "string" ? __REVIEW_BUILD__ : "source";
