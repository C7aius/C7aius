import { fireEvent, render, screen } from '@testing-library/react-native';

import { initI18n } from '@/src/i18n';
import PaymentResult from '../payment-result';

const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
}));

beforeAll(async () => {
  await initI18n('fr');
});

it('success: says the payment awaits confirmation', async () => {
  mockParams = { status: 'success', payment: 'p1' };
  await render(<PaymentResult />);
  expect(screen.getByText('Paiement reçu')).toBeTruthy();
  expect(screen.getByText(/en cours de confirmation/)).toBeTruthy();
  await fireEvent.press(screen.getByText('Retour aux cours'));
  expect(mockReplace).toHaveBeenCalledWith('/');
});

it('cancel: nothing charged (generic text without kind)', async () => {
  mockParams = { status: 'cancel', payment: 'p1' };
  await render(<PaymentResult />);
  expect(screen.getByText('Paiement annulé')).toBeTruthy();
  expect(screen.getByText("Aucun montant n'a été débité.")).toBeTruthy();
});

it('cancel of a course Checkout: spot still held 15 minutes', async () => {
  mockParams = { status: 'cancel', payment: 'p1', kind: 'course' };
  await render(<PaymentResult />);
  expect(screen.getByText(/place reste retenue 15 minutes/)).toBeTruthy();
  expect(screen.queryByText(/adhésion/)).toBeNull();
});

it('cancel of a membership Checkout: no spot, membership not activated', async () => {
  mockParams = { status: 'cancel', payment: 'p1', kind: 'membership' };
  await render(<PaymentResult />);
  expect(screen.getByText(/adhésion n'a pas été activée/)).toBeTruthy();
  expect(screen.queryByText(/place/)).toBeNull();
});

it('unknown status', async () => {
  mockParams = { status: 'x' };
  await render(<PaymentResult />);
  expect(screen.getByText('Retour de paiement inconnu.')).toBeTruthy();
});
