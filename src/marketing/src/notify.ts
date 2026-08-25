/**
 * Alertes et digest.
 *
 * Deux principes hérités de la revue :
 *
 *  1. **Un message dit quoi faire.** « auth / 401 » à 7 h du matin oblige à ouvrir
 *     la base. Chaque alerte porte donc sa remédiation en français.
 *  2. **L'absence d'alerte est ambiguë.** Silence peut vouloir dire « tout va
 *     bien » ou « le cron est mort ». Le digest quotidien lève cette ambiguïté :
 *     il part même quand il n'y a rien à signaler.
 *
 * Le canal d'alerte ne doit pas être le même fournisseur que celui qu'on publie :
 * une panne Brevo rendrait les alertes muettes au moment où on en a le plus
 * besoin. `WEBHOOK_ALERT_URL` est ce second canal indépendant.
 */

import { redact } from './oauth/crypto.ts';
import type { Alert, TickReport } from './scheduler/tick.ts';

export interface Notifier {
  alert(a: Alert): Promise<void>;
  digest(report: DigestInput): Promise<void>;
}

export interface DigestInput {
  date: string;
  published: number;
  failed: number;
  pending: number;
  blocked: number;
  reconciled: number;
  tokenExpiresInDays: number | null;
}

export function formatAlert(a: Alert): string {
  const prefix = { info: 'INFO', warn: 'ATTENTION', critical: 'CRITIQUE' }[a.level];
  const lines = [`[${prefix}] ${a.message}`];
  if (a.remediation) lines.push(`À faire : ${a.remediation}`);
  if (a.itemId != null) lines.push(`Item : #${a.itemId}`);
  return redact(lines.join('\n'));
}

export function formatDigest(d: DigestInput): string {
  const lines = [
    `Marketing ContractShield — ${d.date}`,
    `Publiés ${d.published} · Échecs ${d.failed} · En attente ${d.pending} · Bloqués ${d.blocked}`,
  ];
  if (d.reconciled > 0) {
    lines.push(`${d.reconciled} item(s) à réconcilier : vérifie ton profil LinkedIn.`);
  }
  if (d.tokenExpiresInDays != null && d.tokenExpiresInDays <= 14) {
    lines.push(`Jeton LinkedIn : ${Math.ceil(d.tokenExpiresInDays)} jour(s) restants.`);
  }
  if (d.published === 0 && d.failed === 0 && d.pending === 0) {
    lines.push('Rien à publier aujourd\'hui. Ce message prouve que le cron tourne.');
  }
  return lines.join('\n');
}

/** Écrit sur la sortie standard. Le cron redirige vers un fichier ou un mail. */
export class ConsoleNotifier implements Notifier {
  async alert(a: Alert): Promise<void> {
    const out = a.level === 'critical' ? console.error : console.log;
    out(formatAlert(a));
  }

  async digest(d: DigestInput): Promise<void> {
    console.log(formatDigest(d));
  }
}

/**
 * Poste sur un webhook indépendant du canal publié.
 * Une panne de ce webhook ne doit pas empêcher le tick de se terminer : l'échec
 * est journalisé, pas propagé.
 */
export class WebhookNotifier implements Notifier {
  private readonly url: string;
  private readonly fallback: Notifier;

  constructor(url: string, fallback: Notifier = new ConsoleNotifier()) {
    this.url = url;
    this.fallback = fallback;
  }

  private async post(text: string, fallbackCall: () => Promise<void>): Promise<void> {
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error(
        `[notify] webhook injoignable (${err instanceof Error ? err.message : String(err)}), repli sur la console.`,
      );
      await fallbackCall();
    }
  }

  async alert(a: Alert): Promise<void> {
    await this.post(formatAlert(a), () => this.fallback.alert(a));
  }

  async digest(d: DigestInput): Promise<void> {
    await this.post(formatDigest(d), () => this.fallback.digest(d));
  }
}

export function createNotifier(env: NodeJS.ProcessEnv = process.env): Notifier {
  const url = env.WEBHOOK_ALERT_URL;
  return url ? new WebhookNotifier(url) : new ConsoleNotifier();
}

export async function emitAlerts(notifier: Notifier, report: TickReport): Promise<void> {
  for (const a of report.alerts) await notifier.alert(a);
}
