import SwiftUI

@main
struct RummiTummiApp: App {
    @UIApplicationDelegateAdaptor(PushDelegate.self) private var push
    var body: some Scene {
        WindowGroup {
            GameView()
                .ignoresSafeArea()
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                .background(Color("LaunchBackground"))
                // an invitation link (rummi-tummi://join?t=…) opened the app
                .onOpenURL { url in Bridge.shared.received(url) }
        }
    }
}
