import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { password } = body;

  const masterPassword = process.env.MASTER_PASSWORD;

  if (!masterPassword) {
    return NextResponse.json(
      { error: "서버 설정 오류: 비밀번호가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  if (password === masterPassword) {
    return NextResponse.json({ success: true });
  }

  return NextResponse.json(
    { error: "비밀번호가 올바르지 않습니다." },
    { status: 401 }
  );
}
