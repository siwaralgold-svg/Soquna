/**
 * Shrinks a photo in the browser before upload, to save the user's data on slow and
 * expensive networks. The server re-encodes it again anyway (and strips metadata), so
 * this is purely about upload size. Falls back to the original file if anything fails.
 */
export async function compressImage(file: File, maxSide = 1024, quality = 0.85): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', quality),
    );
    // Some older browsers can't encode WebP and silently return PNG; use JPEG instead.
    if (blob && blob.type === 'image/webp') return blob;
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    return jpeg && jpeg.size < file.size ? jpeg : file;
  } catch {
    return file;
  }
}
