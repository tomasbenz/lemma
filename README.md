# Lemma

POS B2B multi-tenant para librerías argentinas (papelería, útiles escolares,
materiales de arte, regalería, libros). Construido sobre Next.js 16, Supabase
y Vercel.

## Stack
- Next.js 16 (App Router) + TypeScript estricto
- Supabase (Postgres + RLS + Auth)
- Tailwind v4 + shadcn/ui
- PWA offline-first con Serwist + Dexie
- Facturación electrónica AFIP (WSFE v1.5)

## Setup

```bash
cp .env.local.example .env.local
# completar credenciales
npm install
npm run dev
```

## Scripts útiles

- `npm run dev` — servidor de desarrollo
- `npm run build` — build de producción
- `npm test` — suite de tests (AFIP, cobros, builders, parsers)
- `npx tsc --noEmit` — verificar types sin emitir JS
- `npm run db:types` — regenerar `src/types/database.ts` desde Supabase

## Documentación

- `CLAUDE.md` — contexto del proyecto y reglas operativas
- `AGENTS.md` — reglas para agentes que toquen el código
- `docs/security/audit-log.md` — histórico de cambios de seguridad
- `supabase/migrations/` — schema versionado
