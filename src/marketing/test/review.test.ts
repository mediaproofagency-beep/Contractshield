import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRepo } from '../src/repo/memory.ts';
import { SEED_ANGLES } from '../src/angles/seed.ts';
import { generateOne } from '../src/generator/generate.ts';
import { FixtureMistralClient } from '../src/generator/mistral.ts';
import { ReviewService, STALE_AFTER_HOURS } from '../src/review/service.ts';
import { StaleItemError, UnvalidatedContentError } from '../src/domain/errors.ts';
import { LEGAL_MENTION } from '../src/generator/validate.ts';

async function setup() {
  const repo = new MemoryRepo();
  for (const a of SEED_ANGLES) await repo.insertAngle(a);
  const service = new ReviewService(repo);
  const { item } = await generateOne({ repo, client: new FixtureMistralClient() });
  return { repo, service, item };
}

describe('file de validation', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('range les items par onglet', async () => {
    const view = await ctx.service.queue();
    expect(view.counts.pending).toBe(1);
    expect(view.counts.blocked).toBe(0);
    expect(view.pending[0]?.approvable).toBe(true);
  });

  it('approuve et trace qui a décidé', async () => {
    const approved = await ctx.service.approve(ctx.item.id, 'owner');
    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe('owner');
    expect(approved.approvedAt).toBeInstanceOf(Date);
  });

  it('refuse la seconde approbation du même item', async () => {
    // Le double-clic et le second onglet passent par ici.
    await ctx.service.approve(ctx.item.id, 'owner');
    await expect(ctx.service.approve(ctx.item.id, 'owner')).rejects.toThrow(StaleItemError);
  });

  it('annule une approbation dans la fenêtre d’undo', async () => {
    await ctx.service.approve(ctx.item.id, 'owner');
    const back = await ctx.service.undoApprove(ctx.item.id);
    expect(back.status).toBe('pending_review');
    expect(back.approvedBy).toBeNull();
  });

  it('refuse d’approuver un item que le validateur bloque', async () => {
    const { repo, service } = ctx;
    const bad = await repo.insertItem({
      angleId: 1,
      channel: 'linkedin',
      format: 'clause',
      body: "L'article 9999 dit tout.",
      generatedBy: 'test',
      validationErrors: [{ code: 'unknown_article', message: 'article inconnu' }],
    });
    expect(bad.status).toBe('draft');
    await expect(service.approve(bad.id, 'owner')).rejects.toThrow(UnvalidatedContentError);
  });

  it('revalide après une édition humaine et rebloque si nécessaire', async () => {
    // Le trou que l'édition ouvrait sur le validateur.
    const truqué = `${ctx.item.body}\n\nVoir aussi l'article 9999 du Code civil.`;
    const { item, errors } = await ctx.service.edit(ctx.item.id, truqué);
    expect(errors.some((e) => e.code === 'unknown_article')).toBe(true);
    expect(item.status).toBe('draft');
    expect(item.editCount).toBe(1);
    await expect(ctx.service.approve(item.id, 'owner')).rejects.toThrow(UnvalidatedContentError);
  });

  it('laisse repartir en revue une édition propre', async () => {
    const propre = ctx.item.body.replace('Cette', 'Voici pourquoi cette');
    const { item, errors } = await ctx.service.edit(ctx.item.id, propre);
    expect(errors).toEqual([]);
    expect(item.status).toBe('pending_review');
    const approved = await ctx.service.approve(item.id, 'owner');
    expect(approved.status).toBe('approved');
  });

  it('refuse une édition qui retire la mention légale', async () => {
    const sansMention = ctx.item.body.replace(LEGAL_MENTION, '');
    const { item, errors } = await ctx.service.edit(ctx.item.id, sansMention);
    expect(errors.some((e) => e.code === 'missing_legal_mention')).toBe(true);
    expect(item.status).toBe('draft');
  });

  it('enregistre le motif du rejet', async () => {
    const rejected = await ctx.service.reject(ctx.item.id, 'ton', 'trop sec');
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectedReason).toBe('ton');
    expect(rejected.reviewNote).toBe('trop sec');
  });

  it('retire l’angle après deux rejets', async () => {
    const { repo, service } = ctx;
    await service.reject(ctx.item.id, 'angle_faible');
    const second = await generateOne({ repo, angleId: ctx.item.angleId, client: new FixtureMistralClient() });
    // Le doublon renvoie l'item existant, déjà rejeté : on en crée un distinct.
    const other = await repo.insertItem({
      angleId: ctx.item.angleId,
      channel: 'brevo',
      format: 'clause',
      body: `Autre corps. ${LEGAL_MENTION}`,
      generatedBy: 'test',
      validationErrors: null,
    });
    await service.reject(other.id, 'angle_faible');
    const angle = await repo.getAngle(ctx.item.angleId);
    expect(angle?.status).toBe('retired');
    expect(second.item.id).toBeDefined();
  });

  it('signale un item qui vieillit en attente', async () => {
    const { repo } = ctx;
    const late = new Date(Date.now() + (STALE_AFTER_HOURS + 1) * 3_600_000);
    const service = new ReviewService(repo, () => late);
    const view = await service.queue();
    expect(view.pending[0]?.stale).toBe(true);
  });
});
