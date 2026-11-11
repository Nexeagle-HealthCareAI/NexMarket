package com.nexeagle.lockscreen

import android.app.Activity
import android.os.Build
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Lets only the call screens show over the lock screen (like the phone's own dialer): switched on while a call rings or
 * is going on, and off again afterwards, so the rest of the app always needs the phone unlocked.
 */
class LockScreenModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LockScreen")

    Function("setOverLock") { on: Boolean ->
      val activity = appContext.currentActivity
      if (activity != null) {
        activity.runOnUiThread { apply(activity, on) }
      }
      activity != null
    }
  }

  private fun apply(activity: Activity, on: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      activity.setShowWhenLocked(on)
      activity.setTurnScreenOn(on)
    } else {
      @Suppress("DEPRECATION")
      val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      if (on) activity.window.addFlags(flags) else activity.window.clearFlags(flags)
    }
    // Keep the screen on while the call screen is up.
    if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }
}
