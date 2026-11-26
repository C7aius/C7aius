// Natif seulement : ce fichier n'est jamais empaqueté pour le web (voir stripeModule.ts).
// Chargé à la demande : les tests et les écrans sans paiement n'initialisent pas le module natif.
export function loadStripe(): typeof import('@stripe/stripe-react-native') {
  return require('@stripe/stripe-react-native');
}
