# Icon Valais

Application de club (Expo Router + Supabase) : comptes élèves / professeurs / administrateurs,
consentement parental pour les moins de 16 ans, interface en 4 langues (fr, de, en, ru).

## Prérequis

- Node.js 20+ et npm
- Docker (pour la stack Supabase locale)
- [Deno](https://deno.com) (tests des Edge Functions)
- Playwright (uniquement pour le test e2e)

```bash
npm install
```

## Configuration (`.env`)

Créer `icon-valais/.env` (ignoré par git, ne jamais le committer) avec les valeurs affichées par
`npx supabase status` :

```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY ou PUBLISHABLE_KEY>
```

## Backend local

```bash
npx supabase start     # démarre Postgres, Auth, REST, etc. et applique supabase/migrations
npx supabase status    # URL et clés
npx supabase db reset  # (optionnel) rejoue les migrations depuis zéro
npx supabase stop
```

### Edge Functions

`send-parent-consent`, `confirm-parent-consent` et `delete-account` sont dans `supabase/functions`.
Secrets requis (à définir avec `npx supabase secrets set ...` en production, ou dans un fichier
`supabase/functions/.env` pour `npx supabase functions serve`) :

| Variable | Rôle |
| --- | --- |
| `RESEND_API_KEY` | clé API Resend pour l'envoi de l'e-mail au parent |
| `CONSENT_FROM_EMAIL` | adresse expéditrice (domaine vérifié chez Resend) |
| `PUBLIC_FUNCTIONS_URL` | (optionnel) URL publique des fonctions, utilisée pour construire le lien de confirmation ; à défaut, déduite de la requête |

`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis automatiquement par Supabase.

## Lancer l'application

```bash
npx expo start          # puis w (web), i (iOS) ou a (Android)
npx expo start --web    # web directement
```

## Tests

```bash
npx tsc --noEmit                                                    # types
npx jest                                                            # tests unitaires / composants
npx supabase test db                                                # tests pgTAP (stack locale démarrée)
deno test --config supabase/functions/deno.json supabase/functions/_shared   # Edge Functions (aussi : npm run test:functions)
```

### Test de bout en bout (Playwright)

`e2e/smoke.e2e.mjs` pilote l'application web contre la stack locale : inscription élève, inscription
professeur (écran « en attente »), validation par un administrateur, inscription d'un mineur
(écran de consentement parental) et changement de langue.

```bash
npx supabase start
npx expo start --web --port 8081      # dans un autre terminal, avec .env rempli
SHOT_DIR=/tmp/e2e node e2e/smoke.e2e.mjs   # ou : npm run e2e
```

Variables : `BASE_URL` (défaut `http://localhost:8081`), `SHOT_DIR` (captures d'écran),
`DB_CONTAINER` (défaut `supabase_db_icon-valais`, utilisé via `docker exec` pour promouvoir
l'administrateur de test). Le paquet `playwright` doit être résolvable par Node
(`npm i -g playwright` puis `NODE_PATH=$(npm root -g)` si nécessaire). L'envoi réel de l'e-mail au
parent n'est pas vérifié (Edge Functions non démarrées par ce script).

## Créer le premier administrateur

Les administrateurs ne peuvent pas s'inscrire eux-mêmes : créer un compte normal, puis le promouvoir
en SQL avec le rôle `postgres` (Studio > SQL editor, ou `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres`) :

```sql
update profiles set role = 'admin' where email = 'admin@example.com';
```

Les professeurs inscrits restent « en attente de validation » jusqu'à ce qu'un administrateur les
valide dans l'onglet Admin (filtre « Profs en attente »).
