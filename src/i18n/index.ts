// Translation layer: pick a language, look texts up by key, fill placeholders.
// Pure (no React); src/i18n/react.tsx provides the hook for components.

import { en, tr } from './messages.ts';
import type { MessageKey } from './messages.ts';

export type { MessageKey } from './messages.ts';

export const LOCALES = { tr: 'Türkçe', en: 'English' } as const;
export type Locale = keyof typeof LOCALES;

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { tr, en };

export type Params = Readonly<Record<string, string | number>>;
export type Translate = (key: MessageKey, params?: Params) => string;

/** Text for `key` in `locale` with {placeholders} filled in. */
export function translate(locale: Locale, key: MessageKey, params: Params = {}): string {
  const text = DICTIONARIES[locale][key] ?? tr[key];
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export const translator =
  (locale: Locale): Translate =>
  (key, params) =>
    translate(locale, key, params);

export const isLocale = (x: unknown): x is Locale => typeof x === 'string' && x in LOCALES;

/** Default language: Turkish for Turkish browsers, English otherwise. */
export function detectLocale(languages: readonly string[]): Locale {
  return languages.some((l) => l.toLowerCase().startsWith('tr')) ? 'tr' : 'en';
}

export const dictionaries = DICTIONARIES;

/**
 * An error whose message can be shown in any language: `key` and `params`
 * name the text; `message` holds the Turkish one (for logs and tests).
 */
export class LocalizedError extends Error {
  constructor(
    readonly key: MessageKey,
    readonly params: Params = {},
  ) {
    super(translate('tr', key, params));
  }
}

/** Text of a caught error in `t`'s language. */
export const errorText = (e: unknown, t: Translate): string =>
  e instanceof LocalizedError ? t(e.key, e.params) : e instanceof Error ? e.message : String(e);

export const isMessageKey = (k: string): k is MessageKey => k in tr;

/** `key` translated when it exists, else `fallback` (texts stored by older versions, imported tags). */
export const translateOr = (t: Translate, key: string, fallback: string): string =>
  isMessageKey(key) ? t(key) : fallback;
