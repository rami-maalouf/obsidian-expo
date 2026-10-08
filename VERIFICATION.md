# Starter verification

Verified on October 8, 2026 with Expo 58.0.6, React Native 0.88.0-rc.3, Bun 1.3.14, Node 26.5.0, and Xcode 27.0.

| Check | Result |
| --- | --- |
| Frozen Bun dependency installation | Passed |
| Strict TypeScript check | Passed |
| ESLint, zero warnings allowed | Passed |
| Expo dependency version alignment | Passed |
| Expo Doctor | 20 of 20 checks passed |
| Production JS export | Web, iOS, and Android passed |
| Native iOS development build | Built and installed successfully |
| iOS runtime | Home rendered on iPhone 17 Pro simulator, iOS 27.0 |
| iOS interaction | Switched Home to Explore and expanded File-based routing |
| iOS reload smoke check | Passed with zero runtime errors during a 10-second observation window |
| Web interaction | Home to Explore and back; expanded File-based routing |
| Web browser console | No errors recorded during the final interaction check |
| Visual inspection | Home and Explore rendered correctly; app title fits on one line |

## Committed visual evidence

The setup session's Home screenshots are included for reviewers working from a fresh checkout: [web starter](docs/validation/starter-web.png) and [iOS development build](docs/validation/starter-ios.png). These show the starter only. They do not demonstrate the planned editor or vault features, and are not substitutes for rerunning interaction checks after code changes.

## Limits

- Android passed production JS bundling but was not compiled or run on an emulator.
- iOS was tested as a development build in the simulator, not on a physical device or as a release binary.
- This is starter validation, not a performance benchmark or validation of future note and vault features.
- SDK 58 and React Native 0.88 are prerelease versions. The installed SDK 58 Expo Go simulator build failed to load ExpoAsset, so this project uses its own development build.
- Xcode emitted one warning about an upstream Expo Dev Launcher script's dependency analysis. It did not prevent the build.
- The runtime smoke command can report success without confirming visible content. Screenshots and interaction checks were used as additional evidence. An earlier run selected a still-connected Expo Go process; final verification ran with only com.ramimaalouf.obsidianexpo connected.

Verification was performed in the setup session. No independent sub-agent review was performed because this side conversation prohibits sub-agents.
