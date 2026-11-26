import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n, { initI18n } from '@/src/i18n';
import StudentProof from '../student-proof';

const mockRpc = jest.fn();
const mockUpload = jest.fn();
const mockCamera = jest.fn();
const mockPerm = jest.fn();
const mockDoc = jest.fn();
let mockStatus = 'aucun';
let mockParams: Record<string, string> = {};

jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ profile: { id: 'me' } }) }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: (...a: unknown[]) => mockPerm(...a),
  launchCameraAsync: (...a: unknown[]) => mockCamera(...a),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...a: unknown[]) => mockDoc(...a) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'ABCDEF12-3456-7890-ABCD-EF1234567890' }));
jest.mock('@/src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    storage: { from: (b: string) => ({ upload: (...a: unknown[]) => mockUpload(b, ...a) }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { student_status: mockStatus }, error: null }) }) }),
    }),
  },
}));

const realFetch = global.fetch;
beforeAll(async () => {
  await initI18n('fr');
  global.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })) as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = realFetch;
});
beforeEach(async () => {
  jest.clearAllMocks();
  mockStatus = 'aucun';
  mockParams = {};
  mockPerm.mockResolvedValue({ granted: true });
  mockUpload.mockResolvedValue({ data: {}, error: null });
  mockRpc.mockResolvedValue({ data: 'proof1', error: null });
  await act(async () => {
    await i18n.changeLanguage('fr');
  });
});

describe('StudentProof screen', () => {
  it('uploads a photo to <profile>/<lowercase uuid>.jpg then submits it', async () => {
    mockCamera.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///p.jpg', mimeType: 'image/jpeg', fileSize: 1000 }],
    });
    await render(<StudentProof />);
    await waitFor(() => expect(screen.getByText('Aucun justificatif envoyé')).toBeTruthy());
    await fireEvent.press(screen.getByText('Prendre une photo'));
    const path = 'me/abcdef12-3456-7890-abcd-ef1234567890.jpg';
    await waitFor(() =>
      expect(mockUpload).toHaveBeenCalledWith('student-proofs', path, expect.anything(), {
        contentType: 'image/jpeg',
        upsert: false,
      }),
    );
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('submit_student_proof', { p_profile: 'me', p_path: path }));
    await waitFor(() => expect(screen.getByText('En attente de validation')).toBeTruthy());
    expect(mockUpload.mock.invocationCallOrder[0]).toBeLessThan(mockRpc.mock.invocationCallOrder[0]);
  });

  it('uploads a PDF for the child', async () => {
    mockParams = { profileId: 'kid' };
    mockDoc.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///c.pdf', mimeType: 'application/pdf', size: 2000 }],
    });
    await render(<StudentProof />);
    await waitFor(() => expect(screen.getByText('Choisir un PDF')).toBeTruthy());
    await fireEvent.press(screen.getByText('Choisir un PDF'));
    const path = 'kid/abcdef12-3456-7890-abcd-ef1234567890.pdf';
    await waitFor(() =>
      expect(mockUpload).toHaveBeenCalledWith('student-proofs', path, expect.anything(), {
        contentType: 'application/pdf',
        upsert: false,
      }),
    );
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('submit_student_proof', { p_profile: 'kid', p_path: path }));
  });

  it('rejects a file over 10 MB with a translated message and uploads nothing', async () => {
    mockDoc.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///big.pdf', mimeType: 'application/pdf', size: 11 * 1024 * 1024 }],
    });
    await render(<StudentProof />);
    await waitFor(() => expect(screen.getByText('Choisir un PDF')).toBeTruthy());
    await fireEvent.press(screen.getByText('Choisir un PDF'));
    await waitFor(() => expect(screen.getByText('Le fichier dépasse 10 Mo.')).toBeTruthy());
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('does nothing when the camera permission is denied', async () => {
    mockPerm.mockResolvedValue({ granted: false });
    await render(<StudentProof />);
    await waitFor(() => expect(screen.getByText('Prendre une photo')).toBeTruthy());
    await fireEvent.press(screen.getByText('Prendre une photo'));
    await waitFor(() => expect(screen.getByText("L'accès à la caméra est nécessaire pour prendre une photo.")).toBeTruthy());
    expect(mockCamera).not.toHaveBeenCalled();
  });

  it('shows an error when the upload fails and does not submit', async () => {
    mockUpload.mockResolvedValue({ data: null, error: new Error('x') });
    mockDoc.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///c.pdf', mimeType: 'application/pdf', size: 10 }] });
    await render(<StudentProof />);
    await waitFor(() => expect(screen.getByText('Choisir un PDF')).toBeTruthy());
    await fireEvent.press(screen.getByText('Choisir un PDF'));
    await waitFor(() => expect(screen.getByText("L'envoi a échoué, réessayez.")).toBeTruthy());
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('explains a refused proof and allows resubmitting', async () => {
    mockStatus = 'refuse';
    await render(<StudentProof />);
    await waitFor(() => expect(screen.getByText(/Refusé/)).toBeTruthy());
    expect(screen.getByText('Choisir un PDF')).toBeTruthy();
  });

  it('shows validated status and hides the pickers', async () => {
    mockStatus = 'valide';
    await render(<StudentProof />);
    await waitFor(() => expect(screen.getByText(/Validé/)).toBeTruthy());
    expect(screen.queryByText('Choisir un PDF')).toBeNull();
  });

  it('shows pending status and hides the pickers', async () => {
    mockStatus = 'en_attente';
    await render(<StudentProof />);
    await waitFor(() => expect(screen.getByText('En attente de validation')).toBeTruthy());
    expect(screen.queryByText('Prendre une photo')).toBeNull();
  });
});
