import UIKit
import UserNotifications

/// Push notifications: "your turn" and invitations arrive through Apple's
/// push service while the app is closed. The page asks for them once the
/// player is online; iOS shows its own permission prompt the first time.
final class PushDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    static var shared: PushDelegate?
    private var tokenReply: ((Any?, String?) -> Void)?
    private var pendingGame: String?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        PushDelegate.shared = self
        UNUserNotificationCenter.current().delegate = self
        // a notification that started the app: the game to open
        if let note = options?[.remoteNotification] as? [String: Any], let gid = note["gid"] as? String { pendingGame = gid }
        return true
    }

    /// Asks for permission (once) and registers with Apple. The reply carries
    /// the device token as hex, and whether it is for Apple's sandbox or
    /// production push service, or null when the player said no.
    func register(reply: @escaping (Any?, String?) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            DispatchQueue.main.async {
                if let error = error { return reply(nil, error.localizedDescription) }
                if !granted { return reply(NSNull(), nil) }
                self.tokenReply?(NSNull(), nil)
                self.tokenReply = reply
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        #if DEBUG
        let env = "sandbox"
        #else
        let env = "production"
        #endif
        tokenReply?(["token": token, "env": env], nil)
        tokenReply = nil
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        tokenReply?(nil, error.localizedDescription)
        tokenReply = nil
    }

    /// The game to open because a notification was tapped, if any.
    func takePendingGame() -> String? {
        defer { pendingGame = nil }
        return pendingGame
    }

    // While the game is in front its own banner says it; no system banner on top.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([])
    }

    // A tapped notification opens the game it is about.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if let gid = response.notification.request.content.userInfo["gid"] as? String {
            pendingGame = gid
            Bridge.shared.openGame(gid)
        }
        completionHandler()
    }
}
