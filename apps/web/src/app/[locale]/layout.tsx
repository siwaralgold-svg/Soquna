import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { routing } from '@/i18n/routing';
import { BottomNav } from '@/components/bottom-nav';
import { SiteHeader } from '@/components/site-header';
import { ServiceWorker } from '@/components/service-worker';
import '../globals.css';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  return {
    title: { default: t('title'), template: `%s · ${t('title')}` },
    description: t('description'),
    applicationName: t('title'),
    appleWebApp: { capable: true, title: t('title'), statusBarStyle: 'default' },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  themeColor: '#137e5d',
  width: 'device-width',
  initialScale: 1,
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // Every page is rendered per request so it can carry the CSP nonce set in proxy.ts.
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body className="min-h-dvh">
        <NextIntlClientProvider>
          <SiteHeader />
          <main className="mx-auto w-full max-w-xl px-4 pb-28 pt-4">{children}</main>
          <BottomNav />
          <ServiceWorker />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
