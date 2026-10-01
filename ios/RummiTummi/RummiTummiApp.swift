import SwiftUI

@main
struct RummiTummiApp: App {
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
