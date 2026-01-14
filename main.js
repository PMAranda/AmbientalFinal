import { TranscriptionModule } from './modules/transcription.js';
import { RAGModule } from './modules/rag.js';
import { AgentModule } from './modules/agents.js';
import { CanvasModule } from './modules/canvas.js';

const worker = new Worker('worker.js', { type: 'module' });

// Módulos
const transcription = new TranscriptionModule(worker);
const rag = new RAGModule(worker);
const agents = new AgentModule(worker, rag);
const canvas = new CanvasModule('drawing-board', worker);

// UI
const btnMic = document.getElementById('btn-mic');
const btnSend = document.getElementById('btn-send');
const userInput = document.getElementById('user-input');

// Controles Micrófono
if (btnMic) {
    btnMic.addEventListener('click', () => {
        btnMic.classList.toggle('active');
        if (btnMic.classList.contains('active')) {
            transcription.start();
            document.querySelector('.recording-indicator').classList.add('visible');
        } else {
            transcription.stop();
            document.querySelector('.recording-indicator').classList.remove('visible');
        }
    });
}

// Manejo de mensajes del usuario
const handleUserMessage = (inputText = null) => {
    const text = inputText || userInput.value.trim();
    if (!text) return;

    if (!inputText) userInput.value = '';

    addMessageToChat('user', text);
    agents.addToHistory('User', text);

    // --- LÓGICA DE DECISIÓN DE AGENTE ---

    // CASO 1: MODO AUTO (Orquestador decide)
    if (agents.isAutoMode) {
        addMessageToChat('system', '🧠 Analizando intención...', 'info');
        worker.postMessage({ type: 'classify_intent', data: { text: text } });
        return;
    }

    // CASO 2: MODO MANUAL (Sombrero fijo seleccionado)
    if (agents.activeHat) {
        // Si es el Blanco, intentamos usar RAG primero si hay docs
        if (agents.activeHat === 'white' && rag.documents.some(d => d.isReady)) {
             addMessageToChat('system', '⚪ Sombrero Blanco buscando en datos...', 'white');
             worker.postMessage({ 
                type: 'embed', 
                data: { text: text, id: `QUERY:${text}` } 
            });
        } 
        // Cualquier otro color (o blanco sin docs) responde directo
        else {
            agents.triggerHat(agents.activeHat, text);
        }
        return;
    }

    // Fallback (por si acaso): Modo Azul por defecto
    agents.triggerHat('blue', text);
};

if (btnSend) btnSend.addEventListener('click', () => handleUserMessage());
if (userInput) userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleUserMessage(); });

// --- RESPUESTAS DEL WORKER ---
worker.onmessage = (e) => {
    const { status, task, type, text, percent, message, embedding, id, hat, confidence } = e.data;

    // A. Progreso
    if (status === 'progress' || type === 'progress_update') {
        handleProgress(percent, message);
    }
    if (status === 'ready') {
        const statusMap = { 'asr': 'status-whisper', 'llm': 'status-llm', 'vlm': 'status-vision', 'classifier': 'status-llm' };
        const el = document.getElementById(statusMap[task]);
        if (el) el.classList.add('connected');
    }

    // B. Transcripción
    if (type === 'transcription_result') {
        const caption = document.getElementById('live-caption');
        if (caption) caption.innerText = text;
        handleUserMessage(text);
    }

    // C. Orquestador
    if (type === 'intent_result') {
        const safeHat = (typeof hat === 'string' && hat) ? hat : null;
        const hatLabel = safeHat ? safeHat.toUpperCase() : 'DESCONOCIDO';
        const confPct = (typeof confidence === 'number') ? (confidence * 100).toFixed(0) : '0';

        addMessageToChat('system', `💡 Intención: Sombrero ${hatLabel} (${confPct}%)`, safeHat);
        if (safeHat) agents.triggerHat(safeHat);
    }

    // D. RAG (Mejorado)
    if (type === 'embedding_result') {
        // Verificamos que sea una respuesta a una pregunta y no un chunk
        if (id && typeof id === 'string' && id.startsWith('QUERY:')) {
            const originalQuery = id.split('QUERY:')[1];
            const results = rag.search(embedding, 3); // Top 3 resultados

            if (results.length > 0 && results[0].score > 0.25) {
                const bestChunk = results[0];
                
                // Feedback visual de lo encontrado
                addMessageToChat('system', `📄 <b>Encontrado en PDF:</b> "...${bestChunk.text.substring(0, 100)}..."`, 'white');
                
                // Prompt específico para que el modelo conteste usando el contexto
                const prompt = `Instrucción: Usa el siguiente CONTEXTO para responder a la PREGUNTA.
CONTEXTO: "${bestChunk.text}"
PREGUNTA: "${originalQuery}"
RESPUESTA:`;
                
                worker.postMessage({ type: 'generate', data: { prompt, hat: 'white' } });
            } else {
                addMessageToChat('system', '⚠️ No encontrado en documentos. Usando conocimiento general.', 'warning');
                agents.triggerHat('blue', originalQuery);
            }
        } else if (id) {
            // Es un chunk de un documento cargándose
            rag.handleEmbedding(id, embedding);
        }
    }

    // E. Generación de Texto
    if (type === 'generation_result') {
        addMessageToChat('bot', text, hat);
        agents.addToHistory('AI', text);
    }

    // F. Visión
    if (type === 'vision_result') {
        addMessageToChat('bot', `👁️ Análisis visual: ${text}`, 'blue');
    }
};

// UI Helpers
function handleProgress(percent, msg) {
    const container = document.getElementById('progress-container');
    const bar = document.getElementById('progress-bar');
    const txt = document.getElementById('progress-text');
    
    if (container && msg) {
        container.style.display = 'block';
        txt.innerText = msg;
    }
    if (bar && percent) {
        bar.style.width = `${percent}%`;
    }
    if (percent >= 100) {
        setTimeout(() => container.style.display = 'none', 2000);
    }
}

function addMessageToChat(role, text, hat = null) {
    const chatContainer = document.getElementById('chat-stream');
    const msgDiv = document.createElement('div');
    const isSystem = role === 'system';
    
    msgDiv.className = `message ${role} ${hat ? 'hat-' + hat : ''}`;
    
    // Procesar negritas **texto** -> <b>texto</b>
    let content = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

    // Construir HTML
    if (isSystem) {
        msgDiv.innerHTML = `<div class="bubble system-bubble">${content}</div>`;
    } else {
        const avatar = role === 'user' ? '👤' : '🤖';
        msgDiv.innerHTML = `<div class="avatar">${avatar}</div><div class="bubble">${content}</div>`;
    }
    
    chatContainer.appendChild(msgDiv);
    
    // --- FUNCIÓN DE SCROLL ROBUSTA ---
    const scrollToBottom = () => {
        // Opción A: Directo y sin fallos (scrollTop es más fiable que scrollTo en algunos navegadores)
        chatContainer.scrollTop = chatContainer.scrollHeight;
    };

    // 1. Intentar scroll inmediato
    scrollToBottom();

    // 2. Intentar de nuevo tras un instante (para asegurar que el navegador pintó el nuevo div)
    requestAnimationFrame(() => {
        scrollToBottom();
        // Un último intento de seguridad por si había imágenes cargando
        setTimeout(scrollToBottom, 100);
    });
}

// --- GESTIÓN DE GALERÍA DE IMÁGENES ---
const galleryGrid = document.getElementById('gallery-grid');
const galleryCount = document.getElementById('gallery-count');
const modal = document.getElementById('image-modal');
const modalImg = document.getElementById('modal-img');
const closeModal = document.querySelector('.close-modal');
let savedImages = 0;
// Escuchar evento de nuevo análisis (viene de canvas.js)
document.addEventListener('debug-image', (e) => {
    const imageUrl = e.detail;
    
    // 1. Mostrar en el chat (como antes)
    addMessageToChat('system', `<img src="${imageUrl}" style="max-height:100px; border-radius:8px; border:1px solid #444;">`, 'info');

    // 2. Añadir a la Galería Sidebar
    addCheckToGallery(imageUrl);
});

function addCheckToGallery(url) {
    // Quitar mensaje de "vacío" si es la primera
    const emptyText = document.querySelector('.empty-gallery-text');
    if (emptyText) emptyText.remove();

    // Crear elemento
    const div = document.createElement('div');
    div.className = 'gallery-item glass-panel-inset';
    div.innerHTML = `<img src="${url}" alt="Análisis ${savedImages + 1}">`;
    
    // Evento para abrir modal
    div.addEventListener('click', () => {
        modal.classList.remove('hidden');
        modalImg.src = url;
    });

    // Añadir al principio (lo más nuevo arriba)
    galleryGrid.prepend(div);

    // Actualizar contador
    savedImages++;
    if (galleryCount) galleryCount.innerText = savedImages;
}

// Cerrar Modal
if (closeModal) {
    closeModal.addEventListener('click', () => {
        modal.classList.add('hidden');
    });
}

// Cerrar al hacer clic fuera de la imagen
window.addEventListener('click', (e) => {
    if (e.target === modal) {
        modal.classList.add('hidden');
    }
});
// Iniciar carga
worker.postMessage({ type: 'load' });

// --- LÓGICA DE BIENVENIDA ---
const btnStart = document.getElementById('btn-start-app');
const overlay = document.getElementById('welcome-overlay');

if (btnStart && overlay) {
    btnStart.addEventListener('click', () => {
        // Efecto de desvanecimiento
        overlay.classList.add('hidden');
        
        // Opcional: Reproducir un sonido sutil de inicio
        // o iniciar el contexto de audio si es necesario por políticas del navegador
        
        // Eliminamos del DOM después de la animación para que no moleste
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 500);
    });
}