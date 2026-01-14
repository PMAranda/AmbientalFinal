export class RAGModule {
    constructor(worker) {
        this.worker = worker;
        this.documents = []; 
        this.chunkSize = 150; // Palabras por chunk
        this.overlap = 30;    // Solapamiento de palabras
        this.setupDragDrop();
    }

    setupDragDrop() {
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');
        
        if (!dropZone || !fileInput) return;

        dropZone.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) this.handleFile(e.target.files[0]);
        });

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', (e) => dropZone.classList.remove('dragover'));

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) this.handleFile(e.dataTransfer.files[0]);
        });
    }

    async handleFile(file) {
        if (file.type !== 'application/pdf') {
            alert('Solo se soportan archivos PDF.');
            return;
        }

        const docList = document.getElementById('document-list');
        const docItem = document.createElement('div');
        docItem.className = 'status-item';
        docItem.innerHTML = `<span>${file.name}</span> <span class="status-dot busy"></span>`;
        if (docList) docList.appendChild(docItem);

        try {
            const text = await this.extractTextFromPDF(file);
            console.log(`Texto extraído (${text.length} caracteres).`);

            const chunks = this.chunkText(text, this.chunkSize, this.overlap);
            console.log(`Generados ${chunks.length} chunks.`);

            const docId = Date.now().toString();
            const documentEntry = {
                id: docId,
                name: file.name,
                chunks: chunks.map((txt, i) => ({ id: `${docId}_${i}`, text: txt, vector: null })),
                isReady: false,
                uiElement: docItem
            };
            this.documents.push(documentEntry);

            // Generar Embeddings
            for (let i = 0; i < chunks.length; i++) {
                this.worker.postMessage({
                    type: 'embed',
                    data: { text: chunks[i], id: `${docId}_${i}` }
                });
            }

        } catch (err) {
            console.error("Error procesando PDF:", err);
            docItem.querySelector('.status-dot').className = 'status-dot error';
        }
    }

    async extractTextFromPDF(file) {
        const arrayBuffer = await file.arrayBuffer();
        // pdfjsLib debe estar disponible globalmente en index.html
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            // Importante: Salto de línea entre páginas para separar contextos
            fullText += pageText + ' \n ';
        }
        // Limpiar espacios múltiples
        return fullText.replace(/\s+/g, ' ').trim();
    }

    // Chunking inteligente por palabras
    chunkText(text, wordsPerChunk, wordsOverlap) {
        const words = text.split(/\s+/); 
        const chunks = [];
        
        for (let i = 0; i < words.length; i += (wordsPerChunk - wordsOverlap)) {
            const chunkWords = words.slice(i, i + wordsPerChunk);
            if (chunkWords.length > 10) { // Ignorar chunks muy pequeños
                chunks.push(chunkWords.join(' '));
            }
            if (chunkWords.length < wordsPerChunk) break;
        }
        return chunks;
    }

    handleEmbedding(id, vector) {
        const [docId, chunkIndex] = id.split('_');
        const doc = this.documents.find(d => d.id === docId);
        
        if (doc) {
            const chunk = doc.chunks.find(c => c.id === id);
            if (chunk) chunk.vector = vector;

            if (doc.chunks.every(c => c.vector !== null) && !doc.isReady) {
                doc.isReady = true;
                this.updateDocCount();
                const dot = doc.uiElement.querySelector('.status-dot');
                if (dot) dot.className = 'status-dot connected'; // Luz verde
            }
        }
    }

    updateDocCount() {
        const count = document.getElementById('doc-count');
        if (count) count.innerText = this.documents.filter(d => d.isReady).length;
    }

    cosineSimilarity(a, b) {
        if (!a || !b) return 0;
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    search(queryVector, topK = 3) {
        let allChunks = [];
        this.documents.forEach(doc => {
            if (doc.isReady) allChunks.push(...doc.chunks);
        });

        const scored = allChunks.map(chunk => ({
            text: chunk.text,
            score: this.cosineSimilarity(queryVector, chunk.vector)
        }));

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
    }
}