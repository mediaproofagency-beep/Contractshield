import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRepo } from '../src/repo/memory.ts';
import { SEED_ANGLES } from '../src/angles/seed.ts';
import { generateBatch, generateOne } from '../src/generator/generate.ts';
import {
  EmptyGenerationError,
  GenerationParseError,
  GenerationRefusedError,
  NoActiveAngleError,
} from '../src/domain/errors.ts';
import { FixtureMistralClient, parseCompletion } from '../src/generator/mistral.ts';
import { LEGAL_MENTION } from '../src/generator/validate.ts';
import type { MistralClient } from '../src/generator/mistral.ts';

async function seeded(): Promise<MemoryRepo> {
  const repo = new MemoryRepo();
  for (const a of SEED_ANGLES) await repo.insertAngle(a);
  return repo;
}

describe('parseCompletion', () => {
  it('accepte un JSON nu', () => {
    const p = parseCompletion('{"accroche":"a","corps":"b","contraste":"c","aDemander":"d"}');
    expect(p.accroche).toBe('a');
  });

  it('accepte un JSON encadré par un bloc markdown', () => {
    const p = parseCompletion('```json\n{"accroche":"a","corps":"b"}\n```');
    expect(p.corps).toBe('b');
  });

  it('distingue le corps vide', () => {
    expect(() => parseCompletion('   ')).toThrow(EmptyGenerationError);
    expect(() => parseCompletion('{"accroche":"","corps":""}')).toThrow(EmptyGenerationError);
  });

  it('distingue le refus du modèle', () => {
    expect(() => parseCompletion("Je ne peux pas répondre à cette demande.")).toThrow(
      GenerationRefusedError,
    );
  });

  it('distingue la réponse illisible', () => {
    expect(() => parseCompletion('{ ceci nest pas du json')).toThrow(GenerationParseError);
  });
});

describe('generateOne', () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    repo = await seeded();
  });

  it('produit un item validé, prêt pour la revue humaine', async () => {
    const { item, blocked } = await generateOne({ repo, client: new FixtureMistralClient() });
    expect(blocked).toBe(false);
    expect(item.status).toBe('pending_review');
    expect(item.validationErrors).toBeNull();
  });

  it('injecte la mention légale et les liens, que le modèle n’écrit jamais', async () => {
    const { item } = await generateOne({ repo, client: new FixtureMistralClient() });
    expect(item.body).toContain(LEGAL_MENTION);
    expect(item.body).toContain('legifrance.gouv.fr');
  });

  it('bloque en draft un contenu dont les citations ne tiennent pas', async () => {
    // Le modèle glisse un article inventé dans sa prose : il ne doit pas atteindre la revue.
    const menteur: MistralClient = {
      model: 'test-menteur',
      async complete() {
        return {
          accroche: "Cette clause est contestable.",
          corps: "L'article 9999 du Code civil le dit clairement.",
          contraste: 'Un assistant généraliste reste vague.',
          aDemander: 'Demande une rédaction délimitée.',
        };
      },
    };
    const { item, blocked } = await generateOne({ repo, client: menteur });
    expect(blocked).toBe(true);
    expect(item.status).toBe('draft');
    expect(item.validationErrors?.[0]?.code).toBe('unknown_article');
  });

  it('n’invente pas d’angle quand la banque est vide', async () => {
    const vide = new MemoryRepo();
    await expect(generateOne({ repo: vide, client: new FixtureMistralClient() })).rejects.toThrow(
      NoActiveAngleError,
    );
  });

  it('ne crée pas de doublon pour un corps identique sur le même canal', async () => {
    const first = await generateOne({ repo, angleId: 1, client: new FixtureMistralClient() });
    const second = await generateOne({ repo, angleId: 1, client: new FixtureMistralClient() });
    expect(second.duplicate).toBe(true);
    expect(second.item.id).toBe(first.item.id);
  });
});

describe('generateBatch', () => {
  it('produit une semaine de contenu à partir de trois angles', async () => {
    const repo = await seeded();
    const { results, failures } = await generateBatch({
      repo,
      count: 5,
      client: new FixtureMistralClient(),
    });
    expect(failures).toHaveLength(0);
    expect(results).toHaveLength(5);
    // Cinq items distincts : les couples (angle, format) ne se répètent pas.
    expect(new Set(results.map((r) => r.item.id)).size).toBe(5);
  });

  it('renvoie une erreur unique et claire quand la banque est vide', async () => {
    const { results, failures } = await generateBatch({
      repo: new MemoryRepo(),
      count: 5,
      client: new FixtureMistralClient(),
    });
    expect(results).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(NoActiveAngleError);
  });
});
