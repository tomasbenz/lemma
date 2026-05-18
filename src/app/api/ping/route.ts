// src/app/api/ping/route.ts
//
// Endpoint mínimo para detectar si hay conectividad real al server.
// `navigator.onLine` puede mentir (devuelve true si hay Wi-Fi conectado
// aunque no haya internet detrás), así que el cliente complementa con
// un ping periódico a este endpoint.
//
// Devuelve 200 OK con { ok: true, ts: timestamp }. Si el cliente no puede
// alcanzar este endpoint en X segundos, asume que está offline.
//
// SIN auth: este endpoint solo confirma que el server responde, no expone
// datos. Cualquiera puede pingearlo.

import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      ts: Date.now(),
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  )
}