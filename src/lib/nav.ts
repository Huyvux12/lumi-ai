/** Only same-origin relative paths are allowed as post-login destinations. */
export function safeNext(next: string | string[] | undefined) {
  const n = Array.isArray(next) ? next[0] : next;
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/";
}
