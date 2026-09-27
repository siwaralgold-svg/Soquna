import ar from '../messages/ar.json';
import en from '../messages/en.json';

export type Messages = typeof ar;
export const messages = { ar, en } satisfies Record<string, Messages>;
export type MessageLocale = keyof typeof messages;
export const DEFAULT_LOCALE: MessageLocale = 'ar';

/** Minimal `{name}` substitution for server-side text (SMS). The web app uses next-intl. */
export function formatServerMessage(
  locale: MessageLocale,
  key: keyof Messages['server'],
  values: Record<string, string | number>,
): string {
  const template = messages[locale].server[key];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}
