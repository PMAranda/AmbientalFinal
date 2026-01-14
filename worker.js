import { 
    pipeline, 
    env, 
    AutoTokenizer, 
    AutoModelForCausalLM, 
    AutoProcessor, 
    Florence2ForConditionalGeneration, 
    RawImage 
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.2.4';

// 1. CONFIGURACIÓN DEL ENTORNO
env.allowLocalModels = false;
env.useBrowserCache = true;
// Optimización CPU (WASM)
env.backends.onnx.wasm.numThreads = 1; 
env.backends.onnx.wasm.simd = true;

// Variables Globales
let asr_pipeline;           // Whisper
let classifier_pipeline;    // Orquestador
let embed_pipeline;         // RAG
let text_model, text_tokenizer; // LLM (Qwen)
let vlm_model, vlm_processor, vlm_tokenizer; // Visión (Florence-2)

// Estado
let isProcessingAudio = false;

// Callback de progreso
const progressCallback = (data) => {
    if (data.status === 'progress') {
        const percent = (data.loaded / data.total) * 100;
        if (Math.round(percent) % 10 === 0 || percent >= 100) {
            self.postMessage({ 
                type: 'progress_update', 
                percent, 
                file: data.file, 
                message: `Cargando ${data.file || 'modelo'} (${Math.round(percent)}%)`
            });
        }
    }
};

self.onmessage = async (e) => {
    const { type, data } = e.data;

    // --- CARGA DE MODELOS ---
    if (type === 'load') {
        try {
            self.postMessage({ status: 'progress', message: 'Iniciando carga de sistemas...' });

            // 1. ORQUESTADOR
            if (!classifier_pipeline) {
                classifier_pipeline = await pipeline('zero-shot-classification', 'Xenova/nli-deberta-v3-xsmall');
                self.postMessage({ status: 'ready', task: 'classifier' });
            }

            // 2. RAG (Embeddings)
            if (!embed_pipeline) {
                embed_pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
                self.postMessage({ status: 'ready', task: 'rag' });
            }

            // 3. AUDIO (Whisper)
            if (!asr_pipeline) {
                try {
                    asr_pipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base');
                    self.postMessage({ status: 'ready', task: 'asr' });
                } catch (err) { console.warn("Fallo Whisper", err); }
            }

            // 4. LLM DE TEXTO (Qwen 2.5)
            const llm_id = 'onnx-community/Qwen2.5-0.5B-Instruct'; 
            
            if (!text_model) {
                self.postMessage({ status: 'progress', message: 'Cargando Qwen 2.5 (esto puede tardar)...' });
                
                try {
                    text_tokenizer = await AutoTokenizer.from_pretrained(llm_id);
                    // Forzamos WASM para mayor estabilidad en portátiles
                    text_model = await AutoModelForCausalLM.from_pretrained(llm_id, {
                        dtype: "q4", 
                        device: "wasm",
                        progress_callback: progressCallback
                    });
                    
                    self.postMessage({ status: 'ready', task: 'llm' });

                } catch (err) {
                    console.error("Error cargando Qwen:", err);
                    self.postMessage({ status: 'error', message: "Error cargando LLM" });
                }
            }

            // 5. VISIÓN (Florence-2)
            if (!vlm_model) {
                self.postMessage({ status: 'progress', message: 'Cargando Visión (Florence-2)...' });
                const vision_id = 'onnx-community/Florence-2-base-ft'; 
                
                try {
                    vlm_processor = await AutoProcessor.from_pretrained(vision_id);
                    vlm_tokenizer = await AutoTokenizer.from_pretrained(vision_id);
                    
                    try {
                        // Intentamos cargar primero con WebGPU (fp16)
                        vlm_model = await Florence2ForConditionalGeneration.from_pretrained(vision_id, {
                            dtype: "fp16", 
                            device: "webgpu",
                            progress_callback: progressCallback
                        });
                    } catch (gpuErr) {
                         console.warn("Fallo WebGPU Visión, usando CPU", gpuErr);
                         // Fallback a WASM (q4) si falla WebGPU
                         vlm_model = await Florence2ForConditionalGeneration.from_pretrained(vision_id, {
                            dtype: "q4", 
                            device: "wasm",
                            progress_callback: progressCallback
                        });
                    }
                    self.postMessage({ status: 'ready', task: 'vlm' });

                } catch (err) {
                    console.error("Error cargando Visión:", err);
                    self.postMessage({ type: 'debug', text: "❌ Error fatal en módulo de visión." });
                }
            }

            self.postMessage({ status: 'complete', message: 'Sistemas Listos' });

        } catch (error) {
            self.postMessage({ status: 'error', message: error.message });
        }
    }

    // --- GENERACIÓN ---
    if (type === 'generate') {
        if (!text_model || !text_tokenizer) return;

        const messages = [
            { role: "system", content: "Eres un asistente útil y breve en español." },
            { role: "user", content: data.prompt }
        ];

        try {
            const inputs = await text_tokenizer.apply_chat_template(messages, {
                add_generation_prompt: true,
                return_dict: true 
            });

            const outputs = await text_model.generate({
                ...inputs,
                max_new_tokens: 256,
                do_sample: false, 
                temperature: 0.1,
            });

            const decoded = text_tokenizer.decode(outputs[0], { skip_special_tokens: true });
            
            // Limpieza robusta de la respuesta
            let response = decoded;
            if (response.includes("assistant")) {
                response = response.split("assistant").pop();
            }
            
            self.postMessage({ type: 'generation_result', text: response.trim(), hat: data.hat });

        } catch (e) {
            console.error(e);
            self.postMessage({ type: 'generation_result', text: "Error generando respuesta.", hat: 'black' });
        }
    }

    // --- CLASIFICACIÓN DE INTENCIÓN (OPTIMIZADA) ---
    if (type === 'classify_intent') {
        if (!classifier_pipeline) return;
        
        // Etiquetas optimizadas para distinguir mejor 'riesgos' de 'beneficios'
        const labels = [
            "buscar datos objetivos y hechos",        // White
            "expresar una reacción emocional intensa, sentimiento subjetivo o corazonada irracional",       // Red
            "advertir sobre un riesgo, peligro o problema fatal", // Black
            "defender la idea actual y listar sus ventajas o beneficios",  // Yellow
            "proponer una alternativa diferente, solución nueva o cambio innovador",   // Green
            "moderar la reunión, cambiar de tema o pedir conclusiones",           // Blue
        ];
        
        const output = await classifier_pipeline(data.text, labels, { multi_label: false });
        
        const map = { 
            "buscar datos objetivos y hechos": "white", 
            "expresar una reacción emocional intensa, sentimiento subjetivo o corazonada irracional": "red", 
            "advertir sobre un riesgo, peligro o problema fatal": "black", 
            "defender la idea actual y listar sus ventajas o beneficios": "yellow", 
            "proponer una alternativa diferente, solución nueva o cambio innovador": "green", 
            "moderar la reunión, cambiar de tema o pedir conclusiones": "blue",
        };
        
        self.postMessage({ type: 'intent_result', hat: map[output.labels[0]], confidence: output.scores[0] });
    }

    // --- RAG (EMBEDDINGS) ---
    if (type === 'embed') {
        if (embed_pipeline) {
            const out = await embed_pipeline(data.text || data, { pooling: 'mean', normalize: true });
            self.postMessage({ type: 'embedding_result', embedding: out.data, id: data.id });
        }
    }

    // --- AUDIO ---
    if (type === 'audio_chunk') {
        if (!asr_pipeline || isProcessingAudio) return;
        isProcessingAudio = true;
        try {
            const out = await asr_pipeline(data, { language: 'spanish' });
            if (out?.text?.trim().length > 0) self.postMessage({ type: 'transcription_result', text: out.text.trim() });
        } catch (e) {} finally { isProcessingAudio = false; }
    }

    // --- VISIÓN ---
    if (type === 'vision') {
        // Notificación visual rápida (opcional)
        addMessageToChat('system', '👁️ Analizando imagen desde múltiples perspectivas...', 'info');

        // 1. LANZAR SOMBRERO BLANCO (Objetividad)
        // Pedimos traducción y descripción pura.
        const promptWhite = `CONTEXTO: La visión artificial detectó esto (en inglés): "${text}".
        TAREA: Actúa como Sombrero Blanco.
        1. Traduce la descripción al español.
        2. Describe OBJETIVAMENTE qué elementos ves en el dibujo.
        3. Sé breve y no des opiniones.`;

        worker.postMessage({ 
            type: 'generate', 
            data: { prompt: promptWhite, hat: 'white' } 
        });

        // 2. LANZAR SOMBRERO VERDE (Creatividad)
        // Pedimos ideas sobre lo mismo, aprovechando el contexto.
        const promptGreen = `CONTEXTO VISUAL: "${text}".
        TAREA: Actúa como Sombrero Verde.
        1. Ignora la descripción técnica.
        2. Propón una idea innovadora, una mejora creativa o un uso alternativo para este dibujo.
        3. Sorpréndeme.`;

        // Pequeño retraso para que no salgan desordenados (opcional pero recomendado)
        setTimeout(() => {
            worker.postMessage({ 
                type: 'generate', 
                data: { prompt: promptGreen, hat: 'green' } 
            });
        }, 500);
    }
};