import { encodeWebp, openImage, type EncodedImage } from '../../lib/images';

export const AVATAR_SIZE = 256;

export async function processAvatar(input: Buffer): Promise<EncodedImage> {
  const image = await openImage(input);
  return encodeWebp(image().resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' }), 80);
}
