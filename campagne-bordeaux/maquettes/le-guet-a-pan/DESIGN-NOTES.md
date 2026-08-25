# Le Guet-A-Pan — notes de design

**Sujet.** Une cantine de marché place des Capucins qui cuit au four Josper ce
qu'elle achète le matin aux étals d'à côté, pour des gens qui viennent manger
sans cérémonie et repartir.

**Palette.**
- `--encre #16130F` — noir de fonte, texte et cadres
- `--craie #FDFCFA` — fond, blanc de panneau émaillé
- `--braise #D93B18` — la seule couleur vive, celle du charbon en cours
- `--fonte #4A4238` — gris chaud des filets et du plan
- `--zinc #DCDDD8` — gris froid des surfaces secondaires

Pas de crème, pas de terracotta : ici le rouge est celui de la braise, appliqué
en aplats de signalétique, jamais en fond.

**Typographie.** *Archivo Black* en display — la graisse des panneaux de halle,
en capitales serrées. *Public Sans* en texte, neutre et lisible à 360 px. Aucune
serif : le sujet est un marché, pas une maison bourgeoise.

**Layout.** Une affiche de halle : bandeau signalétique en haut, puis le **plan
du marché** en pleine largeur, puis la carte, puis les infos pratiques. Une
seule colonne, cadrée comme un panneau accroché.

```
┌──────────────────────────────────────────┐
│ LE GUET-A-PAN        [tel]  [Capucins]   │
│ ██ UN PETIT COUP ET ÇA REPART ██         │  bandeau braise
├──────────────────────────────────────────┤
│  On achète à 8 h. On sert à midi.        │
│                                          │
│   ┌───── PLAN DU MARCHÉ ─────┐  ①  le    │
│   │  ②      ③        ①      │      poisson│
│   │        [NOUS]     ④      │  ②  le     │
│   │    ⑤        ⑥           │      boucher│
│   └──────────────────────────┘  ...       │  ← survol lié
├──────────────────────────────────────────┤
│ LE JOSPER  — 350°, charbon, rien d'autre │
├──────────────────────────────────────────┤
│ LA CARTE (tapas / grillades / à partager)│
├──────────────────────────────────────────┤
│ VENIR  adresse · téléphone · horaires    │
└──────────────────────────────────────────┘
```

**Signature.** Le plan du marché avec les distances. Six étals numérotés, la
distance en mètres jusqu'à notre comptoir, et ce qu'on y achète. Survoler un
fournisseur allume son point sur le plan. C'est le contenu que personne d'autre
de la liste ne peut avoir : il est fait de la géographie du bâtiment.

**Relecture.** Cette page ne peut servir à aucun autre restaurant de la liste :
son contenu principal est un plan des Capucins avec la position du comptoir.
