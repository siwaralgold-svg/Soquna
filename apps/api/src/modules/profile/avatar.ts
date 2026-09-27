import sharp from 'sharp';
import { AppError } from '../../lib/errors';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_SIZE = 256;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MAX_INPUT_PIXELS = 40_000_000;

/**
 * The file type is decided by decoding the bytes, never by the file name or the
 * browser-supplied content type. The image is always re-encoded, which drops EXIF/GPS and
 * any other metadata (sharp only keeps metadata when asked with `.withMetadata()`).
 */
export async function processAvatar(
  input: Buffer,
): Promise<{ data: Buffer; width: number; height: number }> {
  let format: string | undefined;
  try {
    format = (await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()).format;
  } catch {
    throw new AppError('upload_invalid');
  }
  if (!format || !ALLOWED_FORMATS.has(format)) throw new AppError('upload_invalid');

  try {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new AppError('upload_invalid');
  }
}
