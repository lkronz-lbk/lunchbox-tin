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

    private func publishInsets() {
        guard let webView = webView else { return }
        let insets = view.safeAreaInsets
        let js = """
        (function(){var d=document.documentElement;if(!d)return;\
        d.style.setProperty('--sat','\(insets.top)px');\
        d.style.setProperty('--sab','\(insets.bottom)px');})();
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }
}
