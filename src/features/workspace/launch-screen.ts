/**
 * the launch screen stays up while the app has only progress to show, so a returning user goes
 * from the launch screen straight to the note (flow f2), without a run of progress screens. the
 * first screen that is not progress takes it down, or LAUNCH_SCREEN_LIMIT_MS at the latest.
 */
import * as SplashScreen from 'expo-splash-screen';

/** the longest the launch screen stays up; after that the progress screens show. */
export const LAUNCH_SCREEN_LIMIT_MS = 2000;

type LaunchScreenApi = Pick<typeof SplashScreen, 'preventAutoHideAsync' | 'hide'>;

/** a launch screen that is held once and revealed once. */
export function createLaunchScreen(api: LaunchScreenApi, schedule: (task: () => void, ms: number) => void = setTimeout) {
  let held = false;
  const reveal = () => {
    if (!held) return;
    held = false;
    api.hide();
  };
  return {
    /** call once at startup, before the first render. */
    hold() {
      if (held) return;
      held = true;
      api.preventAutoHideAsync().catch(() => undefined);
      schedule(reveal, LAUNCH_SCREEN_LIMIT_MS);
    },
    /** takes the launch screen down; later calls do nothing. */
    reveal,
  };
}

const launchScreen = createLaunchScreen(SplashScreen);

export const holdLaunchScreen = launchScreen.hold;
export const revealApp = launchScreen.reveal;
