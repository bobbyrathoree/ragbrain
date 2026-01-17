import SwiftUI
import Markdown

struct CaptureSheet: View {
    @EnvironmentObject var captureManager: CaptureManager
    @Environment(\.managedObjectContext) var context
    @Environment(\.dismiss) var dismiss
    
    @State private var text = ""
    @State private var detectedType: ThoughtType = .note
    @State private var tags: [String] = []
    @State private var currentTag = ""
    @State private var showingSaveConfirmation = false
    @State private var characterCount = 0
    @State private var isSaving = false
    
    @FocusState private var isTextFieldFocused: Bool
    
    var body: some View {
        VStack(spacing: 0) {
            // Minimal header
            HStack {
                Image(systemName: "brain")
                    .font(.title3)
                    .foregroundStyle(.tint)
                    .symbolEffect(.pulse)
                
                Spacer()
                
                // Live type detection indicator
                TypeIndicator(type: detectedType)
                    .animation(.spring(response: 0.3), value: detectedType)
                
                Spacer()
                
                // Character count
                Text("\(characterCount)")
                    .font(.caption)
                    .foregroundStyle(characterCount > 500 ? .orange : .secondary)
                    .monospacedDigit()
                
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.escape, modifiers: [])
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
            
            Divider()
            
            // Main editor with syntax highlighting
            MarkdownEditor(
                text: $text,
                detectedType: $detectedType,
                tags: $tags
            )
            .focused($isTextFieldFocused)
            .padding()
            .frame(minHeight: 200, maxHeight: 400)
            .onChange(of: text) { oldValue, newValue in
                characterCount = newValue.count
                detectTypeAndTags(from: newValue)
            }
            
            // Tag pills
            if !tags.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(tags, id: \.self) { tag in
                            TagPill(tag: tag) {
                                tags.removeAll { $0 == tag }
                            }
                        }
                    }
                    .padding(.horizontal)
                }
                .frame(height: 32)
                .padding(.vertical, 8)
            }
            
            Divider()
            
            // Context info bar
            ContextInfoBar()
                .padding(.horizontal)
                .padding(.vertical, 8)
            
            Divider()
            
            // Action buttons
            HStack {
                // Quick tags
                Menu {
                    ForEach(captureManager.recentTags, id: \.self) { tag in
                        Button(tag) {
                            if !tags.contains(tag) {
                                tags.append(tag)
                            }
                        }
                    }
                } label: {
                    Label("Add Tag", systemImage: "tag")
                        .font(.caption)
                }
                .menuStyle(.borderlessButton)
                
                Spacer()
                
                Button("Save") {
                    saveThought()
                }
                .keyboardShortcut(.return, modifiers: [.command])
                .buttonStyle(.borderedProminent)
                .disabled(text.isEmpty || isSaving)
                
                Button("Save & Continue") {
                    saveThought(andContinue: true)
                }
                .keyboardShortcut(.return, modifiers: [.command, .shift])
                .disabled(text.isEmpty || isSaving)
            }
            .padding()
        }
        .frame(width: 600)
        .background(.ultraThinMaterial)
        .overlay {
            if showingSaveConfirmation {
                SaveConfirmationOverlay()
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .onAppear {
            isTextFieldFocused = true
            captureManager.captureContext()
        }
    }
    
    private func detectTypeAndTags(from text: String) {
        // Detect type based on content
        if text.contains("```") {
            detectedType = .code
        } else if text.contains("http://") || text.contains("https://") {
            detectedType = .link
        } else if text.contains("!todo") {
            detectedType = .todo
        } else if text.contains("!decision") {
            detectedType = .decision
        } else if text.contains("!rationale") || text.contains("because") {
            detectedType = .rationale
        } else {
            detectedType = .note
        }
        
        // Extract hashtags
        let pattern = #"#(\w+)"#
        if let regex = try? NSRegularExpression(pattern: pattern) {
            let matches = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
            let extractedTags = matches.compactMap { match -> String? in
                guard let range = Range(match.range(at: 1), in: text) else { return nil }
                return String(text[range])
            }
            tags = Array(Set(extractedTags)) // Remove duplicates
        }
    }
    
    private func saveThought(andContinue: Bool = false) {
        guard !text.isEmpty else { return }
        
        withAnimation {
            isSaving = true
        }
        
        // Create thought in Core Data
        let thought = captureManager.createThought(
            text: text,
            type: detectedType,
            tags: tags
        )
        
        // Show confirmation
        withAnimation(.spring()) {
            showingSaveConfirmation = true
        }
        
        // Queue for sync
        captureManager.queueForSync(thought)
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            if andContinue {
                // Clear for next thought
                text = ""
                tags = []
                characterCount = 0
                isSaving = false
                showingSaveConfirmation = false
                isTextFieldFocused = true
            } else {
                dismiss()
            }
        }
    }
}

// MARK: - Markdown Editor
struct MarkdownEditor: NSViewRepresentable {
    @Binding var text: String
    @Binding var detectedType: ThoughtType
    @Binding var tags: [String]
    
    func makeNSView(context: Context) -> NSTextView {
        let textView = NSTextView()
        textView.isRichText = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.allowsUndo = true
        textView.font = .monospacedSystemFont(ofSize: 14, weight: .regular)
        textView.textColor = .labelColor
        textView.backgroundColor = .clear
        textView.delegate = context.coordinator
        
        // Enable syntax highlighting
        textView.isAutomaticTextCompletionEnabled = true
        textView.isAutomaticSpellingCorrectionEnabled = false
        
        return textView
    }
    
    func updateNSView(_ textView: NSTextView, context: Context) {
        if textView.string != text {
            textView.string = text
            highlightSyntax(in: textView)
        }
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    private func highlightSyntax(in textView: NSTextView) {
        let storage = textView.textStorage!
        let range = NSRange(location: 0, length: storage.length)
        
        // Reset attributes
        storage.removeAttribute(.foregroundColor, range: range)
        storage.addAttribute(.foregroundColor, value: NSColor.labelColor, range: range)
        
        // Highlight code blocks
        let codePattern = #"```[\s\S]*?```"#
        highlightPattern(codePattern, color: .systemGreen, in: storage)
        
        // Highlight tags
        let tagPattern = #"#\w+"#
        highlightPattern(tagPattern, color: .systemBlue, in: storage)
        
        // Highlight flags
        let flagPattern = #"!\w+"#
        highlightPattern(flagPattern, color: .systemOrange, in: storage)
        
        // Highlight URLs
        let urlPattern = #"https?://[^\s]+"#
        highlightPattern(urlPattern, color: .systemPurple, in: storage)
    }
    
    private func highlightPattern(_ pattern: String, color: NSColor, in storage: NSTextStorage) {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return }
        let matches = regex.matches(in: storage.string, range: NSRange(location: 0, length: storage.length))
        
        for match in matches {
            storage.addAttribute(.foregroundColor, value: color, range: match.range)
        }
    }
    
    class Coordinator: NSObject, NSTextViewDelegate {
        var parent: MarkdownEditor
        
        init(_ parent: MarkdownEditor) {
            self.parent = parent
        }
        
        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            parent.text = textView.string
        }
    }
}

// MARK: - Supporting Views
struct TypeIndicator: View {
    let type: ThoughtType
    
    var body: some View {
        Label(type.rawValue.capitalized, systemImage: iconForType(type))
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(colorForType(type).opacity(0.2))
            .foregroundStyle(colorForType(type))
            .clipShape(Capsule())
    }
    
    private func iconForType(_ type: ThoughtType) -> String {
        switch type {
        case .note: return "note.text"
        case .code: return "chevron.left.forwardslash.chevron.right"
        case .link: return "link"
        case .todo: return "checklist"
        case .decision: return "arrow.triangle.branch"
        case .rationale: return "lightbulb"
        }
    }
    
    private func colorForType(_ type: ThoughtType) -> Color {
        switch type {
        case .note: return .gray
        case .code: return .green
        case .link: return .purple
        case .todo: return .orange
        case .decision: return .red
        case .rationale: return .blue
        }
    }
}

struct TagPill: View {
    let tag: String
    let onRemove: () -> Void
    
    var body: some View {
        HStack(spacing: 4) {
            Text("#\(tag)")
                .font(.caption)
            
            Button {
                onRemove()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.caption2)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(.blue.opacity(0.2))
        .foregroundStyle(.blue)
        .clipShape(Capsule())
    }
}

struct ContextInfoBar: View {
    @EnvironmentObject var captureManager: CaptureManager
    
    var body: some View {
        HStack(spacing: 12) {
            if let context = captureManager.currentContext {
                if let app = context.app {
                    Label(app, systemImage: "app")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                
                if let repo = context.repo {
                    Label(repo, systemImage: "folder")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                
                if let branch = context.branch {
                    Label(branch, systemImage: "arrow.triangle.branch")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            
            Spacer()
            
            Text(Date(), style: .time)
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }
}

struct SaveConfirmationOverlay: View {
    @State private var scale = 0.5
    @State private var opacity = 0.0
    
    var body: some View {
        VStack {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(.green)
                .scaleEffect(scale)
                .opacity(opacity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.ultraThinMaterial)
        .onAppear {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                scale = 1.0
                opacity = 1.0
            }
        }
    }
}