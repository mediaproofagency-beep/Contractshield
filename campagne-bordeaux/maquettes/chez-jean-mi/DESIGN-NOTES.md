# Bistrot à huîtres Chez Jean-Mi — notes de design

**Sujet.** L'institution huîtres du marché des Capucins. Mille deux cents avis,
aucune vitrine web. Ce qu'on y vient chercher tient en une ligne : six huîtres et
un verre de blanc pour onze euros, debout, à côté des écaillers.

**Palette.**
- `--ardoise #16302C` — vert-noir d'ardoise, le fond des blocs de prix
- `--nacre #EDF1EF` — gris froid nacré, fond de page (surtout pas un crème)
- `--iode #2C6E63` — le vert d'eau des bacs à coquillages
- `--citron #F5C243` — le quartier de citron, en aplat derrière le prix
- `--galet #B9C4BE` — filets et texte secondaire

**Typographie.** *Anton* en display : une condensée très grasse qui tient un
nombre à 200 px de haut sans se casser. *Karla* en texte, un peu ronde, pour
casser la brutalité du chiffre. Aucune serif, aucun script « bord de mer ».

**Layout.** Le prix arrive avant le nom du restaurant. Toute la première hauteur
d'écran est occupée par un ticket.

```
┌──────────────────────────────────────────┐
│ CHEZ JEAN-MI          marché des Capucins│
│                                          │
│   6 HUÎTRES + UN VERRE                   │
│   ██████ 11 € ██████                     │  ← 200px, aplat citron
│   debout, au comptoir, midi et soir      │
├──────────────────────────────────────────┤
│  L'ARDOISE   (prix à gauche, gros)       │
│   11 €  6 huîtres + verre                │
│    9 €  soupe de poisson                 │
│   ...                                    │
├──────────────────────────────────────────┤
│  1209 AVIS. AUCUNE PAGE POUR LES LIRE.   │
├──────────────────────────────────────────┤
│  LA SOUPE — le second plat le plus cité  │
├──────────────────────────────────────────┤
│  VENIR — dans le marché, pas à côté      │
└──────────────────────────────────────────┘
```

**Signature.** Le prix comme image. `11 €` en Anton sur aplat citron, plus grand
que l'enseigne, et toute l'ardoise ensuite construite prix-à-gauche : c'est
l'inverse de la carte de restaurant habituelle, et c'est exactement l'argument
de la maison.

**Relecture.** Une page dont le premier élément visuel est un prix ne convient à
aucun autre prospect de la liste — les neuf autres vendent une cuisine, pas un
tarif.
