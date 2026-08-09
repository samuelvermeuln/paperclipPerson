import i18n, { type InitOptions, type TOptions } from "i18next";
import { initReactI18next, useTranslation as useReactI18nextTranslation } from "react-i18next";

import { DEFAULT_LOCALE, i18nextResources, supportedLocales, type SupportedLocale } from "./locales";

const LOCALE_STORAGE_KEY = "paperclip.locale";

function normalizeLocale(value: string | null | undefined): SupportedLocale | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (supportedLocales.includes(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (lower === "pt" || lower.startsWith("pt-")) return "pt-BR";
  const baseLanguage = lower.split("-")[0] ?? "";
  for (const locale of supportedLocales) {
    if (locale.toLowerCase() === baseLanguage) return locale;
  }
  return null;
}

function resolveInitialLocale(): SupportedLocale {
  if (typeof window !== "undefined") {
    const stored = normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
    if (stored) return stored;
  }

  return DEFAULT_LOCALE;
}

const i18nextOptions: InitOptions = {
  resources: i18nextResources,
  lng: resolveInitialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: supportedLocales,
  defaultNS: "translation",
  interpolation: { escapeValue: false },
  returnObjects: false,
  initAsync: false,
};

void i18n.use(initReactI18next).init(i18nextOptions).catch((error: unknown) => {
  console.error("Failed to initialize i18next", error);
});

export function t(key: string, options: TOptions = {}) {
  return i18n.t(key, options);
}

export async function changeLocale(locale: SupportedLocale) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
  await i18n.changeLanguage(locale);
}

export const useTranslation = useReactI18nextTranslation;
export { i18n, LOCALE_STORAGE_KEY };
