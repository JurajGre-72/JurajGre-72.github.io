// PHARMACOPOLA Regulatory Monitor – macOS app
//
// A native window around the live dashboard (https://jurajgre-72.github.io/pharma-monitor/), so new data and
// dashboard changes appear without reinstalling. The app itself updates from the repository's GitHub Releases:
// "Check for App Update…" downloads the newest build, replaces this app and restarts it.
//
// Built by .github/workflows/macos-app.yml (swiftc, no Xcode project). Single file on purpose.

import Cocoa
import WebKit

let dashboardURL = URL(string: "https://jurajgre-72.github.io/pharma-monitor/")!
// The repository also publishes releases for other projects, so this app only looks at tags "monitor-mac-v<version>".
let releasesAPI = URL(string: "https://api.github.com/repos/JurajGre-72/JurajGre-72.github.io/releases?per_page=50")!
let tagPrefix = "monitor-mac-v"
let releasesPage = URL(string: "https://github.com/JurajGre-72/JurajGre-72.github.io/releases/tag/monitor-mac-latest")!
let appName = "PHARMACOPOLA Monitor"
let zipAssetSuffix = "-mac.zip"

var currentVersion: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
}

/// "v1.10.0" > "1.9.2"
func isNewer(_ remote: String, than local: String) -> Bool {
    let parts = { (s: String) -> [Int] in
        s.trimmingCharacters(in: CharacterSet(charactersIn: "vV")).split(separator: ".").map { Int($0) ?? 0 }
    }
    let a = parts(remote), b = parts(local)
    for i in 0..<max(a.count, b.count) {
        let x = i < a.count ? a[i] : 0, y = i < b.count ? b[i] : 0
        if x != y { return x > y }
    }
    return false
}

struct Release {
    let version: String
    let notes: String
    let zipURL: URL?
    let pageURL: URL
}

func fetchLatestRelease(_ done: @escaping (Result<Release?, Error>) -> Void) {
    var req = URLRequest(url: releasesAPI, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
    req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
    req.setValue("\(appName)/\(currentVersion)", forHTTPHeaderField: "User-Agent")
    URLSession.shared.dataTask(with: req) { data, response, error in
        if let error = error { return done(.failure(error)) }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200, let data = data,
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return done(.failure(NSError(domain: appName, code: status,
                                         userInfo: [NSLocalizedDescriptionKey: "GitHub answered HTTP \(status)."])))
        }
        let ours = list.filter {
            ($0["tag_name"] as? String)?.hasPrefix(tagPrefix) == true && $0["draft"] as? Bool != true && $0["prerelease"] as? Bool != true
        }
        let version = { (r: [String: Any]) in String((r["tag_name"] as? String ?? "").dropFirst(tagPrefix.count)) }
        guard let json = ours.max(by: { isNewer(version($1), than: version($0)) }) else { return done(.success(nil)) }
        let tag = version(json)
        let assets = json["assets"] as? [[String: Any]] ?? []
        let zip = assets.first { ($0["name"] as? String)?.hasSuffix(zipAssetSuffix) == true }
        let zipURL = (zip?["browser_download_url"] as? String).flatMap(URL.init(string:))
        let page = (json["html_url"] as? String).flatMap(URL.init(string:)) ?? releasesPage
        done(.success(Release(version: tag, notes: json["body"] as? String ?? "", zipURL: zipURL, pageURL: page)))
    }.resume()
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, NSToolbarDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    let smokeTest = ProcessInfo.processInfo.environment["PM_SMOKE_TEST"] == "1"
    /// CI only: install this zip as if the update button had been pressed, without dialogs
    let updateTestZip = ProcessInfo.processInfo.environment["PM_UPDATE_TEST_ZIP"]
    var updateInProgress = false

    // MARK: launch

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()  // keeps the dashboard's settings and token between launches
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.customUserAgent = nil
        webView.setValue(false, forKey: "drawsBackground")  // no white flash before the page paints

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = appName
        window.minSize = NSSize(width: 420, height: 480)
        window.backgroundColor = NSColor(srgbRed: 0, green: 0x3A / 255.0, blue: 0x5B / 255.0, alpha: 1)
        window.contentView = webView
        window.setFrameAutosaveName("MainWindow")
        if !window.setFrameUsingName("MainWindow") { window.center() }

        let toolbar = NSToolbar(identifier: "Main")
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        window.toolbar = toolbar
        window.toolbarStyle = .unifiedCompact
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        load()

        if let zip = updateTestZip {
            print("UPDATE TEST: installing \(zip) over \(Bundle.main.bundlePath) (version \(currentVersion))")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.install(from: URL(fileURLWithPath: zip), fallback: releasesPage) }
        } else if smokeTest {
            runSmokeTest()
        } else {
            // quiet daily check; only speaks up when there is something new
            let last = UserDefaults.standard.double(forKey: "lastUpdateCheck")
            if Date().timeIntervalSince1970 - last > 20 * 3600 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 4) { self.checkForUpdates(userInitiated: false) }
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func load(cachePolicy: URLRequest.CachePolicy = .reloadRevalidatingCacheData) {
        webView.load(URLRequest(url: dashboardURL, cachePolicy: cachePolicy, timeoutInterval: 30))
    }

    // MARK: menus

    func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About \(appName)", action: #selector(about), keyEquivalent: "")
        appMenu.addItem(withTitle: "Check for App Update…", action: #selector(checkForUpdatesMenu), keyEquivalent: "u")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide \(appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        // Edit menu: without it ⌘C / ⌘V do not work in the page (needed to paste the GitHub token)
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Find…", action: #selector(focusSearch), keyEquivalent: "f")
        editItem.submenu = edit

        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        view.addItem(.separator())
        view.addItem(withTitle: "Actual Size", action: #selector(zoomReset), keyEquivalent: "0")
        view.addItem(withTitle: "Zoom In", action: #selector(zoomIn), keyEquivalent: "+")
        view.addItem(withTitle: "Zoom Out", action: #selector(zoomOut), keyEquivalent: "-")
        view.addItem(.separator())
        let fs = view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fs.keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = view

        let windowItem = NSMenuItem(); main.addItem(windowItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = win
        NSApp.windowsMenu = win

        let helpItem = NSMenuItem(); main.addItem(helpItem)
        let help = NSMenu(title: "Help")
        help.addItem(withTitle: "Open Dashboard in Browser", action: #selector(openInBrowser), keyEquivalent: "")
        help.addItem(withTitle: "Release Notes", action: #selector(openReleases), keyEquivalent: "")
        helpItem.submenu = help

        NSApp.mainMenu = main
    }

    // MARK: toolbar

    let reloadID = NSToolbarItem.Identifier("reload")
    let updateID = NSToolbarItem.Identifier("appUpdate")

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { [reloadID, .flexibleSpace, updateID] }
    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { [.flexibleSpace, reloadID, updateID] }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let item = NSToolbarItem(itemIdentifier: id)
        let button: NSButton
        if id == reloadID {
            button = NSButton(image: NSImage(systemSymbolName: "arrow.clockwise", accessibilityDescription: "Reload")!,
                              target: self, action: #selector(reload))
            item.label = "Reload"
            item.toolTip = "Reload the dashboard (⌘R)"
        } else {
            button = NSButton(title: "Check for App Update", image: NSImage(systemSymbolName: "arrow.down.app", accessibilityDescription: nil)!,
                              target: self, action: #selector(checkForUpdatesMenu))
            button.imagePosition = .imageLeading
            item.label = "App Update"
            item.toolTip = "Install the newest version of this app (⌘U)"
        }
        button.bezelStyle = .texturedRounded
        item.view = button
        return item
    }

    // MARK: actions

    @objc func reload() { load(cachePolicy: .reloadIgnoringLocalCacheData) }
    @objc func zoomIn() { webView.pageZoom = min(webView.pageZoom + 0.1, 2.0) }
    @objc func zoomOut() { webView.pageZoom = max(webView.pageZoom - 0.1, 0.6) }
    @objc func zoomReset() { webView.pageZoom = 1.0 }
    @objc func focusSearch() { webView.evaluateJavaScript("document.getElementById('q')?.focus()") }
    @objc func openInBrowser() { NSWorkspace.shared.open(dashboardURL) }
    @objc func openReleases() { NSWorkspace.shared.open(releasesPage) }

    @objc func about() {
        let alert = NSAlert()
        alert.messageText = appName
        alert.informativeText = "Version \(currentVersion)\n\nSlovak and EU regulatory changes relevant to PHARMACOPOLA s.r.o.\nData: \(dashboardURL.absoluteString)\n\nMonitoring aid, not legal advice."
        alert.icon = NSApp.applicationIconImage
        alert.runModal()
    }

    // MARK: app updates

    @objc func checkForUpdatesMenu() { checkForUpdates(userInitiated: true) }

    func checkForUpdates(userInitiated: Bool) {
        guard !updateInProgress else { return }
        fetchLatestRelease { result in
            DispatchQueue.main.async {
                UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "lastUpdateCheck")
                switch result {
                case .failure(let error):
                    if userInitiated { self.info("Could not check for updates", error.localizedDescription) }
                case .success(let release):
                    guard let release = release, isNewer(release.version, than: currentVersion) else {
                        if userInitiated { self.info("You're up to date", "\(appName) \(currentVersion) is the newest version.") }
                        return
                    }
                    self.offer(release)
                }
            }
        }
    }

    func offer(_ release: Release) {
        let alert = NSAlert()
        alert.messageText = "\(appName) \(release.version.trimmingCharacters(in: CharacterSet(charactersIn: "v"))) is available"
        let notes = release.notes.split(separator: "\n").prefix(12).joined(separator: "\n")
        alert.informativeText = "You have version \(currentVersion).\n\n\(notes)"
        alert.icon = NSApp.applicationIconImage
        alert.addButton(withTitle: "Install and Restart")
        alert.addButton(withTitle: "Later")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        guard let zip = release.zipURL else { NSWorkspace.shared.open(release.pageURL); return }
        install(from: zip, fallback: release.pageURL)
    }

    /// Download the new build, swap it in place of this app and relaunch. Any failure falls back to the download page.
    func install(from zipURL: URL, fallback: URL) {
        updateInProgress = true
        window.title = "\(appName) – downloading update…"
        URLSession.shared.downloadTask(with: zipURL) { tmp, _, error in
            let fail = { (why: String) in
                if self.updateTestZip != nil { print("UPDATE FAIL: \(why)"); fflush(stdout); exit(1) }
                DispatchQueue.main.async {
                    self.updateInProgress = false
                    self.window.title = appName
                    self.info("The update could not be installed automatically",
                              "\(why)\n\nThe download page will open – drag the new app into Applications to replace this one.")
                    NSWorkspace.shared.open(fallback)
                }
            }
            guard let tmp = tmp, error == nil else { return fail(error?.localizedDescription ?? "Download failed.") }
            let fm = FileManager.default
            let work = fm.temporaryDirectory.appendingPathComponent("pm-update-\(UUID().uuidString)")
            do {
                try fm.createDirectory(at: work, withIntermediateDirectories: true)
                let zip = work.appendingPathComponent("update.zip")
                try fm.moveItem(at: tmp, to: zip)
                let unzip = Process()
                unzip.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
                unzip.arguments = ["-x", "-k", zip.path, work.path]
                try unzip.run(); unzip.waitUntilExit()
                guard unzip.terminationStatus == 0 else { return fail("The downloaded file could not be unpacked.") }
                let newApp = work.appendingPathComponent("\(appName).app")
                guard fm.fileExists(atPath: newApp.path) else { return fail("The download did not contain the app.") }
                let current = Bundle.main.bundleURL
                _ = try fm.replaceItemAt(current, withItemAt: newApp)
                DispatchQueue.main.async { self.relaunch(current) }
            } catch {
                fail(error.localizedDescription)
            }
        }.resume()
    }

    func relaunch(_ app: URL) {
        print("UPDATE OK: replaced \(app.path), relaunching")
        fflush(stdout)
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = ["-c", "sleep 1; /usr/bin/open -n \"$0\"", app.path]
        try? task.run()
        NSApp.terminate(nil)
    }

    func info(_ title: String, _ text: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        alert.runModal()
    }

    // MARK: web view

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.allow) }
        let inApp = url.host == dashboardURL.host && url.path.hasPrefix("/pharma-monitor")
        if inApp || url.scheme == "about" || url.scheme == "data" || url.scheme == "blob" || action.targetFrame?.isMainFrame == false {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url)  // laws, PDFs, GitHub pages open in the default browser
            decisionHandler(.cancel)
        }
    }

    // target="_blank" links
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        info(appName, message); completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message
        alert.addButton(withTitle: "OK"); alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorNotConnectedToInternet,
           webView.url == nil || webView.url?.host != dashboardURL.host {
            load(cachePolicy: .returnCacheDataDontLoad)  // offline: show the last downloaded copy if there is one
            return
        }
        let html = """
        <html><body style="font:15px -apple-system;background:#EAF0F3;color:#0E2244;display:flex;align-items:center;justify-content:center;height:90vh">
        <div style="text-align:center;max-width:460px"><h2 style="color:#003A5B">Cannot reach the dashboard</h2>
        <p>\(ns.localizedDescription)</p><p>Check the internet connection, then press <b>⌘R</b> or the reload button.</p></div></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: smoke test (CI): load the live dashboard, count items, check the update API, quit

    func runSmokeTest() {
        var finished = false
        func finish(_ code: Int32, _ msg: String) {
            guard !finished else { return }
            finished = true
            print(msg)
            fflush(stdout)
            exit(code)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 90) { finish(1, "SMOKE FAIL: timed out") }
        func poll(_ attempt: Int) {
            webView.evaluateJavaScript("[document.querySelectorAll('article.item').length, !!document.getElementById('refresh'), document.title]") { value, error in
                let arr = value as? [Any] ?? []
                let items = arr.first as? Int ?? 0
                let hasButton = arr.count > 1 ? (arr[1] as? Bool ?? false) : false
                if items > 0 && hasButton {
                    fetchLatestRelease { result in
                        let rel: String
                        switch result {
                        case .success(let r): rel = r?.version ?? "none yet"
                        case .failure(let e): rel = "error: \(e.localizedDescription)"
                        }
                        DispatchQueue.main.async {
                            let ok = isNewer("1.10.0", than: "1.9.2") && !isNewer("v1.0.0", than: "1.0.0") && isNewer("v2", than: "1.9.9")
                            finish(ok ? 0 : 1, "SMOKE OK: version \(currentVersion), \(items) items rendered, title '\(arr.count > 2 ? arr[2] : "")', latest release: \(rel), version compare \(ok ? "ok" : "BROKEN")")
                        }
                    }
                } else if attempt < 60 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { poll(attempt + 1) }
                } else {
                    finish(1, "SMOKE FAIL: dashboard did not render (\(items) items, error: \(error?.localizedDescription ?? "none"))")
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { poll(0) }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
