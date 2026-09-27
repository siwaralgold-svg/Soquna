'use client';

import { REALTIME_EVENTS, type UnreadCount } from '@souqna/contracts/constants';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { onRealtime, onReconnect } from '@/lib/realtime';
import { onUnreadChanged } from '@/lib/unread';
import { ChatIcon, HomeIcon, PlusIcon, SearchIcon, UserIcon } from './icons';

const ITEMS = [
  { href: '/', key: 'home', Icon: HomeIcon },
  { href: '/search', key: 'search', Icon: SearchIcon },
  { href: '/sell', key: 'sell', Icon: PlusIcon },
  { href: '/chats', key: 'chats', Icon: ChatIcon },
  { href: '/account', key: 'account', Icon: UserIcon },
] as const;

/** Keeps the unread-chats badge fresh: on each page change, on pushed messages and on focus. */
function useUnread(pathname: string) {
  const [unread, setUnread] = useState<UnreadCount | null>(null);
  const refresh = useCallback(() => {
    api<UnreadCount>('/conversations/unread').then(setUnread, () => {});
  }, []);

  useEffect(refresh, [pathname, refresh]);

  const signedIn = unread?.signedIn ?? false;
  useEffect(() => {
    if (!signedIn) return;
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    const stop = [
      onRealtime(REALTIME_EVENTS.message, refresh),
      onReconnect(refresh),
      onUnreadChanged(refresh),
    ];
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      stop.forEach((fn) => fn());
    };
  }, [signedIn, refresh]);

  return unread?.count ?? 0;
}

/** Thumb-reachable navigation for phones, the way most marketplace apps work. */
export function BottomNav() {
  const t = useTranslations('nav');
  const format = useFormatter();
  const pathname = usePathname();
  const unread = useUnread(pathname);

  // A chat thread needs the bottom of the screen for its message box.
  if (/^\/chats\/[^/]+$/.test(pathname)) return null;

  return (
    <nav
      aria-label={t('bottom')}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {ITEMS.map(({ href, key, Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          const isSell = key === 'sell';
          const badge = key === 'chats' && unread > 0;
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
                  <span className="relative">
                    <Icon />
                    {badge && (
                      <span
                        data-testid="unread-badge"
                        className="absolute -end-2.5 -top-1.5 min-w-5 rounded-full bg-danger-600 px-1 text-center text-[11px] font-bold leading-5 text-white"
                      >
                        <span aria-hidden>{format.number(Math.min(unread, 99))}</span>
                        <span className="sr-only">{t('unreadBadge', { count: unread })}</span>
                      </span>
                    )}
                  </span>
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
