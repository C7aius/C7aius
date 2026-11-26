import type { ReactElement } from 'react';
import { loadStripe } from '@/src/lib/stripeModule';

const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;

/**
 * StripeProvider sur natif, avec la clé publiable de l'env. Sans clé, les enfants sont rendus
 * tels quels (la clé renvoyée par create-payment initialise de toute façon la feuille).
 * Fichier natif seulement : le web utilise PaymentsProvider.tsx (sans Stripe).
 */
export function PaymentsProvider({ children }: { children: ReactElement }) {
  if (!PUBLISHABLE_KEY) return children;
  const { StripeProvider } = loadStripe();
  return (
    <StripeProvider publishableKey={PUBLISHABLE_KEY} urlScheme="iconvalais" merchantIdentifier="merchant.ch.iconvalais.placeholder">
      {children}
    </StripeProvider>
  );
}
