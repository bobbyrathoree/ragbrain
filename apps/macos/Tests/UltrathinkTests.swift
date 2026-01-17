import XCTest
@testable import Ultrathink

final class UltrathinkTests: XCTestCase {
    func testCaptureContextEncoding() throws {
        let context = CaptureContext(
            app: "VS Code",
            windowTitle: "main.swift",
            repo: "ultrathink",
            branch: "main",
            file: "Sources/main.swift"
        )

        let data = context.toData()
        XCTAssertNotNil(data)

        let decoded = CaptureContext.fromData(data!)
        XCTAssertNotNil(decoded)
        XCTAssertEqual(decoded?.app, "VS Code")
        XCTAssertEqual(decoded?.repo, "ultrathink")
    }

    func testThoughtTypeRawValues() {
        XCTAssertEqual(ThoughtType.note.rawValue, "note")
        XCTAssertEqual(ThoughtType.code.rawValue, "code")
        XCTAssertEqual(ThoughtType.decision.rawValue, "decision")
    }

    func testSyncStatusRawValues() {
        XCTAssertEqual(SyncStatus.pending.rawValue, "pending")
        XCTAssertEqual(SyncStatus.synced.rawValue, "synced")
        XCTAssertEqual(SyncStatus.failed.rawValue, "failed")
    }
}
