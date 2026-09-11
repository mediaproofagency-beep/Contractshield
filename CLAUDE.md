# CLAUDE.md — ContractShield

> Vérifié contre le code le 2026-09-11. Chaque affirmation porte son statut :
> **[vérifié]** = confirmé dans le dépôt · **[hors dépôt]** = plausible mais le code
> concerné n'est pas ici · **[contredit]** = le dépôt dit le contraire.

---

## ⚠️ À lire avant tout : ce que contient réellement ce dépôt

La branche `main` ne contient **qu'un seul fichier** : `contractshield-project (1).tar.gz`.
Le code source n'est pas extrait. Pour travailler dessus :

```bash
mkdir -p /tmp/cs && tar xzf "contractshield-project (1).tar.gz" -C /tmp/cs
# → /tmp/cs/contractshield/  (app React/Vite)
```

Trois branches portent du code différent, **aucune n'est mergée** :

| Branche | Contenu |
|---|---|
| `main` | le tarball seul |
| `claude/gstack-install-setup-7qfx5l` | `src/marketing/` (TypeScript, Drizzle, MariaDB, Mistral) + `docs/` + un `CLAUDE.md` dédié à gstack |
| `claude/new-session-3a2bwg` | `campagne-bordeaux/` (prospection e-mail en Python) |

**Il n'existe aucun backend applicatif dans ce dépôt.** Pas de `server/`, pas d'API
HTTP de production, pas d'authentification serveur. L'app React tourne sur un
backend **simulé** (`src/api/mockBackend.js`) et une auth **localStorage**
(`src/context/AuthContext.jsx`). Le design doc le dit lui-même :
« Le backend réel vit peut-être sur le VPS Scaleway ; non vérifiable depuis cette
session » (`docs/designs/distribution-contenu-preuve-avant-megaphone.md:30`).

C'est la clé de lecture de tout ce qui suit : **les pièges de déploiement
ci-dessous concernent un serveur qui n'est pas versionné ici.**

---

## Stack réelle

### App front (dans le tarball, branche `main`)

| Élément | Valeur | Statut |
|---|---|---|
| Runtime | Node ≥ 18 (`README.md`) | **[vérifié]** |
| Build | Vite 5 + React 18 | **[vérifié]** `package.json` |
| Gestionnaire | **npm** | **[vérifié]** |
| Tests | Vitest | **[vérifié]** |
| Port dev | **3000** (`vite.config.js` → `server.port`) | **[vérifié]** — serveur de dev uniquement |
| Déploiement | **Vercel** (`vercel.json`, rewrites SPA) | **[vérifié]** |

### Paquet marketing (branche `claude/gstack-install-setup-7qfx5l`)

| Élément | Valeur | Statut |
|---|---|---|
| Runtime | **Node ≥ 22.6** (`engines`), `--experimental-strip-types` | **[vérifié]** |
| Gestionnaire | **npm** — `package-lock.json` committé | **[vérifié]** |
| Base | **MariaDB** via `drizzle-orm` + `mysql2` | **[vérifié]** |
| LLM | **Mistral** (`src/generator/mistral.ts`), pas Claude | **[vérifié]** |
| Serveur | `node:http` brut, écoute `127.0.0.1:4321` | **[vérifié]** `src/server/dev-server.ts:199` |

### Infra cible (documentée en prose, pas dans le code)

- VPS **Scaleway**, **Ubuntu 24.04** — `docs/designs/distribution-contenu-preuve-avant-megaphone.md:60` **[hors dépôt]**
- Stack annoncée : React / tRPC / Drizzle / MariaDB — `docs/plans/systeme-marketing-contractshield.md:31` **[hors dépôt]**
- **PM2** et **Nginx** : **zéro occurrence** dans les trois branches. **[contredit]**

---

## Commandes

### App front

```bash
tar xzf "contractshield-project (1).tar.gz" && cd contractshield
npm install
npm run dev        # port 3000, ouvre le navigateur
npm run build      # → dist/, minify terser, pas de sourcemap
npm run preview
npm run test       # vitest run
```

Déploiement Vercel : push sur GitHub → import du repo, ou `vercel --prod`.
Variables d'env : préfixe `VITE_` obligatoire (voir `.env.example` — Stripe, Firebase optionnel).

### Paquet marketing

```bash
cd src/marketing
npm install
npm run typecheck          # tsc --noEmit
npm run build              # tsc -p tsconfig.json
npm run test               # vitest run
npm run marketing:demo     # aucun secret requis, repo en mémoire
npm run marketing:doctor   # diagnostic env / base / tokens
npm run marketing:review   # file de validation sur 127.0.0.1:4321
npm run marketing -- db:print-ddl   # imprime le DDL — il n'y a PAS de migrations
```

Sans `DATABASE_URL`, le dépôt en mémoire prend le relais : rien n'est persisté.
Le process doit tourner en `TZ=UTC` (sinon un post planifié au changement d'heure
part deux fois ou jamais — `.env.example`).

---

## Déploiement — pièges connus

> **Avertissement de fiabilité.** Les cinq points ci-dessous ont été demandés comme
> acquis. Vérification faite, **aucun n'est confirmable dans ce dépôt**, et deux sont
> activement contredits. Ils sont conservés parce qu'ils décrivent vraisemblablement
> le **serveur de production hors dépôt** — mais ne pas les appliquer aveuglément au
> code présent ici.

### 1. SMTP Brevo sur le port 2525 (Scaleway bloque 25/465/587)

**Statut : [hors dépôt] — aucun envoi SMTP n'existe dans le dépôt.**

Brevo est bien utilisé, mais **en API HTTPS, pas en SMTP** :

- `campagne-bordeaux/scripts/3-envoyer.py` → `POST https://api.brevo.com/v3/smtp/email`
  (port **443**). Le mot `smtp` est un segment d'URL de l'API Brevo, pas une
  connexion SMTP.
- Branche `gstack` : Brevo n'apparaît que comme valeur d'enum `channel` et dans des
  commentaires (`src/marketing/src/notify.ts`) — **aucune implémentation**.
- `2525` : **zéro occurrence**. Aucun `nodemailer`, aucun `smtplib`.

Le blocage des ports sortants 25/465/587 par Scaleway est un comportement réel de
l'hébergeur. Mais **tant que l'envoi passe par l'API HTTPS, la question du port ne se
pose pas.** Si le serveur de production bascule un jour sur SMTP direct, alors 2525
devient la voie à suivre.

### 2. `pnpm install --no-frozen-lockfile` sur une install fraîche

**Statut : [contredit] — ce dépôt est en npm.**

- `src/marketing/package-lock.json` est committé → **npm**.
- Aucun `pnpm-lock.yaml`, aucun `pnpm-workspace.yaml`, aucun champ `packageManager`.
- Seule mention de pnpm : **une ligne d'intention** dans un plan,
  `docs/plans/systeme-marketing-contractshield.md:802`
  (« Cible : `git clone && pnpm i && pnpm marketing:demo` ») — un objectif, pas l'état actuel.

Sur ce dépôt, la commande fraîche est **`npm install`** (ou `npm ci` si on veut
respecter le lockfile). Utiliser pnpm ici créerait un second lockfile divergent.
Le `--no-frozen-lockfile` n'a de sens que si le serveur de prod, lui, est en pnpm
avec un lockfile désynchronisé du `package.json` — auquel cas **le vrai correctif est
de regénérer et committer le lockfile**, pas de le contourner à chaque déploiement.

### 3. Table `magicLinkTokens` absente des migrations, à créer via `drizzle-kit push`

**Statut : [contredit] sur deux points.**

- **Aucune table `magicLinkTokens`** nulle part. Le schéma Drizzle
  (`src/marketing/src/db/schema.ts`) déclare exactement 4 tables :
  `contentAngles`, `contentItems`, `publishAttempts`, `oauthTokens`.
- **Il n'y a aucune migration**, donc rien dont la table puisse être « absente ».
  Le schéma expose des chaînes DDL brutes (`DDL`, `DDL_PHASE2`) appliquées via
  `npm run marketing -- db:print-ddl`.
- **`drizzle-kit` n'est pas une dépendance** — seulement `drizzle-orm` et `mysql2`.
  La commande `drizzle-kit push` échouerait en l'état.
- Aucune authentification par lien magique dans le dépôt : l'auth front est un mock
  localStorage, et `oauthTokens` sert à **OAuth LinkedIn**, pas aux magic links.

Les migrations Drizzle sont une **tâche planifiée non faite** :
`docs/plans/systeme-marketing-contractshield.md:933` → « T-01 … migrations Drizzle des 5 tables ».

### 4. Retirer le bloc du paramètre `thinking` de `server/_core/llm.ts` après un déploiement frais

**Statut : [hors dépôt] — ce fichier n'existe pas.**

- Pas de répertoire `server/`, pas de `_core/`, pas de `llm.ts` sur les trois branches.
- Le seul client LLM est `src/marketing/src/generator/mistral.ts`, qui appelle
  **Mistral** avec `model` et `temperature: 0.4` — **aucun paramètre `thinking`**.
- `thinking` est un paramètre de la **Messages API d'Anthropic**, que l'API Mistral
  n'accepte pas. Si ce bloc existe côté production, il vit dans le backend non versionné.

**Si ce piège est réel, le corriger à la source** : un paramètre qu'il faut retirer
manuellement après chaque déploiement frais est un bug de configuration, pas une
procédure. Le rendre conditionnel (drapeau d'env, ou détection du fournisseur) supprime
l'étape manuelle définitivement.

### 5. `trust proxy` requis à cause du reverse proxy Nginx

**Statut : [hors dépôt] — pas d'Express, pas de Nginx dans le dépôt.**

- `trust proxy` est un réglage **Express**. Le seul serveur HTTP du dépôt,
  `src/marketing/src/server/dev-server.ts`, est en **`node:http` brut** : ce réglage
  n'y existe pas.
- Il écoute explicitement sur **`127.0.0.1`** (`dev-server.ts:199`) et ne lit
  **aucun en-tête `X-Forwarded-*`**.
- **Aucune configuration Nginx** n'est versionnée.

Le besoin est réel dès qu'un Express se trouve derrière Nginx (sinon `req.ip` renvoie
l'IP du proxy et les cookies `secure` cassent) — mais il concerne le backend hors dépôt.
⚠️ Si ce serveur applique du **rate limiting** par IP, `trust proxy` mal réglé le rend
soit inopérant, soit trivialement contournable via un `X-Forwarded-For` forgé : à
configurer avec le nombre exact de proxys, jamais `trust proxy = true` en aveugle.

### 6. Le port 3000 n'est pas ce qu'on croit

**Statut : [vérifié] — nuance importante.**

Le `3000` présent dans le dépôt est le **serveur de développement Vite**
(`vite.config.js` → `server.port: 3000`, avec `open: true`). Ce n'est **pas** un
service de production : `npm run build` produit des fichiers statiques dans `dist/`,
qui n'écoutent sur aucun port. Le serveur marketing, lui, écoute sur **4321**
(`MARKETING_PORT`), sur la boucle locale.

Donc « Nginx vers le port 3000 » ne correspond à rien de versionné. Si Nginx proxifie
bien un `:3000` en production, c'est le backend hors dépôt.

---

## Conventions de travail (gstack)

> Repris de la branche `claude/gstack-install-setup-7qfx5l`, dont le `CLAUDE.md`
> n'existait pas sur `main`. Ces règles s'appliquent quelle que soit la branche.

gstack est installé dans `~/.claude/skills/gstack` (skills liés dans `~/.claude/skills/`).

### Navigation web

- **Toujours** utiliser le skill `/browse` de gstack pour toute navigation web
  (ouvrir une page, cliquer, remplir un formulaire, screenshot, QA visuelle,
  scraping, vérification d'un rendu).
- **Ne jamais** utiliser les outils `mcp__claude-in-chrome__*`. Si une tâche semble
  les appeler, passer par `/browse` (ou `/open-gstack-browser` pour un navigateur
  visible piloté par l'agent).

### Skills gstack disponibles

| Domaine | Skills |
|---|---|
| Revue & plan | `/office-hours` `/plan-ceo-review` `/plan-eng-review` `/plan-design-review` `/autoplan` `/review` |
| Design | `/design-consultation` `/design-shotgun` `/design-html` `/design-review` |
| Livraison | `/ship` `/land-and-deploy` `/canary` `/benchmark` `/setup-deploy` |
| Navigateur | `/browse` `/open-gstack-browser` `/setup-browser-cookies` `/pair-agent` |
| QA | `/qa` `/qa-only` `/investigate` |
| Documentation | `/document-release` `/document-generate` `/retro` `/learn` |
| Garde-fous | `/careful` `/freeze` `/guard` `/unfreeze` `/cso` |
| Divers | `/codex` `/setup-gbrain` `/sync-gbrain` `/gstack-upgrade` |

---

## Sécurité du dépôt

⚠️ **`mediaproofagency-beep/Contractshield` est un dépôt PUBLIC** (vérifié le
2026-09-11). Tout ce qui y est committé est visible de tous, et le rester même
après suppression (forks, caches, archives).

- Le backend de production ne doit **pas** y être poussé : il va dans un dépôt
  **privé** séparé.
- Vérification faite à cette date : le tarball et les fichiers versionnés ne
  contiennent **aucun secret réel** (seul `VITE_API_URL=http://localhost:3001/api`,
  sans risque). L'adresse du VPS n'apparaît nulle part dans le dépôt.
- Avant tout `git add` sur ce dépôt, se rappeler qu'il est public.

---

## Le backend réel est désormais versionné

✅ **`mediaproofagency-beep/contractshield-prod` (privé)** porte le code de production :
`server/_core/llm.ts`, `magicLinkTokens`, `trust proxy`, PM2, Nginx, SMTP.

**Les cinq pièges y ont été vérifiés le 2026-09-11**, références `fichier:ligne` à
l'appui, dans le `CLAUDE.md` de ce dépôt-là. Résumé :

| Piège | Verdict côté production |
|---|---|
| SMTP port 2525 | **réel** — mais le défaut codé est 587, un port bloqué par Scaleway |
| `--no-frozen-lockfile` | **cause différente** — pnpm 12 sur le VPS vs pnpm 10.4.1 épinglé ; le lockfile est sain |
| `magicLinkTokens` | **réel** — table déclarée et utilisée, aucune migration n'existe |
| paramètre `thinking` | **absent** — et le fournisseur n'est pas Anthropic |
| `trust proxy` | **réel, et déjà correct** (`1`) |

⚠️ Les constats de la section ci-dessus restent valables **pour ce dépôt-ci** : le MVP
n'a effectivement ni backend, ni pnpm, ni Nginx. Les deux lectures ne se contredisent
pas — elles portent sur deux bases de code différentes.

Deux corrections à faire quoi qu'il arrive :
- **Extraire le tarball** et versionner le code réellement, ou retirer le tarball de `main`.
- ~~Réconcilier les CLAUDE.md~~ — **fait** : les conventions gstack sont reprises
  ci-dessus, section « Conventions de travail (gstack) ».
