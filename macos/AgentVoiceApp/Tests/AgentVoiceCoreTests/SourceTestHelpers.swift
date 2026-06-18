import Foundation
import XCTest

func appSource(_ fileName: String, callerFilePath: String = #filePath) throws -> String {
    let testFile = URL(fileURLWithPath: callerFilePath)
    let packageRoot = testFile
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let sourceFile = packageRoot.appendingPathComponent("Sources/AgentVoiceApp/\(fileName)")
    return try String(contentsOf: sourceFile, encoding: .utf8)
}

func appSources(callerFilePath: String = #filePath) throws -> String {
    let testFile = URL(fileURLWithPath: callerFilePath)
    let packageRoot = testFile
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let appSourceRoot = packageRoot.appendingPathComponent("Sources/AgentVoiceApp")

    guard let enumerator = FileManager.default.enumerator(
        at: appSourceRoot,
        includingPropertiesForKeys: [.isRegularFileKey],
        options: [.skipsHiddenFiles]
    ) else {
        XCTFail("Could not enumerate app source files")
        throw XCTSkip("Cannot verify source contract without app sources.")
    }

    let files = enumerator
        .compactMap { $0 as? URL }
        .filter { $0.pathExtension == "swift" }
        .sorted { $0.path < $1.path }

    return try files
        .map { "// FILE: \($0.lastPathComponent)\n" + (try String(contentsOf: $0, encoding: .utf8)) }
        .joined(separator: "\n")
}

func dashboardViewSource(callerFilePath: String = #filePath) throws -> String {
    try appSource("DashboardView.swift", callerFilePath: callerFilePath)
}

func sourceSlice(in source: String, from startMarker: String, to endMarker: String) throws -> String {
    guard
        let start = source.range(of: startMarker),
        let end = source.range(of: endMarker, range: start.upperBound..<source.endIndex)
    else {
        XCTFail("Could not isolate source slice from \(startMarker) to \(endMarker)")
        throw XCTSkip("Cannot verify source action binding without expected markers.")
    }
    return String(source[start.lowerBound..<end.lowerBound])
}

func propertyBody(named propertyName: String, in source: String) throws -> String {
    let markers = [
        "private var \(propertyName): some View",
        "var \(propertyName): some View"
    ]
    guard let start = markers.compactMap({ source.range(of: $0) }).first else {
        XCTFail("Could not find property: \(propertyName)")
        throw XCTSkip("Cannot verify missing property.")
    }
    let remaining = source[start.upperBound..<source.endIndex]
    let endCandidates = [
        remaining.range(of: "\n    private var ")?.lowerBound,
        remaining.range(of: "\n    var ")?.lowerBound,
        remaining.range(of: "\n    private func ")?.lowerBound,
        remaining.range(of: "\n    func ")?.lowerBound
    ].compactMap { $0 }
    let end = endCandidates.min() ?? source.endIndex
    return String(source[start.lowerBound..<end])
}

func functionBody(named functionName: String, in source: String) throws -> String {
    let markers = ["private func \(functionName)", "func \(functionName)"]
    guard let start = markers.compactMap({ source.range(of: $0) }).first else {
        XCTFail("Could not find function: \(functionName)")
        throw XCTSkip("Cannot verify missing function.")
    }
    let remaining = source[start.upperBound..<source.endIndex]
    let endCandidates = [
        remaining.range(of: "\n    private func ")?.lowerBound,
        remaining.range(of: "\n    func ")?.lowerBound,
        remaining.range(of: "\n    private var ")?.lowerBound,
        remaining.range(of: "\n    var ")?.lowerBound
    ].compactMap { $0 }
    let end = endCandidates.min() ?? source.endIndex
    return String(source[start.lowerBound..<end])
}

func dashboardBody(in source: String) throws -> String {
    guard
        let start = source.range(of: "    var body: some View"),
        let end = source.range(of: "    var header", range: start.upperBound..<source.endIndex)
    else {
        XCTFail("Could not isolate DashboardView body")
        throw XCTSkip("Cannot verify dashboard section order without DashboardView body.")
    }
    return String(source[start.lowerBound..<end.lowerBound])
}

func attentionBody(in source: String) throws -> String {
    guard
        let start = source.range(of: "    var body: some View"),
        let end = source.range(of: "private extension AttentionDetailView", range: start.upperBound..<source.endIndex)
    else {
        XCTFail("Could not isolate AttentionDetailView body")
        throw XCTSkip("Cannot verify diagnostics section order without AttentionDetailView body.")
    }
    return String(source[start.lowerBound..<end.lowerBound])
}

func offset(of marker: String, in source: String) throws -> String.Index {
    guard let range = source.range(of: marker) else {
        XCTFail("Missing marker: \(marker)")
        throw XCTSkip("Cannot verify source order without \(marker).")
    }
    return range.lowerBound
}

func offsets(in source: String, markers: [String]) throws -> [String: String.Index] {
    var offsets: [String: String.Index] = [:]
    for marker in markers {
        offsets[marker] = try offset(of: marker, in: source)
    }
    return offsets
}
