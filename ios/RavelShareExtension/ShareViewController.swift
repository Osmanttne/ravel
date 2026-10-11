import SwiftUI
import UIKit

/// The extension receives only items explicitly supplied by the current host request.
@MainActor
final class ShareViewController: UIViewController {
    private var checkModel: ShareCheckModel?
    private var didFinishRequest = false

    override func viewDidLoad() {
        super.viewDidLoad()
        let model = ShareCheckModel()
        checkModel = model
        let hostedView = ShareCheckView(
            model: model,
            onCancel: { [weak self] in self?.finishRequest(cancelled: true) },
            onDone: { [weak self] in self?.finishRequest(cancelled: false) }
        )
        let host = UIHostingController(rootView: hostedView)
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        host.didMove(toParent: self)
        preferredContentSize = CGSize(width: 540, height: 680)

        NotificationCenter.default.addObserver(
            self, selector: #selector(hostEnteredBackground),
            name: .NSExtensionHostDidEnterBackground, object: extensionContext
        )
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        model.start(items: items)
    }

    override func viewWillDisappear(_ animated: Bool) {
        // Cancel before the host dismisses the UI, including an interactive dismissal.
        checkModel?.stopForDismissal()
        super.viewWillDisappear(animated)
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if !didFinishRequest { finishRequest(cancelled: true) }
    }

    @objc private func hostEnteredBackground() {
        checkModel?.stopForBackground()
    }

    private func finishRequest(cancelled: Bool) {
        guard !didFinishRequest else { return }
        didFinishRequest = true
        checkModel?.stopForDismissal()
        if cancelled {
            extensionContext?.cancelRequest(withError: NSError(
                domain: NSCocoaErrorDomain, code: NSUserCancelledError,
                userInfo: [NSLocalizedDescriptionKey: "The private check was cancelled."]
            ))
        } else {
            // Return no private input or assessment to the host application.
            extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}
