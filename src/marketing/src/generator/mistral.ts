/**
 * Client Mistral.
 *
 * Trois modes, pilotés par `MISTRAL_MODE` :
 *  - `api`     : appel réel (défaut si `MISTRAL_API_KEY` est présente) ;
 *  - `fixture` : rejoue une réponse enregistrée, aucun réseau, aucun secret ;
 *  - `off`     : refuse de générer avec un message clair.
 *
 * Le mode fixture n'est pas un gadget de test : sans lui, obtenir un premier
 * brouillon en local demande une clé API et un compte, ce qui fait passer le
 * démarrage de cinq minutes à plusieurs heures.
 *
 * Les quatre pannes d'un appel LLM sont distinctes et traitées comme telles :
 * corps vide, refus, réponse illisible, service injoignable.
 */

import {
  EmptyGenerationError,
  GenerationParseError,
  GenerationRefusedError,
  GenerationUnavailableError,
} from '../domain/errors.ts';

export interface GeneratedParts {
  accroche: string;
  corps: string;
  contraste: string;
  aDemander: string;
}

export interface MistralClient {
  readonly model: string;
  complete(system: string, user: string): Promise<GeneratedParts>;
}

export type MistralMode = 'api' | 'fixture' | 'off';

export function resolveMode(env: NodeJS.ProcessEnv = process.env): MistralMode {
  const raw = (env.MISTRAL_MODE ?? '').toLowerCase();
  if (raw === 'fixture' || raw === 'api' || raw === 'off') return raw;
  return env.MISTRAL_API_KEY ? 'api' : 'fixture';
}

/** Un refus se reconnaît au contenu, pas au code HTTP. */
const REFUSAL_MARKERS = [
  'je ne peux pas',
  "je ne suis pas en mesure",
  'i cannot',
  "i'm sorry",
];

export function parseCompletion(raw: string): GeneratedParts {
  const text = raw.trim();
  if (text.length === 0) throw new EmptyGenerationError();

  const lower = text.toLowerCase();
  if (REFUSAL_MARKERS.some((m) => lower.startsWith(m))) {
    throw new GenerationRefusedError(text.slice(0, 200));
  }

  // Les modèles encadrent souvent le JSON d'un bloc markdown.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    throw new GenerationParseError(err instanceof Error ? err.message : String(err));
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new GenerationParseError('La réponse n\'est pas un objet JSON.');
  }

  const obj = parsed as Record<string, unknown>;
  const parts: GeneratedParts = {
    accroche: str(obj.accroche),
    corps: str(obj.corps),
    contraste: str(obj.contraste),
    aDemander: str(obj.aDemander),
  };

  if (parts.accroche === '' && parts.corps === '') throw new EmptyGenerationError();
  return parts;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Client réel. Timeout court : la file de validation ne doit pas attendre un LLM. */
export class HttpMistralClient implements MistralClient {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    model: string,
    apiKey: string,
    baseUrl = 'https://api.mistral.ai/v1/chat/completions',
    timeoutMs = 30_000,
  ) {
    this.model = model;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  async complete(system: string, user: string): Promise<GeneratedParts> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.4,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new GenerationUnavailableError(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new GenerationUnavailableError(`HTTP ${res.status} ${detail.slice(0, 200)}`);
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch (err) {
      throw new GenerationParseError(err instanceof Error ? err.message : String(err));
    }

    const content = (payload as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
      ?.message?.content;
    if (typeof content !== 'string') {
      throw new GenerationParseError('Champ `choices[0].message.content` absent ou non textuel.');
    }
    return parseCompletion(content);
  }
}

/**
 * Client de fixture. Produit un texte plausible à partir du payload de l'angle,
 * sans réseau. Il ne cite jamais d'article : c'est le formatter qui les ajoute,
 * donc la sortie passe le validateur comme le ferait une vraie génération propre.
 */
export class FixtureMistralClient implements MistralClient {
  readonly model = 'fixture';

  async complete(_system: string, user: string): Promise<GeneratedParts> {
    const data = extractAngleData(user);
    const clause = pick(data, 'clauseType') || 'clause';
    const exemple = pick(data, 'exempleTypique');
    const coince = pick(data, 'pourquoiCaCoince');
    const llm = pick(data, 'cePourquoiUnLlmGeneralisteEchoue');
    const demander = pick(data, 'quoiDemander');

    return {
      accroche: `Cette ${clause} passe inaperçue dans neuf contrats sur dix.`,
      corps: [exemple, coince].filter(Boolean).join(' ') || `Une ${clause} mal rédigée coûte cher.`,
      contraste: llm || "Un assistant généraliste signale le risque sans dire sur quoi il repose.",
      aDemander: demander || 'Demande une rédaction délimitée et réciproque.',
    };
  }
}

/** Relit le bloc de données du prompt utilisateur. Simple et suffisant pour une fixture. */
function extractAngleData(user: string): Record<string, unknown> {
  const m = user.match(/<<<ANGLE_DATA>>>\s*([\s\S]*?)\s*<<<ANGLE_DATA>>>/);
  if (!m?.[1]) return {};
  try {
    const parsed: unknown = JSON.parse(m[1]);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function pick(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === 'string' ? v : '';
}

export function createClient(env: NodeJS.ProcessEnv = process.env): MistralClient {
  const mode = resolveMode(env);
  if (mode === 'fixture') return new FixtureMistralClient();
  if (mode === 'off') {
    throw new GenerationUnavailableError(
      'MISTRAL_MODE=off. Passe en `fixture` pour travailler hors ligne ou en `api` avec une clé.',
    );
  }
  const key = env.MISTRAL_API_KEY;
  if (!key) {
    throw new GenerationUnavailableError(
      'MISTRAL_API_KEY absente alors que MISTRAL_MODE=api. Renseigne la clé ou passe en `fixture`.',
    );
  }
  return new HttpMistralClient(env.MISTRAL_MODEL ?? 'mistral-large-latest', key);
}
