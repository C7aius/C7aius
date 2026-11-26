import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { initI18n } from '@/src/i18n';
import Ranking from '../index';

const mockRpc = jest.fn();
let mockAuth: { profile: { id: string } };

jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, [cb]);
  },
}));
jest.mock('@/src/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
const row = (rank: number, id: string, first: string, sessions: number, belt: string | null = 'bleue') => ({
  rank, profile_id: id, first_name: first, last_name: 'X', bjj_belt: belt, sessions,
});
let ranking: unknown[];
let mine: unknown[];
let rankingError: unknown = null;

beforeAll(async () => {
  await initI18n('fr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { profile: { id: 'me' } };
  ranking = [row(1, 'a', 'Anna', 30), row(2, 'b', 'Bob', 20, null), row(2, 'c', 'Cleo', 20), row(4, 'me', 'Moi', 5)];
  mine = [{ rank: 4, sessions: 5 }];
  rankingError = null;
  mockRpc.mockImplementation((fn: string) =>
    fn === 'attendance_ranking'
      ? Promise.resolve({ data: rankingError ? null : ranking, error: rankingError })
      : Promise.resolve({ data: mine, error: null }),
  );
});

describe('Ranking', () => {
  it('charge par défaut tous / toujours et affiche la position', async () => {
    await render(<Ranking />);
    await settle();
    expect(mockRpc).toHaveBeenCalledWith('attendance_ranking', { p_period: 'all', p_limit: undefined });
    expect(mockRpc).toHaveBeenCalledWith('my_ranking', { p_period: 'all' });
    expect(screen.getByText('Ta position : n° 4 (5 présences)')).toBeTruthy();
    expect(screen.getByText('🥇')).toBeTruthy();
    expect(screen.getAllByText('🥈')).toHaveLength(2);
  });

  it('Top 10 appelle attendance_ranking(all, 10)', async () => {
    await render(<Ranking />);
    await settle();
    await fireEvent.press(screen.getByText('Top 10'));
    await settle();
    expect(mockRpc).toHaveBeenCalledWith('attendance_ranking', { p_period: 'all', p_limit: 10 });
  });

  it('Cette année relance avec year', async () => {
    await render(<Ranking />);
    await settle();
    await fireEvent.press(screen.getByText('Cette année'));
    await settle();
    expect(mockRpc).toHaveBeenCalledWith('attendance_ranking', { p_period: 'year', p_limit: undefined });
    expect(mockRpc).toHaveBeenCalledWith('my_ranking', { p_period: 'year' });
  });

  it('affiche les ex aequo avec le même rang, sans texte de ceinture si null', async () => {
    await render(<Ranking />);
    await settle();
    expect(screen.getAllByTestId('rank-2')).toHaveLength(2);
    expect(screen.queryByText(/belts\./)).toBeNull();
  });

  it('surligne la ligne de l’utilisateur', async () => {
    await render(<Ranking />);
    await settle();
    expect(screen.getByTestId('row-me').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByTestId('row-a').props.accessibilityState).toEqual({ selected: false });
  });

  it('ligne de l’utilisateur : libellé d’accessibilité avec marqueur « toi »', async () => {
    await render(<Ranking />);
    await settle();
    const me = screen.getByTestId('row-me');
    expect(me.props.accessible).toBe(true);
    expect(me.props.accessibilityLabel).toBe('4, Moi X, Bleue, 5 présences, toi');
    expect(screen.getByTestId('row-a').props.accessibilityLabel).toBeUndefined();
  });

  it('pluriel français : 1 présence / 2 présences', async () => {
    ranking = [row(1, 'a', 'Anna', 1), row(2, 'b', 'Bob', 2)];
    mine = [{ rank: 1, sessions: 1 }];
    await render(<Ranking />);
    await settle();
    expect(screen.getByText('1 présence')).toBeTruthy();
    expect(screen.getByText('2 présences')).toBeTruthy();
    expect(screen.getByText('Ta position : n° 1 (1 présence)')).toBeTruthy();
  });

  it('réponses dans le désordre : la plus récente gagne', async () => {
    const resolvers: Record<string, (v: unknown) => void> = {};
    mockRpc.mockImplementation((fn: string, args: { p_limit?: number }) =>
      new Promise((res) => {
        resolvers[`${fn}:${args.p_limit ?? 'all'}`] = res;
      }),
    );
    await render(<Ranking />);
    await fireEvent.press(screen.getByText('Top 10'));
    await act(async () => {
      resolvers['attendance_ranking:10']({ data: [row(1, 'new', 'Nouveau', 9)], error: null });
      resolvers['my_ranking:all']({ data: [{ rank: 1, sessions: 9 }], error: null });
    });
    await act(async () => {
      resolvers['attendance_ranking:all']({ data: [row(1, 'old', 'Ancien', 1)], error: null });
    });
    expect(screen.getByText('Nouveau X')).toBeTruthy();
    expect(screen.queryByText('Ancien X')).toBeNull();
  });

  it('changement de période : la position est réinitialisée pendant le chargement', async () => {
    await render(<Ranking />);
    await settle();
    mockRpc.mockImplementation(() => new Promise(() => {}));
    await fireEvent.press(screen.getByText('Cette année'));
    expect(screen.queryByText(/Ta position/)).toBeNull();
    expect(screen.getByLabelText('Chargement…')).toBeTruthy();
  });

  it('sans présence : message dédié', async () => {
    mine = [{ rank: null, sessions: 0 }];
    await render(<Ranking />);
    await settle();
    expect(screen.getByText('Pas encore de présence')).toBeTruthy();
  });

  it('liste vide : message traduit', async () => {
    ranking = [];
    await render(<Ranking />);
    await settle();
    expect(screen.getByText('Aucune présence enregistrée pour le moment.')).toBeTruthy();
  });

  it('erreur : message traduit', async () => {
    rankingError = { code: 'XX000' };
    await render(<Ranking />);
    await settle();
    expect(screen.getByText('Une erreur est survenue')).toBeTruthy();
  });
});

describe('Ranking (ru)', () => {
  afterAll(async () => {
    await initI18n('fr');
  });
  it.each([
    [1, 'посещение'],
    [3, 'посещения'],
    [5, 'посещений'],
    [21, 'посещение'],
  ])('%i -> %s', async (n, word) => {
    await initI18n('ru');
    ranking = [row(1, 'a', 'Anna', n)];
    mine = [{ rank: 1, sessions: n }];
    await render(<Ranking />);
    await settle();
    expect(screen.getAllByText(`${n} ${word}`).length).toBeGreaterThan(0);
  });
});
