# NexEagle Field

The Android / iOS app for Glisan Akbari SuperSpeciality Hospital's field marketing agents
(package and bundle id `com.nexeagle.field`). Built with Expo SDK 58, expo-router and TypeScript.

It works offline first: every action is written to the phone's SQLite database and an
outbox, the agent sees "saved on phone", and the app sends the outbox to the NexMarket API
when there is signal (on open, when the network returns, every 2 minutes during a shift, or
from **Me → Send now**).

## What's in it

| Screen | File |
| --- | --- |
| Login (language picker, first sync) | `src/app/login.tsx` |
| Start shift (location notice, battery-saver tip) | `src/app/shift.tsx` |
| Today: week's patients, shift strip, ranked plan | `src/app/today.tsx` |
| Route map (MapLibre + OpenFreeMap, Google Maps hand-off) | `src/app/route.tsx` |
| Check-in → 3-tap outcome → check-out | `src/app/checkin.tsx` |
| Partner profile (priority, notes, patients, call / WhatsApp / refer) | `src/app/partner/[id].tsx` |
| New partner: photo → details → survey | `src/app/partner-new.tsx`, `src/app/survey.tsx` |
| “+” sheet | `src/app/add.tsx` |
| Refer a patient (consent, urgent, department) | `src/app/refer.tsx` |
| My patients (stage tracker) | `src/app/patients.tsx` |
| Follow-ups / partners tab | `src/app/followups.tsx` |
| Me (sync queue, month numbers, language, logout) | `src/app/me.tsx` |
| My attendance and leave, apply for leave | `src/app/attendance.tsx`, `src/app/leave.tsx` |

Logic lives in `src/lib`: `db.ts` (SQLite schema and queries), `repo.ts` (every write + its
outbox item), `sync.ts` (push / pull / reference data), `location.ts` (shift-only background
tracking), `api.ts` (tokens in the secure keystore, refresh), `plan.ts` (today's order).

Languages: Hindi (default), Hinglish, Bengali and English in `src/i18n`. **The Bengali file
is a draft and needs review by a native speaker** before it goes to the Kishanganj / Uttar
Dinajpur teams. Add a key to `en.ts` first; TypeScript then flags every language missing it.

## Run it

```bash
cd mobile
npm ci
npx expo start            # needs a development build, see below
```

Background location, the camera and SQLite need native code, so use a development build
rather than Expo Go:

```bash
npx expo run:android      # builds and installs on a connected phone or emulator
npx expo run:ios          # macOS + Xcode
```

The API address comes from `EXPO_PUBLIC_API_URL` (default
`https://nexmarket-api.nexeagle.com`). For a local API:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:5000 npx expo run:android
```

Optional: `EXPO_PUBLIC_DUTY_DOCTOR_PHONE` shows a "Duty doctor" call button on urgent referrals.

Checks:

```bash
npm run typecheck                        # tsc --noEmit
npx expo export --platform android       # bundles the JS exactly as a release build does
```

## Build an APK

GitHub Actions does this. The workflow is in `mobile/ci/android-apk.yml`; **move it to
`.github/workflows/android-apk.yml`** to switch it on. It runs on pushes to `develop` / `main`
that touch `mobile/`, on tags `v*`, and by hand (Actions → Android APK → Run workflow).

Each run uploads `nexeagle-field-<version>-<run number>.apk` as an artifact. A tag such as
`v1.0.0` also builds an `.aab` for the Play Store and creates a GitHub release with both.
The Android `versionCode` is the run number, so every build installs over the previous one.

### Secrets and variables

| Name | Kind | What |
| --- | --- | --- |
| `ANDROID_KEYSTORE_BASE64` | secret | `base64 -w0 upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | secret | keystore password |
| `ANDROID_KEY_ALIAS` | secret | key alias |
| `ANDROID_KEY_PASSWORD` | secret | key password |
| `EXPO_PUBLIC_API_URL` | variable | API base URL baked into the build |
| `EXPO_PUBLIC_DUTY_DOCTOR_PHONE` | variable | optional |

Without the keystore secrets the APK is signed with the debug key: fine for testing, but
the Play Store will not accept it, and a later release-signed APK will not install over it
(uninstall first).

Create a keystore once and keep it safe (losing it means a new Play listing):

```bash
keytool -genkeypair -v -storetype JKS -keystore upload.jks -alias nexeagle-field \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 upload.jks   # paste into ANDROID_KEYSTORE_BASE64
```

### Build locally

```bash
cd mobile
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

`android/` and `ios/` are generated; don't commit them. Change `app.config.ts` instead.

## Release checklist

1. Bump `version` in `package.json` (the app and CI read it from there).
2. Merge to `main`, then tag: `git tag v1.0.1 && git push origin v1.0.1`.
3. Download the APK from the release, or upload the `.aab` to Play Console.

## Phone setup for agents

- Allow location **"All the time"** — needed to record the route with the screen off.
  Tracking runs only between Start shift and End shift; Android shows a notification the
  whole time.
- On Xiaomi / Vivo / Oppo / Realme set Battery → **No restrictions** for NexEagle Field
  (Start shift → "Fix" opens the setting).
