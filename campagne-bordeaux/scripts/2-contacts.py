#!/usr/bin/env python3
"""
Phase 4 — Assemblage des contacts.

Ce script ne devine JAMAIS une adresse email. Il assemble ce qu'une recherche
manuelle a trouve (data/recherche-emails.json), le valide, et bascule tout le
reste vers des canaux alternatifs.

Entrees :
    data/cibles.json            (sortie de 1-verifier.py)
    data/recherche-emails.json  (rempli a la main, voir --modele)

Sorties :
    data/contacts.json              email + source + confiance
    data/contacts-alternatifs.json  Messenger / Instagram / telephone / passage

Usage :
    python3 scripts/2-contacts.py --modele   # ecrit un squelette a completer
    python3 scripts/2-contacts.py            # assemble et valide
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
CIBLES = RACINE / "data" / "cibles.json"
RECHERCHE = RACINE / "data" / "recherche-emails.json"
CONTACTS = RACINE / "data" / "contacts.json"
ALTERNATIFS = RACINE / "data" / "contacts-alternatifs.json"

# Ordre de recherche du brief. Une adresse sans source dans cette liste est
# refusee : c'est le seul garde-fou contre les adresses inventees.
SOURCES_VALIDES = {
    "fiche_google": "Fiche Google Business Profile (editorialSummary, posts)",
    "facebook_infos": "Page Facebook, section Informations",
    "instagram_bio": "Bio Instagram",
    "societe_com": "societe.com",
    "infobel": "Infobel",
    "pagesjaunes": "PagesJaunes",
    "restaurants_de_france": "restaurants-de-france.com",
    "site_existant": "Page contact d'un site existant (cas CIBLE_FAIBLE)",
    "communication_directe": "Donnee par l'etablissement (telephone, passage)",
}

# Adresses generiques : acceptees seulement si la source les a reellement vues.
PREFIXES_GENERIQUES = ("contact@", "info@", "hello@", "bonjour@", "reservation@")

RE_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)


def modele() -> int:
    cibles = json.loads(CIBLES.read_text(encoding="utf-8"))
    entrees = []
    for c in cibles["retenus"]:
        entrees.append({
            "slug": c["slug"],
            "nom": c["nom"],
            "email": None,
            "source": None,
            "_sources_possibles": sorted(SOURCES_VALIDES),
            "confiance": None,
            "_confiance_possible": ["haute", "moyenne"],
            "vu_le": None,
            "note": "",
        })
    RECHERCHE.write_text(json.dumps({
        "regle": "Ne jamais ecrire une adresse qu'on n'a pas vue ecrite quelque "
                 "part. Un champ email nul est un resultat valide : le prospect "
                 "bascule sur contacts-alternatifs.json.",
        "ordre_de_recherche": [SOURCES_VALIDES[k] for k in
                               ("fiche_google", "facebook_infos", "instagram_bio",
                                "societe_com", "infobel", "pagesjaunes",
                                "restaurants_de_france", "site_existant")],
        "entrees": entrees,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Modele ecrit dans {RECHERCHE}")
    return 0


def valider(entree: dict) -> list[str]:
    erreurs = []
    email = (entree.get("email") or "").strip()
    if not email:
        return erreurs
    if not RE_EMAIL.match(email):
        erreurs.append(f"{entree['slug']}: '{email}' n'est pas une adresse valide")
    source = entree.get("source")
    if source not in SOURCES_VALIDES:
        erreurs.append(
            f"{entree['slug']}: source '{source}' inconnue. "
            f"Une adresse sans source verifiable ne part pas.")
    if entree.get("confiance") not in ("haute", "moyenne"):
        erreurs.append(f"{entree['slug']}: confiance doit valoir haute ou moyenne")
    if email.lower().startswith(PREFIXES_GENERIQUES) and not entree.get("vu_le"):
        erreurs.append(
            f"{entree['slug']}: adresse generique '{email}' sans date de "
            f"constatation. Si elle n'a pas ete VUE, c'est une adresse devinee "
            f"— elle genere un bounce et degrade la reputation d'envoi.")
    return erreurs


def canaux_alternatifs(cible: dict) -> list[dict]:
    canaux = []
    signaux = (cible.get("signaux") or "") + " " + (cible.get("site_web") or "")
    if "facebook" in signaux.lower():
        canaux.append({
            "type": "messenger",
            "detail": "Page Facebook de l'etablissement, message direct",
            "note": "Souvent le canal reel des bistrots sans site.",
        })
    if cible.get("telephone"):
        canaux.append({
            "type": "telephone",
            "detail": cible["telephone"],
            "note": "Appeler entre 15 h et 17 h, hors service.",
        })
    canaux.append({
        "type": "passage",
        "detail": cible.get("adresse"),
        "note": "Passer vers 15 h avec la maquette ouverte sur une tablette. "
                "Meilleur taux de reponse que l'email sur ce profil.",
    })
    return canaux


def main() -> int:
    parseur = argparse.ArgumentParser()
    parseur.add_argument("--modele", action="store_true",
                         help="ecrire le squelette de recherche-emails.json")
    args = parseur.parse_args()

    if args.modele:
        return modele()

    cibles = json.loads(CIBLES.read_text(encoding="utf-8"))
    par_slug = {c["slug"]: c for c in cibles["retenus"]}

    if RECHERCHE.exists():
        recherche = json.loads(RECHERCHE.read_text(encoding="utf-8"))["entrees"]
    else:
        print(f"{RECHERCHE.name} absent — lancer d'abord --modele.", file=sys.stderr)
        return 2

    erreurs = [e for entree in recherche for e in valider(entree)]
    if erreurs:
        print("Refus d'ecrire les contacts :", file=sys.stderr)
        for e in erreurs:
            print("  - " + e, file=sys.stderr)
        return 1

    avec, sans = [], []
    for entree in recherche:
        cible = par_slug.get(entree["slug"])
        if cible is None:
            print(f"[!] {entree['slug']} absent de cibles.json, ignore",
                  file=sys.stderr)
            continue
        if entree.get("email"):
            avec.append({
                "slug": entree["slug"],
                "nom": cible["nom"],
                "email": entree["email"].strip(),
                "source": entree["source"],
                "source_libelle": SOURCES_VALIDES[entree["source"]],
                "confiance": entree["confiance"],
                "vu_le": entree.get("vu_le"),
                "prenom_contact": entree.get("prenom_contact"),
                "variante_email": cible.get("variante_email"),
                "verifie_sans_site": cible.get("verifie") is True,
            })
        else:
            sans.append({
                "slug": entree["slug"],
                "nom": cible["nom"],
                "raison": entree.get("note") or "Aucune adresse publique trouvee.",
                "canaux": canaux_alternatifs(cible),
            })

    entete = {"genere_le": time.strftime("%Y-%m-%d %H:%M")}
    CONTACTS.write_text(json.dumps({
        **entete,
        "regle": "Aucune adresse devinee. Chaque entree porte la source ou elle "
                 "a ete lue.",
        "contacts": avec,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    ALTERNATIFS.write_text(json.dumps({
        **entete,
        "regle": "Prospects sans email public. Ne pas fabriquer d'adresse : "
                 "passer par ces canaux.",
        "prospects": sans,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"{len(avec)} contacts email -> {CONTACTS.name}")
    print(f"{len(sans)} prospects sans email -> {ALTERNATIFS.name}")
    for s in sans:
        print(f"  · {s['nom']} : " +
              ", ".join(c["type"] for c in s["canaux"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
