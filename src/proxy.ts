import { NextResponse, type NextRequest } from "next/server";

// Optimistic navigation only. Python validates the session and permissions for every protected API.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = request.cookies.has("lumi_session");
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/create", "/profile", "/login", "/signup"],
};
