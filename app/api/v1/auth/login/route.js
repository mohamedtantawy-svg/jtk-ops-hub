import { NextResponse } from 'next/server';
export async function POST() {
  return NextResponse.json(
    { error: 'Email-only login has been disabled. Please use Google Sign-In.' },
    { status: 410 }
  );
}
