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

`send-parent-consent`, `confirm-parent-consent`, `delete-account` et `send-push` sont dans `supabase/functions`.
Secrets requis (à définir avec `npx supabase secrets set ...` en production, ou dans un fichier
`supabase/functions/.env` pour `npx supabase functions serve`) :

| Variable | Rôle |
| --- | --- |
| `RESEND_API_KEY` | clé API Resend pour l'envoi de l'e-mail au parent |
| `CONSENT_FROM_EMAIL` | adresse expéditrice (domaine vérifié chez Resend) |
| `PUBLIC_FUNCTIONS_URL` | (optionnel) URL publique des fonctions, utilisée pour construire le lien de confirmation ; à défaut, déduite de la requête |

`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis automatiquement par Supabase.

## Notifications et tâches planifiées

Les notifications sont écrites dans `notification_outbox` (annulation de cours, créneau sans prof,
prof validé) puis envoyées par l'Edge Function `send-push` (Expo Push). L'application enregistre le
jeton Expo de l'appareil avec `register_push_token(p_token, p_platform)` (table `push_tokens`).

Deux tâches `pg_cron` sont créées par la migration `0006_notifications.sql` :

| Tâche | Fréquence | Rôle |
| --- | --- | --- |
| `process-course-schedule` | toutes les 5 minutes | `process_course_schedule()` : cours sans prof dans les 24 h → notification `slot_vacant` aux profs validés et aux admins, aux admins seulement pour un cours privé (une seule fois par cours) ; cours sans prof commencé → Open Mat |
| `send-push` | chaque minute | s'il reste des notifications en attente, appelle `POST <functions_url>/send-push` via `pg_net` |

`send-push` n'accepte que la clé `service_role` (`Authorization: Bearer <clé>`). La tâche lit l'URL et
la clé dans Supabase Vault ; tant que ces deux secrets n'existent pas, elle ne fait rien (sans erreur).
À créer une fois par projet (éditeur SQL du tableau de bord, ou `psql`) :

```sql
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1', 'functions_url');
select vault.create_secret('<clé service_role du projet>', 'service_role_key');
```

`functions_url` est la base des fonctions, sans `/send-push`. `service_role_key` doit être la même
valeur que `SUPABASE_SERVICE_ROLE_KEY` dans les fonctions (clé JWT `service_role`, page *Settings → API*).
Pour la changer : `select vault.update_secret(id, '<nouvelle valeur>') from vault.secrets where name = 'service_role_key';`.
En local (depuis le conteneur Postgres) : `http://supabase_kong_icon-valais:8000/functions/v1` et la
clé `service_role` affichée par `npx supabase status`.

La clé `service_role` transite par la file de requêtes de `pg_net` (`net.http_request_queue`, dans
la base, le temps de l'envoi) : seul le rôle `postgres` / `service_role` y a accès.

Secret optionnel de la fonction : `EXPO_ACCESS_TOKEN` (si la sécurité renforcée des notifications push
est activée sur le projet Expo). `send-push` réserve ses lignes avec `claim_outbox(p_limit)` (verrou
`SKIP LOCKED`, réservation valable 5 minutes) : deux exécutions qui se chevauchent n'envoient pas deux
fois la même notification. Chaque ligne reçoit `sent_at` (au moins un appareil accepté) ou `error` :
`no_push_token`, code d'erreur Expo, `http_4xx` (message refusé, renvoyé seul), `max_attempts`
(5 tentatives) ou `expired` (créneau vacant ou annulation d'un cours déjà commencé). Si Expo est
injoignable, limite le débit (429) ou refuse le jeton d'accès (401/403), la ligne est libérée et
réessayée la minute suivante (jusqu'à `max_attempts`). Les jetons signalés
`DeviceNotRegistered` sont supprimés ; un profil garde au plus 10 jetons. Les textes (fr/de/en/ru
selon `profiles.language`) indiquent le sport et la date et l'heure du cours (heure de Zurich), et le
prénom de l'enfant quand un parent est notifié pour lui.

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

`e2e/smoke.e2e.mjs` pilote l'application web contre la stack locale (13 flux). Plan 1 : inscription
élève, inscription professeur (écran « en attente »), validation par un administrateur, inscription d'un
mineur (écran de consentement parental, adresse du parent affichée, pas de faux « e-mail envoyé »),
changement de langue, langue conservée après reconnexion et rechargement, « mot de passe oublié » de bout
en bout (lien lu dans Mailpit, nouveau mot de passe, connexion). Plan 2 (cours, flux 8 à 13, enchaînés) :
l'admin crée un cours récurrent (3 occurrences) visible dans le planning ; un élève réserve, se désinscrit
puis réserve de nouveau ; un prof prend le créneau vacant ; le prof fait l'appel (cours déplacé dans le
passé proche en SQL) ; l'admin annule « ce cours et les suivants » (statut « Annulé » et lignes
`course_cancelled` dans `notification_outbox`, vérifiées en SQL) ; `process_course_schedule()` appelé en
SQL fait passer un cours vacant commencé en « Open Mat » (et écrit les lignes `slot_vacant` d'un cours
vacant dans moins de 24 h). Les étapes de mise en place (promotion de l'admin, déplacement d'un cours dans
le passé, appel de `process_course_schedule()`, lecture de l'outbox) passent par `docker exec ... psql`.
En cas d'échec d'un flux, une capture `FAIL-<n>.png` est écrite dans `SHOT_DIR`.

```bash
npx supabase start
npx expo start --web --port 8081      # dans un autre terminal, avec .env rempli
SHOT_DIR=/tmp/e2e node e2e/smoke.e2e.mjs   # ou : npm run e2e
```

Variables : `BASE_URL` (défaut `http://localhost:8081`), `SHOT_DIR` (captures d'écran),
`MAIL_URL` (Mailpit, défaut `http://127.0.0.1:54324`, voir `npx supabase status` ; s'il est injoignable le
flux « mot de passe oublié » est marqué NON VÉRIFIÉ),
`DB_CONTAINER` (défaut `supabase_db_icon-valais`, utilisé via `docker exec` pour promouvoir
l'administrateur de test). Le paquet `playwright` doit être résolvable par Node
(`npm i -g playwright` puis `NODE_PATH=$(npm root -g)` si nécessaire). L'envoi réel de l'e-mail au
parent n'est pas vérifié (Edge Functions non démarrées par ce script).

Remarques : la stack locale limite l'envoi d'e-mails d'authentification (`auth.rate_limit.email_sent`,
2 par heure) : relancer le test plusieurs fois dans l'heure peut faire échouer le flux « mot de passe
oublié » (`npx supabase db reset` remet le compteur à zéro). Avec `CI=1`, Metro ne surveille pas les
fichiers : relancer `expo start` après une modification du code.

### Ordre des tests sur la base locale

Les tests pgTAP (`npx supabase test db`) supposent une base fraîchement réinitialisée : après un passage du
test e2e (comptes, cours et notifications laissés en base), certains tests comptant les lignes d'outbox
échouent. Lancer `npx supabase db reset` avant `npx supabase test db` (et avant chaque e2e si le compteur
d'e-mails d'authentification est atteint).

### Limites des notifications en local

- Les notifications push réelles (Expo Push vers un appareil) ne sont testables que sur un téléphone, une
  fois l'application construite (plan 5) : le test e2e vérifie uniquement les lignes écrites dans
  `notification_outbox` (annulation, créneau vacant) et pas leur livraison. Sur le web, l'enregistrement
  du jeton est ignoré.
- Le cron `send-push` ne fait rien tant que les secrets Vault `functions_url` et `service_role_key` n'existent
  pas (voir « Notifications et tâches planifiées »).
- `npx tsc --noEmit` s'appuie sur les types de routes générés dans `.expo/types` (dossier ignoré par git) :
  sur un clone neuf, ou si `tsc` se plaint de routes inconnues (`/courses/new`, `/admin/locations`…),
  lancer une fois `npx expo start` (puis quitter) pour les régénérer.
- Une route de `Tabs` masquée par `href: null` est redirigée vers `/` par expo-router : le dossier
  `courses` (détail, création, modification) n'est donc pas masqué mais sans bouton d'onglet
  (`tabBarItemStyle: { display: 'none' }`).

## Notes pour les plans suivants

- **Plan 3** : une réservation (`bookings`) d'un cours annulé reste active (`cancelled_at` null) ; les
  écrans « mes réservations » et les compteurs doivent joindre `courses.status` et ignorer les cours
  `annule`.
- **Plan 4** : les classements ne doivent compter que la présence (`attendance`) des cours non annulés
  (`cancel_course` supprime l'appel des cours qu'il annule, mais filtrer quand même sur `courses.status`).
- **Plan 5** (application native), à vérifier :
  - lire les reçus Expo (`getReceipts`) pour supprimer les jetons invalides signalés après l'envoi ;
  - supprimer le jeton push de l'appareil à la déconnexion (`push_tokens`, policy `delete` propre) ;
  - démarrage à froid depuis une notification : différer l'ouverture de la route jusqu'à ce que la
    session et le profil soient chargés (`AuthGate`) ;
  - onglet Admin (`href: null` pour un non-admin) : vérifier le comportement au rechargement de la page
    web sur une route admin ;
  - renseigner `extra.eas.projectId` (EAS) : sans lui, `registerForPush` renvoie `unsupported`.

## Mot de passe oublié

Le lien de l'e-mail ramène sur `/reset-password` : `<origine web>/reset-password` sur le web,
`iconvalais://reset-password` sur mobile. Ces URL doivent être autorisées dans
`auth.additional_redirect_urls` (`supabase/config.jsonc` pour la stack locale ; en production, ajouter
l'URL web publique + `/reset-password` et `iconvalais://reset-password` dans le tableau de bord Supabase,
Authentication > URL Configuration). Après modification de `config.jsonc` : `npx supabase stop && npx supabase start`.

## Créer le premier administrateur

Les administrateurs ne peuvent pas s'inscrire eux-mêmes : créer un compte normal, puis le promouvoir
en SQL avec le rôle `postgres` (Studio > SQL editor, ou `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres`) :

```sql
update profiles set role = 'admin' where email = 'admin@example.com';
```

Le dernier administrateur ne peut ni se retirer le rôle admin ni supprimer son compte : nommer d'abord
un autre administrateur.

Les professeurs inscrits restent « en attente de validation » jusqu'à ce qu'un administrateur les
valide dans l'onglet Admin (filtre « Profs en attente »).
