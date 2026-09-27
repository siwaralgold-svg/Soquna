'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { HeartIcon, HomeIcon, PlusIcon, SearchIcon, UserIcon } from './icons';

const ITEMS = [
  { href: '/', key: 'home', Icon: HomeIcon },
  { href: '/search', key: 'search', Icon: SearchIcon },
  { href: '/sell', key: 'sell', Icon: PlusIcon },
  { href: '/favourites', key: 'favourites', Icon: HeartIcon },
  { href: '/account', key: 'account', Icon: UserIcon },
] as const;

/** Thumb-reachable navigation for phones, the way most marketplace apps work. */
export function BottomNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();

  return (
    <nav
      aria-label={t('bottom')}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {ITEMS.map(({ href, key, Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          const isSell = key === 'sell';
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs ${
                  active ? 'font-semibold text-brand-700' : 'text-ink-muted'
                }`}
              >
                {isSell ? (
                  <span className="flex size-8 items-center justify-center rounded-full bg-brand-600 text-white">
                    <PlusIcon width={20} height={20} />
                  </span>
                ) : (
                  <Icon />
                )}
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
