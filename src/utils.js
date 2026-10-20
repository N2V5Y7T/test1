/**
 * The Nines — Shared Utility Functions
 */

/**
 * Sanitizes dynamic strings for safe insertion into HTML.
 * Converts &, <, >, ", and ' to their respective HTML entities.
 *
 * @param {*} str - input value
 * @returns {string} escaped string
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
