# Plan technique — Système marketing ContractShield

Branche : `claude/gstack-install-setup-7qfx5l`
Source : `docs/designs/distribution-contenu-preuve-avant-megaphone.md` (statut APPROVED)
Statut : APPROUVÉ après revue /autoplan (2026-08-24), révisé au gate final

## Objectif

Un système qui génère, fait valider et diffuse du contenu ContractShield sur LinkedIn,
Brevo, et plus tard TikTok et Facebook, sans qu'aucun contenu ne parte sans validation
humaine, et sans qu'un canal non autorisé fasse échouer la chaîne.

## Rappel des contraintes du design doc

Le design doc conclut que le pipeline automatisé (approche B) attend le résultat du banc
d'essai manuel (approche A). Ce plan décrit B. La réconciliation est en `Phasage` :
l'étape 0 du plan construit le banc d'essai, qui est aussi l'ingest de la banque
d'angles. Le même composant sert les deux.

## Exigences non négociables (fondateur)

| # | Exigence | Où elle est traitée |
|---|----------|---------------------|
| R1 | Séparation stricte génération / diffusion, machine à états en base | `Modèle de données`, `Machine à états` |
| R2 | Human-in-the-loop obligatoire, 5 min/jour | `Interface de validation` |
| R3 | Architecture par adaptateurs, un canal = un fichier | `Contrat Publisher` |
| R4 | Dégradation gracieuse (TikTok non audité, token expiré) | `Dégradation gracieuse` |
| R5 | OAuth avec refresh auto et alerte avant expiration | `Gestion des tokens` |
| R6 | Banque de contenu source réelle, pas de texte générique | `Banque d'angles` |

Stack imposée : TypeScript, Drizzle, MariaDB, tRPC, VPS Scaleway existant. Aucune
nouvelle infra sans justification écrite dans ce plan.

## Architecture

```
                    ┌──────────────────────────────────────────┐
                    │  SOURCES (R6)                            │
                    │  analyses anonymisées (agrégats)         │
                    │  Légifrance / PISTE (texte + URL)        │
                    │  cas d'usage freelance (saisie manuelle) │
                    └───────────────────┬──────────────────────┘
                                        │ ingest
                                        ▼
                            ┌───────────────────────┐
                            │  content_angles       │
                            │  (banque d'angles)    │
                            └───────────┬───────────┘
                                        │ sélection pondérée
                                        ▼
  ┌────────────────┐          ┌───────────────────────┐
  │  Mistral       │◄─────────┤  generator/           │
  │  (grounded)    │          │  prompt = angle +     │
  └────────────────┘          │  legal_refs           │
                              └───────────┬───────────┘
                                          │ draft
                                          ▼
                              ┌───────────────────────┐
                              │  citation validator   │  ← refuse tout article
                              │  (bloquant)           │    absent de legal_refs
                              └───────────┬───────────┘
                                          │ pending_review
                                          ▼
                              ┌───────────────────────┐
                              │  content_items        │  ← LA frontière
                              │  (machine à états)    │    génération | diffusion
                              └───────────┬───────────┘
                                          │ approved (humain, R2)
                                          ▼
                              ┌───────────────────────┐
                              │  scheduler/tick.ts    │  cron + claim par bail
                              └───────────┬───────────┘
                                          │ ne lit QUE status=approved|scheduled
                                          ▼
                    ┌─────────────────────┴─────────────────────┐
                    │           publisher/registry.ts           │
                    └──┬───────────┬────────────┬───────────────┘
                       ▼           ▼            ▼           ▼
                  linkedin.ts  brevo.ts   tiktok.ts   facebook.ts
                       │           │            │           │
                       └───────────┴─────┬──────┴───────────┘
                                         ▼
                              ┌───────────────────────┐
                              │  publish_attempts     │  audit + retry + dégradation
                              └───────────────────────┘
```

Arborescence :

```
src/marketing/
  db/schema.ts              tables Drizzle
  angles/ingest.ts          sources → content_angles
  angles/select.ts          sélection pondérée fréquence / récence
  generator/generate.ts     angle → draft (Mistral, grounded)
  generator/formats/        duel.ts, clause.ts, cas-usage.ts
  generator/validate.ts     validateur de citations (bloquant)
  review/router.ts          routes tRPC de la file
  publisher/types.ts        interface Publisher
  publisher/registry.ts     canal → adaptateur (1 ligne par canal)
  publisher/linkedin.ts
  publisher/brevo.ts
  publisher/tiktok.ts
  publisher/facebook.ts
  oauth/store.ts            chiffrement, lecture, écriture
  oauth/refresh.ts          job de refresh + alertes
  scheduler/tick.ts         worker cron
  notify.ts                 alertes fondateur
```

## Modèle de données (Drizzle / MariaDB)

**`content_angles`** — la banque de contenu source (R6)

| colonne | type | note |
|---|---|---|
| id | bigint PK | |
| kind | enum(`clause_abusive`,`jurisprudence`,`cas_usage`,`duel_llm`) | |
| title | varchar(200) | |
| payload | json | données de l'angle, jamais de texte de contrat client verbatim |
| legal_refs | json | `[{code, article, url, fetched_at}]` |
| frequency_score | int | nb d'occurrences dans les analyses agrégées |
| source_kind | enum(`aggregate`,`legifrance`,`manual`,`public_template`) | |
| last_used_at | datetime NULL | |
| status | enum(`active`,`retired`) | `retired` après 2 rejets humains |
| created_at / updated_at | datetime | |

**`content_items`** — la file (R1)

Corrigé en revue : ajout de `locked_by`, `lease_until`, `version`, `approved_by`,
`approved_at`, `rejected_reason` (liste courte), et `UNIQUE(channel, external_id)`.
Le claim de publication se fait par bail sur la ligne, pas par changement de statut, ce
qui préserve exactement la liste de statuts imposée par R1.

| colonne | type | note |
|---|---|---|
| id | bigint PK | |
| angle_id | bigint FK → content_angles | un item vient toujours d'un angle |
| channel | enum(`linkedin`,`brevo`,`tiktok`,`facebook`) | |
| format | enum(`duel`,`clause`,`cas_usage`) | |
| status | enum(`draft`,`pending_review`,`approved`,`scheduled`,`published`,`failed`,`rejected`) | |
| publish_mode | enum(`direct`,`draft`) NULL | rempli à la publication, porte la dégradation |
| body | text | |
| media_ref | varchar(255) NULL | |
| body_hash | char(64) UNIQUE(channel, body_hash) | anti-doublon |
| validation_errors | json NULL | sortie du validateur de citations |
| scheduled_at | datetime NULL | |
| published_at | datetime NULL | |
| external_id | varchar(191) NULL | id renvoyé par la plateforme |
| review_note | text NULL | motif de rejet |
| generated_by | varchar(100) | modèle + version du prompt |
| attempt_count | int default 0 | |
| created_at / updated_at | datetime | |

Index : `(status, scheduled_at)` pour le scheduler, `(channel, body_hash)` unique,
`(angle_id, created_at)`.

**`publish_attempts`** — audit et retry (R4)

id, content_item_id FK, adapter, attempt_no, request_hash, response_code, error_class
(enum `auth`,`rate_limit`,`validation`,`network`,`platform`,`unknown`), error_detail text,
degraded_mode bool, created_at. Une ligne est écrite **avant** l'appel réseau et
complétée après, pour qu'un crash en plein appel soit détectable.

**`oauth_tokens`** — R5

id, provider, account_ref, access_token_enc blob, refresh_token_enc blob, scopes json,
access_expires_at, refresh_expires_at, last_refreshed_at, status enum(`active`,
`expiring`,`expired`,`revoked`), last_alert_at, alert_level int.

**`channel_capabilities`** — dégradation déclarative (R4)

provider PK, can_direct_publish bool, probed_at, probe_result json, notes text.
Sondée au démarrage du worker et rafraîchie toutes les 24 h. C'est cette table, pas un
`if (provider === 'tiktok')` dans le code, qui décide du mode.

## Ordonnancement et unicité de publication (corrigé en revue)

`GET_LOCK` de MariaDB est lié à la **connexion**, pas à la transaction. Avec le pool
mysql2 de Drizzle, la connexion qui prend le verrou n'est pas forcément celle qui exécute
le tick, et une coupure réseau libère le verrou côté serveur pendant que le worker tourne
encore. Deux workers actifs sans le savoir. `GET_LOCK` reste utile comme optimisation,
il n'est pas la garantie.

La garantie est un **claim atomique par ligne** :

```sql
UPDATE content_items
   SET locked_by = ?, lease_until = NOW() + INTERVAL 5 MINUTE, version = version + 1
 WHERE id = ? AND status IN ('approved','scheduled') AND (lease_until IS NULL OR lease_until < NOW());
-- publication seulement si affectedRows = 1
```

Un bail expiré sans `published_at` n'est **jamais** rejoué à l'aveugle : l'item repart en
`pending_review` avec le motif `needs_reconcile`, et un humain tranche. Republier
automatiquement après un crash en plein appel est le scénario du double post.

## Machine à états (R1)

```
  draft ──validate ok──► pending_review ──humain──► approved ──planif──► scheduled
    │                          │                       │                    │
    │ validate ko              │ humain rejette        │                    │ publish
    ▼                          ▼                       │                    ▼
  draft (bloqué,               rejected ◄──────────────┘              published
  validation_errors)                                                       │
                                                                    échec  ▼
                                                                        failed
                                                                     (retry ≤ 3,
                                                                   puis pending_review)
```

Règles dures :
- Le scheduler ne lit **que** `status IN ('approved','scheduled')`. Une requête sur un
  autre statut est un bug, couverte par un test.
- Aucune transition n'est écrite par le générateur au-delà de `draft` → `pending_review`.
- `rejected` est un ajout par rapport à la liste initiale du fondateur. Justification :
  sans lui, un rejet humain est perdu, l'angle est resélectionné et le même contenu
  revient dans la file le lendemain. Le rejet nourrit `content_angles.status = retired`.
- `publish_mode` porte la dégradation. Un item publié en brouillon TikTok est
  `published` avec `publish_mode='draft'`, jamais `failed` : le système a fait ce qu'il
  pouvait, et le fondateur est notifié.

## Contrat Publisher (R3)

```ts
export type Channel = 'linkedin' | 'brevo' | 'tiktok' | 'facebook';
export type PublishMode = 'direct' | 'draft';

export interface ChannelCapability {
  canDirectPublish: boolean;
  reason?: string;              // "audit video.publish non validé"
  probedAt: Date;
}

export interface PublishResult {
  ok: boolean;
  mode: PublishMode;            // ce qui a réellement été fait
  externalId?: string;
  degraded?: { reason: string };
  retryable: boolean;
  errorClass?: 'auth' | 'rate_limit' | 'validation' | 'network' | 'platform' | 'unknown';
  errorDetail?: string;
}

export interface Publisher {
  readonly channel: Channel;
  capabilities(): Promise<ChannelCapability>;
  validate(item: ContentItem): { ok: boolean; errors: string[] };
  publish(item: ContentItem, ctx: PublishContext): Promise<PublishResult>;
}
```

Ajouter un canal = créer `publisher/<canal>.ts` exportant un `Publisher`, plus une ligne
dans `registry.ts` et une valeur dans l'enum `channel`. Ce n'est pas littéralement un
seul fichier : c'est un fichier plus deux lignes (registre, enum) plus une migration
Drizzle pour l'enum. Le dire ici évite la promesse fausse. Rien d'autre ne bouge :
scheduler, revue, retry, alertes sont agnostiques du canal.

`ctx` porte le token déchiffré, le logger redacté, et le budget de rate limit.

## Dégradation gracieuse (R4)

| Situation | Comportement | Notification |
|---|---|---|
| TikTok non audité | `capabilities().canDirectPublish=false` → `publish()` fait un `video.upload` vers les brouillons, renvoie `mode:'draft'` | mail Brevo + badge dans la file |
| Token expiré ou révoqué | `errorClass:'auth'`, item repasse en `pending_review`, canal marqué en pause, aucun retry aveugle | alerte immédiate, niveau haut |
| Rate limit | `retryable:true`, backoff exponentiel plafonné, item reste `scheduled` | alerte au 3e échec |
| Panne réseau | `retryable:true`, 3 tentatives espacées | alerte au 3e échec |
| Erreur plateforme 4xx non auth | `retryable:false` → `failed` + `review_note` | alerte immédiate |
| Worker qui meurt en plein appel | ligne `publish_attempts` orpheline détectée au tick suivant, item réconcilié via `external_id` | log, pas d'alerte |

Principe : un job ne meurt jamais en silence. Toute sortie non nominale écrit dans
`publish_attempts` et déclenche `notify.ts` selon la gravité.

## Gestion des tokens (R5)

- Chiffrement au repos AES-256-GCM, clé dans `MARKETING_TOKEN_KEY` (env du VPS, hors
  dépôt). Les tokens sont des identifiants porteurs de l'identité LinkedIn réelle du
  fondateur : les stocker en clair est un risque disproportionné pour le gain.
- LinkedIn : access token 60 jours, refresh token 365 jours. Job quotidien qui rafraîchit
  dès que l'access token descend sous 14 jours de reste.
- Alertes sur le refresh token : J-30, J-14, J-7, puis quotidienne. `alert_level` évite
  le spam et garantit qu'aucune alerte n'est avalée.
- Rotation testée : un script `oauth:rotate --provider linkedin` en dry-run pour vérifier
  le chemin de refresh sans attendre 60 jours.
- Aucun token dans les logs. Le logger du `PublishContext` redacte les motifs
  `Bearer\s+\S+`, `access_token`, `refresh_token`.

## Banque d'angles (R6)

Trois sources, aucune ne produit du texte générique :

1. **Agrégats d'analyses réelles.** Le pipeline lit les analyses passées et n'en extrait
   que des statistiques : type de clause, fréquence, gravité moyenne. Jamais le texte du
   contrat client. `source_kind='aggregate'`.
2. **Légifrance / PISTE.** Texte de l'article, numéro, URL, date de récupération.
   `source_kind='legifrance'`.
3. **Cas d'usage freelance.** Saisie manuelle depuis les conversations réelles.
   `source_kind='manual'`. Trois angles suffisent pour démarrer.

Sélection : score = `frequency_score` pondéré, pénalisé par `last_used_at` (aucun angle
réutilisé sous 30 jours), angles `retired` exclus.

Génération ancrée : le prompt Mistral reçoit l'angle et ses `legal_refs`, avec consigne
de ne citer que ces références. **Validateur bloquant** : toute référence d'article
présente dans le corps mais absente de `legal_refs` laisse l'item en `draft` avec
`validation_errors`. Une citation d'article fausse publiée sous le nom du fondateur est
pire que pas de post, c'est la question ouverte n°5 du design doc.

## Interface de validation (R2)

Page `/admin/marketing`, protégée par l'auth existante, une carte par item :

- corps du post, canal, format
- l'angle d'origine et ses références légales cliquables (vérification en un coup d'œil)
- statut du validateur de citations
- badge de dégradation si le canal est en mode brouillon

Raccourcis clavier : `J`/`K` naviguer, `A` approuver, `R` rejeter avec motif, `E` éditer
avant approbation. Volume cible : **1 post LinkedIn par jour ouvré et 1 email Brevo par
semaine**, aligné sur le design doc (décision D-03, le plan disait 6 items/jour, ce qui
contredisait la décision approuvée). Environ 30 secondes par item, donc bien sous les
5 minutes quotidiennes de R2.

Pas d'approbation en masse en v1. Un bouton « tout approuver » transforme la revue
humaine en formalité, ce qui vide R2 de son sens.

Toute édition humaine est enregistrée (`body` avant / après) : c'est le signal
d'entraînement le plus utile pour améliorer le prompt.

## Contraintes légales intégrées

- Aucun texte de contrat client verbatim dans un contenu public, même anonymisé, tant
  que la clause CGU et la base légale RGPD ne sont pas écrites. v1 : agrégats,
  Légifrance, contrats-types publics uniquement.
- Mention obligatoire sur chaque post : analyse automatisée, ne constitue pas un conseil
  juridique. Injectée par le formatter, pas laissée au modèle.

## Phasage

| Étape | Contenu | Effort humain | Effort Claude Code |
|---|---|---|---|
| 0 | Schéma Drizzle + ingest d'angles + validateur de citations + harnais de banc d'essai (20 contrats, ContractShield vs ChatGPT) | ~3 j | ~4 h |
| **GATE** | **Seuil dur (décision fondateur, D1) : moins de 8 gains nets sur 20 contrats, les étapes 1 à 3 ne démarrent pas.** | — | — |
| 1 | Générateur + formats + file + interface de validation | ~4 j | ~5 h |
| 2 | OAuth LinkedIn, adaptateur LinkedIn, adaptateur Brevo, scheduler, alertes | ~5 j | ~6 h |
| 3 | Adaptateurs TikTok et Facebook en mode brouillon, audits lancés en tâche de fond | ~3 j | ~3 h |

L'étape 0 produit le banc d'essai que le design doc exige avant toute diffusion, et ses
lignes `content_angles` sont l'entrée de l'étape 1. Le même code sert les deux besoins.

## Tests

- Machine à états : table de transitions valides / invalides, une assertion par
  transition interdite. Le test qui compte : le scheduler ne voit jamais un item non
  approuvé.
- Adaptateurs : un contrat de test partagé rejoué contre chaque implémentation
  (`publisher.contract.test.ts`), plus des doublures HTTP par canal.
- Dégradation : TikTok sans audit produit `mode:'draft'` et une notification.
- OAuth : refresh à J-14 simulé par horloge injectée, alertes J-30/14/7 vérifiées.
- Validateur de citations : un post citant un article absent de `legal_refs` reste
  bloqué en `draft`.
- Idempotence : deux ticks concurrents ne publient qu'une fois. Le test porte sur
  `affectedRows = 0` du claim perdant, pas sur l'index unique de contenu, qui ne protège
  pas de la double publication.
- Reprise après crash : `kill -9` entre l'écriture de `publish_attempts` et la réponse
  HTTP laisse un bail expiré, l'item part en `needs_reconcile`, jamais en retry.
- Re-validation après édition humaine : un corps édité repasse par le validateur de
  citations avant de pouvoir être approuvé.
- Exhaustivité du registre : chaque valeur de l'enum `channel` a un adaptateur, sinon le
  tick lève une exception toutes les minutes.
- Redaction du logger : assertion sur la sortie réelle, pas sur l'intention.
- Passage à l'heure d'été : un `scheduled_at` à 02h30 le dimanche du changement.

## Pas dans le périmètre

- Page entreprise LinkedIn (Community Management API, approbation incertaine).
- Génération de vidéo TikTok. Les adaptateurs poussent en brouillon, le montage reste
  manuel.
- Analytics d'engagement multi-canal. Le design doc retient commentaires et messages
  privés, comptés à la main en v1.
- Toute nouvelle infra : pas de Redis, pas de file de messages, pas de conteneur
  supplémentaire. MariaDB plus cron suffisent au volume visé (6 items par jour).

---

# REVUE /autoplan

Voix Codex : `[codex-unavailable]` sur les 4 phases (binaire absent de cet environnement).
Voix subagent Claude : non lancée par défaut dans cette session (pas d'agent secondaire
sans demande explicite). Mode effectif : **single-reviewer**.

## Phase 1 — Revue CEO (stratégie et périmètre)

### 0A. Challenge des prémisses

| # | Prémisse du plan | Verdict |
|---|---|---|
| Pr1 | Le pipeline de diffusion doit être construit maintenant | **CONTESTÉE** — le design doc approuvé le reporte après le banc d'essai. Voir Défi utilisateur 1. |
| Pr2 | 6 items par jour à valider | **FAUSSE** — le design doc retient 1 post par jour ouvré. Corrigé (décision D-03). |
| Pr3 | MariaDB + cron suffisent | **VALIDE** — 6 items/jour, aucune contention. Redis serait de l'infra gratuite. |
| Pr4 | Mistral produit un post publiable avec ancrage | **NON PROUVÉE** — c'est exactement ce que le banc d'essai doit établir. Dépendance dure. |
| Pr5 | `w_member_social` suffit pour publier sur le profil perso | **VALIDE** — vérifié par le fondateur. |
| Pr6 | Le fondateur validera 5 min par jour, tous les jours | **FRAGILE** — c'est le point de défaillance unique du système. Voir A2. |

### 0B. Ce qui existe déjà

Ce dépôt ne contient pas le backend. Aucune ligne de tRPC, Drizzle, MariaDB, Mistral ou
Brevo n'est vérifiable ici. Le plan suppose leur existence sur le VPS. Tant que ce n'est
pas confirmé, chaque estimation d'effort porte un risque de sous-évaluation : « réutiliser
l'auth existante » n'est pas gratuit si l'auth existante n'a pas de notion de rôle.

### 0C. État rêvé

```
AUJOURD'HUI          CE PLAN                        IDÉAL 12 MOIS
───────────          ───────                        ─────────────
produit en ligne     file validée à la main         les pages-clause captent
0 utilisateur   ──▶  LinkedIn + Brevo auto     ──▶  l'intention de signature
0 contenu            TikTok/FB en brouillon         le social est un sous-produit
                                                    le contenu vient des usages payants
```

**Delta** : le plan ne construit pas les pages-clause SEO (approche C), qui étaient
co-retenues avec A dans la décision approuvée. Voir Défi utilisateur 2.

### 0C-bis. Alternatives d'implémentation

| | Approche | Effort humain / CC | Risque | Couverture |
|---|---|---|---|---|
| Alt1 | Pipeline complet tel que décrit (étapes 0 à 3) | ~15 j / ~18 h | Moyen | 9/10 |
| Alt2 | Étape 0 seule (banque d'angles + validateur + banc d'essai), le reste après résultat | ~3 j / ~4 h | Faible | 4/10 |
| Alt3 | Banque d'angles + générateur de pages-clause SEO, canaux sociaux ensuite | ~6 j / ~7 h | Moyen | 7/10 |

Recommandation CEO : **Alt2 puis Alt3 puis Alt1**, l'ordre du design doc. Le fondateur
demande Alt1. Écart porté au Défi utilisateur 1.

### 0E. Interrogation temporelle

- **Heure 1** : migration Drizzle des 5 tables, appliquée sur une base de dev.
- **Heure 3** : `angles/ingest.ts` importe 20 angles Légifrance + agrégats.
- **Heure 6** : le validateur de citations tourne sur 20 contrats, le tableau du banc
  d'essai sort en CSV. C'est la livraison qui débloque la décision produit.
- **Heure 6+** : générateur, file, interface. Rien de tout cela n'est utile avant l'heure 6.

### Section 1 — Architecture

Graphe de dépendances : voir `Architecture` plus haut. Findings :

- **A1** (faible) `channel_capabilities` rafraîchie toutes les 24 h : un audit TikTok
  validé en cours de journée laisse le canal en brouillon jusqu'à 24 h. Accepté (P3),
  ajout d'un `--probe-now` en CLI.
- **A2** (élevé) **Point de défaillance unique : le fondateur.** Trois jours sans
  validation et la file gonfle en silence. Aucun garde-fou dans le plan.
  Décision D-01 : alerte à 48 h sur tout item `pending_review`, expiration automatique
  à 7 jours vers `rejected` avec motif `stale`, et l'angle n'est pas retiré.
- **A3** (aucun) Couplage générateur ↔ Mistral : si Mistral tombe, la génération échoue
  et la diffusion continue sur la file déjà approuvée. La séparation R1 tient.
- **A4** (aucun) 10x = 60 items/jour, MariaDB et cron tiennent sans changement. À 100x,
  ce qui casse en premier est la revue humaine, pas la base. C'est voulu.
- **A5** (élevé) Aucune procédure de rollback ni interrupteur d'arrêt.
  Décision D-02 : variable `MARKETING_ENABLED=false` court-circuite le scheduler sans
  déploiement, et `MARKETING_DRY_RUN=true` journalise le payload sans appel réseau.

### Section 2 — Carte des erreurs et des rattrapages

```
  CODEPATH                     | CE QUI PEUT CASSER            | CLASSE
  -----------------------------|-------------------------------|-------------------
  angles/ingest (Légifrance)   | PISTE 5xx / timeout           | LegifranceUnavailable
                               | article introuvable            | LegalRefNotFound
  generator/generate (Mistral) | réponse vide                   | EmptyGeneration
                               | JSON malformé                  | GenerationParseError
                               | refus du modèle                | GenerationRefused
                               | cite un article hors legal_refs| CitationHallucination
  oauth/store                  | déchiffrement impossible       | TokenDecryptError
  oauth/refresh                | refresh token expiré           | RefreshExpired
  publisher/*                  | 401 / 403                      | AuthError
                               | 429                            | RateLimitError
                               | 5xx plateforme                 | PlatformError
                               | timeout réseau                 | NetworkError
  scheduler/tick               | claim perdu (affectedRows=0)   | (normal, sortie propre)
                               | bail expiré sans published_at  | NeedsReconcile
                               | crash en plein appel           | OrphanAttempt

  CLASSE                 | RATTRAPÉ ? | ACTION                        | CE QUE VOIT LE FONDATEUR
  -----------------------|------------|-------------------------------|--------------------------
  LegifranceUnavailable  | O          | retry 3x backoff, angle ignoré| rien (log)
  LegalRefNotFound       | O          | angle non créé                | ligne dans le digest
  EmptyGeneration        | O ← AJOUT  | item reste draft + erreur     | badge dans la file
  GenerationParseError   | O ← AJOUT  | idem                          | badge dans la file
  GenerationRefused      | O ← AJOUT  | idem + angle marqué sensible  | badge dans la file
  CitationHallucination  | O          | bloqué en draft (validateur)  | badge rouge
  TokenDecryptError      | O ← AJOUT  | canal en pause, aucun retry   | alerte immédiate
  RefreshExpired         | O          | canal en pause                | alerte immédiate
  AuthError              | O          | item → pending_review, pause  | alerte immédiate
  RateLimitError         | O          | backoff, item reste scheduled | alerte au 3e échec
  PlatformError          | O          | 3 retries puis failed         | alerte
  NetworkError           | O          | 3 retries puis failed         | alerte au 3e échec
  NeedsReconcile         | O ← AJOUT  | retour pending_review, humain | badge "à vérifier"
  BrevoDown (alertes)    | O ← AJOUT  | bascule canal d'alerte 2      | alerte secondaire
```

Trois classes de panne LLM (vide, malformé, refus) manquaient au plan. Décision D-04 :
ajoutées avec le même traitement que la hallucination de citation, l'item ne quitte
jamais `draft`. Aucun `catch (e)` générique n'est autorisé dans les adaptateurs.

### Section 3 — Sécurité et modèle de menace

| # | Menace | Probabilité | Impact | Traité ? |
|---|---|---|---|---|
| S1 | Injection de prompt via le contenu d'un angle (une clause de contrat peut contenir « ignore les instructions précédentes ») | Moyenne | Élevé | **NON** → D-05 |
| S2 | `/admin/marketing` protégé par « l'auth existante » sans contrôle de rôle explicite | Moyenne | Élevé | **NON** → D-06 |
| S3 | Rotation de `MARKETING_TOKEN_KEY` impossible sans re-chiffrement | Faible | Élevé | **NON** → D-07 |
| S4 | Absence de traçabilité de l'approbation humaine | Certaine | Moyen | **NON** → D-08 |
| S5 | Token en clair dans les logs | Faible | Élevé | Oui, redaction spécifiée |
| S6 | Publication d'un texte de contrat client (RGPD) | Faible | Élevé | Oui, `source_kind` restreint en v1 |

- **D-05** : le payload de l'angle est passé au modèle comme donnée délimitée, jamais
  concaténé aux instructions. Le validateur de citations et la revue humaine sont la
  seconde et la troisième barrière. Une injection réussie produit au pire un brouillon
  bizarre qu'un humain rejette.
- **D-06** : contrôle de rôle explicite `role === 'owner'` sur chaque route tRPC de la
  file, pas seulement une session valide. Un utilisateur ordinaire qui approuve un post
  publie sous l'identité LinkedIn réelle du fondateur.
- **D-07** : colonne `key_version` sur `oauth_tokens` et commande `oauth:rekey`.
- **D-08** : colonnes `approved_by`, `approved_at`, `rejected_by` sur `content_items`.

### Section 4 — Flux de données et cas limites

```
  ANGLE ──▶ GÉNÉRATION ──▶ VALIDATION ──▶ FILE ──▶ PUBLICATION
    │            │              │           │            │
    ▼            ▼              ▼           ▼            ▼
 [aucun      [vide?]        [citation    [double     [token mort?]
  angle      [refus?]        fausse?]     clic?]     [429?]
  actif?]    [timeout?]     [trop long?] [file        [crash mid-call?]
                                          vide?]
```

| Interaction | Cas limite | Traité ? | Comment |
|---|---|---|---|
| Approbation | double-clic | **NON** → D-09 | update conditionnel `WHERE status='pending_review'` |
| Approbation | annuler après approbation, avant publication | **NON** → D-10 | transition `approved → rejected` autorisée tant que `published_at IS NULL` |
| File | zéro item | **NON** → phase design | état vide explicite |
| File | 200 items après une semaine d'absence | **NON** → D-01 | expiration à 7 jours |
| Génération | aucun angle actif disponible | **NON** → D-11 | le générateur ne produit rien et alerte, il n'invente pas un angle |
| Publication | le worker meurt entre l'appel et l'écriture | Oui | ligne `publish_attempts` écrite avant l'appel |

### Sections 5, 7 — Qualité de code, performance

Aucun code à lire dans ce dépôt, revue faite sur le plan. Section 5 : un couplage à
surveiller, ajouter un format touche `format` (enum), `generator/formats/` et le rendu de
la file, soit trois endroits. Acceptable pour trois formats, à revoir au-delà de six.
Section 7 : à 6 items par jour, aucune requête chaude. Les index `(status, scheduled_at)`
et `(channel, body_hash)` couvrent les deux seules requêtes du scheduler. Coût Mistral
négligeable. Rien à signaler.

### Section 8 — Observabilité

Le plan a des alertes mais aucune vue d'ensemble. Décision D-12 : digest quotidien par
mail (générés, en attente, approuvés, rejetés, publiés, échoués, dégradés) plus logs
structurés avec `content_item_id` en clé de corrélation. Sans ça, « le système marche »
n'est pas observable, seulement l'absence d'alerte.

### Section 9 — Déploiement

Migrations additives, aucune table existante modifiée, pas de downtime. Deux manques :
- **D-02** (déjà pris) interrupteur `MARKETING_ENABLED` et `MARKETING_DRY_RUN`.
- **D-13** : on ne peut pas tester une publication LinkedIn sans publier. Le mode dry-run
  est donc la seule vérification pré-déploiement possible, et la première publication
  réelle doit être faite à la main, un lundi matin, avec le fondateur devant l'écran.

### Section 10 — Trajectoire

Réversibilité 4/5 : cinq tables additives et un dossier isolé, suppression sans effet de
bord. Dette assumée : les adaptateurs TikTok et Facebook écrits avant l'obtention des
audits pourront ne pas correspondre à l'API finale. C'est le coût de R4, accepté.
Question à 1 an : un ingénieur qui lit `publisher/types.ts` comprend le système en deux
minutes. La partie opaque sera la sélection pondérée des angles, à documenter.

### Phase 1 — apports de la voix indépendante (lecture à froid)

Deux trouvailles absentes de ma propre passe :

- **C-01 (critique) La source n°1 de la banque d'angles n'existe pas.** R6 s'appuie sur
  les agrégats d'analyses réelles. Zéro utilisateur extérieur donc zéro analyse, donc
  `frequency_score` reste vide et la sélection pondérée dégénère en tirage aléatoire sur
  Légifrance et trois cas manuels. Décision D-14 : tant que le trafic est nul, la banque
  d'angles tient dans un fichier de seed de 30 lignes. Le schéma reste, la pondération
  est court-circuitée par un ordre manuel, et `angles/select.ts` n'est écrit qu'une fois
  `frequency_score` alimenté par de vraies analyses.
- **C-02 (moyenne) Aucune ligne « pourquoi pas un outil du marché ».** Buffer, Make et
  n8n font file d'approbation plus publication multi-canal pour environ 20 €/mois, ce
  soir. Le plan construit une plateforme de publication avec sondes de capacités,
  chiffrement AES-256-GCM et réconciliation d'appels orphelins, pour un opérateur unique.
  Décision D-15 : la section `Pourquoi pas un outil du marché` est obligatoire dans ce
  plan avant la première ligne de code. Réponse par défaut retenue : le différenciateur
  est la génération ancrée sur les angles et le validateur de citations, qu'aucun outil
  du marché ne fait. La publication elle-même n'est pas différenciante et pourrait
  légitimement passer par un outil tiers.

La voix indépendante rend par ailleurs 6 verdicts KO sur 6, dont quatre que ma passe
avait déjà relevés (prémisses, périmètre, approche C abandonnée, trajectoire). Le point
de désaccord entre les deux lectures : elle recommande de geler le plan entier, je
recommande de garder l'étape 0 avec un seuil dur. Porté au Défi utilisateur 1.

## Phase 2 — Revue design (interface de validation)

### 0A. Note initiale

**2/10.** Le plan fait 346 lignes, l'interface en occupe 14. C'est l'écran qui porte
R2, la garantie centrale du système, et c'est la partie la moins spécifiée. Aucun
DESIGN.md dans le dépôt, aucune maquette, aucun état vide rédigé.

### Passes 1 à 7

**Pass 1 — Architecture de l'information : KO (critique).**
L'ordre listé dans le plan (corps, canal, format, angle, refs, validateur, badge) est un
ordre de colonnes de base, pas une hiérarchie visuelle. Pour une décision en 30 secondes,
l'œil ne cherche pas à lire de la prose : il cherche une raison de dire non.
Décision D-16, ordre imposé :
1. verdict du validateur, pleine largeur, couleur plus texte (« 2 citations vérifiées »
   ou « article L.1221-1 introuvable ») ;
2. le post rendu **tel qu'il apparaîtra sur LinkedIn** : largeur de colonne, troncature
   « voir plus », mention légale visible ;
3. les `legal_refs` en panneau latéral, l'extrait cité surligné dans le corps, survol
   d'une citation surligne sa référence ;
4. métadonnées (canal, format, angle, `generated_by`) en pied, taille réduite.

**Pass 2 — Couverture des états : KO (critique).** Huit états non spécifiés : file vide
(l'état le plus fréquent une fois le rythme pris), chargement, échec de la mutation
d'approbation, succès avec undo, item bloqué en `draft` avec `validation_errors`
(apparaît-il ou disparaît-il en silence ?), conflit multi-onglets, mode édition,
formulaire de rejet. Décision D-17 : les huit sont spécifiés avant implémentation, et
le motif de rejet devient une liste courte (`citation fausse`, `ton`, `angle faible`,
`redondant`, `autre`) plutôt qu'un champ libre. Un champ libre tue le budget de
30 secondes et rend `content_angles.status='retired'` inexploitable statistiquement.

**Pass 3 — Parcours : KO (élevé).** Le plan optimise l'item, pas la session. Manquent la
progression (« 3 / 6 »), l'écran de fin de file, et surtout le retour après une semaine
d'absence. R2 ne meurt pas par contournement, il meurt par abandon : 42 items en attente
et le fondateur cesse d'ouvrir la page. Décision D-18 : expiration automatique à J+7
(déjà D-01) plus une vue de rattrapage groupée par angle.

**Pass 4 — Risque de slop : KO (élevé).** « Une carte par item », « badge »,
« raccourcis » sont des patterns génériques. L'implémenteur produira la carte par défaut
de sa bibliothèque, centrée, avec trois pastilles grises. Décision D-19 : le format
`duel` s'affiche en deux colonnes, ContractShield contre le LLM généraliste. C'est la
différenciation produit, une zone de texte unique la cache.

**Pass 5 — Alignement design system : KO.** Aucun système nommé. Le tarball du dépôt
contient `src/styles/theme.js` : l'écran d'admin réutilise ce thème, il ne réinvente pas
une palette.

**Pass 6 — Clavier et accessibilité : KO (élevé).** Les raccourcis J/K/A/R/E sont
annoncés sans rien de ce qui les rend utilisables. Décision D-20, six ajouts :
feuille d'aide sur `?`, indication du raccourci sur chaque bouton, garde
`isEditableTarget` (taper « rejet » dans un motif déclencherait R, E, J), focus visible,
`role="status"` avec `aria-live` pour annoncer « approuvé, item suivant », `Escape` pour
sortir de l'édition. Plus un undo de 5 secondes sur `A` : une touche unique qui publie
sous le nom réel du fondateur sans filet est un défaut de conception, pas une
optimisation.

**Pass 7 — Décisions non tranchées (à trancher avant de coder) :** une carte à la fois
ou liste scrollable ; l'approbation avance-t-elle automatiquement ; l'édition bloque-t-elle
les raccourcis ; où vit le compteur de caractères LinkedIn ; que fait `A` sur un item en
`validation_errors` (réponse : désactivé et visiblement désactivé, jamais silencieux).

Diagramme de flux utilisateur :

```
  ouverture ──▶ [file vide] ──▶ "prochaine génération à 6h" ──▶ sortie
      │
      └──▶ [n items] ──▶ carte 1 ──A──▶ toast undo 5s ──▶ carte 2 ──▶ ... ──▶ fin de file
                            │  │                                              │
                            │  └──R──▶ motif (liste courte) ──▶ carte suivante│
                            │                                                 ▼
                            └──E──▶ édition inline ──Esc/save──▶ carte      récap du jour
                                                                            (n approuvés,
                            [validation_errors] ──▶ A désactivé, motif visible  n rejetés)
```

## Phase 3 — Revue engineering

### Section 1 — Architecture

Findings de ma passe : voir Phase 1 sections 1 à 4. Findings de la voix indépendante,
tous retenus :

- **F1 (critique) Aucune protection réelle contre la double publication.** La machine
  passait `scheduled → published` sans claim. Un crash entre l'appel LinkedIn et l'UPDATE
  laissait l'item en `scheduled`, republié au tick suivant. Ma proposition initiale
  (écrire `publish_attempts` avant l'appel) détecte le problème, elle ne l'empêche pas.
  Corrigé dans le corps du plan : claim atomique par bail, et un bail expiré part en
  `needs_reconcile`, jamais en retry aveugle.
- **F2 (élevée) `UNIQUE(channel, body_hash)` déduplique du contenu, pas une publication.**
  Le test « deux ticks ne publient qu'une fois » serait passé pour la mauvaise raison.
  Corrigé : le test porte sur `affectedRows = 0` du claim perdant. Effet de bord traité :
  une édition humaine peut créer une collision 1062, à gérer comme message et non comme
  crash SQL, avec une option `--force`.
- **F3 (élevée) L'édition humaine contourne le validateur de citations.** `E` permet de
  modifier le corps, donc d'introduire un article inventé, puis d'approuver. C'est un
  trou dans R6 par la porte de R2. Corrigé : re-validation dans la mutation d'édition,
  approbation refusée tant que `validation_errors` n'est pas nul.
- **F4 (élevée) Le canal d'alerte est aussi un canal publié.** `notify.ts` passe par
  Brevo. Brevo tombe, les alertes tombent, en silence. Décision D-21 : canal d'alerte
  secondaire indépendant plus heartbeat externe. C'est la seule entorse au « pas de
  nouvelle infra » que je recommande, et elle est justifiée : un système de dégradation
  gracieuse dont les alertes peuvent disparaître ne dégrade pas gracieusement.
- **F5 (critique) `GET_LOCK` est lié à la connexion, pas à la transaction.** Avec le pool
  de connexions de Drizzle, le verrou peut être pris par une connexion et le travail fait
  par une autre. Corrigé dans le corps du plan : `GET_LOCK` rétrogradé au rang
  d'optimisation, la correction vient du claim par ligne.

### Section 2 — Qualité de code

`ContentItem` importé directement du schéma Drizzle couple les adaptateurs à la base.
Décision D-22 : les adaptateurs reçoivent un DTO `PublishableItem` défini dans
`publisher/types.ts`. Un adaptateur ne doit rien savoir de Drizzle.

### Section 3 — Revue des tests

Diagramme de ce que le plan introduit :

```
  NOUVEAUX FLUX UX
    file de validation : naviguer, approuver, rejeter, éditer, annuler
  NOUVEAUX FLUX DE DONNÉES
    source → angle → génération → validation → file → claim → publication → audit
  NOUVEAUX CODEPATHS
    validateur de citations (ok / article inconnu / hôte non autorisé)
    claim (gagné / perdu / bail expiré)
    dégradation (direct / brouillon)
    refresh OAuth (nominal / concurrent / refresh expiré)
  NOUVEAUX JOBS
    tick de publication, job de refresh, ingest d'angles, digest quotidien
  NOUVELLES INTÉGRATIONS
    Mistral, PISTE/Légifrance, LinkedIn, Brevo, TikTok, Facebook
  NOUVEAUX CHEMINS D'ERREUR
    12 classes, voir la carte des erreurs
```

Le test qui donne confiance un vendredi à 2 h du matin : `kill -9` du worker entre
l'insertion de `publish_attempts` et la réponse HTTP, puis relance, et l'item ne part
pas deux fois. Le test qu'écrirait un QA hostile : approuver le même item depuis deux
onglets simultanément. Le test de chaos : couper le réseau pendant le refresh OAuth,
avec deux ticks concurrents.

Artefact de plan de test écrit dans `~/.gstack/projects/<slug>/`.

### Section 4 — Performance

Rien de chaud à 1 post par jour ouvré. Deux ajouts de la voix indépendante :

- **F6 (moyenne) Fuseaux et heure d'été.** `DATETIME` MariaDB est sans fuseau, le cron du
  VPS est en Europe/Paris. Un `scheduled_at` à 02h30 le dimanche du passage à l'heure
  d'été ne se déclenche jamais, et se déclenche deux fois à l'automne. Décision D-23 :
  tout en UTC dans le process et en base, conversion à l'affichage seulement.
- **F7 (moyenne) Rattrapage en masse.** `scheduled_at <= now()` sans fenêtre : worker
  arrêté 48 h, tout l'arriéré part d'un coup. Décision D-24 : fenêtre de grâce de 2 h,
  au-delà retour en `pending_review`, plus un quota `max/canal/jour`.

### Sécurité (compléments de la voix indépendante)

- **F8 (critique pour le planning) Le refresh token LinkedIn n'est pas garanti.** R5
  suppose un refresh token de 365 jours. Sur une application standard avec
  `w_member_social`, l'échange OAuth peut ne renvoyer qu'un access token de 60 jours,
  sans refresh token, la rotation automatique étant réservée à certains programmes.
  Je ne peux pas le vérifier depuis cet environnement, l'accès réseau sortant vers la
  documentation LinkedIn est bloqué. Voir Défi utilisateur 3.
- **F9 (élevée) Injection de prompt, précisée.** Au-delà de la délimitation des données
  (D-05) : allowlist d'hôtes sur les URL de `legal_refs`, le validateur vérifie l'hôte
  et pas seulement le numéro d'article, rendu admin en texte échappé, et refus de toute
  URL produite par le modèle.
- **F10 (élevée) Autorisation, précisée.** Chaque procédure tRPC vérifie le rôle **et**
  le statut de départ, journalise l'acteur, et l'approbation est une transition
  conditionnelle depuis `pending_review` uniquement.
- **F11 (élevée, juridique) Consentement Brevo.** Le plan ne dit rien du désabonnement,
  de la base légale de consentement ni des bounces. Envoyer vers une liste sans cela est
  une infraction, pas un bug. Décision D-25 : lien de désabonnement obligatoire, double
  opt-in, traitement des bounces, avant le premier envoi.
- **F12 (moyenne) Modèle de données.** Ajouts retenus : `lease_until`, `locked_by`,
  `version` sur `content_items` ; `UNIQUE(channel, external_id)` ; index
  `publish_attempts(content_item_id, attempt_no)` ; `UNIQUE(provider, account_ref)` et
  `key_version` sur `oauth_tokens` ; IV et tag GCM stockés explicitement ; `body_hash`
  calculé sur un corps normalisé ; index `(channel, status)` pour les quotas.

## Phase 3.5 — Revue DX

Le seul développeur de ce système est son auteur, plus un éventuel prestataire.

**TTHW actuel estimé : 3 à 6 h, et impossible sans clé Mistral. Cible : 5 minutes.**

- **X1 (critique) Aucun chemin d'exécution local.** Ni `.env.example`, ni seed, ni mode
  hors ligne. Décision D-26 : l'étape 0 livre `.env.example` commenté,
  `seeds/angles.seed.ts` avec 3 angles Légifrance figés sans appel réseau,
  `MISTRAL_MODE=fixture` qui rejoue une réponse enregistrée, un adaptateur
  `publisher/console.ts` (canal `dryrun`) qui écrit sur stdout, et une commande
  `marketing:demo` qui enchaîne migrate, seed, génération d'un item et affichage.
  Cible : `git clone && pnpm i && pnpm marketing:demo`, zéro secret requis.
- **X2 (élevée) L'interface Publisher ne suffit pas pour TikTok, donc R3 est fausse en
  l'état.** TikTok renvoie un `publish_id` à sonder, et exige un cycle d'upload média
  init/chunks/finalize. `PublishResult` n'a que `ok: true|false`. Ajouter TikTok
  forcerait donc à changer l'interface, exactement ce que R3 promet d'éviter.
  Décision D-27 : l'interface est étendue **maintenant**, avant le premier adaptateur.
  `PublishResult` gagne `status: 'done' | 'pending'` et `pollAfter`, le Publisher gagne
  `supportedFormats: Format[]` et un `upload(media)` optionnel, et `validate()` devient
  `async (item, ctx)`. Coût aujourd'hui : une heure. Coût plus tard : le refactor que R3
  interdit.
- **X3 (critique) Les messages d'erreur parlent à la machine, pas au fondateur.**
  `error_class: 'auth'` à 7 h du matin oblige à ouvrir la base. Décision D-28 :
  `PublishResult.remediation` en texte lisible (« Reconnecte LinkedIn sur
  /admin/marketing/oauth/linkedin ») plus `itemUrl`, et un gabarit d'alerte par classe
  d'erreur : canal, item et lien direct, horodatage, tentative n/3, prochaine action
  automatique, action humaine requise.
- **X4 (élevée) `oauth:login` n'existe nulle part.** Le plan gère le refresh et jamais
  l'obtention initiale du token. Trou réel. Décision D-29 : `oauth:login <provider>` plus
  une page de re-consentement en un clic dans l'admin, qui sert aussi de plan B si F8 se
  confirme.
- **X5 (élevée) Commandes opérationnelles manquantes.** Décision D-30, l'étape 0 livre
  `marketing:doctor` (env, base, migrations, tokens, capabilities, la commande à lancer
  avant d'appeler à l'aide), `marketing:queue ls|show <id>`, `marketing:generate --angle`,
  `marketing:tick --once --dry-run`, `marketing:retry <id>`, `marketing:cancel <id>`,
  `marketing:probe-capabilities`, `db:seed`, `db:reset`.
- **X6 (élevée) Aucune échappatoire.** Pas d'annulation d'un item `scheduled`, pas de
  retour de `failed` vers `approved`, pas de `publish --now`, pas de reprise après une
  panne de cron, et `UNIQUE(channel, body_hash)` sans contournement pour republier
  volontairement. Décision D-31 : les cinq sont livrés avec le scheduler.
- **X7 (moyenne) Documentation.** Décision D-32 : `docs/marketing/ADAPTERS.md` avec la
  checklist des fichiers touchés, `publisher/_template.ts` copiable,
  `publisher.contract.test.ts` déclaré comme définition de « terminé »,
  `docs/marketing/RUNBOOK.md` avec une section par classe d'erreur, et le tableau des
  variables d'environnement.

### Tableau de bord DX

| Dimension | Note | Cible |
|---|---|---|
| Démarrage sous 5 min | 1/10 | 9/10 après D-26 |
| Nommage devinable | 8/10 | 8/10 |
| Messages d'erreur actionnables | 2/10 | 9/10 après D-28 |
| Documentation | 0/10 | 8/10 après D-32 |
| Chemin de mise à jour | 6/10 | 8/10 après D-27 |
| Environnement de dev | 1/10 | 9/10 après D-26 |
| **Global** | **3/10** | **8,5/10** |

## Tables de consensus

Codex absent, la seconde voix est un agent Claude lancé à froid sur le plan seul, sans le
contexte de la conversation. Note d'honnêteté : sur la phase design, ma passe a été
rédigée après réception de la lecture à froid et l'a intégrée. Ce n'est donc pas une
double lecture indépendante, c'est une lecture unique enrichie, et la table le dit.

```
CEO — CONSENSUS
════════════════════════════════════════════════════════════════════
  Dimension                        Ma passe  Voix froide  Consensus
  ──────────────────────────────── ───────── ──────────── ──────────
  1. Prémisses valides ?           KO        KO           CONFIRMÉ KO
  2. Bon problème à résoudre ?     KO        KO           CONFIRMÉ KO
  3. Calibrage du périmètre ?      KO        KO           CONFIRMÉ KO
  4. Alternatives explorées ?      OK        KO           DÉSACCORD → T1
  5. Risques marché couverts ?     OK        KO           DÉSACCORD → UC2
  6. Trajectoire 6 mois ?          OK        KO           DÉSACCORD → UC1
════════════════════════════════════════════════════════════════════
  3 confirmés, 3 désaccords

ENG — CONSENSUS
════════════════════════════════════════════════════════════════════
  1. Architecture saine ?          OK        KO           voix froide a raison (F1,F2,F5)
  2. Couverture de tests ?         KO        KO           CONFIRMÉ KO
  3. Risques perf traités ?        OK        OK           CONFIRMÉ OK
  4. Menaces sécurité couvertes ?  KO        KO           CONFIRMÉ KO
  5. Chemins d'erreur gérés ?      OK        KO           voix froide a raison (F4)
  6. Risque de déploiement ?       OK        OK           CONFIRMÉ OK
════════════════════════════════════════════════════════════════════
  4 confirmés, 2 concessions à la voix froide

DESIGN — 7 passes, 7 KO. Lecture unique enrichie, pas de consensus réel.
DX — 6 dimensions : 4 KO, 2 OK. Lecture croisée, verdicts identiques.
```

## Thèmes inter-phases

- **La preuve manquante** apparaît en phase CEO (Pr4) et en phase eng (F8) et en phase DX
  (X1) : trois fois, sous trois angles, le plan suppose vérifié ce qui ne l'est pas.
  Signal de forte confiance.
- **Le silence comme mode de panne** apparaît en CEO (A2, le fondateur qui ne valide
  plus), en eng (F4, les alertes qui passent par le canal en panne) et en DX (X3, le
  message qui ne dit pas quoi faire). Le système sait échouer, il ne sait pas le dire.

## Journal des décisions automatiques

| # | Phase | Décision | Classe | Principe | Justification |
|---|---|---|---|---|---|
| D-01 | CEO | Expiration des items `pending_review` à J+7, alerte à 48 h | Mécanique | P1 | Le fondateur est le point de défaillance unique |
| D-02 | CEO | `MARKETING_ENABLED` et `MARKETING_DRY_RUN` | Mécanique | P1 | Aucun interrupteur d'arrêt dans le plan |
| D-03 | CEO | Volume ramené à 1 post/jour ouvré + 1 email/semaine | Mécanique | P4 | Le plan contredisait le design doc approuvé |
| D-04 | CEO | 3 classes de panne LLM (vide, malformé, refus) | Mécanique | P1 | Trois modes de panne non traités |
| D-05 | CEO | Payload d'angle délimité, jamais concaténé aux instructions | Mécanique | P1 | Injection de prompt |
| D-06 | CEO | Contrôle de rôle explicite sur chaque route de la file | Mécanique | P1 | Publication sous identité réelle |
| D-07 | CEO | `key_version` et commande `oauth:rekey` | Mécanique | P1 | Rotation de clé impossible sinon |
| D-08 | CEO | `approved_by`, `approved_at`, `rejected_by` | Mécanique | P1 | Traçabilité de la validation humaine |
| D-09 | CEO | Approbation en update conditionnel | Mécanique | P1 | Double-clic |
| D-10 | CEO | Transition `approved → rejected` tant que non publié | Mécanique | P1 | Aucun chemin d'annulation |
| D-11 | CEO | Le générateur alerte si aucun angle actif, il n'invente pas | Mécanique | P1 | Contenu générique par défaut, contraire à R6 |
| D-12 | CEO | Digest quotidien + logs corrélés par `content_item_id` | Mécanique | P1 | Aucune observabilité |
| D-13 | CEO | Première publication réelle faite à la main | Mécanique | P6 | On ne peut pas tester LinkedIn sans publier |
| D-14 | CEO | Banque d'angles en seed tant que le trafic est nul | Mécanique | P5 | La source n°1 n'existe pas encore |
| D-15 | CEO | Section « pourquoi pas un outil du marché » obligatoire | Goût | P3 | Voir T1 |
| D-16 | Design | Hiérarchie imposée : validateur, rendu LinkedIn, refs, méta | Mécanique | P1 | Ordre de colonnes de base, pas hiérarchie |
| D-17 | Design | 8 états spécifiés + motif de rejet en liste courte | Mécanique | P1 | Champ libre incompatible avec 30 s |
| D-18 | Design | Vue de rattrapage groupée par angle | Mécanique | P1 | R2 meurt par abandon |
| D-19 | Design | Format duel en deux colonnes | Mécanique | P1 | La différenciation produit, cachée sinon |
| D-20 | Design | 6 ajouts clavier/a11y + undo 5 s sur `A` | Mécanique | P1 | Une touche qui publie sans filet |
| D-21 | Eng | Canal d'alerte secondaire + heartbeat | Goût | P1 | Seule entorse au « pas de nouvelle infra », voir T2 |
| D-22 | Eng | DTO `PublishableItem`, adaptateurs découplés de Drizzle | Mécanique | P5 | Couplage base ↔ adaptateur |
| D-23 | Eng | Tout en UTC | Mécanique | P1 | Heure d'été |
| D-24 | Eng | Fenêtre de grâce 2 h + quota par canal | Mécanique | P1 | Rattrapage en masse après panne |
| D-25 | Eng | Désabonnement, double opt-in, bounces avant le 1er envoi | Mécanique | P1 | Obligation légale, pas une option |
| D-26 | DX | `.env.example`, seed, `MISTRAL_MODE=fixture`, adaptateur console, `marketing:demo` | Mécanique | P1 | TTHW 3-6 h → 5 min |
| D-27 | DX | Interface Publisher étendue maintenant (async, média, formats) | Goût | P1 | Voir T3 |
| D-28 | DX | `remediation` et `itemUrl` dans `PublishResult` | Mécanique | P1 | Message pour la machine, pas pour l'humain |
| D-29 | DX | `oauth:login` et page de re-consentement | Mécanique | P1 | L'obtention initiale du token n'existait pas |
| D-30 | DX | 9 commandes opérationnelles dont `marketing:doctor` | Mécanique | P1 | Aucun outillage d'exploitation |
| D-31 | DX | 5 échappatoires (annuler, rejouer, forcer, publier maintenant, reprendre) | Mécanique | P1 | Système sans issue de secours |
| D-32 | DX | ADAPTERS.md, RUNBOOK.md, `_template.ts`, contrat de test | Mécanique | P1 | Aucune documentation prévue |

## Tâches d'implémentation

- [ ] **T-01 (P1, humain ~1 j / CC ~1 h) — schema** — migrations Drizzle des 5 tables avec les colonnes ajoutées en revue (`lease_until`, `locked_by`, `version`, `key_version`, `approved_by`)
  - Surfacé par : eng — F1, F12
  - Fichiers : `src/marketing/db/schema.ts`
- [ ] **T-02 (P1, humain ~0,5 j / CC ~30 min) — angles** — seed de 3 angles Légifrance figés, sans appel réseau
  - Surfacé par : ceo — C-01, dx — X1
  - Fichiers : `src/marketing/seeds/angles.seed.ts`
- [ ] **T-03 (P1, humain ~1 j / CC ~1 h) — generator** — validateur de citations bloquant, avec allowlist d'hôtes
  - Surfacé par : eng — F9
  - Fichiers : `src/marketing/generator/validate.ts`
- [ ] **T-04 (P1, humain ~0,5 j / CC ~20 min) — oauth** — spike LinkedIn : échanger un vrai code, vérifier la présence d'un `refresh_token`
  - Surfacé par : eng — F8
  - Fichiers : `scripts/spike-linkedin-oauth.ts`
- [ ] **T-05 (P1, humain ~1 j / CC ~1 h) — publisher** — interface étendue (async, média, `supportedFormats`) + `console.ts` + contrat de test partagé
  - Surfacé par : dx — X2
  - Fichiers : `src/marketing/publisher/types.ts`, `src/marketing/publisher/console.ts`, `src/marketing/publisher/publisher.contract.test.ts`
- [ ] **T-06 (P1, humain ~1 j / CC ~1 h) — scheduler** — claim par bail, `needs_reconcile`, fenêtre de grâce, quotas
  - Surfacé par : eng — F1, F5, F7
  - Fichiers : `src/marketing/scheduler/tick.ts`
- [ ] **T-07 (P2, humain ~2 j / CC ~2 h) — review-ui** — file de validation avec les 8 états, la hiérarchie D-16 et les 6 ajouts clavier
  - Surfacé par : design — passes 1, 2, 6
  - Fichiers : `src/marketing/review/router.ts`, `src/pages/admin/Marketing.jsx`
- [ ] **T-08 (P2, humain ~0,5 j / CC ~40 min) — ops** — `marketing:doctor` et les 8 autres commandes
  - Surfacé par : dx — X5
  - Fichiers : `src/marketing/cli/`
- [ ] **T-09 (P2, humain ~0,5 j / CC ~30 min) — notify** — gabarits d'alerte avec remédiation, digest quotidien, canal secondaire
  - Surfacé par : dx — X3, eng — F4
  - Fichiers : `src/marketing/notify.ts`
- [ ] **T-10 (P2, humain ~0,5 j / CC ~30 min) — legal** — désabonnement Brevo, double opt-in, bounces
  - Surfacé par : eng — F11
  - Fichiers : `src/marketing/publisher/brevo.ts`
- [ ] **T-11 (P3, humain ~0,5 j / CC ~30 min) — docs** — ADAPTERS.md, RUNBOOK.md, `_template.ts`
  - Surfacé par : dx — X7
  - Fichiers : `docs/marketing/`

## Artefacts produits

- Plan de test : `~/.gstack/projects/mediaproofagency-beep-Contractshield/root-claude-gstack-install-setup-7qfx5l-test-plan-20260824-102856.md`
- Tâches JSONL : `~/.gstack/projects/mediaproofagency-beep-Contractshield/tasks-autoplan-20260824-102856.jsonl`
- Point de restauration : `~/.gstack/projects/mediaproofagency-beep-Contractshield/claude-gstack-install-setup-7qfx5l-autoplan-restore-20260824-101903.md`

## Reporté à TODOS.md

- Page entreprise LinkedIn (Community Management API, approbation incertaine)
- Génération de vidéo TikTok (montage manuel, l'adaptateur pousse en brouillon)
- Analytics d'engagement multi-canal
- Sélection pondérée des angles (`angles/select.ts`), tant que `frequency_score` est vide

---

# RÉVISIONS POST-GATE

Décisions du fondateur au gate final du 2026-08-24.

| Gate | Décision | Effet |
|---|---|---|
| Défi 1 | Étape 0 telle que planifiée, avec seuil dur | Le plan garde l'étape 0. Rien ne démarre au-delà sous 8/20. |
| Défi 2 | Pages-clause SEO réintégrées en parallèle | Nouvelle étape 0-bis, voir ci-dessous. |
| Défi 3 | Spike LinkedIn de 2 h | Conservé, mais devient **conditionnel**, voir la note d'interaction. |
| Goût T1 | **Inversé** : la publication passe par un outil du marché | Refonte de la couche diffusion, voir ci-dessous. |
| Goût T2 | Maintenu : canal d'alerte secondaire | Inchangé. |
| Goût T3 | Maintenu : interface Publisher étendue | Inchangé, et devient encore plus utile, voir ci-dessous. |

## Écart assumé sur R3, R4 et R5

R3, R4 et R5 étaient déclarées non négociables. L'inversion de T1 les change matériellement.
Ce n'est pas une dérive de ma part, c'est la conséquence directe de la décision, et elle
est écrite ici pour qu'elle soit visible plutôt que découverte en cours de route.

- **R3 (un canal = un fichier)** : mieux servie, pas contournée. Ajouter un canal devient
  une configuration dans l'outil, pas un fichier. L'interface `Publisher` reste, avec deux
  implémentations seulement : `console` (dry-run local) et `relay` (l'outil). Le jour où un
  canal natif se justifie, il s'ajoute derrière la même interface, sans refactor. T3
  maintenue prend ici tout son sens : l'interface étendue est ce qui garde la porte ouverte.
- **R4 (dégradation gracieuse)** : la moitié plateforme (TikTok non audité, rate limits,
  5xx) part chez l'outil. Reste chez nous la moitié qui compte : l'outil injoignable, un
  item accepté par l'outil mais jamais publié, et la réconciliation. Un `relay` qui répond
  200 n'est pas une publication : le statut `published` n'est posé qu'à confirmation.
- **R5 (OAuth avec refresh automatique)** : **sort du périmètre v1**. C'est l'outil qui
  détient et renouvelle les tokens LinkedIn. Les tables `oauth_tokens`, le chiffrement
  AES-256-GCM, `oauth:refresh`, `oauth:login`, `key_version` et les alertes J-30/14/7
  disparaissent de l'étape 0. Gain secondaire : le risque F8 (refresh token peut-être
  jamais délivré) s'évapore, il devient le problème de l'outil.

## Note d'interaction entre le Défi 3 et T1

Les deux réponses ont été données ensemble et se contredisent partiellement. Le spike
LinkedIn de 2 h ne sert à rien tant que la publication passe par un outil tiers : c'est
l'outil qui fait l'échange OAuth. Le spike est donc **conservé mais déplacé** : il devient
la première tâche du jour où un adaptateur LinkedIn natif est décidé, pas une tâche de
l'étape 0. Si tu voulais le spike malgré T1, dis-le et je le remonte, mais il consommerait
2 h pour répondre à une question que le plan ne pose plus.

## Périmètre révisé

**Ce qu'on construit** (le différenciateur, qu'aucun outil du marché ne fait) :
banque d'angles, générateur ancré sur Mistral, validateur de citations bloquant, machine
à états, file de validation humaine, pages-clause SEO.

**Ce qu'on achète** : la publication multi-canal et la détention des tokens.

**Ce qui disparaît de l'étape 0** : `oauth/store.ts`, `oauth/refresh.ts`, la table
`oauth_tokens`, `publisher/linkedin.ts`, `publisher/tiktok.ts`, `publisher/facebook.ts`,
`channel_capabilities`, et les commandes `oauth:*`. Environ 5 jours humains retirés.

**Ce qui reste obligatoire malgré l'outil** : la mention légale injectée par le formatter
(D-19), le désabonnement et le double opt-in Brevo si l'email passe par l'outil (D-25,
obligation légale, elle ne se sous-traite pas), le claim par bail (D-06/F1, l'outil ne
protège pas de notre propre double envoi), et le digest quotidien (D-12).

## Étape 0-bis — Pages-clause SEO (Défi 2)

Même banque d'angles, même validateur, sortie différente.

```
  content_angles ──▶ generator/formats/page-clause.ts ──▶ pages statiques
       (déjà là)              (nouveau, ~150 lignes)        /clauses/<slug>
                                    │
                                    └──▶ sitemap.xml + données structurées
```

- Une page par type de clause : intitulé, verdict, article Légifrance cliquable, exemple
  de reformulation, appel à l'action vers l'analyseur gratuit.
- Rendu statique au build, aucune nouvelle infra, servi par le front existant.
- Le validateur de citations est le même. Une page qui cite un article inexistant est un
  problème SEO durable, pas un post qui disparaît en 48 h.
- 20 pages à l'étape 0-bis, extension ensuite.
- Effort : ~2 j humain / ~2 h Claude Code.

## Phasage révisé

| Étape | Contenu | Humain | Claude Code |
|---|---|---|---|
| 0 | Schéma (sans `oauth_tokens`), seed d'angles, validateur de citations, harnais de banc d'essai, adaptateur `console` | ~2 j | ~3 h |
| **GATE** | **Moins de 8 gains nets sur 20 contrats : rien ne démarre au-delà** | — | — |
| 0-bis | 20 pages-clause SEO + sitemap | ~2 j | ~2 h |
| 1 | Générateur, formats, file de validation avec les 8 états | ~4 j | ~5 h |
| 2 | Adaptateur `relay` vers l'outil, claim par bail, scheduler, alertes, digest | ~2 j | ~2 h |
| 3 | Configuration des canaux dans l'outil, audits TikTok et Facebook lancés en tâche de fond | ~1 j | — |

Total révisé : environ 11 jours humains contre 15, et le risque OAuth sort du chemin critique.

## Tâches révisées

- [x] T-04 — spike LinkedIn : **déplacé** hors étape 0 (voir note d'interaction)
- [ ] **T-12 (P1, humain ~2 j / CC ~2 h) — seo** — générateur de pages-clause + sitemap, alimenté par la même banque d'angles et le même validateur
- [ ] **T-13 (P1, humain ~0,5 j / CC ~30 min) — publisher** — adaptateur `relay` vers l'outil choisi, avec confirmation de publication avant de poser `published`
- [ ] **T-14 (P2, humain ~0,5 j / CC ~20 min) — decision** — choisir l'outil (Buffer, Make, n8n) et écrire la ligne de justification exigée par D-15
- [ ] ~~T-01 colonnes `oauth_tokens` / `key_version`~~ — retiré du périmètre v1

---

# RÉVISION PHASE 2 — retour à l'adaptateur natif

Décision du fondateur, postérieure au gate `/autoplan`.

Le gate avait inversé T1 : la publication devait passer par un outil du marché, ce
qui sortait R5 (OAuth) du périmètre. La demande de la phase 2 est un adaptateur
LinkedIn natif. **T1 est donc rétabli dans son sens initial et R5 revient au
périmètre.** Conséquences appliquées :

- `oauth_tokens`, chiffrement AES-256-GCM avec version de clé, renouvellement
  automatique et alertes : construits.
- Le risque F8 (aucun refresh token délivré) redevient actif. Traité dans le code
  par deux régimes distincts, et `oauth:login` dit lequel s'applique au moment de
  la connexion plutôt qu'au jour 60.
- `publisher/relay.ts` (T-13) et le choix d'outil (T-14) sortent du périmètre.

Périmètre livré : LinkedIn uniquement, `/rest/posts`, auteur `urn:li:person`,
en-têtes `LinkedIn-Version` et `X-Restli-Protocol-Version: 2.0.0`. Pas de
`ugcPosts`. Brevo reste déclaré sans adaptateur.

## Écart entre le plan et l'implémentation, assumé

Le plan prévoyait un statut de claim par bail sur la ligne : c'est bien ce qui a
été fait, et `GET_LOCK` n'apparaît nulle part. Deux ajouts non prévus au plan :

- **`LINKEDIN_ESCAPE_COMMENTARY`** : l'échappement du champ `commentary` n'a pas pu
  être vérifié contre la documentation LinkedIn depuis l'environnement de
  développement. Plutôt que de parier, le comportement est basculable par variable
  d'environnement, décidable après le premier post réel.
- **Dry-run sans jeton** : le mode `--dry-run` affiche le payload même sans OAuth
  configuré, puisque c'est exactement le moment où on veut le relire.
