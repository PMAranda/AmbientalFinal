export class TranscriptionModule {
    constructor(worker) {
        this.worker = worker;
        this.isRecording = false;
        this.mediaStream = null;
        this.audioContext = null;
        this.processor = null;
        this.buffer = [];
        this.BUFFER_SIZE = 4096;
    }

    async start() {
        if (this.isRecording) return;

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });

            const source = this.audioContext.createMediaStreamSource(this.mediaStream);

            // Using ScriptProcessor for simplicity in this prototype context
            // In production, AudioWorklet is preferred
            this.processor = this.audioContext.createScriptProcessor(this.BUFFER_SIZE, 1, 1);

            source.connect(this.processor);
            this.processor.connect(this.audioContext.destination);

            this.processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                this.handleAudioData(inputData);
            };

            this.isRecording = true;
            console.log("Microphone connected. Sample Rate:", this.audioContext.sampleRate);

            // Signal worker that we are ready or reset context if needed
            this.worker.postMessage({ type: 'reset_asr' });

        } catch (error) {
            console.error("Error accessing microphone:", error);
            alert("No se pudo acceder al micrófono. Por favor verifica los permisos.");
        }
    }

    handleAudioData(inputData) {
        // Simple VAD (Voice Activity Detection) - Amplitude threshold
        // Or just accumulating a buffer to send to worker every X seconds

        // We accumulate ~1 second of audio (16000 samples) then send
        // Or send smaller chunks if the model supports streaming well.
        // For Whisper via Transformers.js, it often wants a chunk.

        // For this demo, let's copy the data and send it.
        // We'll trust the worker/pipeline to handle the framing or we accumulate here.

        // Let's accumulate ~2 seconds of audio before sending for better context
        // 16,000 * 2 = 32,000 samples

        for (let i = 0; i < inputData.length; i++) {
            this.buffer.push(inputData[i]);
        }

        if (this.buffer.length >= 16000 * 3) { // 3 seconds chunks
            const audioData = new Float32Array(this.buffer);
            this.worker.postMessage({
                type: 'audio_chunk',
                data: audioData
            });
            this.buffer = []; // clear buffer after sending
            // Note: Overlapping windows would be better for continuity
        }
    }

    async stop() {
        if (!this.isRecording) return;

        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        this.isRecording = false;
        this.buffer = [];
    }
}
