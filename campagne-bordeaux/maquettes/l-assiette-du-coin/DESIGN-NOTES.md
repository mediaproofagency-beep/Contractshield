# L'assiette du coin — notes de design

**Sujet.** Une cheffe-propriétaire, avenue Thiers, qui cuisine bio et change son
menu toutes les semaines, uniquement le midi, du lundi au vendredi. Le problème
n'est pas de montrer un menu : c'est qu'il faut pouvoir le remplacer chaque
lundi matin sans appeler personne.

**Palette.**
- `--encre-bleue #23438A` — bleu de stylo sur cahier, couleur principale
- `--papier #FAFBF6` — blanc très légèrement vert, jamais crème
- `--reglure #D8E1EE` — le quadrillage, en fond réel de la page
- `--jardin #46702F` — vert des légumes, pour le bio et les accents
- `--mine #454A41` — gris de crayon, texte secondaire

**Typographie.** *Bricolage Grotesque* en display — une grotesque un peu de
travers, qui a l'air écrite plutôt que composée. *Newsreader* en texte : une
serif de lecture, à contre-emploi du display, qui donne au menu l'air d'un
document plutôt que d'une affiche.

**Layout.** Un cahier de semaine. Fond quadrillé véritable (CSS), et cinq
colonnes lundi-vendredi. Pas de samedi, pas de dimanche : la grille dit
l'horaire.

```
┌──────────────────────────────────────────┐
│ L'assiette du coin        200 av. Thiers │
│ ╔══════════════════════════════════════╗ │
│ ║ SEMAINE DU 25 AU 29 AOÛT   [21 €]    ║ │  ← tampon, dates calculées
│ ╚══════════════════════════════════════╝ │
│ ┌LUN─┬MAR─┬MER─┬JEU─┬VEN─┐               │
│ │entr│    │    │    │    │  ← colonne du │
│ │plat│    │    │    │    │    jour mise  │
│ │dess│    │    │    │    │    en avant   │
│ └────┴────┴────┴────┴────┘               │
│  [semaine en cours] [semaine suivante]   │  ← démo du changement
├──────────────────────────────────────────┤
│  CHANGER LA SEMAINE PREND DEUX MINUTES   │
├──────────────────────────────────────────┤
│  LA MAISON — pierre, poutres, terrasse   │
├──────────────────────────────────────────┤
│  MIDI SEULEMENT, LUN-VEN                 │
└──────────────────────────────────────────┘
```

**Signature.** Deux boutons qui basculent la page d'une semaine à l'autre,
devant le visiteur. C'est la démonstration commerciale : le menu n'est pas une
image à refaire chez le graphiste, c'est une liste qu'on remplace. La section
suivante montre l'objet à modifier, en clair.

**Relecture.** Une page dont la structure entière est une semaine ouvrable ne
peut pas servir à un bar ouvert 22 h – 4 h ni à un comptoir à huîtres.
