# Bar des Capucins — Chez Ludo — notes de design

**Sujet.** Le seul endroit de Bordeaux où l'on mange du bœuf de Bazas à deux
heures du matin. Ouvert 22 h – 4 h, du mercredi au samedi, pour ceux qui
finissent quand les autres ferment : cuisiniers, serveurs, gens de nuit,
noctambules qui ne veulent pas d'un kebab.

**Palette.**
- `--nuit #14102A` — bleu-violet profond, le fond de toute la page
- `--velours #241A3E` — surfaces posées sur la nuit
- `--sodium #F2A65A` — l'orange des lampadaires bordelais, seule source de lumière
- `--os #EFE9DF` — le texte, blanc cassé jamais pur
- `--braise-froide #7A6E92` — texte secondaire

Le piège à éviter était « fond noir + accent vert acide ». Ici le noir est un
violet, et l'accent est la couleur réelle de l'éclairage public sous lequel on
arrive rue Émile-Laparra.

**Typographie.** *Instrument Serif* en display — une serif à contraste fort,
presque d'affiche de nuit, utilisée en très grand et en bas de casse.
*Space Grotesk* en texte, avec ses chiffres bien dessinés : la page est pleine
d'heures, elles doivent se lire d'un coup.

**Layout.** La page est une horloge. On arrive sur l'heure qu'il est réellement,
et tout le reste en découle.

```
┌──────────────────────────────────────────┐
│  chez ludo                    [ouvert ●] │
│                                          │
│        il est  23:47                     │  ← heure réelle du visiteur
│   la cuisine tourne encore 4 h 13        │
│                                          │
│  18 20 [22 ─────── 02 ─────── 04] 06 08  │  ← cadran 24 h, plage allumée
├──────────────────────────────────────────┤
│  CE QUI SE PASSE À CETTE HEURE-LÀ        │
│  22h · 00h · 02h · 03h30  (4 moments)    │
├──────────────────────────────────────────┤
│  LA CARTE — Bazas, magret, confit…       │
├──────────────────────────────────────────┤
│  LES FRITES — coupées devant vous        │
├──────────────────────────────────────────┤
│  MER-SAM 22h-4h · 27 rue Émile-Laparra   │
└──────────────────────────────────────────┘
```

**Signature.** L'heure du visiteur, en 90 px, et le cadran 24 h derrière. Quand
la page s'ouvre à 23 h 47 elle dit « la cuisine tourne encore 4 h 13 » ; à 15 h
elle dit « on ouvre dans 7 h ». Le site sait quelle heure il est, comme le
restaurant.

**Relecture.** Aucune autre adresse de la liste ne peut afficher ce cadran : ce
sont les seuls dont l'horaire est le sujet.
