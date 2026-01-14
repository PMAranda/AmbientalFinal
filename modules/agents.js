export class AgentModule {
    constructor(worker, ragModule) {
        this.worker = worker;
        this.rag = ragModule;
        this.conversationHistory = [];
        
        // ESTADO
        this.isAutoMode = true; // Empieza en automático
        this.activeHat = null;  // Ningún sombrero fijo al inicio

        // PROMPTS (Se mantienen igual que antes...)
        this.hatPrompts = {
            white: "Eres un asistente analista objetivo. Tu objetivo es localizar hechos concretos, cifras y datos. No des opiniones.",
            red: "Eres un asistente de gestion emocional. Tu rol es detectar el estado de ánimo del equipo. Si notas tensión, enfado o estrés, responde con palabras calmantes y conciliadoras para relajar el ambiente. Si notas entusiasmo o alegría, comparte y amplifica esa energía positiva. Sé muy humano y empático.",
            black: "Eres una analista crítico y racional. Identifica riesgos, peligros y debilidades fatales. Sé pesimista.",
            yellow: "Eres un asistente optimista. Identifica beneficios y valor añadido. Explica por qué funcionará.",
            green: "Eres un asistente creativo. Ignora limitaciones. Valora ideas nuevas y propon alternativas innovadoras y soluciones nuevas.",
            blue: "Eres un asistente moderador. Sintetiza la discusión, por orden y define pasos.",
        };


        this.setupListeners();
    }

    setupListeners() {
        const autoBtn = document.getElementById('btn-auto-hat');
        const hatButtons = document.querySelectorAll('.btn-hat');

        // 1. CLICK EN SOMBREROS DE COLORES (Modo Manual)
        hatButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const hat = btn.dataset.hat;
                
                // Cambiar estado
                this.isAutoMode = false;
                this.activeHat = hat;

                // Actualizar UI
                autoBtn.classList.remove('active');
                hatButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active'); // Iluminar el seleccionado

                console.log(`Modo Manual Activado: Sombrero ${hat.toUpperCase()}`);
            });
        });

        // 2. CLICK EN AUTO-FACILITADOR (Modo Automático)
        if (autoBtn) {
            // Activar visualmente al inicio
            if(this.isAutoMode) autoBtn.classList.add('active');

            autoBtn.addEventListener('click', () => {
                // Cambiar estado
                this.isAutoMode = true;
                this.activeHat = null;

                // Actualizar UI
                hatButtons.forEach(b => b.classList.remove('active'));
                autoBtn.classList.add('active');

                alert("🤖 Modo Auto activado: El sistema decidirá el mejor rol.");
            });
        }
    }

    addToHistory(role, text) {
        this.conversationHistory.push(`${role}: ${text}`);
        if (this.conversationHistory.length > 5) this.conversationHistory.shift();
    }

    // Método para llamar al worker
    triggerHat(hat, textOverride = null) {
        // Obtenemos el texto: o es nuevo (textOverride) o es el último del historial
        let content = textOverride;
        if (!content) {
            const lastMsg = this.conversationHistory[this.conversationHistory.length - 1] || "el tema";
            content = lastMsg.includes(':') ? lastMsg.split(':')[1] : lastMsg;
        }

        const instruction = this.hatPrompts[hat];
        const fullPrompt = `
### INSTRUCCIÓN DEL ROL:
${instruction}

### TEXTO DE ENTRADA:
"${content}"

### REQUISITOS:
- Responde EXCLUSIVAMENTE en español.
- Sé breve y directo.

### TU RESPUESTA:`;

        this.worker.postMessage({
            type: 'generate',
            data: { 
                systemMessage: this.hatPrompts[hat], // La definición del rol va al sistema
                userMessage: content,                // El input del usuario va aparte
                hat: hat,
                temperature: hatConfig[hat].temp
            }
            });
         }
}