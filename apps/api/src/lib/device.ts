const BROWSERS: Array<[RegExp, string]> = [
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/OPR\/|Opera/, 'Opera'],
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
];

/**
 * Short, non-identifying device label for the "devices" list, e.g. "Chrome · Android".
 * Returns an empty string when nothing is recognised (the web app shows a translated
 * "unknown device" label).
 */
export function deviceLabel(userAgent: string | undefined): string {
  if (!userAgent) return '';
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1];
  return [browser, system].filter(Boolean).join(' · ');
}
