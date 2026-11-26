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

it('cancel: nothing charged', async () => {
  mockParams = { status: 'cancel', payment: 'p1' };
  await render(<PaymentResult />);
  expect(screen.getByText('Paiement annulé')).toBeTruthy();
});

it('unknown status', async () => {
  mockParams = { status: 'x' };
  await render(<PaymentResult />);
  expect(screen.getByText('Retour de paiement inconnu.')).toBeTruthy();
});
