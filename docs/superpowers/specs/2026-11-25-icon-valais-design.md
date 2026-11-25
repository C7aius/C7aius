# Icon Valais — Document de conception

Date : 2026-11-25
Statut : brouillon à valider

## 1. Intention

Le club (JJB, grappling, MMA — Valais) s'organise aujourd'hui via WhatsApp / Excel.
Impossible de savoir qui a payé, qui vient en visiteur, quel prof donne quel cours.

L'app **Icon Valais** doit permettre :
- aux élèves de réserver les cours et de payer (cours à l'unité ou abonnement) ;
- aux profs de créer des cours, de prendre les créneaux libres et de faire l'appel ;
- à l'admin (le propriétaire) de tout gérer et de savoir qui est adhérent, qui est venu à l'essai, qui est régulier.

**Réussite** : 50–60 élèves et 3–4 profs l'utilisent pour s'organiser ; l'admin voit en un coup d'œil adhérents / non-adhérents / régularité.

Échelle : 100–200 élèves, ~10 profs, 1–2 cours/jour (illimité possible).

## 2. Objectifs / non-objectifs / anti-objectifs

**Objectifs**
- App mobile iOS + Android (App Store, Play Store) + accès web pour l'administration sur PC.
- Comptes, réservation, paiement, appel, classements, statistiques admin.
- 4 langues : français (défaut), allemand, anglais, russe.

**Non-objectifs (pour l'instant)**
- Onglet Compétition : présent comme onglet vide « bientôt disponible », développé plus tard.
- Liste d'attente, pénalités, délai d'annulation.
- Messagerie / fil d'annonces.
- Connexion Google / Apple (e-mail + mot de passe uniquement).
- Paie des profs.

**Anti-objectifs**
- Collecter plus de données que nécessaire (pas de date de naissance, pas de données médicales).
- Payer une commission Apple/Google : les cours sont des services physiques → paiement hors achats intégrés, via Stripe.

## 3. Contraintes

- L'utilisateur a un PC (pas de Mac) → compilation iOS dans le cloud (EAS Build).
- Comptes développeur à créer au nom du propriétaire : Apple Developer (99 $/an), Google Play (25 $ une fois).
- Hébergement ≈ 0–50 CHF/mois.
- nLPD suisse : s'applique (nom, e-mail, âge sont des données personnelles). Mesures : données minimales, hébergement Suisse (Supabase région Zurich), politique de confidentialité, suppression de compte dans l'app (aussi exigée par Apple), consentement parental pour les moins de 16 ans.
- Stripe : TWINT n'accepte pas le paiement récurrent → abonnements automatiques par carte / Apple Pay / Google Pay ; TWINT pour les paiements uniques.
- Paiements reçus d'abord sur le compte perso Raiffeisen du propriétaire ; compte de destination à revoir à la fin du projet.

## 4. Approches envisagées

| Approche | Avantages | Inconvénients |
|---|---|---|
| **A. React Native (Expo) + Supabase + Stripe** — **choisie** | Un seul code iOS/Android/web ; build iOS sans Mac ; données à Zurich ; notifications push simples | Rendu un peu moins « natif » que Flutter |
| B. Flutter + Supabase + Stripe | Très fluide | Mac ou service payant pour iOS ; web admin moins confortable |
| C. Outil no-code (FlutterFlow, Adalo) | Démarrage rapide | Trop limité (récurrence 5 ans, Open Mat auto, classements, 4 langues, compétition future) |

Choix du propriétaire : **A**.

## 5. Rôles et comptes

Trois rôles :
- **Élève** (adhérent ou non-adhérent) — compte actif immédiatement.
- **Prof** — compte inactif tant que l'admin ne l'a pas validé. Un prof peut aussi réserver des cours comme élève.
- **Admin** — un seul pour l'instant (le propriétaire). Apparaît comme « Prof » aux yeux des autres.

À l'inscription on demande : élève ou prof.

### Champs communs (élève et prof)
- Prénom, nom, e-mail, mot de passe, téléphone (facultatif)
- Âge (nombre libre 0–100)
- Sports pratiqués : JJB, grappling, MMA (choix multiple)
- JJB : ceinture
  - adultes : blanche, bleue, violette, marron, noire
  - si âge < 18 : grise, jaune, orange, verte s'ajoutent
  - pas de barrettes
- Grappling / MMA : années d'expérience (par sport)
- Statut étudiant (facultatif) + justificatif (voir §8)

### Champs supplémentaires prof
- Années d'expérience comme coach
- Lieux / camps d'entraînement notables
- Compétitions et prix (ex. international, européen)
- CV libre (texte)

### Ceinture
Déclarée par l'élève ; **un prof peut la modifier** sur le compte de n'importe quel élève ou prof.

### Mineurs et comptes parent
- Un enfant peut créer son propre compte.
- Si l'âge saisi est < 16 ans : l'enfant entre l'e-mail d'un parent, qui reçoit un lien de confirmation ; le compte est actif après confirmation.
- Un parent peut créer un compte « parent » et y ajouter plusieurs profils enfants (sans login propre). Pas d'étape de confirmation dans ce cas. Le parent réserve et paie pour chaque enfant.
- Un compte enfant peut payer seul dans l'app.

### Pouvoirs de l'admin sur les comptes
- Valider / refuser les comptes prof.
- Changer le rôle d'un compte (prof ↔ élève).
- Marquer un compte comme **« payé pour l'année courante »** (paiement hors app, ex. espèces) → adhérent jusqu'au 31 décembre.
- Valider le statut étudiant.

## 6. Lieux

- Liste gérée par l'admin (ajout / modification / suppression).
- Lieux initiaux : **Conthey (défaut)**, Sion, Martigny.
- Chaque lieu : nom, adresse, lien Google Maps cliquable (affichés en déroulant le lieu).

## 7. Cours

### Création
- Admin et profs peuvent créer des cours.
- Champs :
  - sport : JJB, grappling ou MMA
  - niveau : adulte ou enfant
  - type : normal ou compétition
  - lieu (Conthey par défaut)
  - date, heure de début, heure de fin
  - prof assigné (peut être vide = créneau vacant)
  - nombre de places **indicatif**, visible par tous, personnalisable de 1 à 100 (non bloquant)
  - prix adhérent (défaut 0 CHF)
  - prix non-adhérent

### Récurrence
- Bouton « cours récurrent » : répète le cours chaque semaine (même jour, même heure).
- Prof : jusqu'au 31 décembre de l'année courante.
- Admin : jusqu'à 5 ans.
- Modifier / supprimer : cette occurrence seule, ou cette occurrence et les suivantes.

### Profs et créneaux vacants
- Par défaut un cours récurrent garde le même prof.
- L'admin peut assigner n'importe quel prof à n'importe quel cours.
- Un prof peut se retirer d'un cours → le créneau devient vacant.
- Tout prof peut prendre un créneau vacant (premier arrivé).
- **24 h avant le cours**, si le créneau est encore vacant : notification push à tous les profs.
- Si personne ne le prend : le cours est maintenu et affiché **« Open Mat »**, sans notification.

### Cours privés
- Seul l'admin voit la fonction de création, crée, modifie et assigne le prof.
- Une fois créé, le cours privé est visible et **réservable par tout le monde**.

### Annulation d'un cours
- L'admin (et le prof créateur) peut annuler.
- Notification **push** à tous les inscrits (pas d'e-mail).

### Réservation (élève)
- Réservation et désinscription libres, sans délai ni pénalité, pas de liste d'attente.
- Adhérent : prix adhérent (le plus souvent 0).
- Non-adhérent : paie le prix non-adhérent à la réservation ; **maximum 10 réservations** au total ; ensuite l'app lui propose un abonnement.

### Appel
- Le prof assigné (ou l'admin) coche les présents, pendant ou après le cours.
- Les présences cochées alimentent classements et statistiques.

## 8. Abonnements et paiements

| Durée | Prix | Étudiant (-30 %) |
|---|---|---|
| 1 mois | 100 CHF | 70 CHF |
| 3 mois | 250 CHF | 175 CHF |
| 6 mois | 450 CHF | 315 CHF |
| 12 mois | 650 CHF | 455 CHF |

- Renouvellement automatique (carte / Apple Pay / Google Pay via Stripe).
- Résiliation possible dans l'app (fin à l'échéance en cours).
- Tarif étudiant : l'élève envoie un justificatif (PDF, ou photo prise avec l'appareil photo de l'app) ; l'admin valide ; le justificatif est supprimé après décision.
- Cours à l'unité : carte, TWINT, Apple Pay, Google Pay.
- Quittances PDF téléchargeables dans l'app (historique des paiements).

## 9. Classements et statistiques

**Classement de régularité** (visible par tous les élèves et profs)
- Basé sur les présences cochées.
- Affichage top 10, top 20, ou tous les membres.

**Tableau de bord admin** (web + mobile)
- Liste des membres avec filtres : adhérent, non-adhérent, essai (1 venue), occasionnel, régulier ; nombre de venues ; date de fin d'abonnement.
- Heures d'enseignement par prof et totales.
- Heures de présence par adhérent, triées de la plus haute à la plus basse.
- Comptes prof en attente, justificatifs étudiants en attente.

## 10. Notifications

Push uniquement :
- cours annulé → inscrits
- créneau vacant 24 h avant → profs
- compte prof validé → le prof

E-mails techniques indispensables (gérés par Supabase) : réinitialisation du mot de passe, confirmation parentale.

## 11. Identité visuelle

- Nom : **Icon Valais**
- Couleurs : noir anthracite et orange
- Logo : fichier à fournir par le propriétaire

## 12. Architecture technique

- **Application** : Expo (React Native, TypeScript), un seul code pour iOS, Android et web. Le web sert surtout à l'admin.
- **Backend** : Supabase (région Zurich)
  - Postgres avec règles d'accès par rôle (Row Level Security)
  - authentification e-mail
  - stockage des justificatifs
  - fonctions serveur pour Stripe et tâches planifiées
- **Paiement** : Stripe (Payment Sheet, Subscriptions, webhooks → base de données).
- **Tâche planifiée** (toutes les ~15 min) : notifications de créneaux vacants à 24 h, passage en « Open Mat ».
- **Notifications** : Expo Push.
- **Langues** : i18n, langue du téléphone par défaut, modifiable dans le profil.
- **Publication** : EAS Build / Submit vers l'App Store et le Play Store ; web hébergé (ex. Vercel ou Netlify).
- **Dépôt** : dépôt GitHub dédié à l'app (à créer par le propriétaire).

## 13. Décisions prises par Claude (à vérifier)

1. Âge minimum sans parent : 16 ans.
2. « Payé pour l'année courante » = adhérent jusqu'au 31 décembre.
3. Limite non-adhérent : 10 réservations au total, cours désinscrits non comptés.
4. La fonction « cours privé » est réservée à l'admin, mais le cours créé est visible et réservable par tous.
5. Prise d'un créneau vacant : premier prof qui clique.
6. Annulation d'un cours : admin + prof créateur.
7. Récurrence hebdomadaire uniquement.
8. Classement : toutes périodes confondues, avec filtre « cette année ».
9. Notification « compte prof validé » ajoutée (push).
10. Justificatif étudiant supprimé après validation.
11. Ceintures adultes : blanche, bleue, violette, marron, noire.
12. Places indicatives par défaut : 20.

## 14. Laissé au développeur

Structure exacte de la base, écrans détaillés, librairies secondaires, hébergement du web admin, tests.
