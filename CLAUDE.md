# CLAUDE.md — Contractshield

## gstack

gstack est installé dans `~/.claude/skills/gstack` (skills liés dans `~/.claude/skills/`).

### Navigation web

- **Toujours** utiliser le skill `/browse` de gstack pour toute navigation web
  (ouvrir une page, cliquer, remplir un formulaire, screenshot, QA visuelle,
  scraping, vérification d'un rendu).
- **Ne jamais** utiliser les outils `mcp__claude-in-chrome__*`. Si une tâche
  semble les appeler, passer par `/browse` (ou `/open-gstack-browser` pour un
  navigateur visible piloté par l'agent).

### Skills gstack disponibles

- `/office-hours` — session de type YC office hours
- `/plan-ceo-review` — revue de plan en mode CEO/fondateur
- `/plan-eng-review` — revue de plan en mode eng manager
- `/plan-design-review` — revue de plan en mode designer
- `/design-consultation` — consultation design (système, typo, couleurs, layout)
- `/design-shotgun` — génération et comparaison de variantes de design
- `/design-html` — finalisation design en HTML/CSS de production
- `/review` — revue de PR avant merge
- `/ship` — workflow de livraison (tests, diff, version, changelog, PR)
- `/land-and-deploy` — merge + déploiement
- `/canary` — surveillance canary post-déploiement
- `/benchmark` — détection de régressions de performance
- `/browse` — navigateur headless rapide (QA, dogfooding)
- `/open-gstack-browser` — lancement du GStack Browser (Chromium piloté)
- `/qa` — QA systématique d'une app web + correction des bugs
- `/qa-only` — QA en lecture seule (rapport sans correction)
- `/design-review` — QA visuelle « œil de designer »
- `/setup-browser-cookies` — import des cookies du navigateur réel
- `/setup-deploy` — configuration du déploiement
- `/setup-gbrain` — installation et initialisation de gbrain
- `/sync-gbrain` — synchronisation de gbrain avec le repo
- `/retro` — rétrospective d'ingénierie
- `/investigate` — debug systématique avec analyse de cause racine
- `/document-release` — documentation post-livraison
- `/document-generate` — génération de documentation manquante
- `/codex` — wrapper OpenAI Codex CLI
- `/cso` — mode Chief Security Officer
- `/autoplan` — pipeline de revues automatiques (CEO, design, eng, DX)
- `/pair-agent` — pairing d'un agent distant avec le navigateur
- `/careful` — garde-fous sur les commandes destructrices
- `/freeze` — restriction des éditions à un répertoire
- `/guard` — mode sécurité complet (careful + freeze)
- `/unfreeze` — levée de la restriction posée par `/freeze`
- `/gstack-upgrade` — mise à jour de gstack
- `/learn` — gestion des apprentissages du projet
