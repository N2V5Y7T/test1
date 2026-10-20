/**
 * Runtime platform profile for performance-sensitive tuning.
 */
function detectWindowsDesktop() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const uaPlatform = navigator.userAgentData?.platform || navigator.platform || '';
  const ua = navigator.userAgent || '';
  const isWin = /win/i.test(uaPlatform) || /windows/i.test(ua);
  return isWin && !coarse;
}

const isWindowsDesktop = detectWindowsDesktop();

export const RUNTIME_PROFILE = {
  isWindowsDesktop,
  maxCanvasDpr: isWindowsDesktop ? 1.5 : 2,
  desktopTauMs: isWindowsDesktop ? 48 : 55,
  preloadWindowRatio: isWindowsDesktop ? 0.36 : 0.48,
  evictHysteresis: isWindowsDesktop ? 0 : 1,
  maxAnchorWorkers: isWindowsDesktop ? 2 : 3,
  maxConcurrentHigh: isWindowsDesktop ? 8 : 10,
  maxConcurrentMedium: isWindowsDesktop ? 4 : 6,
  maxConcurrentLow: isWindowsDesktop ? 2 : 3,
  maxGlobalWorkers: isWindowsDesktop ? 10 : 14,
  sessionCacheMaxBytes: (isWindowsDesktop ? 64 : 90) * 1024 * 1024,
};
