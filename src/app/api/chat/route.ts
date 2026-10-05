import { NextResponse } from "next/server";
export function POST() {
  return NextResponse.json(
    { message: "Dùng API hội thoại đã xác thực.", code: "ROUTE_RETIRED" },
    { status: 410 },
  );
}
