import { NextResponse } from 'next/server';

export async function GET() {
  // Return 200 immediately so K8s readiness/liveness probes always pass.
  // DB connectivity must NOT block the health check — a slow or failing DB
  // connection will cause the probe to timeout and trigger a restart loop.
  return NextResponse.json(
    { status: 'ok', uptime: process.uptime() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
