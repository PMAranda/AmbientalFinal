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

// UI Globales
const btnMic = document.getElementById('btn-mic');
const btnSend = document.getElementById('btn-send');
const userInput = document.getElementById('user-input');

// ESTADO DE CIERRE DE SESIÓN
let isEndingSession = false;

// --- NUEVO: BOTÓN DE FINALIZAR SESIÓN ---
const btnEndSession = document.getElementById('btn-end-session');
const summaryOverlay = document.getElementById('summary-overlay');
const summaryContent = document.getElementById('summary-content');
const btnRestart = document.getElementById('btn-restart-app');

if (btnEndSession) {
    btnEndSession.addEventListener('click', () => {
        const confirmEnd = confirm("¿Seguro que quieres finalizar la sesión y generar el acta?");
        if (confirmEnd) {
            isEndingSession = true; // ACTIVAMOS BANDERA
            
            // Mostramos el overlay cargando
            summaryOverlay.classList.remove('hidden');
            summaryContent.innerHTML = '<div style="text-align:center;">🧠 <b>Generando acta de la reunión...</b><br>Analizando historial y dibujos...</div>';
            
            // Forzamos al agente azul a resumir
            agents.triggerHat('blue', 'haz un resumen detallado y concluye la reunión');
        }
    });
}

// LÓGICA DE REINICIO (BOTÓN EN EL OVERLAY)
if (btnRestart) {
    btnRestart.addEventListener('click', () => {
        // 1. Ocultar overlay de resumen
        summaryOverlay.classList.add('hidden');

        // 2. Limpiar Chat
        const chatContainer = document.getElementById('chat-stream');
        chatContainer.innerHTML = `
            <div class="message system-message">
                <div class="avatar">🤖</div>
                <div class="bubble">
                    Sesión Reiniciada.
                    <br><small>Sube un PDF o empieza a hablar para comenzar.</small>
                </div>
            </div>`;
        
        // 3. Limpiar Galería y Pizarra
        document.getElementById('gallery-grid').innerHTML = '<div class="empty-gallery-text">Aún no hay análisis</div>';
        document.getElementById('gallery-count').innerText = '0';
        // Limpiamos canvas si es posible (accediendo a fabric desde module o recargando)
        // (Para simplificar, recargamos la página sería lo más limpio, pero aquí lo hacemos SPA)
        
        // 4. Resetear Agentes (Memoria)
        agents.reset();

        // 5. Mostrar Overlay de Bienvenida
        const welcomeOverlay = document.getElementById('welcome-overlay');
        welcomeOverlay.style.display = 'flex'; // Asegurar display flex
        welcomeOverlay.classList.remove('hidden');

        isEndingSession = false;
    });
}


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
        
        // LÓGICA ESPECIAL PARA CIERRE DE SESIÓN
        if (isEndingSession) {
            // Reemplazar saltos de línea por <br> y negritas para HTML
            const formattedText = text.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
            
            summaryContent.innerHTML = formattedText;
            return; // Detenemos aquí para que NO salga en el chat de fondo
        }

        // Comportamiento normal (Chat)
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
    
    // Scroll
    const scrollToBottom = () => {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    };
    scrollToBottom();
    requestAnimationFrame(() => {
        scrollToBottom();
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

document.addEventListener('debug-image', (e) => {
    const imageUrl = e.detail;
    addMessageToChat('system', `<img src="${imageUrl}" style="max-height:100px; border-radius:8px; border:1px solid #444;">`, 'info');
    addCheckToGallery(imageUrl);
});

function addCheckToGallery(url) {
    const emptyText = document.querySelector('.empty-gallery-text');
    if (emptyText) emptyText.remove();

    const div = document.createElement('div');
    div.className = 'gallery-item glass-panel-inset';
    div.innerHTML = `<img src="${url}" alt="Análisis ${savedImages + 1}">`;
    
    div.addEventListener('click', () => {
        modal.classList.remove('hidden');
        modalImg.src = url;
    });

    galleryGrid.prepend(div);
    savedImages++;
    if (galleryCount) galleryCount.innerText = savedImages;
}

// Cerrar Modal
if (closeModal) {
    closeModal.addEventListener('click', () => {
        modal.classList.add('hidden');
    });
}

window.addEventListener('click', (e) => {
    if (e.target === modal) {
        modal.classList.add('hidden');
    }
});

// Carga Inicial
worker.postMessage({ type: 'load' });

// --- LÓGICA DE BIENVENIDA ---
const btnStart = document.getElementById('btn-start-app');
const overlay = document.getElementById('welcome-overlay');

if (btnStart && overlay) {
    btnStart.addEventListener('click', () => {
        overlay.classList.add('hidden');
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 500);
    });
}