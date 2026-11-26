import type { ReactElement } from 'react';

/** Web : pas de SDK natif Stripe (paiement par Checkout). Voir PaymentsProvider.native.tsx. */
export function PaymentsProvider({ children }: { children: ReactElement }) {
  return children;
}
