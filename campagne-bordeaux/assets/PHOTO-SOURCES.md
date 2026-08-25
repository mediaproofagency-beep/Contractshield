# Sources visuelles — campagne maquettes Bordeaux

## Décision : aucune photographie dans les dix maquettes

Les dix maquettes sont construites **sans aucun fichier image**. Tout ce qui est
visuel est du CSS et du SVG écrits à la main, inline dans le `index.html`.

Trois raisons, dans l'ordre où elles pèsent :

1. **Les photos Google Places sont hors de question.** Les conditions Google
   interdisent de les stocker et de les réafficher hors d'un contexte Google
   Maps. Une maquette commerciale envoyée par email est exactement le cas
   interdit. Aucune photo issue de l'API Places n'a été téléchargée.
2. **Une photo Unsplash de « bistrot générique » dessert la vente.** Le
   restaurateur reconnaît immédiatement la banque d'images, et la maquette
   devient un template. Or l'argument de cette campagne est précisément
   l'inverse : quelqu'un a regardé *son* établissement.
3. **Le traitement graphique montre le design sans prétendre montrer leur
   cuisine.** C'est la troisième option du brief, et sur ces dix sujets c'est la
   plus solide : chaque maquette porte sa signature en typographie, couleur et
   dessin vectoriel.

Effet secondaire utile : zéro requête image, chargement bien sous les 2 s
exigés, et un fichier unique qui s'ouvre au double-clic.

## Traçabilité — ce que contient chaque maquette

| Maquette | Éléments visuels | Origine | Statut |
|---|---|---|---|
| le-guet-a-pan | Plan du marché des Capucins (SVG), pictogrammes d'étals, trame de braise CSS | Dessin original MediaProof | libre |
| chez-ludo | Cadran 24 h (SVG), halo de lampe sodium (dégradé CSS) | Dessin original MediaProof | libre |
| chez-jean-mi | Ardoise de prix (CSS), coquille d'huître (SVG), houle (SVG) | Dessin original MediaProof | libre |
| l-assiette-du-coin | Grille semaine (CSS), tampon « semaine du » (SVG) | Dessin original MediaProof | libre |
| l-oustaou | Rangée de pins landais (SVG), fond de nuit CSS | Dessin original MediaProof | libre |
| casa-gatti | Chat au trait (SVG), nappe à carreaux (dégradé CSS) | Dessin original MediaProof | libre |
| le-calixte | Pastilles de filtre (CSS), feuillage au trait (SVG) | Dessin original MediaProof | libre |
| la-mere-michel | Flèche Saint-Michel (SVG), ruban horaire (CSS) | Dessin original MediaProof | libre |
| toopita | Mosaïque géométrique (SVG pattern), grille de mezzés (CSS) | Dessin original MediaProof | libre |
| dat-viet | Bol et vapeur (SVG), frise du bouillon (CSS) | Dessin original MediaProof | libre |

Aucune image n'est marquée `data-placeholder="true"` : il n'y a aucune image à
marquer.

## Si le prospect répond et qu'il faut des photos

Ordre à suivre, jamais Google Places :

1. **Ses propres photos** (page Facebook / Instagram publique), uniquement dans
   la maquette qu'on lui montre à lui, jamais en mise en ligne publique.
   Créditer en pied de maquette : « Visuels provenant de votre page Facebook, à
   remplacer par un reportage photo. »
2. **Unsplash / Pexels** sélectionnées par thème, chaque balise portant
   `data-placeholder="true"`, et la ligne ajoutée à ce tableau (URL, auteur,
   licence).
3. **Reportage photo** au devis — c'est de toute façon ce qu'on vend ensuite.

Chaque ajout d'image met à jour ce fichier : fichier, page, URL source, auteur,
licence, date.
