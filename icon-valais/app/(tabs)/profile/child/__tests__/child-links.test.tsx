import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { initI18n } from '@/src/i18n';
import ChildProfile from '../[id]';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'kid' }),
}));
jest.mock('@/src/components/profile/ProfileForm', () => ({ ProfileForm: () => null }));
jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { id: 'kid', first_name: 'Léo', last_name: 'Roux' }, error: null }) }),
      }),
    }),
  },
}));

beforeAll(async () => {
  await initI18n('fr');
});

it('opens the child membership and proof screens with the child id', async () => {
  await render(<ChildProfile />);
  await waitFor(() => expect(screen.getByText('Mon abonnement')).toBeTruthy());
  await fireEvent.press(screen.getByText('Mon abonnement'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/profile/membership', params: { profileId: 'kid' } });
  await fireEvent.press(screen.getByText('Justificatif étudiant'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/profile/student-proof', params: { profileId: 'kid' } });
});
