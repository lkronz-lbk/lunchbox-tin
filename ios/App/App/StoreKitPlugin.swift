import Foundation
import Capacitor
import StoreKit

/// The iPhone app's way of paying: StoreKit 2, reached from the page as `StoreKit`.
///
/// The phone decides nothing about the plan. It hands the page the App Store's signed transaction
/// (`jws`), the page sends it to /api/apple/link, and the server checks Apple's signature before it
/// writes the household's row. Only then does the page call `finish`, so a purchase the server never
/// heard about (no signal, the app killed mid-way) is not finished, and StoreKit hands it back on the
/// next launch through `Transaction.updates` until it is.
///
/// Every purchase carries the household's token (`appAccountToken`), which Apple returns in every
/// notification, so the server can place a notification that arrives before the phone does.
@objc(StoreKitPlugin)
public class StoreKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StoreKitPlugin"
    public let jsName = "StoreKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manage", returnType: CAPPluginReturnPromise)
    ]

    /// transactions handed to the page and not yet finished, by id
    private actor Unfinished {
        private var byId: [String: Transaction] = [:]
        func add(_ transaction: Transaction) { byId[String(transaction.id)] = transaction }
        func take(_ id: String) -> Transaction? { byId.removeValue(forKey: id) }
    }
    private let unfinished = Unfinished()
    private var updates: Task<Void, Never>?

    /// Renewals made on this phone, an Ask to Buy a parent approves later, a purchase on another
    /// device, and anything left unfinished last time all arrive here. The event is kept until the
    /// page is listening, since at launch StoreKit can be quicker than the page.
    override public func load() {
        updates = Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard let self = self else { return }
                await self.hand(result, event: true)
            }
        }
    }

    deinit { updates?.cancel() }

    /// A transaction the App Store could not verify here is finished and dropped: it could never be
    /// shown to the server as Apple's, and leaving it would have StoreKit offer it again every launch.
    @discardableResult
    private func hand(_ result: VerificationResult<Transaction>, event: Bool) async -> [String: Any]? {
        switch result {
        case .verified(let transaction):
            await unfinished.add(transaction)
            let out: [String: Any] = ["jws": result.jwsRepresentation, "transactionId": String(transaction.id), "productId": transaction.productID]
            if event { notifyListeners("transaction", data: out, retainUntilConsumed: true) }
            return out
        case .unverified(let transaction, _):
            await transaction.finish()
            return nil
        }
    }

    @objc func products(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        Task {
            do {
                let found = try await Product.products(for: ids)
                call.resolve(["products": found.map { product -> [String: Any] in
                    var out: [String: Any] = [
                        "id": product.id,
                        "displayName": product.displayName,
                        "displayPrice": product.displayPrice,   // Apple's price, in the buyer's own currency
                        "kind": product.type == .autoRenewable ? "subscription" : "forever"
                    ]
                    if let period = product.subscription?.subscriptionPeriod {
                        out["period"] = period.unit == .year ? "year" : period.unit == .month ? "month" : "other"
                    }
                    return out
                }])
            } catch {
                call.reject("The App Store did not answer", nil, error)
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let token = UUID(uuidString: call.getString("token") ?? "") else {
            call.reject("Missing plan or household")
            return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [id]).first else {
                    call.reject("That plan is not in the App Store")
                    return
                }
                switch try await product.purchase(options: [.appAccountToken(token)]) {
                case .success(let result):
                    if let out = await hand(result, event: false) {
                        call.resolve(out.merging(["status": "purchased"]) { _, new in new })
                    } else {
                        call.reject("The App Store could not confirm that purchase")
                    }
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                case .pending:
                    // Ask to Buy, or a bank's extra check: the answer comes later through Transaction.updates
                    call.resolve(["status": "pending"])
                @unknown default:
                    call.resolve(["status": "cancelled"])
                }
            } catch {
                call.reject("The purchase did not go through", nil, error)
            }
        }
    }

    /// Restore Purchases: asks the App Store for this Apple ID's purchases, then hands the page each
    /// one still in force. If the parent dismisses the sign-in, what the phone already knows is used.
    @objc func restore(_ call: CAPPluginCall) {
        Task {
            try? await AppStore.sync()
            var found: [[String: Any]] = []
            for await result in Transaction.currentEntitlements {
                if let out = await hand(result, event: false) { found.append(out) }
            }
            call.resolve(["transactions": found])
        }
    }

    /// once the server has the purchase
    @objc func finish(_ call: CAPPluginCall) {
        guard let id = call.getString("transactionId") else {
            call.reject("Missing transaction")
            return
        }
        Task {
            let transaction = await unfinished.take(id)
            await transaction?.finish()
            call.resolve(["finished": transaction != nil])
        }
    }

    /// Apple's own sheet for changing or cancelling a subscription, over the app. Only Apple can
    /// cancel a subscription bought through the App Store.
    @objc func manage(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let scene = self.bridge?.viewController?.view.window?.windowScene else {
                call.reject("Nothing to show it over")
                return
            }
            do {
                try await AppStore.showManageSubscriptions(in: scene)
                call.resolve()
            } catch {
                call.reject("Could not open subscriptions", nil, error)
            }
        }
    }
}
