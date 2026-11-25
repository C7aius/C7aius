/**
 * Résultat du dernier envoi de l'e-mail de consentement (fait à l'inscription),
 * transmis à l'écran /pending pour qu'il n'affirme pas qu'un e-mail est parti
 * quand l'envoi a échoué. Valeur : clé i18n de l'erreur, ou null si envoyé ;
 * undefined : aucun envoi connu dans cette session de l'application.
 *
 * /pending peut s'afficher AVANT la fin de l'envoi (la session arrive dès
 * signUp) : l'écran lit la valeur courante puis s'abonne aux changements.
 * Lecture sans effet de bord (compatible avec le double rendu de StrictMode).
 */
let lastSendError: string | null | undefined;
const listeners = new Set<(errorKey: string | null | undefined) => void>();

export function setConsentSendResult(errorKey: string | null | undefined): void {
  lastSendError = errorKey;
  listeners.forEach((l) => l(errorKey));
}

export function getConsentSendResult(): string | null | undefined {
  return lastSendError;
}

/** À la déconnexion : le résultat ne concerne que le compte qui vient de s'inscrire. */
export function clearConsentSendResult(): void {
  setConsentSendResult(undefined);
}

export function subscribeConsentSendResult(listener: (errorKey: string | null | undefined) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
