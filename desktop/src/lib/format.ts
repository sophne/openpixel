/* Small pure helpers more than one area uses. */

/** "5 min ago" for a time in seconds since 1970. */
export function timeAgo(t: number): string {
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
  return new Date(t * 1000).toLocaleDateString();
}
