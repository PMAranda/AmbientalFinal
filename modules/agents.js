export class AgentModule {
    constructor(worker, ragModule) {
        this.worker = worker;
        this.rag = ragModule;
        
        // MEMORIA
        this.conversationHistory = []; // Memoria a corto plazo (Contexto inmediato)
        this.fullHistory = [];         // NUEVO: Memoria completa para el resumen final
        
        // ESTADO
        this.isAutoMode = true; // Empieza en automático
        this.activeHat = null;  // Ningún sombrero fijo al inicio

        // PROMPTS (Referencia)
        this.hatPrompts = {
            white: "Eres un analista objetivo. Tu única función es aportar datos numéricos y hechos probados que ya conozcas o estén en el contexto.",
            red: "Eres un mediador emocional y empático. Si detectas agresividad o conflicto en el texto del usuario, tu objetivo es pedir calma y sugerir mantener un tono respetuoso. Si el usuario expresa sentimientos, valídalos.",
            black: "Eres un analista de riesgos prudente y pesimista. Tu objetivo es señalar los peligros, problemas legales o pérdidas económicas potenciales basados en lo que dice el usuario.",
            yellow: "Eres un consultor optimista. Destaca los beneficios, el valor y las oportunidades de éxito.",
            green: "Eres un creativo sin límites. Propón una alternativa innovadora, loca o diferente a lo que se ha dicho.",
            blue: "Eres el moderador de la reunión. Resume lo dicho hasta ahora y propón el siguiente paso."
        };

        this.setupListeners();
    }
    reset() {
        this.conversationHistory = [];
        this.fullHistory = [];
        this.isAutoMode = true;
        this.activeHat = null;
        
        // Reset UI de botones
        document.querySelectorAll('.btn-hat').forEach(b => b.classList.remove('active'));
        const autoBtn = document.getElementById('btn-auto-hat');
        if(autoBtn) autoBtn.classList.add('active');
        
        console.log("Memoria del agente reiniciada.");
    }
    // -----
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
        const entry = `${role}: ${text}`;
        
        // 1. Memoria Corta (para chat fluido)
        this.conversationHistory.push(entry);
        if (this.conversationHistory.length > 5) this.conversationHistory.shift();

        // 2. NUEVO: Memoria Completa (para el resumen)
        this.fullHistory.push(entry);
    }

    // Método para llamar al worker
   triggerHat(hat, textOverride = null) {
        // 1. Obtener el texto del usuario
        let content = textOverride;
        if (!content) {
            const lastMsg = this.conversationHistory[this.conversationHistory.length - 1] || "el tema";
            content = lastMsg.includes(':') ? lastMsg.split(':')[1] : lastMsg;
        }
        console.log(content)
        // --- NUEVA LÓGICA: DETECCIÓN DE RESUMEN (SOMBRERO AZUL) ---
        const summaryKeywords = [
            'resumir', 'recapitular', 'recapitulemos', 'resumamos', 'concluir', 
            'resumen', 'síntesis', 'conclusión', 'acta'
        ];
        const isSummaryRequest = summaryKeywords.some(kw => content.includes(kw));
        console.log(hat)
        if (isSummaryRequest) {
            console.log("Detectada petición de resumen completo.");

            // A. Obtener conteo de dibujos del DOM
            const galleryElement = document.getElementById('gallery-count');
            const drawingCount = galleryElement ? galleryElement.innerText : "0";

            // B. Preparar historial completo (Convertir array a texto)
            // Usamos slice(-4000) caracteres para asegurar que entra en el prompt si es muy largo
            const fullContext = this.fullHistory.join('\n').slice(-4000); 

            // C. Enviar al worker con parámetro especial 'drawing_count'
            this.worker.postMessage({
                type: 'generate',
                data: { 
                    system_prompt: "Eres un secretario experto. Tu tarea es generar un RESUMEN ESTRUCTURADO Y COMPLETO de las ideas principales tratadas en la conversación entre la IA y los usuarios.", 
                    text: `Historial de la conversación:\n${fullContext}\n\nInstrucción: Genera el resumen ahora.`,
                    hat: 'blue',
                    drawing_count: drawingCount // <--- DATO CLAVE
                }
            });
            return; // Salimos para que no se ejecute el código normal de abajo
        }
        // -----------------------------------------------------------
        console.log("Ni resumen ni ostias.");
        // 2. Definir la personalidad (System Prompt) estándar
        const prompts = {
            white: "Eres un analista de datos objetivo. Tu trabajo es responder unicamente con hechos o pedir datos concretos. Se breve y conciso.",
            red: "Eres un mediador de conflictos y emociones. Sé empático e intenta calmar los ánimos de la reunión. Sé muy breve, menos de 200 palabras.",
            black: "Eres un gestor de riesgos corporativos. Tu trabajo es analizar la frase del usuario y explicar POR QUÉ es una mala idea o qué peligros financieros/técnicos conlleva. Se breve y conciso, menos de 200 palabras.",
            yellow: "Eres un consultor optimista. Tu trabajo es encontrar beneficios y valor de negocio en lo que dice el usuario. Se entusiasta, breve y conciso, menos de 200 palabras.",
            green: "Eres un experto en innovación y creatividad. Propón una idea original relacionada con lo que dice el usuario.  Sé breve y conciso, menos de 200 palabras.",
            blue: "Eres el moderador de la reunión. Tu trabajo es poner orden. Resume brevemente lo que se ha dicho o propón pasar al siguiente punto, menos de 200 palabras."
        };

        const systemInstruction = prompts[hat.toLowerCase()] || prompts['blue'];

        // 3. Enviamos al worker
        this.worker.postMessage({
            type: 'generate',
            data: { 
                system_prompt: systemInstruction, 
                text: content,                    
                hat: hat 
            }
        });
    }
}