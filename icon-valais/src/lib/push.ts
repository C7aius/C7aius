import { Platform } from 'react-native';

import { supabase } from '@/src/lib/supabase';

export type PushResult = 'registered' | 'denied' | 'unsupported';

/**
 * Route à ouvrir pour une notification (données `{ courseId }` envoyées par send-push),
 * ou null si les données sont inconnues ou invalides.
 */
export function routeForNotification(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const id = (data as { courseId?: unknown }).courseId;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return `/courses/${id}`;
}

// Chargés à la demande : ces modules natifs ne doivent pas être importés sur le web.
function loadNative() {
  return {
    Notifications: require('expo-notifications') as typeof import('expo-notifications'),
    Device: require('expo-device') as typeof import('expo-device'),
    Constants: (require('expo-constants') as typeof import('expo-constants')).default,
  };
}

/**
 * Demande la permission et enregistre le jeton Expo Push du compte courant.
 * `unsupported` : web, simulateur, ou sans projectId EAS (configuré au plan 5).
 * Lève en cas d'erreur réseau/serveur : l'appelant journalise sans bloquer l'UI.
 */
export async function registerForPush(): Promise<PushResult> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'unsupported';
  const { Notifications, Device, Constants } = loadNative();
  if (!Device.isDevice) return 'unsupported';
  const projectId: unknown = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
  if (typeof projectId !== 'string' || projectId === '') return 'unsupported';

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return 'denied';

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
  if (error) throw new Error('register_push_token failed');
  return 'registered';
}

/**
 * Affiche les notifications reçues quand l'app est au premier plan (bannière et centre de
 * notifications, sans son ni badge). Sans ce gestionnaire, expo-notifications les ignore.
 * Sans effet sur le web.
 */
export function configureForegroundNotifications(): void {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  const { Notifications } = loadNative();
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Ouvre le cours d'une notification touchée (app au premier plan/arrière-plan, ou lancée depuis elle).
 * Configure aussi l'affichage au premier plan (appelée au démarrage par app/_layout.tsx).
 * Retourne la fonction de désabonnement. Sans effet sur le web.
 */
export function listenForNotificationTaps(open: (route: string) => void): () => void {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return () => undefined;
  configureForegroundNotifications();
  const { Notifications } = loadNative();
  let cancelled = false;
  const handle = (response: { notification: { request: { content: { data?: unknown } } } } | null) => {
    const route = routeForNotification(response?.notification.request.content.data);
    if (route) open(route);
  };
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  Notifications.getLastNotificationResponseAsync()
    .then((r) => {
      if (!cancelled) handle(r);
    })
    .catch(() => undefined);
  return () => {
    cancelled = true;
    sub.remove();
  };
}
