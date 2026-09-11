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
        /* the first painted frame has to know already, or the top bar lands under the clock
           and drops a frame later; the observers below keep it right after that */
        if let controller = webView?.configuration.userContentController {
            let seed = WKUserScript(source: insetScript(view.safeAreaInsets),
                                    injectionTime: .atDocumentStart, forMainFrameOnly: true)
            controller.addUserScript(seed)
        }
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

    private func insetScript(_ insets: UIEdgeInsets) -> String {
        /* clamped and fixed to one decimal, so the only thing that can reach the page is a
           plain number: nothing here can end the quoted value it sits in */
        let top = String(format: "%.1f", min(max(insets.top, 0), 200))
        let bottom = String(format: "%.1f", min(max(insets.bottom, 0), 200))
        return "(function(){var d=document.documentElement;if(!d)return;"
            + "d.style.setProperty('--sat','\(top)px');"
            + "d.style.setProperty('--sab','\(bottom)px');})();"
    }

    private func publishInsets() {
        guard let webView = webView else { return }
        let insets = view.safeAreaInsets
        /* layout and load progress both fire many times a page; only talk to the web view
           when the numbers actually moved, or after a load threw the inline values away */
        let pair = (insets.top, insets.bottom)
        if let last = last, last == pair, !webView.isLoading { return }
        last = pair
        webView.evaluateJavaScript(insetScript(insets), completionHandler: nil)
    }
}
