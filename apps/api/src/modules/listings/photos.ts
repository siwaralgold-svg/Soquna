import { randomUUID } from 'node:crypto';
import { PHOTO_WIDTHS } from '@souqna/contracts';
import { media } from '@souqna/db';
import type { AppContext } from '../../context';
import { sha256 } from '../../lib/crypto';
import { encodeWebp, openImage } from '../../lib/images';

export const photoKey = (storageKey: string, width: number) => `${storageKey}/${width}.webp`;

/**
 * Stores an uploaded photo in three widths (320/800/1280 px, never enlarged), as re-encoded
 * WebP without metadata. It stays unattached (visible only to its owner) until it is used in a
 * listing or sent in a chat.
 */
export async function storePhoto(
  ctx: AppContext,
  ownerId: string,
  kind: 'listing_photo' | 'chat_photo',
  input: Buffer,
): Promise<{ id: string }> {
  const image = await openImage(input);
  const variants = await Promise.all(
    PHOTO_WIDTHS.map((width) =>
      encodeWebp(
        image().resize({ width, height: width, fit: 'inside', withoutEnlargement: true }),
        78,
      ),
    ),
  );

  const id = randomUUID();
  const storageKey = `${kind === 'listing_photo' ? 'listings' : 'chat'}/${ownerId}/${id}`;
  await Promise.all(
    variants.map((v, i) =>
      ctx.storage.put(photoKey(storageKey, PHOTO_WIDTHS[i]!), v.data, 'image/webp'),
    ),
  );

  const largest = variants[variants.length - 1]!;
  await ctx.db.insert(media).values({
    id,
    ownerId,
    kind,
    storageKey,
    mime: 'image/webp',
    bytes: largest.data.length,
    width: largest.width,
    height: largest.height,
    sha256: sha256(largest.data),
    sizes: [...PHOTO_WIDTHS],
  });
  return { id };
}
