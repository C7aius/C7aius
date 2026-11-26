// Web : le SDK natif Stripe n'existe pas (Metro prend stripeModule.native.ts sur iOS/Android).
// Le web paie par Stripe Checkout, sans jamais appeler ceci. Seul le type est importé.
export function loadStripe(): typeof import('@stripe/stripe-react-native') {
  throw new Error('stripe-react-native is native-only');
}
