import type { ExpoConfig } from 'expo/config';

// Version shown in the app and on the Play Store comes from package.json — bump it there for
// every release. CI derives the Android versionCode from the run number so every APK can be
// installed over the last.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const VERSION: string = require('./package.json').version;
const versionCode = Number(process.env.ANDROID_VERSION_CODE ?? '1');

const CALL_MIC = 'NexEagle uses the microphone when you tap Speak, to write your note for you, and during voice and video calls with the office and your team.';
const CALL_CAMERA = 'NexEagle uses the camera to photograph partners, clinics and documents (each photo is stamped with the time and place), and for video calls.';

const LOCATION_PURPOSE =
  'NexEagle records your location only while your shift is on, including when the screen is off, so the hospital can see your visits and distance. Tracking stops when you end the shift.';

// Firebase (phone push): CI writes google-services.json from a secret. Without it the app still builds,
// and alerts come through the sync loop while the app is running.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs: { existsSync(p: string): boolean } = require('fs');
const GOOGLE_SERVICES = process.env.GOOGLE_SERVICES_JSON ?? (fs.existsSync('./google-services.json') ? './google-services.json' : undefined);

const config: ExpoConfig = {
  name: 'NexEagle',
  slug: 'nexeagle-field',
  scheme: 'nexeaglefield',
  version: VERSION,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#f4f6fa',
  ios: {
    bundleIdentifier: 'com.nexeagle.field',
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.nexeagle.field',
    versionCode,
    ...(GOOGLE_SERVICES ? { googleServicesFile: GOOGLE_SERVICES } : {}),
    adaptiveIcon: {
      backgroundColor: '#0e1525',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: [
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.CAMERA',
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.VIBRATE', // the short buzz after a save (Me → Vibrate when saved), and an incoming call
      // Voice and video calls (LiveKit / WebRTC): the microphone, switching earpiece ↔ loudspeaker, Bluetooth headsets
      // (Android 12+ asks for "Nearby devices"), and keeping the CPU awake during a call.
      'android.permission.RECORD_AUDIO',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.WAKE_LOCK',
      // An incoming call rings full screen, like a phone call, even when the phone is locked or the app is closed.
      'android.permission.USE_FULL_SCREEN_INTENT',
    ],
    // The app records audio only while the agent taps Speak or is in a call, and never reads the photo gallery (photos must be taken live).
    // SYSTEM_ALERT_WINDOW (added by the WebRTC plugin) stays blocked: calls don't draw over other apps.
    blockedPermissions: [
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    // Only the two phone CPU types (32-bit ARM for older phones, 64-bit ARM for newer ones); emulator-only
    // x86 code is left out, which makes the APK much smaller to download and install.
    // Calls (LiveKit): its WebRTC classes are called from native code, so the release shrinker must keep them; and
    // JniZeroJni only exists on the native side, which R8 would otherwise stop the build over as a "missing class".
    ['expo-build-properties', {
      android: {
        buildArchs: ['armeabi-v7a', 'arm64-v8a'],
        extraProguardRules: [
          '-keep class livekit.org.webrtc.** { *; }',
          '-keep class livekit.org.jni_zero.** { *; }',
          '-dontwarn livekit.org.jni_zero.JniZeroJni',
        ].join('\n'),
      },
    }],
    'expo-router',
    'expo-sqlite',
    'expo-secure-store',
    'expo-localization',
    'expo-font',
    // The microphone: only while the agent taps "Speak" to fill a note, a name or a chat message.
    ['expo-audio', { microphonePermission: CALL_MIC, recordAudioAndroid: true }],
    ['expo-local-authentication', { faceIDPermission: 'NexEagle uses Face ID to unlock the app instead of your PIN.' }],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: '#0e1525',
      },
    ],
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission: LOCATION_PURPOSE,
        locationAlwaysPermission: LOCATION_PURPOSE,
        locationWhenInUsePermission:
          'NexEagle uses your location to check you in at panchayats and to plan your route.',
        motionUsagePermission: false,
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/android-icon-monochrome.png',
        color: '#0a72d6',
      },
    ],
    // The full-screen ringing for incoming calls (Answer / Decline on the notification, ringing until answered).
    'react-native-notify-kit',
    [
      'expo-image-picker',
      {
        cameraPermission: CALL_CAMERA,
        photosPermission: false,
        microphonePermission: false,
      },
    ],
    // Voice and video calls through the hospital's own LiveKit server. "communication" = phone-call audio (echo
    // cancellation, earpiece by default); no screen sharing, so no media-projection foreground service.
    ['@livekit/react-native-expo-plugin', { android: { audioType: 'communication' } }],
    ['@config-plugins/react-native-webrtc', { cameraPermission: CALL_CAMERA, microphonePermission: CALL_MIC }],
  ],
  extra: {
    // Where the NexMarket API lives. CI sets EXPO_PUBLIC_API_URL from the repo variable.
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'https://nexmarket-api.nexeagle.com',
    // Optional: the hospital's duty-doctor line, shown on urgent referrals.
    dutyDoctorPhone: process.env.EXPO_PUBLIC_DUTY_DOCTOR_PHONE ?? '',
    // The marketing office, for the call button in the agent's office chat.
    officePhone: process.env.EXPO_PUBLIC_OFFICE_PHONE ?? '+919162321859',
  },
};

export default config;
