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
    async stop() {
        // 1. ¡CORTAR INMEDIATAMENTE!
        // Al poner esto primero, cualquier audio que llegue milisegundos después se ignorará.
        this.isRecording = false; 
        this.buffer = []; // Borramos lo que hubiera en memoria para que no se envíe a medio hacer.

        // 2. Desconectar el hardware (Limpieza)
        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop()); // Apaga la luz de la webcam/micro
            this.mediaStream = null;
        }
        if (this.audioContext) {
            // Cerramos el contexto de audio para liberar memoria del navegador
            await this.audioContext.close();
            this.audioContext = null;
        }
        
        console.log("🛑 Micrófono detenido completamente.");
    }

    handleAudioData(inputData) {
        if (!this.isRecording) return;
        // 1. Añadimos el trocito de audio actual al buffer general
        for (let i = 0; i < inputData.length; i++) {
            this.buffer.push(inputData[i]);
        }

        // 2. Calculamos el VOLUMEN del trocito actual
        // (Sumamos los valores absolutos para ver si hay "ruido" o silencio)
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
            sum += Math.abs(inputData[i]);
        }
        const volume = sum / inputData.length;

        // 3. Configuración de Tiempos (Sample Rate = 16000)
        // Mínimo 2 segundos para no enviar palabras sueltas o ruidos
        const MIN_SAMPLES = 16000 * 2; 
        // Máximo 7 segundos para que no tardes mucho en ver el texto
        const MAX_SAMPLES = 16000 * 7;   
        // Umbral de silencio (Si el volumen baja de aquí, asumimos que has hecho una pausa)
        // AJUSTA ESTE VALOR SI ES NECESARIO (0.005 a 0.02)
        const SILENCE_THRESH = 0.01;     

        // 4. Lógica de Decisión
        const isSilence = volume < SILENCE_THRESH;
        const hasMinimumData = this.buffer.length >= MIN_SAMPLES;
        const isTooLong = this.buffer.length >= MAX_SAMPLES;

        // CORTAMOS Y ENVIAMOS SI:
        // (Llevamos suficiente tiempo grabando Y detectamos un silencio)
        //  O
        // (Llevamos demasiado tiempo grabando y hay que cortar ya para no bloquear)
        if ((hasMinimumData && isSilence) || isTooLong) {
            
            // Enviamos al worker
            const audioData = new Float32Array(this.buffer);
            this.worker.postMessage({
                type: 'audio_chunk',
                data: audioData
            });
            
            // Limpiamos el buffer para la siguiente frase
            this.buffer = []; 
        }
    }
}
