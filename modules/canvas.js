export class CanvasModule {
    constructor(canvasId, worker) {
        this.canvasId = canvasId;
        this.worker = worker;

        this.fCanvas = new fabric.Canvas(canvasId, {
            isDrawingMode: true,
            width: 800,
            height: 600,
            backgroundColor: '#ffffff' // Importante para la visión
        });

        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        this.setupTools();
    }

    resizeCanvas() {
        const container = document.getElementById('canvas-panel');
        if (container) {
            this.fCanvas.setWidth(container.clientWidth);
            this.fCanvas.setHeight(container.clientHeight - 50);
            this.fCanvas.renderAll();
        }
    }

    setupTools() {
        this.fCanvas.freeDrawingBrush.width = 5;
        this.fCanvas.freeDrawingBrush.color = '#000000';

        document.querySelectorAll('.tool').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const tool = btn.dataset.tool;
                if (tool === 'pen') {
                    this.fCanvas.isDrawingMode = true;
                    this.fCanvas.freeDrawingBrush.color = '#000000';
                    this.fCanvas.freeDrawingBrush.width = 5;
                } else if (tool === 'eraser') {
                    this.fCanvas.isDrawingMode = true;
                    this.fCanvas.freeDrawingBrush.color = '#ffffff';
                    this.fCanvas.freeDrawingBrush.width = 30;
                } else if (tool === 'clear') {
                    this.fCanvas.clear();
                    this.fCanvas.setBackgroundColor('#ffffff', this.fCanvas.renderAll.bind(this.fCanvas));
                }
            });
        });

        const toggleBtn = document.getElementById('toggle-canvas');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                document.getElementById('canvas-panel').classList.toggle('open');
            });
        }

        const analyzeBtn = document.getElementById('btn-analyze-canvas');
        if (analyzeBtn) {
            analyzeBtn.addEventListener('click', () => this.analyze());
        }
    }

    async analyze() {
        if (this.fCanvas.getObjects().length === 0) {
            alert("Dibuja algo primero.");
            return;
        }

        const btn = document.getElementById('btn-analyze-canvas');
        const originalText = btn.innerHTML;
        btn.innerHTML = "<span>👁️ Mirando...</span>";
        btn.disabled = true;

        // 1. Calcular los límites (Bounding Box)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.fCanvas.getObjects().forEach(obj => {
            const rect = obj.getBoundingRect();
            if (rect.left < minX) minX = rect.left;
            if (rect.top < minY) minY = rect.top;
            if (rect.left + rect.width > maxX) maxX = rect.left + rect.width;
            if (rect.top + rect.height > maxY) maxY = rect.top + rect.height;
        });

        // 2. Añadir padding y recortar
        const padding = 20;
        const cropLeft = Math.max(0, minX - padding);
        const cropTop = Math.max(0, minY - padding);
        const cropWidth = Math.min(this.fCanvas.width - cropLeft, (maxX - minX) + (padding * 2));
        const cropHeight = Math.min(this.fCanvas.height - cropTop, (maxY - minY) + (padding * 2));

        // 3. Exportar región específica
        const dataURL = this.fCanvas.toDataURL({
            format: 'jpeg',
            quality: 0.9,
            multiplier: 1,
            left: cropLeft,
            top: cropTop,
            width: cropWidth,
            height: cropHeight
        });

        document.dispatchEvent(new CustomEvent('debug-image', { detail: dataURL }));
        this.worker.postMessage({ type: 'vision', data: { image: dataURL } });

        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }, 4000);
    }
}