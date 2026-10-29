import type { ExpoConfig } from 'expo/config';

// Version shown in the app and on the Play Store comes from package.json — bump it there for
// every release. CI derives the Android versionCode from the run number so every APK can be
// installed over the last.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const VERSION: string = require('./package.json').version;
const versionCode = Number(process.env.ANDROID_VERSION_CODE ?? '1');

const LOCATION_PURPOSE =
  'NexEagle Field records your location only while your shift is on, including when the screen is off, so the hospital can see your visits and distance. Tracking stops when you end the shift.';

const config: ExpoConfig = {
  name: 'NexEagle Field',
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
    ],
    // The app never records audio or reads the photo gallery (photos must be taken live).
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    'expo-secure-store',
    'expo-localization',
    'expo-font',
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
          'NexEagle Field uses your location to check you in at panchayats and to plan your route.',
        motionUsagePermission: false,
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'expo-image-picker',
      {
        cameraPermission: 'NexEagle Field uses the camera to photograph partners, clinics and documents. Each photo is stamped with the time and place.',
        photosPermission: false,
        microphonePermission: false,
      },
    ],
  ],
  extra: {
    // Where the NexMarket API lives. CI sets EXPO_PUBLIC_API_URL from the repo variable.
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'https://nexmarket-api.nexeagle.com',
    // Optional: the hospital's duty-doctor line, shown on urgent referrals.
    dutyDoctorPhone: process.env.EXPO_PUBLIC_DUTY_DOCTOR_PHONE ?? '',
  },
};

export default config;
