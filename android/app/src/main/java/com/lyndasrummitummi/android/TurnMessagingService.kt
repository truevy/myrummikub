package com.lyndasrummitummi.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService

/** The notification channel "your turn" and invitations arrive on. */
object Channels {
    const val TURNS = "turns"

    fun ensure(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(TURNS) != null) return
        manager.createNotificationChannel(
            NotificationChannel(TURNS, "Your turn and invitations", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Tells you when it is your turn in a game, and when someone invites you."
            }
        )
    }
}

/**
 * While the game is closed or in the background, Firebase shows the
 * notification itself (the function at Firebase sends a "notification"
 * message), and a tap on it starts [MainActivity] with the game in the intent.
 * While the game is in front its own banner says it, so nothing is shown here.
 */
class TurnMessagingService : FirebaseMessagingService() {
    override fun onCreate() {
        super.onCreate()
        Channels.ensure(this)
    }

    // The page saves the device's token with the account every time it goes online,
    // so a new token is picked up the next time the game opens.
    override fun onNewToken(token: String) {}
}
