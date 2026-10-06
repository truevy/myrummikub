import AuthenticationServices
import CryptoKit
import GameKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

/// The whole game is the same web page the Mac and Windows apps show. This
/// view hosts it and gives it the few things a web page cannot do by itself.
struct GameView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // The page is served from app://rummikub/, the same origin as on the
        // Mac, so stored players, settings and the online sign-in persist.
        config.setURLSchemeHandler(WebFiles(), forURLScheme: "app")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.addScriptMessageHandler(Bridge.shared, contentWorld: .page, name: "rk")
        config.userContentController.addUserScript(
            WKUserScript(source: Bridge.pageScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let web = WKWebView(frame: .zero, configuration: config)
        web.uiDelegate = Bridge.shared
        web.isOpaque = false
        web.backgroundColor = UIColor(named: "LaunchBackground")
        web.scrollView.backgroundColor = UIColor(named: "LaunchBackground")
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsLinkPreview = false
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #endif
        Bridge.shared.web = web
        web.load(URLRequest(url: URL(string: "app://rummikub/index.html")!))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// Serves index.html, src/ and vendor/ from the app bundle.
final class WebFiles: NSObject, WKURLSchemeHandler {
    private let types = [
        "html": "text/html", "js": "text/javascript", "css": "text/css",
        "json": "application/json", "png": "image/png", "svg": "image/svg+xml",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let root = Bundle.main.resourceURL?.appendingPathComponent("web") else {
            return task.didFailWithError(URLError(.badURL))
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(path).standardizedFileURL
        // nothing outside the web folder is ever served
        guard file.path.hasPrefix(root.standardizedFileURL.path + "/"), let data = try? Data(contentsOf: file) else {
            let missing = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!
            task.didReceive(missing)
            task.didFinish()
            return
        }
        let mime = types[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let headers = ["Content-Type": "\(mime); charset=utf-8", "Content-Length": "\(data.count)", "Cache-Control": "no-cache"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// What the page can ask the app to do: open Messages or Mail, hand over an
/// invitation link, save and open game files.
final class Bridge: NSObject, WKScriptMessageHandlerWithReply, WKUIDelegate, UIDocumentPickerDelegate, GKGameCenterControllerDelegate,
                    ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding, ASWebAuthenticationPresentationContextProviding {
    static let shared = Bridge()
    weak var web: WKWebView?
    private var appleReply: ((Any?, String?) -> Void)?
    private var webSession: ASWebAuthenticationSession?
    private var appleNonce = ""
    private var pendingUrl: String?
    private var pickerReply: ((Any?, String?) -> Void)?
    private var exporting = false
    private var exportName = ""

    /// Defined before the page's own scripts run. Mirrors what the Mac app's
    /// preload script provides, so the game code is the same on both.
    static let pageScript = """
    (function () {
      const call = (message) => window.webkit.messageHandlers.rk.postMessage(message);
      const listeners = [];
      window.__rkOpenUrl = (url) => listeners.forEach((cb) => cb(url));
      window.rkCloud = {
        isDev: false,
        version: () => call({ cmd: 'version' }),
        pendingUrl: () => call({ cmd: 'pendingUrl' }),
        onUrl: (cb) => listeners.push(cb),
        openExternal: (url) => call({ cmd: 'openExternal', url }),
      };
      // Signing in to Game Center is optional; resolves to { alias, id }.
      // Sign in with Apple: resolves to { idToken, nonce } for the account sign-in.
      window.rkApple = { signIn: () => call({ cmd: 'apple' }) };
      // The hosted sign-in page (Google, or Apple on a Mac) in a web session; resolves to the link it comes back with.
      window.rkWebAuth = { open: (url) => call({ cmd: 'webAuth', url }) };
      // Push notifications: register resolves to { token, env } or null; a
      // tapped notification calls window.__rkOpenGame(gid).
      window.rkPush = {
        register: () => call({ cmd: 'pushRegister' }),
        pendingGame: () => call({ cmd: 'pushPending' }),
        clearBadge: () => call({ cmd: 'pushClear' }),
      };
      window.rkGameCenter = {
        signIn: () => call({ cmd: 'gameCenter' }),
        report: (leaderboard, score) => call({ cmd: 'gameCenterReport', leaderboard, score }),
        show: () => call({ cmd: 'gameCenterShow' }),
      };
      window.rkFiles = {
        save: (name, text) => call({ cmd: 'save', name, text }),
        load: () => call({ cmd: 'load' }),
      };
      window.addEventListener('error', (e) => call({ cmd: 'log', text: 'error: ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno }));
      window.addEventListener('unhandledrejection', (e) => call({ cmd: 'log', text: 'rejection: ' + (e.reason && e.reason.message || e.reason) }));
    })();
    """

    /// A notification was tapped: the page opens that game.
    func openGame(_ gid: String) {
        guard let web = web, !web.isLoading, let json = try? JSONEncoder().encode(gid), let literal = String(data: json, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.__rkOpenGame && window.__rkOpenGame(\(literal))")
    }

    /// An invitation link arrived, at launch or while running.
    func received(_ url: URL) {
        let text = url.absoluteString
        guard text.lowercased().hasPrefix("rummi-tummi://") else { return }
        pendingUrl = text
        guard let web = web, !web.isLoading, let json = try? JSONEncoder().encode(text), let literal = String(data: json, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.__rkOpenUrl && window.__rkOpenUrl(\(literal))") { [weak self] _, error in
            if error == nil { self?.pendingUrl = nil }
        }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else {
            return replyHandler(nil, "Bad request.")
        }
        switch cmd {
        case "version":
            replyHandler(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "", nil)
        case "pendingUrl":
            replyHandler(pendingUrl ?? NSNull(), nil)
            pendingUrl = nil
        case "openExternal":
            // only Messages, Mail and the download page may be opened
            guard let text = body["url"] as? String, let url = URL(string: text),
                  ["sms", "imessage", "mailto"].contains(url.scheme?.lowercased() ?? "")
                    || text.hasPrefix("https://github.com/truevy/myrummikub/") else {
                return replyHandler(nil, "That kind of link cannot be opened.")
            }
            UIApplication.shared.open(url) { ok in replyHandler(ok, ok ? nil : "Could not open that link.") }
        case "save":
            guard let name = body["name"] as? String, let text = body["text"] as? String else { return replyHandler(nil, "Nothing to save.") }
            let file = FileManager.default.temporaryDirectory.appendingPathComponent((name as NSString).lastPathComponent)
            do { try text.write(to: file, atomically: true, encoding: .utf8) } catch { return replyHandler(nil, error.localizedDescription) }
            exporting = true
            exportName = file.lastPathComponent
            present(UIDocumentPickerViewController(forExporting: [file], asCopy: true), reply: replyHandler)
        case "load":
            exporting = false
            present(UIDocumentPickerViewController(forOpeningContentTypes: [.data, .json, .item], asCopy: true), reply: replyHandler)
        case "pushRegister":
            guard let push = PushDelegate.shared else { return replyHandler(NSNull(), nil) }
            push.register(reply: replyHandler)
        case "pushPending":
            replyHandler(PushDelegate.shared?.takePendingGame() ?? NSNull(), nil)
        case "pushClear":
            UNUserNotificationCenter.current().setBadgeCount(0)
            replyHandler(true, nil)
        case "webAuth":
            guard let text = body["url"] as? String, let url = URL(string: text), text.hasPrefix("https://lyndas-rummikub.web.app/") else {
                return replyHandler(nil, "That page cannot be opened.")
            }
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "rummi-tummi") { callback, error in
                if let callback = callback { replyHandler(callback.absoluteString, nil) }
                else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin { replyHandler(NSNull(), nil) }
                else { replyHandler(nil, error?.localizedDescription ?? "The sign-in did not complete.") }
                self.webSession = nil
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            webSession = session
            session.start()
        case "apple":
            signInWithApple(reply: replyHandler)
        case "gameCenter":
            signInToGameCenter(reply: replyHandler)
        case "gameCenterReport":
            // the player's standing on a leaderboard, e.g. their online wins
            guard GKLocalPlayer.local.isAuthenticated, let id = body["leaderboard"] as? String, let score = body["score"] as? Int else {
                return replyHandler(false, nil)
            }
            GKLeaderboard.submitScore(score, context: 0, player: GKLocalPlayer.local, leaderboardIDs: [id]) { error in
                replyHandler(error == nil, error?.localizedDescription)
            }
        case "gameCenterShow":
            guard GKLocalPlayer.local.isAuthenticated else { return replyHandler(nil, "Sign in to Game Center first.") }
            let screen = GKGameCenterViewController(state: .leaderboards)
            screen.gameCenterDelegate = self
            let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
            scene?.keyWindow?.rootViewController?.present(screen, animated: true)
            replyHandler(true, nil)
        case "log":
            NSLog("[page] %@", body["text"] as? String ?? "")
            replyHandler(true, nil)
        default:
            replyHandler(nil, "Unknown request.")
        }
    }

    /// Game Center, when the player asks for it. iOS shows its own sign-in
    /// sheet if needed; the page gets the player's Game Center name back.
    private func signInToGameCenter(reply: @escaping (Any?, String?) -> Void) {
        let player = GKLocalPlayer.local
        let info: () -> [String: Any] = { ["alias": player.alias, "name": player.displayName, "id": player.teamPlayerID] }
        if player.isAuthenticated { return reply(info(), nil) }
        var answered = false
        player.authenticateHandler = { sheet, error in
            if let sheet = sheet {
                let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
                scene?.keyWindow?.rootViewController?.present(sheet, animated: true)
                return
            }
            guard !answered else { return }
            answered = true
            if player.isAuthenticated {
                reply(info(), nil)
            } else {
                reply(nil, error?.localizedDescription ?? "Game Center sign-in was cancelled. You can sign in under Settings › Game Center.")
            }
        }
    }

    /// Apple's own sign-in sheet. The page gets the identity token and the
    /// nonce it was issued for, and signs in to the account service with them.
    private func signInWithApple(reply: @escaping (Any?, String?) -> Void) {
        appleReply?(nil, "Replaced by a newer sign-in.")
        appleReply = reply
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        appleNonce = bytes.map { String(format: "%02x", $0) }.joined()
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName]
        request.nonce = SHA256.hash(data: Data(appleNonce.utf8)).map { String(format: "%02x", $0) }.joined()
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        controller.performRequests()
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        defer { appleReply = nil }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let data = credential.identityToken, let token = String(data: data, encoding: .utf8) else {
            return appleReply?(nil, "Apple did not return a sign-in.") ?? ()
        }
        let name = [credential.fullName?.givenName, credential.fullName?.familyName].compactMap { $0 }.joined(separator: " ")
        appleReply?(["idToken": token, "nonce": appleNonce, "name": name], nil)
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        defer { appleReply = nil }
        let code = (error as? ASAuthorizationError)?.code
        appleReply?(nil, code == .canceled ? "Sign-in cancelled." : error.localizedDescription)
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        return scene?.keyWindow ?? ASPresentationAnchor()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        return scene?.keyWindow ?? ASPresentationAnchor()
    }

    func gameCenterViewControllerDidFinish(_ screen: GKGameCenterViewController) {
        screen.dismiss(animated: true)
    }

    private func present(_ picker: UIDocumentPickerViewController, reply: @escaping (Any?, String?) -> Void) {
        pickerReply?(NSNull(), nil) // an earlier dialog that was never answered
        pickerReply = reply
        picker.delegate = self
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        guard let top = scene?.keyWindow?.rootViewController else {
            pickerReply = nil
            return reply(nil, "No window to show the dialog in.")
        }
        top.present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        defer { pickerReply = nil }
        guard let url = urls.first else { pickerReply?(NSNull(), nil); return }
        if exporting { pickerReply?(exportName, nil); return }
        guard let data = try? Data(contentsOf: url), data.count <= 4 * 1024 * 1024, let text = String(data: data, encoding: .utf8) else {
            pickerReply?(nil, "That file could not be read as a saved game.")
            return
        }
        pickerReply?(["name": url.lastPathComponent, "text": text], nil)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickerReply?(NSNull(), nil)
        pickerReply = nil
    }

    // The page asks for the camera for profile photos; iOS still shows its own
    // permission prompt the first time.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(type == .camera && origin.protocol == "app" ? .grant : .deny)
    }
}
