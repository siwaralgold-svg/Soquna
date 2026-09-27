import type { MetadataRoute } from 'next';
import { messages } from '@souqna/i18n';

export default function manifest(): MetadataRoute.Manifest {
  const ar = messages.ar.meta;
  return {
    id: '/',
    name: ar.title,
    short_name: ar.title,
    description: ar.description,
    lang: 'ar',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#faf8f5',
    theme_color: '#137e5d',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
