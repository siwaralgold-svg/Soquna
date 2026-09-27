import sharp, { type Sharp } from 'sharp';
import { AppError } from './errors';

export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MAX_INPUT_PIXELS = 40_000_000;

/**
 * Opens an uploaded image. The type is decided by decoding the bytes, never by the file
 * name or the browser-supplied content type. Everything we store is re-encoded, which drops
 * EXIF/GPS and all other metadata (sharp only keeps it when asked with `.withMetadata()`).
 */
export async function openImage(input: Buffer): Promise<() => Sharp> {
  let format: string | undefined;
  try {
    format = (await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()).format;
  } catch {
    throw new AppError('upload_invalid');
  }
  if (!format || !ALLOWED_FORMATS.has(format)) throw new AppError('upload_invalid');
  return () => sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
}

export interface EncodedImage {
  data: Buffer;
  width: number;
  height: number;
}

export async function encodeWebp(image: Sharp, quality: number): Promise<EncodedImage> {
  try {
    const { data, info } = await image.webp({ quality }).toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new AppError('upload_invalid');
  }
}
