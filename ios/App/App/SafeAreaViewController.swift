import UIKit
import WebKit
import Capacitor

/// The web view runs the full height of the phone (`contentInset: "never"`), which is what
/// lets the page paint its own strip behind the clock and keep the app's colours in dark
/// mode. The cost is that WebKit then reports `env(safe-area-inset-*)` as zero, so the page
/// has no idea how much room the clock or the home indicator needs.
///
/// This hands it the real numbers. `--sat` and `--sab` are the same two tokens the stylesheet
/// defines from `env()` for Safari and for a home-screen web app; setting them on the document
/// element overrides those, so one set of rules covers every way the app runs. They are sent
/// again on rotation, on a call banner, and after every page load, since a load throws the
/// inline values away.
class SafeAreaViewController: CAPBridgeViewController {

    private var progress: NSKeyValueObservation?

    override func viewDidLoad() {
        super.viewDidLoad()
        progress = webView?.observe(\.estimatedProgress, options: [.new]) { [weak self] _, _ in
            self?.publishInsets()
        }
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        publishInsets()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        publishInsets()
    }

    private var last: (CGFloat, CGFloat)?

    /* An inline value on <html> outranks the stylesheet's env() fallback, so a zero must
       clear the property rather than set it: a web view that has not been laid out yet
       would otherwise pin the page to no room at all. Values are clamped and fixed to one
       decimal, so nothing but a plain number can reach the page. */
    private func insetScript(_ insets: UIEdgeInsets) -> String {
        func set(_ name: String, _ value: CGFloat) -> String {
            guard value > 0 else { return "d.style.removeProperty('\(name)');" }
            return "d.style.setProperty('\(name)','\(String(format: "%.1f", min(value, 200)))px');"
        }
        return "(function(){var d=document.documentElement;if(!d)return;"
            + set("--sat", insets.top) + set("--sab", insets.bottom) + "})();"
    }

    /* Added once the phone has told us its insets, and it applies to every document loaded
       after that: the sign-in round trip and any reload then start out with the right room
       instead of a frame of the top bar under the clock. */
    private func seedNextDocuments(_ insets: UIEdgeInsets) {
        guard !seeded, insets.top > 0 || insets.bottom > 0,
              let controller = webView?.configuration.userContentController else { return }
        seeded = true
        controller.addUserScript(WKUserScript(source: insetScript(insets),
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true))
    }

    private var seeded = false

    private func publishInsets() {
        guard let webView = webView else { return }
        let insets = view.safeAreaInsets
        /* layout and load progress both fire many times a page; only talk to the web view
           when the numbers actually moved, or after a load threw the inline values away */
        let pair = (insets.top, insets.bottom)
        seedNextDocuments(insets)
        if let last = last, last == pair, !webView.isLoading { return }
        last = pair
        webView.evaluateJavaScript(insetScript(insets), completionHandler: nil)
    }
}
