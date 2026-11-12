const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS/, 'Firefox'],
  [/Chrome\/|CriOS/, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/Windows/, 'Windows'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

const UA_LIKE = /Mozilla\/|AppleWebKit|Gecko/;

/** "Edge on Windows" from a raw user agent when available, otherwise the stored device label. */
export function describeDevice(label: string | null | undefined, userAgent?: string | null): string {
  const source = userAgent && UA_LIKE.test(userAgent) ? userAgent : label || userAgent || '';
  if (!source) return 'Unknown device';
  if (!UA_LIKE.test(source)) return source;
  const browser = BROWSERS.find(([re]) => re.test(source))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(source))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? 'Unknown browser';
}
