/**
 * Serveur de la file de validation.
 *
 * `node:http` seul, aucune dépendance web. Le plan prévoit des routes tRPC dans
 * l'application existante ; ce dépôt ne contient pas encore ce backend (question
 * ouverte n°2 du design doc). Le service de revue est donc exposé ici par une API
 * JSON minimale, et le brancher sur tRPC le jour venu est un adaptateur d'une
 * vingtaine de lignes qui appelle exactement les mêmes méthodes.
 *
 * Autorisation : la file publie sous l'identité réelle du fondateur. Le serveur
 * exige un jeton (`MARKETING_ADMIN_TOKEN`) et refuse de démarrer sans, sauf en
 * mode démo explicite où il n'écoute que sur la boucle locale.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MarketingError } from '../domain/errors.ts';
import { REJECT_REASONS, type RejectReason } from '../domain/types.ts';
import { MemoryRepo } from '../repo/memory.ts';
import type { MarketingRepo } from '../repo/types.ts';
import { ReviewService } from '../review/service.ts';
import { SEED_ANGLES } from '../angles/seed.ts';
import { generateBatch } from '../generator/generate.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_PATH = join(HERE, '..', 'ui', 'index.html');

export interface ServerOptions {
  repo: MarketingRepo;
  port?: number;
  host?: string;
  token?: string | null;
  /** Identité écrite dans `approved_by`. */
  actor?: string;
}

export function createReviewServer(opts: ServerOptions) {
  const service = new ReviewService(opts.repo);
  const actor = opts.actor ?? 'owner';
  const token = opts.token ?? null;

  return createServer((req, res) => {
    handle(req, res, service, opts.repo, actor, token).catch((err: unknown) => {
      sendError(res, err);
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  service: ReviewService,
  repo: MarketingRepo,
  actor: string,
  token: string | null,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (path === '/' || path === '/admin/marketing') {
    const html = await readFile(UI_PATH, 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (!path.startsWith('/api/')) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  // Le jeton protège toutes les routes qui écrivent, et la lecture de la file.
  if (token && req.headers['x-admin-token'] !== token) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Jeton admin absent ou invalide.' }));
    return;
  }

  if (path === '/api/queue' && req.method === 'GET') {
    return sendJson(res, 200, await service.queue());
  }

  if (path === '/api/generate' && req.method === 'POST') {
    const body = await readJson(req);
    const count = clampCount(body.count);
    const { results, failures } = await generateBatch({ repo, count });
    return sendJson(res, 200, {
      generated: results.length,
      blocked: results.filter((r) => r.blocked).length,
      duplicates: results.filter((r) => r.duplicate).length,
      failures: failures.map(describe),
    });
  }

  if (path === '/api/approve' && req.method === 'POST') {
    const { id } = await readJson(req);
    return sendJson(res, 200, await service.approve(numeric(id), actor));
  }

  if (path === '/api/undo' && req.method === 'POST') {
    const { id } = await readJson(req);
    return sendJson(res, 200, await service.undoApprove(numeric(id)));
  }

  if (path === '/api/reject' && req.method === 'POST') {
    const { id, reason, note } = await readJson(req);
    const noteText = typeof note === 'string' ? note : null;
    return sendJson(res, 200, await service.reject(numeric(id), asReason(reason), noteText));
  }

  if (path === '/api/edit' && req.method === 'POST') {
    const { id, body } = await readJson(req);
    if (typeof body !== 'string') throw new MarketingError('Corps manquant.', 'Renvoie le champ `body`.');
    return sendJson(res, 200, await service.edit(numeric(id), body));
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Route inconnue.' }));
}

function clampCount(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 5;
  return Math.min(20, Math.max(1, Math.trunc(n)));
}

function numeric(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n)) throw new MarketingError('Identifiant invalide.', "Recharge la file.");
  return n;
}

function asReason(v: unknown): RejectReason {
  if (typeof v === 'string' && (REJECT_REASONS as readonly string[]).includes(v)) {
    return v as RejectReason;
  }
  throw new MarketingError(
    `Motif de rejet inconnu : ${String(v)}.`,
    `Motifs acceptés : ${REJECT_REASONS.join(', ')}.`,
  );
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > 1_000_000) throw new MarketingError('Corps de requête trop volumineux.', '');
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new MarketingError('JSON invalide.', 'Vérifie la requête envoyée par la page.');
  }
}

function sendJson(res: ServerResponse, code: number, payload: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/** Un message d'erreur dit ce qui casse ET quoi faire. */
function describe(err: unknown): { error: string; remediation: string } {
  if (err instanceof MarketingError) return { error: err.message, remediation: err.remediation };
  if (err instanceof Error) return { error: err.message, remediation: '' };
  return { error: String(err), remediation: '' };
}

function sendError(res: ServerResponse, err: unknown): void {
  const payload = describe(err);
  const code = err instanceof MarketingError ? 409 : 500;
  if (!res.headersSent) sendJson(res, code, payload);
  else res.end();
}

/** Point d'entrée `npm run marketing:review`. */
async function main(): Promise<void> {
  const repo = new MemoryRepo();
  for (const angle of SEED_ANGLES) await repo.insertAngle(angle);

  const port = Number(process.env.MARKETING_PORT ?? 4321);
  const token = process.env.MARKETING_ADMIN_TOKEN ?? null;
  if (!token) {
    console.log(
      "MARKETING_ADMIN_TOKEN absent : démarrage en mode démo, écoute sur 127.0.0.1 uniquement.\n" +
        "Pour un déploiement, définis le jeton et place la page derrière l'auth de l'application.",
    );
  }

  const server = createReviewServer({ repo, token });
  server.listen(port, '127.0.0.1', () => {
    console.log(`File de validation : http://127.0.0.1:${port}/admin/marketing`);
    console.log('Données en mémoire : tout disparaît à l\'arrêt du serveur.');
  });
}

const invokedDirectly =
  process.argv[1] != null && import.meta.url === new URL(process.argv[1], 'file:').href;
if (invokedDirectly) void main();
