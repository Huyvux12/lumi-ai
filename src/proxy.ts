import { NextResponse, type NextRequest } from "next/server";

// Optimistic routing only: the demo account itself lives in localStorage, so
// client pages re-check and recover if the cookie and storage disagree.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = request.cookies.has("rb_session");
  const guest = request.cookies.has("rb_guest");

  // First visit lands on the cinematic welcome page.
  if (pathname === "/" && !session && !guest) {
    return NextResponse.redirect(new URL("/welcome", request.url));
  }

  if ((pathname === "/create" || pathname === "/profile") && !session) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  if ((pathname === "/login" || pathname === "/signup") && session) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/create", "/profile", "/login", "/signup"],
};
