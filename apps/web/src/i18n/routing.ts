import { LOCALES } from '@souqna/contracts/constants';
import { defineRouting } from 'next-intl/routing';

// Arabic lives at `/`, English at `/en`.
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: 'ar',
  localePrefix: 'as-needed',
});
