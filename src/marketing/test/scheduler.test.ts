import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRepo } from '../src/repo/memory.ts';
import { SEED_ANGLES } from '../src/angles/seed.ts';
import { generateOne } from '../src/generator/generate.ts';
import { FixtureMistralClient } from '../src/generator/mistral.ts';
import { ReviewService } from '../src/review/service.ts';
import { ConsolePublisher } from '../src/publisher/console.ts';
import { tick } from '../src/scheduler/tick.ts';
import {
  backoffFor,
  checkQuota,
  isWithinGrace,
  nextAttemptAt,
  utcDayBounds,
} from '../src/scheduler/rate-limit.ts';
import type { ContentItem } from '../src/domain/types.ts';
import type { Publisher, PublishResult } from '../src/publisher/types.ts';

const silent = () => {};

async function setup(count = 1) {
  const repo = new MemoryRepo();
  for (const a of SEED_ANGLES) await repo.insertAngle(a);
  const service = new ReviewService(repo);
  const items: ContentItem[] = [];
  for (let i = 0; i < count; i++) {
    const { item } = await generateOne({
      repo,
      angleId: (i % SEED_ANGLES.length) + 1,
      format: i % 2 === 0 ? 'duel' : 'clause',
      client: new FixtureMistralClient(),
    });
    items.push(await service.approve(item.id, 'owner'));
  }
  return { repo, service, items };
}

/** Adaptateur programmable, pour exercer chaque mode de panne. */
function stub(result: PublishResult | (() => Promise<PublishResult>)): Publisher {
  return {
    channel: 'linkedin',
    supportedFormats: ['duel', 'clause', 'cas_usage'],
    async capabilities(ctx) {
      return { canDirectPublish: true, probedAt: ctx.now };
    },
    async validate() {
      return { ok: true, errors: [] };
    },
    async publish() {
      return typeof result === 'function' ? result() : result;
    },
  };
}

describe('limitation de débit', () => {
  it('refuse au-delà du quota du jour', () => {
    expect(checkQuota(0, 'linkedin').allowed).toBe(true);
    expect(checkQuota(1, 'linkedin').allowed).toBe(false);
    expect(checkQuota(2, 'linkedin', 5).allowed).toBe(true);
  });

  it('recule de plus en plus, puis plafonne', () => {
    expect(backoffFor(1)).toBeLessThan(backoffFor(2));
    expect(backoffFor(3)).toBe(backoffFor(99));
  });

  it('respecte Retry-After quand la plateforme le donne', () => {
    const now = new Date('2026-08-24T10:00:00Z');
    const retryAfter = new Date('2026-08-24T10:30:00Z');
    expect(nextAttemptAt(1, now, retryAfter).toISOString()).toBe(retryAfter.toISOString());
    // Un Retry-After déjà passé ne raccourcit pas le recul.
    const past = new Date('2026-08-24T09:00:00Z');
    expect(nextAttemptAt(1, now, past).getTime()).toBeGreaterThan(now.getTime());
  });

  it('ferme la fenêtre de grâce au-delà de deux heures', () => {
    const now = new Date('2026-08-24T12:00:00Z');
    expect(isWithinGrace(new Date('2026-08-24T11:00:00Z'), now)).toBe(true);
    expect(isWithinGrace(new Date('2026-08-24T09:00:00Z'), now)).toBe(false);
    // Une heure future n'est pas « en retard » : elle n'est simplement pas due.
    expect(isWithinGrace(new Date('2026-08-24T13:00:00Z'), now)).toBe(false);
  });

  it('borne la journée en UTC, sans surprise d’heure d’été', () => {
    // 2026-03-29 est le passage à l'heure d'été en Europe : en UTC, rien ne bouge.
    const { start, end } = utcDayBounds(new Date('2026-03-29T01:30:00Z'));
    expect(start.toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(86_400_000);
  });
});

describe('tick', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup(1);
  });

  it('publie un item approuvé et le marque', async () => {
    const report = await tick({
      repo: ctx.repo,
      publisher: new ConsolePublisher(),
      dryRun: true,
      log: silent,
    });
    expect(report.published).toBe(1);
    const item = await ctx.repo.getItem(ctx.items[0]!.id);
    expect(item?.status).toBe('published');
    expect(item?.externalId).toBeTruthy();
    expect(item?.leaseUntil).toBeNull();
  });

  it('ne publie rien quand l’interrupteur est fermé', async () => {
    const report = await tick({
      repo: ctx.repo,
      publisher: new ConsolePublisher(),
      enabled: false,
      log: silent,
    });
    expect(report.published).toBe(0);
    const item = await ctx.repo.getItem(ctx.items[0]!.id);
    expect(item?.status).toBe('approved');
  });

  it('ne regarde jamais un item non approuvé', async () => {
    const { repo } = await setup(0);
    const { item } = await generateOne({ repo, client: new FixtureMistralClient() });
    expect(item.status).toBe('pending_review');
    const report = await tick({ repo, publisher: new ConsolePublisher(), log: silent });
    expect(report.examined).toBe(0);
    expect(report.published).toBe(0);
  });

  it('respecte le quota quotidien', async () => {
    const two = await setup(2);
    const first = await tick({ repo: two.repo, publisher: new ConsolePublisher(), log: silent });
    expect(first.published).toBe(1);
    const second = await tick({ repo: two.repo, publisher: new ConsolePublisher(), log: silent });
    expect(second.published).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
  });

  it('deux ticks concurrents ne publient qu’une fois', async () => {
    // Le cas qui compte : le claim par bail, pas l'index unique de contenu.
    const slow = stub(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return {
        ok: true,
        mode: 'direct' as const,
        status: 'done' as const,
        retryable: false,
        externalId: 'urn:li:share:1',
      };
    });
    const [a, b] = await Promise.all([
      tick({ repo: ctx.repo, publisher: slow, workerId: 'w1', log: silent }),
      tick({ repo: ctx.repo, publisher: slow, workerId: 'w2', log: silent }),
    ]);
    expect(a.published + b.published).toBe(1);
  });

  it('met le canal en pause sur une erreur d’authentification, sans rejouer', async () => {
    const report = await tick({
      repo: ctx.repo,
      publisher: stub({
        ok: false,
        mode: 'direct',
        status: 'done',
        retryable: false,
        errorClass: 'auth',
        errorDetail: '401',
        remediation: 'Reconnecte LinkedIn.',
      }),
      log: silent,
    });
    expect(report.failed).toBe(1);
    const item = await ctx.repo.getItem(ctx.items[0]!.id);
    // Retour en revue humaine, pas de nouvelle tentative en boucle.
    expect(item?.status).toBe('pending_review');
    expect(report.alerts.some((a) => a.level === 'critical')).toBe(true);
  });

  it('replanifie après un 429 sans alerter', async () => {
    const report = await tick({
      repo: ctx.repo,
      publisher: stub({
        ok: false,
        mode: 'direct',
        status: 'done',
        retryable: true,
        errorClass: 'rate_limit',
        errorDetail: '429',
      }),
      log: silent,
    });
    expect(report.published).toBe(0);
    const item = await ctx.repo.getItem(ctx.items[0]!.id);
    expect(item?.status).toBe('scheduled');
    expect(item?.scheduledAt).toBeInstanceOf(Date);
    expect(report.alerts).toHaveLength(0);
  });

  it('écrit la tentative avant l’appel réseau', async () => {
    await tick({
      repo: ctx.repo,
      publisher: stub(async () => {
        // Au moment de l'appel, la trace doit déjà exister.
        const attempts = await ctx.repo.listAttempts(ctx.items[0]!.id);
        expect(attempts).toHaveLength(1);
        expect(attempts[0]?.finishedAt).toBeNull();
        return {
          ok: true,
          mode: 'direct' as const,
          status: 'done' as const,
          retryable: false,
          externalId: 'urn:li:share:2',
        };
      }),
      log: silent,
    });
    const attempts = await ctx.repo.listAttempts(ctx.items[0]!.id);
    expect(attempts[0]?.finishedAt).toBeInstanceOf(Date);
    expect(attempts[0]?.externalId).toBe('urn:li:share:2');
  });

  it('ne rejoue jamais un bail expiré : il part en réconciliation', async () => {
    // Simule un worker mort entre l'appel et l'écriture.
    const id = ctx.items[0]!.id;
    const past = new Date(Date.now() - 60_000);
    await ctx.repo.claim({ id, workerId: 'mort', leaseUntil: past, now: new Date(Date.now() - 120_000) });
    await ctx.repo.startAttempt({ contentItemId: id, adapter: 'linkedin', attemptNo: 1, startedAt: past });

    const report = await tick({ repo: ctx.repo, publisher: new ConsolePublisher(), log: silent });
    expect(report.reconciled).toBe(1);
    const item = await ctx.repo.getItem(id);
    expect(item?.status).toBe('pending_review');
    expect(item?.reviewNote).toContain('needs_reconcile');
    expect(report.alerts.some((a) => a.level === 'critical')).toBe(true);
  });

  it('renvoie en revue un item dont l’heure est passée depuis trop longtemps', async () => {
    const id = ctx.items[0]!.id;
    await ctx.repo.schedule(id, new Date(Date.now() - 5 * 60 * 60 * 1000));
    const report = await tick({ repo: ctx.repo, publisher: new ConsolePublisher(), log: silent });
    expect(report.published).toBe(0);
    const item = await ctx.repo.getItem(id);
    expect(item?.status).toBe('pending_review');
    expect(item?.reviewNote).toContain('dépassée');
  });

  it('ne marque pas publié une réponse sans identifiant', async () => {
    const report = await tick({
      repo: ctx.repo,
      publisher: stub({
        ok: false,
        mode: 'direct',
        status: 'done',
        retryable: false,
        errorClass: 'platform',
        errorDetail: 'sans x-restli-id',
        remediation: 'Vérifie le profil.',
      }),
      log: silent,
    });
    expect(report.published).toBe(0);
    const item = await ctx.repo.getItem(ctx.items[0]!.id);
    expect(item?.status).not.toBe('published');
  });
});
