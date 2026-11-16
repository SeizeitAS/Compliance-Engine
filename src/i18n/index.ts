/**
 * Minimal, dependency-free i18n system.
 *
 * - Source language is English (`en`); every other locale is a translation.
 * - Messages live in locales/<tag>.json as a flat map of dotted keys.
 * - Interpolation: "Hello {name}". Plurals: "<key>.one" / "<key>.other" (and any other CLDR
 *   category) selected via Intl.PluralRules when params.count is given.
 * - Fallback chain: nb-NO -> nb -> default locale (en) -> the key itself.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type Messages = Record<string, string>;
export type Params = Record<string, string | number>;

export const DEFAULT_LOCALE = "en";

/** Common alternative tags mapped to the locale file that serves them. */
const ALIASES: Record<string, string> = { no: "nb", nn: "nb" };

export interface TranslatorOptions {
  locale: string;
  defaultLocale?: string;
  catalogs: Record<string, Messages>;
  onMissing?: (key: string, locale: string) => void;
}

export interface Translator {
  readonly locale: string;
  t(key: string, params?: Params): string;
  has(key: string): boolean;
}

export function loadCatalogs(dir: string): Record<string, Messages> {
  const out: Record<string, Messages> = {};
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".json")) out[f.slice(0, -5)] = JSON.parse(readFileSync(join(dir, f), "utf8"));
  }
  return out;
}

/** Candidate locale tags for a requested tag, most specific first. */
export function fallbackChain(tag: string, defaultLocale = DEFAULT_LOCALE): string[] {
  const parts = tag.replace("_", "-").split("-");
  const chain: string[] = [];
  for (let i = parts.length; i > 0; i--) chain.push(parts.slice(0, i).join("-"));
  const primary = parts[0].toLowerCase();
  if (ALIASES[primary] && !chain.includes(ALIASES[primary])) chain.push(ALIASES[primary]);
  if (!chain.includes(defaultLocale)) chain.push(defaultLocale);
  return chain;
}

/** Pick the best supported locale from e.g. an Accept-Language header or env LANG. */
export function negotiateLocale(requested: string[], supported: string[], defaultLocale = DEFAULT_LOCALE): string {
  for (const r of requested) {
    const tag = r.split(";")[0].trim().split(".")[0];
    if (!tag || tag === "*") continue;
    for (const c of fallbackChain(tag, defaultLocale)) if (supported.includes(c)) return c;
  }
  return defaultLocale;
}

export function createTranslator(opts: TranslatorOptions): Translator {
  const defaultLocale = opts.defaultLocale ?? DEFAULT_LOCALE;
  const chain = fallbackChain(opts.locale, defaultLocale);
  const plural = new Intl.PluralRules(chain[0].replace("_", "-"));

  const lookup = (key: string): string | undefined => {
    for (const loc of chain) {
      const v = opts.catalogs[loc]?.[key];
      if (v !== undefined) return v;
    }
    return undefined;
  };

  return {
    locale: chain[0],
    has: (key) => lookup(key) !== undefined || lookup(`${key}.other`) !== undefined,
    t(key, params) {
      let msg: string | undefined;
      if (params && typeof params.count === "number") {
        msg = lookup(`${key}.${plural.select(params.count)}`) ?? lookup(`${key}.other`);
      }
      msg ??= lookup(key);
      if (msg === undefined) {
        opts.onMissing?.(key, opts.locale);
        return key;
      }
      return msg.replace(/\{(\w+)\}/g, (m, name: string) => (params && name in params ? String(params[name]) : m));
    },
  };
}
