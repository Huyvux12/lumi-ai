/** Only same-origin relative paths are allowed as post-login destinations. */
export function safeNext(next: string | string[] | undefined) {
  const n = Array.isArray(next) ? next[0] : next;
  if (!n || !n.startsWith("/") || n.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(n))
    return "/";
  const origin = "https://lumi.invalid";
  try {
    const url = new URL(n, origin);
    return url.origin === origin ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}
