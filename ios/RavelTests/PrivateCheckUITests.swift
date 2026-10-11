import XCTest

/// Run synthetic app/share-host checks against the same reachable fixture backend.
/// The containing app and extension may use localhost or a local-network address.
/// URL-only fixture controls run before text/image submissions, so a connected
/// backend is rejected before any selected text or screenshot can reach Gemini.
/// Automated Photos selection is compiled only for a simulator seeded with one
/// synthetic PNG; physical-device screenshot acceptance requires user selection.
final class PrivateCheckUITests: XCTestCase {
    private let fixtureBadge = "Fixture demo · simulated analysis"
    private let ticketMessage =
        "Free concert tickets. Pay a $20 transfer fee before delivery: https://tickets.example/offer"
    private let exampleLink = "https://campus.example/events"
    private let hostBundleIdentifier = "com.osmantaka.ravel.sharetesthost"

    override func setUpWithError() throws {
        continueAfterFailure = false
        executionTimeAllowance = 180
    }

    @MainActor
    func testManualMessageRequiresAnalyzeAndShowsFixtureResult() throws {
        let app = launchRavel()
        try establishAppFixtureMode(app)
        try tap(app.buttons["Paste message"], in: app)
        let editor = app.textViews["Message to check"]
        try tap(editor, in: app)
        editor.typeText(ticketMessage)
        try tap(app.buttons["Done typing"], in: app)

        let analyze = app.buttons["Analyze privately"]
        try reveal(analyze, in: app)
        XCTAssertTrue(analyze.isEnabled)
        XCTAssertFalse(fixtureElement(in: app).waitForExistence(timeout: 1),
                       "Entering text must not automatically submit it.")
        analyze.tap()
        try assertPrivateFixtureResult(app, category: "Suspicious — verify before acting")
        try finishResult(app)
        XCTAssertEqual(app.textViews["Message to check"].value as? String, "",
                       "Dismissing a result must clear the submitted message.")
    }

    @MainActor
    func testManualURLIsParsedWithoutAIAnalysis() throws {
        let app = launchRavel()
        try enterLinkAndAnalyze(app)
        try assertPrivateFixtureResult(app, category: "Insufficient evidence")
        try assertLabelContaining("Link parsed only. Its destination wasn't visited or analyzed by AI.",
                                  in: app)
        try finishResult(app)
    }

    @MainActor
    func testSharedMessagePreviewRequiresAnalyzeAndShowsFixtureResult() throws {
        let host = launchShareHost()
        try establishExtensionFixtureMode(host)
        try share("Share ticket message", from: host)
        try assertLabelContaining("Selected message", in: host)
        try analyzeSharedPreview(host)
        try assertPrivateFixtureResult(host, category: "Suspicious — verify before acting")
        try finishResult(host)
    }

    @MainActor
    func testSharedURLPreviewIsParsedWithoutAIAnalysis() throws {
        let host = launchShareHost()
        try share("Share example link", from: host)
        try assertLabelContaining("Selected link", in: host)
        try assertLabelContaining("not be opened or sent to Gemini", in: host)
        try analyzeSharedPreview(host)
        try assertPrivateFixtureResult(host, category: "Insufficient evidence")
        try assertLabelContaining("Link parsed only. Its destination wasn't visited or analyzed by AI.",
                                  in: host)
        try finishResult(host)
    }

    @MainActor
    func testSharedImageFilePreviewAndPrivateFixtureResult() throws {
        let host = launchShareHost()
        try establishExtensionFixtureMode(host)
        try share("Share ticket image", from: host)
        try require(host.images["Preview of the selected screenshot"], in: host)
        try analyzeSharedPreview(host)
        // The generated image is reencoded and does not match the fixture PNG hash.
        // Fixture mode must therefore return unknown evidence, not invented OCR.
        try assertPrivateFixtureResult(host, category: "Insufficient evidence")
        try finishResult(host)
    }

    @MainActor
    func testSeededPhotosScreenshotCanBeSharedAndCheckedPrivately() throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("Automated Photos selection is disabled on physical devices. Select a synthetic screenshot manually.")
        #else
        let host = launchShareHost()
        try establishExtensionFixtureMode(host)
        host.terminate()
        let photos = XCUIApplication(bundleIdentifier: "com.apple.mobileslideshow")
        photos.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        photos.launch()
        addTeardownBlock { @MainActor in photos.terminate() }

        // Handle only named Photos onboarding actions; never use screen coordinates.
        for title in ["Continue", "Get Started", "Not Now"] {
            let button = photos.buttons[title].firstMatch
            if button.exists && button.isHittable { button.tap() }
        }
        let library = photos.buttons["Library"].firstMatch
        if library.exists && library.isHittable { library.tap() }
        let allPhotos = photos.buttons["All Photos"].firstMatch
        if allPhotos.exists && allPhotos.isHittable { allPhotos.tap() }

        let thumbnail = photos.collectionViews.cells.firstMatch
        try require(thumbnail, in: photos,
                    message: "Seed one synthetic PNG with simctl addmedia before running the Photos test.")
        try tap(thumbnail, in: photos)
        try tap(photos.buttons["Share"].firstMatch, in: photos)
        try chooseRavel(in: photos)
        try require(photos.images["Preview of the selected screenshot"], in: photos)
        try analyzeSharedPreview(photos)
        try assertPrivateFixtureResult(photos, category: "Insufficient evidence")
        try finishResult(photos)
        #endif
    }

    @MainActor
    private func launchRavel() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        addTeardownBlock { @MainActor in app.terminate() }
        return app
    }

    @MainActor
    private func launchShareHost() -> XCUIApplication {
        // The test target installs Ravel and its embedded extension.
        // Opening the containing app once completes initial extension registration.
        let app = launchRavel()
        app.terminate()
        let host = XCUIApplication(bundleIdentifier: hostBundleIdentifier)
        host.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        host.launch()
        addTeardownBlock { @MainActor in host.terminate() }
        return host
    }

    @MainActor
    private func establishAppFixtureMode(_ app: XCUIApplication) throws {
        try enterLinkAndAnalyze(app)
        try assertPrivateFixtureResult(app, category: "Insufficient evidence")
        try finishResult(app)
    }

    @MainActor
    private func enterLinkAndAnalyze(_ app: XCUIApplication) throws {
        try tap(app.buttons["Check link"], in: app)
        let field = app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@ AND (elementType == %d OR elementType == %d)",
                        "Link to check", XCUIElement.ElementType.textField.rawValue,
                        XCUIElement.ElementType.textView.rawValue)
        ).firstMatch
        try tap(field, in: app)
        field.typeText(exampleLink)
        let analyze = app.buttons["Analyze privately"]
        try reveal(analyze, in: app)
        XCTAssertTrue(analyze.isEnabled)
        XCTAssertFalse(fixtureElement(in: app).exists)
        analyze.tap()
    }

    @MainActor
    private func establishExtensionFixtureMode(_ host: XCUIApplication) throws {
        try share("Share example link", from: host)
        try analyzeSharedPreview(host)
        try assertPrivateFixtureResult(host, category: "Insufficient evidence")
        try finishResult(host)
    }

    @MainActor
    private func share(_ title: String, from host: XCUIApplication) throws {
        try tap(host.buttons[title], in: host)
        try chooseRavel(in: host)
    }

    @MainActor
    private func chooseRavel(in app: XCUIApplication) throws {
        if tapActivityIfVisible(in: app) { return }
        var more = app.buttons["More"].firstMatch
        if !more.isHittable {
            // App activities form a horizontal collection in the system share sheet.
            for collection in app.collectionViews.allElementsBoundByIndex.prefix(3) {
                if collection.isHittable { collection.swipeLeft() }
                if tapActivityIfVisible(in: app) { return }
                more = app.buttons["More"].firstMatch
                if more.exists && more.isHittable { break }
            }
        }
        try tap(more, in: app)
        if tapActivityIfVisible(in: app) { return }

        // First-run installations may need enabling in the named Apps/Edit list.
        let edit = app.buttons["Edit"].firstMatch
        if edit.exists && edit.isHittable {
            edit.tap()
            let cell = app.cells.containing(.staticText, identifier: "Ravel").firstMatch
            try reveal(cell, in: app)
            let toggle = cell.switches.firstMatch
            if toggle.exists && (toggle.value as? String) == "0" { toggle.tap() }
            try tap(app.buttons["Done"].firstMatch, in: app)
        }
        for _ in 0..<5 {
            if tapActivityIfVisible(in: app) { return }
            scrollUp(app)
        }
        attachDiagnostics(app, name: "Ravel activity not found")
        XCTFail("Ravel must be available in the system Share menu.")
        throw UIAcceptanceError.missingElement
    }

    @MainActor
    private func tapActivityIfVisible(in app: XCUIApplication) -> Bool {
        let button = app.buttons["Ravel"].firstMatch
        if button.exists && button.isEnabled && button.isHittable { button.tap(); return true }
        let cell = app.cells.containing(.staticText, identifier: "Ravel").firstMatch
        if cell.exists && cell.isEnabled && cell.isHittable { cell.tap(); return true }
        return false
    }

    @MainActor
    private func analyzeSharedPreview(_ app: XCUIApplication) throws {
        let analyze = app.buttons["Analyze privately"]
        try reveal(analyze, in: app)
        XCTAssertTrue(analyze.isEnabled)
        XCTAssertFalse(fixtureElement(in: app).waitForExistence(timeout: 1),
                       "Sharing must present a preview and require an explicit Analyze tap.")
        analyze.tap()
    }

    @MainActor
    private func assertPrivateFixtureResult(_ app: XCUIApplication, category: String) throws {
        try require(fixtureElement(in: app), in: app, timeout: 20,
                    message: "Fixture backend required; provider-backed UI acceptance is forbidden.")
        guard app.keyboards.firstMatch.waitForNonExistence(timeout: 5) else {
            attachDiagnostics(app, name: "Keyboard obscures the private result")
            XCTFail("The keyboard must dismiss when a private result appears so its disclosures remain visible.")
            throw UIAcceptanceError.missingElement
        }
        try assertLabelContaining(category, in: app)
        try assertLabelContaining("This check didn't create a community report.", in: app)
        XCTAssertFalse(app.staticTexts["Safe"].exists)
    }

    @MainActor
    private func finishResult(_ app: XCUIApplication) throws {
        try tap(app.buttons["Done"].firstMatch, in: app)
        XCTAssertTrue(fixtureElement(in: app).waitForNonExistence(timeout: 5))
    }

    @MainActor
    private func fixtureElement(in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", fixtureBadge)).firstMatch
    }

    @MainActor
    private func assertLabelContaining(_ text: String, in app: XCUIApplication) throws {
        let element = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@", text)
        ).firstMatch
        try reveal(element, in: app)
    }

    @MainActor
    private func require(_ element: XCUIElement, in app: XCUIApplication, timeout: TimeInterval = 8,
                         message: String = "Expected accessible UI element is missing.") throws {
        guard element.waitForExistence(timeout: timeout) else {
            attachDiagnostics(app, name: message)
            XCTFail(message)
            throw UIAcceptanceError.missingElement
        }
    }

    @MainActor
    private func reveal(_ element: XCUIElement, in app: XCUIApplication) throws {
        for _ in 0..<8 {
            if element.exists && element.isHittable { return }
            scrollUp(app)
        }
        try require(element, in: app)
        guard element.isHittable else {
            attachDiagnostics(app, name: "Element could not be revealed")
            XCTFail("Expected element exists but could not be revealed with accessibility scrolling.")
            throw UIAcceptanceError.missingElement
        }
    }

    @MainActor
    private func tap(_ element: XCUIElement, in app: XCUIApplication) throws {
        try reveal(element, in: app)
        element.tap()
    }

    @MainActor
    private func scrollUp(_ app: XCUIApplication) {
        let scroll = app.scrollViews.firstMatch
        if scroll.exists && scroll.isHittable { scroll.swipeUp(); return }
        let collection = app.collectionViews.firstMatch
        if collection.exists && collection.isHittable { collection.swipeUp(); return }
        let table = app.tables.firstMatch
        if table.exists && table.isHittable { table.swipeUp(); return }
        app.swipeUp()
    }

    @MainActor
    private func attachDiagnostics(_ app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "Accessibility hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }
}

private enum UIAcceptanceError: Error { case missingElement }
