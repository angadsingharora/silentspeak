import SwiftUI

@main
struct SilentSpeakApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(model)
                .frame(minWidth: 980, minHeight: 680)
                .task { model.start() }
        }
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .importExport) {
                Button("Import Dataset (Merge)…") { model.importDataset(replace: false) }
                    .keyboardShortcut("i", modifiers: [.command, .shift])
                Button("Import Dataset (Replace)…") { model.importDataset(replace: true) }
                Button("Export Dataset…") { model.exportDataset() }
                    .keyboardShortcut("e", modifiers: [.command, .shift])
            }
        }
    }
}
