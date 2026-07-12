const rawAppUrl = import.meta.env.VITE_GTM_APP_URL;
const rawMailto = import.meta.env.VITE_WALKTHROUGH_MAILTO;

export const GTM_APP_URL =
  typeof rawAppUrl === "string" && rawAppUrl.trim().length > 0
    ? rawAppUrl
    : "https://gtm.aiexperiments.eu";

export const WALKTHROUGH_MAILTO =
  typeof rawMailto === "string" && rawMailto.trim().length > 0 ? rawMailto : null;
