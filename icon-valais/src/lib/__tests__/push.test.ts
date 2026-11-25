import { Platform } from 'react-native';

const mockRpc = jest.fn();
jest.mock('@/src/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

const mockDevice = { isDevice: true };
jest.mock('expo-device', () => mockDevice);

const mockConstants: { expoConfig: unknown; easConfig: unknown } = {
  expoConfig: { extra: { eas: { projectId: 'proj-1' } } },
  easConfig: undefined,
};
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockConstants.expoConfig;
    },
    get easConfig() {
      return mockConstants.easConfig;
    },
  },
}));

const mockGetPerms = jest.fn();
const mockRequestPerms = jest.fn();
const mockGetToken = jest.fn();
const mockSetHandler = jest.fn();
const mockRemove = jest.fn();
jest.mock('expo-notifications', () => ({
  setNotificationHandler: (h: unknown) => mockSetHandler(h),
  addNotificationResponseReceivedListener: () => ({ remove: mockRemove }),
  getLastNotificationResponseAsync: () => Promise.resolve(null),
  getPermissionsAsync: () => mockGetPerms(),
  requestPermissionsAsync: () => mockRequestPerms(),
  getExpoPushTokenAsync: (o: unknown) => mockGetToken(o),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { DEFAULT: 3 },
}));

import { configureForegroundNotifications, listenForNotificationTaps, registerForPush, routeForNotification } from '../push';

const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

beforeEach(() => {
  jest.clearAllMocks();
  setOS('ios');
  mockDevice.isDevice = true;
  mockConstants.expoConfig = { extra: { eas: { projectId: 'proj-1' } } };
  mockConstants.easConfig = undefined;
  mockGetPerms.mockResolvedValue({ status: 'granted' });
  mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
  mockRpc.mockResolvedValue({ error: null });
});

describe('registerForPush', () => {
  it('web : unsupported sans appel RPC', async () => {
    setOS('web');
    expect(await registerForPush()).toBe('unsupported');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('simulateur : unsupported', async () => {
    mockDevice.isDevice = false;
    expect(await registerForPush()).toBe('unsupported');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('sans projectId EAS : unsupported sans RPC', async () => {
    mockConstants.expoConfig = { extra: {} };
    expect(await registerForPush()).toBe('unsupported');
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('permission refusée : denied', async () => {
    mockGetPerms.mockResolvedValue({ status: 'undetermined' });
    mockRequestPerms.mockResolvedValue({ status: 'denied' });
    expect(await registerForPush()).toBe('denied');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('permission accordée : enregistre le jeton (ios)', async () => {
    expect(await registerForPush()).toBe('registered');
    expect(mockGetToken).toHaveBeenCalledWith({ projectId: 'proj-1' });
    expect(mockRpc).toHaveBeenCalledWith('register_push_token', { p_token: 'ExponentPushToken[abc]', p_platform: 'ios' });
  });

  it('demande la permission si non déterminée puis enregistre (android)', async () => {
    setOS('android');
    mockGetPerms.mockResolvedValue({ status: 'undetermined' });
    mockRequestPerms.mockResolvedValue({ status: 'granted' });
    expect(await registerForPush()).toBe('registered');
    expect(mockRpc).toHaveBeenCalledWith('register_push_token', { p_token: 'ExponentPushToken[abc]', p_platform: 'android' });
  });

  it("lève si le RPC échoue (l'appelant journalise)", async () => {
    mockRpc.mockResolvedValue({ error: { message: 'boom' } });
    await expect(registerForPush()).rejects.toBeTruthy();
  });
});

describe('routeForNotification', () => {
  it('courseId valide', () => {
    expect(routeForNotification({ courseId: 'x' })).toBe('/courses/x');
  });
  it.each([null, undefined, 'x', 3, {}, { courseId: 5 }, { courseId: '' }, { courseId: 'a/b' }])('invalide %p', (d) => {
    expect(routeForNotification(d)).toBeNull();
  });
});

describe('foreground notifications', () => {
  it('native: setNotificationHandler shows banner and list, without sound', async () => {
    const unsubscribe = listenForNotificationTaps(jest.fn());
    expect(mockSetHandler).toHaveBeenCalledTimes(1);
    const handler = mockSetHandler.mock.calls[0][0] as { handleNotification: () => Promise<Record<string, boolean>> };
    await expect(handler.handleNotification()).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
    unsubscribe();
    expect(mockRemove).toHaveBeenCalled();
  });

  it('android: handler set too', () => {
    setOS('android');
    configureForegroundNotifications();
    expect(mockSetHandler).toHaveBeenCalledTimes(1);
  });

  it('web: no handler, no native module', () => {
    setOS('web');
    configureForegroundNotifications();
    listenForNotificationTaps(jest.fn())();
    expect(mockSetHandler).not.toHaveBeenCalled();
  });
});
