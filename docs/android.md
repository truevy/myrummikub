# The Android app

A thin native shell (Kotlin, one `WebView`) around the same web code the Mac,
Windows and iPhone apps run. It lives in `android/`. Everything the game does
is the same; the shell only adds what a web page cannot do by itself:
notifications, saving and opening game files, opening Messages or Mail, and the
camera for a profile photo.

## Getting it

The Android app is not part of the releases yet: build it yourself (below) and copy
the `.apk` to the phone or tablet; Android asks to allow installing apps from that
source the first time. It is a sideloaded app, not a Play Store one (see "Play Store" below).

## Building it

```bash
scripts/build-android.sh
```

needs Java 17, the Android SDK (`ANDROID_HOME`) and gradle 8.9 or newer. The
file ends up in `dist/Lyndas-Rummi-Time-<version>-android.apk`. To add it to a release
later, build it in a Linux job of the "Windows build" workflow (Java 17, `gradle`) and
`gh release upload` the file.

The version is the game's own (`package.json`; 3.1.0 is version code 30100).

## Push notifications

"Your turn" and invitations reach a closed Android app through Firebase Cloud
Messaging (FCM). The app registers its FCM token under
`v3/pushTokens/{account}/{token}` with `env: "fcm"`, and the same functions that
notify iPhones (`functions/index.js`) send to it; a tapped notification opens
the game. Set-up, once:

1. In the Firebase console (project *lyndas-rummikub*) choose **Add app › Android**,
   package name `com.lyndasrummitummi.android`, and download `google-services.json`.
2. Put it in `android/app/google-services.json` (it is git-ignored) to build by
   hand.
3. Deploy the functions: `firebase deploy --only functions`. Nothing else is needed:
   FCM uses the project's own service account, no key like the Apple one.

Without `google-services.json` the app still builds and plays; it just receives
nothing while closed. Android 13 and later ask for permission when the player
first goes online; **Settings › Notifications** in the game shows where things
stand and opens the system settings when notifications were refused.

## Play Store

For the Play Store the app has to be signed with your own upload key. Create a
keystore (`keytool -genkey -v -keystore rummi.jks -alias rummi -keyalg RSA -keysize 2048 -validity 10000`)
and build with `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` set; `build.gradle.kts` then signs
the release with it. Without them the debug key is used. Keep the keystore safe:
an app cannot be updated if its key is lost.
