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
            white: "Eres el Sombrero Blanco (Analista Objetivo). Tu objetivo es localizar hechos concretos, cifras y datos. No des opiniones. Formato: 'Dato: [Hecho]'. Texto:",
            red: "Eres el Sombrero Rojo (Emoción e Intuición). Reacciona con corazonadas y sentimientos viscerales. No uses lógica. Formato: 'Sentimiento: [Reacción]'. Texto:",
            black: "Eres el Sombrero Negro (El Juez Crítico). Identifica riesgos, peligros y debilidades fatales. Sé pesimista. Formato: 'Riesgo: [Crítica]'. Texto:",
            yellow: "Eres el Sombrero Amarillo (Optimista). Identifica beneficios y valor añadido. Explica por qué funcionará. Formato: 'Beneficio: [Positivo]'. Texto:",
            green: "Eres el Sombrero Verde (Creatividad). Ignora limitaciones. Propone alternativas innovadoras y soluciones radicales. Formato: 'Idea: [Propuesta]'. Texto:",
            blue: "Eres el Sombrero Azul (Moderador). Sintetiza la discusión, por orden y define pasos. Formato: 'Resumen: [Síntesis]'. Texto:",
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
            data: { prompt: fullPrompt, hat: hat }
        });
    }
}