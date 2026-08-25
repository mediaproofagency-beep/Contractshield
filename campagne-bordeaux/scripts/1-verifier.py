#!/usr/bin/env python3
"""
Phase 1 — Verification et enrichissement des prospects.

Appelle Places Details API (v1) pour chaque place_id de
data/prospects-bordeaux.json, puis classe chaque etablissement :

    CIBLE          websiteUri absent
    CIBLE_FAIBLE   websiteUri = reseau social / agregateur / page auto-generee
    EXCLU          vrai domaine propre et site vivant

Verifie aussi le domaine "evident" (<slug>.fr / .com) : certains sites
existent sans etre declares sur Google.

Sortie : data/cibles.json

Usage :
    export GOOGLE_PLACES_API_KEY=...
    python3 scripts/1-verifier.py            # verifie les 15 candidats
    python3 scripts/1-verifier.py --no-dns   # saute le test des domaines evidents

Sans cle API le script s'arrete : il ne produit jamais de verdict devine.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
PROSPECTS = RACINE / "data" / "prospects-bordeaux.json"
SORTIE = RACINE / "data" / "cibles.json"

DETAILS_URL = "https://places.googleapis.com/v1/places/{place_id}"

# NOTE : le brief donne le field mask sous la forme "places.displayName,..."
# — c'est la forme attendue par places:searchText. L'endpoint Details (GET
# /v1/places/{id}) renvoie UN place, donc le mask s'ecrit sans le prefixe
# "places.". Meme liste de champs, prefixe retire.
FIELD_MASK = ",".join([
    "displayName",
    "websiteUri",
    "nationalPhoneNumber",
    "formattedAddress",
    "rating",
    "userRatingCount",
    "priceLevel",
    "regularOpeningHours",
    "reviews",
    "photos",
    "editorialSummary",
    "primaryType",
])

# Hotes qui ne constituent pas un site propre.
HOTES_FAIBLES = (
    "facebook.com", "fb.me", "instagram.com", "linktr.ee", "eatbu.com",
    "placejoys.com", "thefork.", "lafourchette.", "tripadvisor.",
    "ubereats.com", "deliveroo.", "just-eat.", "wixsite.com",
    "business.site", "google.com", "sites.google.com", "linktree",
    "zenchef.com", "resy.com", "opentable.", "petitfute.", "yelp.",
    "pagesjaunes.fr", "restaurantguru.", "menulist.", "theforkmanager.",
)

MOTS_EN_CONSTRUCTION = (
    "en construction", "under construction", "coming soon",
    "site en cours", "bientot disponible", "default web page",
    "domain for sale", "a vendre",
)


def slugifier(nom: str) -> str:
    base = unicodedata.normalize("NFKD", nom).encode("ascii", "ignore").decode()
    base = re.sub(r"[^a-zA-Z0-9]+", "-", base).strip("-").lower()
    return re.sub(r"-+", "-", base)


def appeler_details(place_id: str, cle: str) -> dict:
    requete = urllib.request.Request(
        DETAILS_URL.format(place_id=urllib.parse.quote(place_id)),
        headers={
            "X-Goog-Api-Key": cle,
            "X-Goog-FieldMask": FIELD_MASK,
            "Accept-Language": "fr-FR",
        },
    )
    with urllib.request.urlopen(requete, timeout=20) as reponse:
        return json.load(reponse)


def page_vivante(url: str) -> tuple[bool, str]:
    """True si l'URL repond 200 et ne ressemble pas a une page parking/vide."""
    try:
        requete = urllib.request.Request(
            url, headers={"User-Agent": "MediaProof-verif/1.0"})
        with urllib.request.urlopen(requete, timeout=12) as reponse:
            if reponse.status >= 400:
                return False, f"HTTP {reponse.status}"
            corps = reponse.read(60_000).decode("utf-8", "ignore").lower()
    except Exception as erreur:  # DNS, TLS, 404, timeout
        return False, type(erreur).__name__
    for motif in MOTS_EN_CONSTRUCTION:
        if motif in corps:
            return False, f"page parking ({motif})"
    if len(re.sub(r"<[^>]+>", "", corps).split()) < 40:
        return False, "page quasi vide"
    return True, "page vivante"


def domaines_evidents(nom: str) -> list[str]:
    slug = slugifier(nom)
    compact = slug.replace("-", "")
    bases = {slug, compact}
    # "Bistrot a huitres Chez Jean-Mi" -> "chezjeanmi", "jeanmi"
    mots = [m for m in slug.split("-") if m not in
            ("le", "la", "les", "l", "du", "de", "des", "a", "chez", "bar",
             "bistrot", "restaurant")]
    if mots:
        bases.add("".join(mots))
    return [f"https://{b}.{tld}" for b in sorted(bases) if len(b) > 3
            for tld in ("fr", "com")]


def classer(site: str | None, verif_domaine: dict | None) -> tuple[str, str]:
    if not site:
        if verif_domaine:
            return ("EXCLU",
                    f"pas de websiteUri sur Google mais site trouve : "
                    f"{verif_domaine['url']}")
        return "CIBLE", "aucun websiteUri sur la fiche Google"

    hote = urllib.parse.urlparse(site).netloc.lower()
    for faible in HOTES_FAIBLES:
        if faible in hote:
            return "CIBLE_FAIBLE", f"page hebergee sur {hote} (non propre)"

    vivante, detail = page_vivante(site)
    if not vivante:
        return "CIBLE_FAIBLE", f"domaine propre mais {detail} : {site}"
    return "EXCLU", f"site propre et vivant : {site}"


def main() -> int:
    parseur = argparse.ArgumentParser()
    parseur.add_argument("--no-dns", action="store_true",
                         help="ne pas tester les domaines evidents")
    parseur.add_argument("--pause", type=float, default=0.4)
    args = parseur.parse_args()

    cle = os.environ.get("GOOGLE_PLACES_API_KEY")
    if not cle:
        print("GOOGLE_PLACES_API_KEY absente. Aucun verdict ne peut etre "
              "produit sans appel reel a Places Details.", file=sys.stderr)
        print("Le fichier data/cibles.json existant reste marque "
              "verifie=false pour les prospects non confirmes.",
              file=sys.stderr)
        return 2

    prospects = json.loads(PROSPECTS.read_text(encoding="utf-8"))
    resultats = []

    for prospect in prospects["shortlist_15_pour_retenir_10"]:
        nom, place_id = prospect["nom"], prospect["place_id"]
        try:
            details = appeler_details(place_id, cle)
        except urllib.error.HTTPError as erreur:
            print(f"[!] {nom}: HTTP {erreur.code} — {erreur.read()[:200]!r}",
                  file=sys.stderr)
            resultats.append({**prospect, "verdict": "ERREUR_API",
                              "verifie": False,
                              "motif": f"HTTP {erreur.code}"})
            continue

        site = details.get("websiteUri")

        trouve = None
        if not site and not args.no_dns:
            for url in domaines_evidents(nom):
                vivante, detail = page_vivante(url)
                if vivante:
                    trouve = {"url": url, "detail": detail}
                    break

        verdict, motif = classer(site, trouve)
        resultats.append({
            "nom": details.get("displayName", {}).get("text", nom),
            "slug": slugifier(nom),
            "place_id": place_id,
            "verdict": verdict,
            "motif": motif,
            "verifie": True,
            "verifie_le": time.strftime("%Y-%m-%d"),
            "site_web": site,
            "telephone": details.get("nationalPhoneNumber")
                         or prospect.get("telephone"),
            "adresse": details.get("formattedAddress") or prospect["adresse"],
            "quartier": prospect.get("quartier"),
            "note": details.get("rating", prospect.get("note")),
            "nb_avis": details.get("userRatingCount", prospect.get("nb_avis")),
            "niveau_prix": details.get("priceLevel"),
            "type": details.get("primaryType"),
            "resume_google": (details.get("editorialSummary") or {}).get("text"),
            "horaires": (details.get("regularOpeningHours") or {})
                        .get("weekdayDescriptions"),
            "avis": [
                {"note": a.get("rating"),
                 "texte": (a.get("text") or {}).get("text", "")[:600]}
                for a in details.get("reviews", [])[:5]
            ],
            "thematique": prospect.get("thematique"),
            "signaux": prospect.get("signaux"),
        })
        print(f"{verdict:<13} {nom} — {motif}")
        time.sleep(args.pause)

    gardes = [r for r in resultats
              if r["verdict"] in ("CIBLE", "CIBLE_FAIBLE")]
    sortie = {
        "genere_le": time.strftime("%Y-%m-%d %H:%M"),
        "source": "Places Details API v1",
        "regle": "Aucun email ne part vers un prospect dont verifie != true "
                 "ou dont le verdict n'est pas CIBLE / CIBLE_FAIBLE.",
        "retenus": gardes[:10],
        "reserve": gardes[10:],
        "exclus": [r for r in resultats
                   if r["verdict"] not in ("CIBLE", "CIBLE_FAIBLE")],
    }
    SORTIE.write_text(json.dumps(sortie, ensure_ascii=False, indent=2),
                      encoding="utf-8")
    print(f"\n{len(gardes)} cibles retenues -> {SORTIE}")
    if len(gardes) < 10:
        print("Moins de 10 cibles : elargir via places:searchText sur "
              "Saint-Pierre, Nansouty, Cauderan, Talence, Begles "
              "(< 700 avis, note >= 4.3, telephone mobile ou 09).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
