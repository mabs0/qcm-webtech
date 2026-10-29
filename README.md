# QCM Webtech

Petite plateforme d'entraînement pour la banque de questions du cours Web Technologies
(<https://mcq-api.paul-farault.workers.dev/questions>).

- **Entraînement** : QCM de 10 à 40 questions tirées au hasard (tous les chapitres ou ceux choisis),
  note sur 20 à la fin, correction détaillée, « Refaire mes erreurs »
  - mode **Examen** : correction seulement à la fin
  - mode **Révision** : correction + explication après chaque question
- **Bibliothèque** : toutes les questions avec leurs bonnes réponses et une explication,
  recherche, filtre par chapitre, « Mes erreurs », « Jamais vues », réponses cachables
- Progression (notes, stats par question) gardée dans le `localStorage` du navigateur

Une question est juste seulement si **toutes** les bonnes réponses sont cochées, et aucune mauvaise.

## Le corrigé

L'API ne donne jamais les bonnes réponses : `site/data/answers.json` est un corrigé
**non officiel** rédigé à partir du cours, il peut contenir des erreurs.

```json
"247": { "correct": [2], "explanation": "…" }
```

`correct` contient les indices des bonnes réponses (0 = A). Une question sans corrigé
reste visible dans la bibliothèque mais n'est jamais tirée dans un QCM.

## Structure

```
site/                    ← publié tel quel sur GitHub Pages
  index.html, style.css, app.js
  data/questions.json    ← instantané de l'API
  data/answers.json      ← corrigé
scripts/fetch_questions.py
.github/workflows/pages.yml
```

L'API n'envoie pas d'en-têtes CORS, donc le site ne peut pas l'appeler depuis le navigateur.
`scripts/fetch_questions.py` en fait un instantané dans `site/data/questions.json`
et liste les questions qui n'ont pas encore de corrigé.

## En local

```bash
python3 scripts/fetch_questions.py         # met à jour les questions (optionnel)
python3 -m http.server 8765 -d site        # → http://localhost:8765
```

## GitHub Pages

Le workflow `.github/workflows/pages.yml` déploie `site/` à chaque push sur `main`
et tous les jours à 5 h (UTC), en récupérant les nouvelles questions au passage.

Une seule fois, dans le dépôt : **Settings → Pages → Source : GitHub Actions**.
