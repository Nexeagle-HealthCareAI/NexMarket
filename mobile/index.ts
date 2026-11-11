// Incoming-call ringing must be wired up before anything else: Android may start the app in the background only to
// handle a "someone is calling" push, with no screen at all.
import './src/lib/callRing';
import 'expo-router/entry';
