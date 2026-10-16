import Foundation
import AVFoundation
import Speech

// A private helper keeps Apple's callback loop separate from the WebView and the Rust UI thread.
func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}
if CommandLine.arguments.contains("--self-test") {
    emit(["text": "Olá, Orbit", "final": true])
    emit(["ended": true])
    exit(0)
}

final class Dictation {
    let engine = AVAudioEngine()
    let request = SFSpeechAudioBufferRecognitionRequest()
    var task: SFSpeechRecognitionTask?
    var stopping = false
    var tapped = false

    func finish(_ error: String? = nil) {
        engine.stop()
        if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
        request.endAudio()
        task?.cancel()
        if let error = error { emit(["error": error]) }
        emit(["ended": true])
        exit(error == nil ? 0 : 1)
    }

    func stop() {
        if stopping { return }
        stopping = true
        engine.stop()
        request.endAudio()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.finish() }
    }

    func start() {
        guard !stopping else { finish(); return }
        let locale = CommandLine.arguments.dropFirst().first ?? "pt-BR"
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)), recognizer.isAvailable else {
            finish("O reconhecimento de fala não está disponível para este idioma."); return
        }
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { finish("Nenhum microfone disponível."); return }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in self.request.append(buffer) }
        tapped = true
        task = recognizer.recognitionTask(with: request) { result, error in
            DispatchQueue.main.async {
                if let result = result {
                    emit(["text": result.bestTranscription.formattedString, "final": result.isFinal])
                    if result.isFinal { self.finish(); return }
                }
                if let error = error {
                    self.finish(self.stopping ? nil : "O ditado parou: \(error.localizedDescription)")
                }
            }
        }
        do {
            engine.prepare()
            try engine.start()
            emit(["started": true, "onDevice": request.requiresOnDeviceRecognition])
            DispatchQueue.main.asyncAfter(deadline: .now() + 60) { self.stop() }
        } catch { finish("Não foi possível iniciar o microfone: \(error.localizedDescription)") }
    }

    func authorize() {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                DispatchQueue.main.async { self.finish("Permita o reconhecimento de fala em Ajustes do Sistema › Privacidade e Segurança.") }
                return
            }
            AVCaptureDevice.requestAccess(for: .audio) { allowed in
                DispatchQueue.main.async {
                    if allowed { self.start() }
                    else { self.finish("Permita o microfone em Ajustes do Sistema › Privacidade e Segurança.") }
                }
            }
        }
    }
}
let dictation = Dictation()
DispatchQueue.global().async {
    // Parent closes stdin on exit; EOF stops capture too.
    _ = readLine()
    DispatchQueue.main.async { dictation.stop() }
}
dictation.authorize()
dispatchMain()
