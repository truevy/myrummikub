# Signing the Mac app so it opens without a security override

macOS only opens an app without complaint when two things are true:

1. it is signed with a **Developer ID Application** certificate, and
2. Apple has **notarized** it (checked it and issued a ticket).

`scripts/build-mac.sh` does both automatically once the certificate and the
notary credentials are on this Mac. Until then it signs "ad hoc", which only
satisfies the Mac that built it.

Both steps need the paid Apple Developer Program, and the certificate can only
be created by the account holder.

## 1. Create the Developer ID Application certificate (once)

This Mac currently has an *Apple Development* certificate. That one is for
running apps on your own devices; it does not satisfy Gatekeeper.

In Xcode:

1. **Xcode › Settings › Accounts**, select your Apple ID, then your team.
2. **Manage Certificates…**
3. Press **+** and choose **Developer ID Application**.

Check it arrived:

```bash
security find-identity -v -p codesigning
```

The list should now include a line starting `Developer ID Application:`.

## 2. Store notary credentials (once)

Apple's notary service needs to know who is submitting.

1. At <https://account.apple.com>, under **Sign-In and Security › App-Specific
   Passwords**, create a password (name it anything, e.g. "notary").
2. Store it in the keychain under the profile name the build looks for. Run
   this yourself in Terminal; it asks for the app-specific password and saves
   it, so the password never appears in a file:

```bash
xcrun notarytool store-credentials rummi-tummi-notary --apple-id YOUR_APPLE_ID_EMAIL --team-id WFEP74PJYU
```

`WFEP74PJYU` is the team id on this Mac's existing certificate. If you belong
to more than one team, use the id of the team that owns the Developer ID
certificate.

## 3. Build

```bash
npm run build:mac
```

The last lines say how the app was signed. With both steps done they read
`Signed: Developer ID Application: … , notarized by Apple`. Notarizing takes a
few minutes each time: the app is sent, then the disk image.

To check a finished app the way Gatekeeper will:

```bash
spctl --assess --type execute --verbose "dist/…/Lynda's Rummi Time 1.3.0.app"
```

`accepted` with `source=Notarized Developer ID` is the result to look for.

## Notes

- `npm run release` uses the same build, so released downloads are signed and
  notarized as soon as the two steps above are in place.
- The app is signed with the hardened runtime and the entitlements in
  `build/entitlements.mac.plist` (what Electron's JavaScript engine needs, and
  the camera for profile photos).
- Windows builds are not signed. Windows shows "Windows protected your PC"
  until the user chooses More info › Run anyway; removing that needs a
  separate Windows code-signing certificate.
