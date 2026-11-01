// Daily reading reminder, scheduled on the phone itself (no server).
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export interface ReminderSettings {
  enabled: boolean;
  hour: number;
  minute: number;
}

export const DEFAULT_REMINDER: ReminderSettings = { enabled: true, hour: 7, minute: 30 };

// One notification per day for the next two weeks, rescheduled on every launch,
// so each one can suggest a different unread reading
const FIRST_ID = 100;
const DAYS_AHEAD = 14;

export type ReminderStatus = "scheduled" | "off" | "denied" | "unsupported";

export const remindersSupported = () => Capacitor.isNativePlatform();

export async function exactRemindersAllowed(): Promise<boolean> {
  if (!remindersSupported()) return false;
  try {
    return (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === "granted";
  } catch {
    return true; // Android < 12 has no such permission
  }
}

// Opens Android's "Alarms & reminders" screen so reminders arrive on the minute
export async function allowExactReminders() {
  if (remindersSupported()) await LocalNotifications.changeExactNotificationSetting();
}

// A reading a reminder suggests; tapping the notification opens it
export interface ReminderSuggestion {
  deckId: string;
  title: string;
}

export async function scheduleReminders(settings: ReminderSettings, suggestions: ReminderSuggestion[]): Promise<ReminderStatus> {
  if (!remindersSupported()) return "unsupported";

  await LocalNotifications.cancel({
    notifications: Array.from({ length: DAYS_AHEAD }, (_, i) => ({ id: FIRST_ID + i })),
  });
  if (!settings.enabled) return "off";

  let permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted" && permission.display !== "denied") {
    permission = await LocalNotifications.requestPermissions();
  }
  if (permission.display !== "granted") return "denied";

  // Without the exact-alarm permission Android may deliver a few minutes late;
  // never pop the settings screen on its own, the reminder sheet offers it
  const exact = await exactRemindersAllowed();

  const first = new Date();
  first.setHours(settings.hour, settings.minute, 0, 0);
  if (first.getTime() <= Date.now()) first.setDate(first.getDate() + 1);

  await LocalNotifications.schedule({
    notifications: Array.from({ length: DAYS_AHEAD }, (_, i) => {
      const at = new Date(first);
      at.setDate(first.getDate() + i);
      const pick = suggestions.length ? suggestions[i % suggestions.length] : undefined;
      return {
        id: FIRST_ID + i,
        title: "Okuma vakti 📖",
        body: pick ? `Bugün okumaya ne dersin: “${pick.title}”` : "Bugünün okuması seni bekliyor.",
        extra: pick ? { deckId: pick.deckId } : undefined,
        schedule: { at, allowWhileIdle: true },
        smallIcon: "ic_stat_reading",
        isExactNotification: exact,
      };
    }),
  });
  return "scheduled";
}

// The plugin keeps a tap that launched the app until this listener is attached
export function onReminderTapped(handler: (deckId?: string) => void) {
  if (!remindersSupported()) return () => {};
  const listener = LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
    const deckId = action.notification.extra?.deckId;
    handler(typeof deckId === "string" ? deckId : undefined);
  });
  return () => {
    void listener.then((l) => l.remove());
  };
}
