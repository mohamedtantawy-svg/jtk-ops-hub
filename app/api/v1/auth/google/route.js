import { NextResponse } from 'next/server';
export async function POST() {
  return NextResponse.json(
    { error: 'This endpoint has been deprecated. Please use Google Sign-In via the login page.' },
    { status: 410 }
  );
}
