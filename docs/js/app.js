/**
 * app.js - Controlador principal de la aplicación MRI Ischemia Detector
 */

const App = {
    // Estado
    originalImageData: null,
    currentFile: null,
    dicomHandler: null,
    analyzer: new IschemiaAnalyzer(),
    results: null,
    activeView: 'overlay',

    init() {
        this.bindEvents();
    },

    bindEvents() {
        // Upload via botón
        document.getElementById('fileInput').addEventListener('change', e => {
            if (e.target.files[0]) this.loadFile(e.target.files[0]);
        });

        // Drag & Drop
        const dropZone = document.getElementById('dropZone');
        dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const f = e.dataTransfer.files[0];
            if (f) this.loadFile(f);
        });
        dropZone.addEventListener('click', () => document.getElementById('fileInput').click());

        // Controles
        document.getElementById('analyzeBtn').addEventListener('click', () => this.analyze());

        // Vista
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeView = btn.dataset.view;
                this.renderActiveView();
            });
        });

        // Exportar
        document.getElementById('exportBtn').addEventListener('click', () => this.exportImage());
        document.getElementById('reportBtn').addEventListener('click', () => this.printReport());
    },

    async loadFile(file) {
        this.currentFile = file;
        const ext = file.name.split('.').pop().toLowerCase();
        this.setStatus('loading', 'Cargando imagen...');
        this.showSection('imageSection');

        try {
            let imageData;
            if (ext === 'dcm' || ext === 'dicom') {
                if (typeof dicomParser === 'undefined') {
                    throw new Error('Librería DICOM no cargada. Verifique su conexión a Internet.');
                }
                this.dicomHandler = new DICOMHandler();
                imageData = await this.dicomHandler.loadFromFile(file);
                this.showDICOMMetadata(this.dicomHandler.getMetadata());
            } else {
                imageData = await this.loadStandardImage(file);
                this.dicomHandler = null;
                this.hideDICOMMetadata();
            }

            this.originalImageData = imageData;
            this.renderCanvas('originalCanvas', imageData);
            this.clearProcessed();
            this.setStatus('ready', `Imagen cargada: ${file.name} (${imageData.width}×${imageData.height} px)`);
            document.getElementById('analyzeBtn').disabled = false;
            document.getElementById('fileInfo').textContent = `${file.name} — ${imageData.width}×${imageData.height} px`;
        } catch (err) {
            this.setStatus('error', 'Error: ' + err.message);
            console.error(err);
        }
    },

    loadStandardImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width  = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
            };
            img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
            img.src = url;
        });
    },

    analyze() {
        if (!this.originalImageData) return;

        const sensitivity = null; // siempre automático
        const mode = document.getElementById('detectionMode').value;

        this.setStatus('processing', 'Analizando imagen...');
        document.getElementById('analyzeBtn').disabled = true;

        // Usar setTimeout para permitir que la UI se actualice antes del procesamiento
        setTimeout(() => {
            try {
                this.results = this.analyzer.analyze(this.originalImageData, sensitivity, mode);
                this.renderResults();
                this.renderActiveView();
                document.getElementById('exportBtn').disabled = false;
                document.getElementById('reportBtn').disabled = false;
                this.setStatus('done', this.results.hasIschemia
                    ? `Isquemia detectada — ${this.results.numRegions} región(es)`
                    : 'Sin evidencia de isquemia');
            } catch (err) {
                this.setStatus('error', 'Error en análisis: ' + err.message);
                console.error(err);
            }
            document.getElementById('analyzeBtn').disabled = false;
        }, 50);
    },

    renderResults() {
        const r = this.results;
        const panel = document.getElementById('resultsPanel');
        panel.style.display = 'block';

        // Indicador principal
        const indicator = document.getElementById('detectionIndicator');
        if (r.hasIschemia) {
            indicator.className = 'detection-badge positive';
            indicator.innerHTML = `<span class="badge-icon">⚠</span><span>ISQUEMIA DETECTADA</span>`;
        } else {
            indicator.className = 'detection-badge negative';
            indicator.innerHTML = `<span class="badge-icon">✓</span><span>SIN ISQUEMIA DETECTADA</span>`;
        }

        // Mostrar k usado en el panel de resultados
        const kUsedLine = document.getElementById('kUsedLine');
        if (kUsedLine && r.autoK != null) {
            const isAuto = r.autoKReason !== null;
            kUsedLine.textContent = `Sensibilidad usada: k = ${r.autoK.toFixed(2)} (${isAuto ? 'automático' : 'manual'})`;
        }

        // Métricas
        const brainAreaCm2 = this.dicomHandler?.pixelsToArea(r.brainArea);
        const ischemicAreaCm2 = this.dicomHandler?.pixelsToArea(r.ischemicArea);

        document.getElementById('metricBrainArea').textContent =
            brainAreaCm2 ? `${r.brainArea.toLocaleString()} px² (${brainAreaCm2} cm²)` : `${r.brainArea.toLocaleString()} px²`;

        document.getElementById('metricIschemicArea').textContent =
            ischemicAreaCm2 ? `${r.ischemicArea.toLocaleString()} px² (${ischemicAreaCm2} cm²)` : `${r.ischemicArea.toLocaleString()} px²`;

        document.getElementById('metricPercentage').textContent = r.percentage.toFixed(2) + '%';
        document.getElementById('metricRegions').textContent = r.numRegions;

        // Tabla de regiones
        const tbody = document.getElementById('regionsTable');
        tbody.innerHTML = '';
        if (r.regions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted)">Sin regiones detectadas</td></tr>';
        } else {
            r.regions.forEach((reg, i) => {
                const w = reg.maxX - reg.minX;
                const h = reg.maxY - reg.minY;
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${i + 1}</td>
                    <td>${reg.size.toLocaleString()} px²</td>
                    <td>${(reg.size / r.brainArea * 100).toFixed(2)}%</td>
                    <td>(${reg.minX}, ${reg.minY}) — ${w}×${h} px</td>
                `;
                tbody.appendChild(tr);
            });
        }

        // Barra de progreso del porcentaje
        const pct = Math.min(r.percentage, 100);
        document.getElementById('percentageBar').style.width = pct + '%';
        document.getElementById('percentageBar').style.backgroundColor =
            pct < 5 ? 'var(--success)' : pct < 15 ? '#f0a500' : 'var(--danger)';
    },

    renderActiveView() {
        if (!this.originalImageData || !this.results) return;
        const canvas = document.getElementById('processedCanvas');
        let imageData;

        if (this.activeView === 'overlay') {
            imageData = this.analyzer.generateOverlay(this.originalImageData, this.results);
        } else if (this.activeView === 'mask') {
            imageData = this.createMaskImage();
        } else {
            imageData = this.analyzer.generateBrainMaskImage(this.originalImageData, this.results);
        }

        this.renderCanvas('processedCanvas', imageData);
        // Dibuja bounding boxes si hay isquemia
        if (this.results.hasIschemia && this.activeView === 'overlay') {
            this.drawBoundingBoxes(canvas);
        }
    },

    createMaskImage() {
        const { width, height } = this.originalImageData;
        const out = new ImageData(width, height);
        const d = out.data;
        const gray = this.analyzer.toGrayscale(this.originalImageData);

        for (let i = 0; i < width * height; i++) {
            if (this.results.finalMask[i]) {
                d[i*4]   = 255; d[i*4+1] = 60; d[i*4+2] = 60; d[i*4+3] = 255;
            } else {
                const v = Math.floor(gray[i] * 0.3);
                d[i*4] = v; d[i*4+1] = v; d[i*4+2] = v; d[i*4+3] = 255;
            }
        }
        return out;
    },

    renderCanvas(canvasId, imageData) {
        const canvas = document.getElementById(canvasId);
        const container = canvas.parentElement;
        const maxW = container.clientWidth - 20;
        const maxH = 500;
        const scale = Math.min(maxW / imageData.width, maxH / imageData.height, 1);

        canvas.width  = Math.round(imageData.width  * scale);
        canvas.height = Math.round(imageData.height * scale);
        canvas.dataset.scale = scale;

        const ctx = canvas.getContext('2d');
        const tmp = document.createElement('canvas');
        tmp.width  = imageData.width;
        tmp.height = imageData.height;
        tmp.getContext('2d').putImageData(imageData, 0, 0);
        ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
    },

    drawBoundingBoxes(canvas) {
        if (!this.results?.regions?.length) return;
        const ctx = canvas.getContext('2d');
        const scale = parseFloat(canvas.dataset.scale) || 1;
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 2;
        ctx.font = `${Math.max(10, 12 * scale)}px monospace`;
        ctx.fillStyle = '#00ffff';

        this.results.regions.forEach((reg, i) => {
            const x = reg.minX * scale;
            const y = reg.minY * scale;
            const w = (reg.maxX - reg.minX) * scale;
            const h = (reg.maxY - reg.minY) * scale;
            ctx.strokeRect(x, y, w, h);
            ctx.fillText(`R${i+1}`, x + 2, y - 4);
        });
    },

    clearProcessed() {
        const canvas = document.getElementById('processedCanvas');
        const ctx = canvas.getContext('2d');
        canvas.width  = 300;
        canvas.height = 200;
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, 300, 200);
        ctx.fillStyle = '#3d4451';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Presione "Analizar" para procesar', 150, 100);
        ctx.textAlign = 'left';

        document.getElementById('resultsPanel').style.display = 'none';
        document.getElementById('exportBtn').disabled = true;
        document.getElementById('reportBtn').disabled = true;
    },

    setStatus(type, msg) {
        const el = document.getElementById('statusBar');
        el.className = 'status-bar ' + type;
        el.textContent = msg;
    },

    showSection(id) {
        document.getElementById(id).style.display = 'flex';
    },

    showDICOMMetadata(meta) {
        const panel = document.getElementById('dicomMetadata');
        panel.style.display = 'block';
        const list = document.getElementById('metadataList');
        list.innerHTML = Object.entries(meta).map(([k, v]) =>
            `<div class="meta-row"><span class="meta-key">${k}:</span><span class="meta-val">${v || 'N/D'}</span></div>`
        ).join('');
    },

    hideDICOMMetadata() {
        document.getElementById('dicomMetadata').style.display = 'none';
    },

    exportImage() {
        if (!this.results) return;
        const canvas = document.getElementById('processedCanvas');
        const link = document.createElement('a');
        link.download = 'ischemia_analysis.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    },

    printReport() {
        if (!this.results) return;
        const r = this.results;
        const date = new Date().toLocaleString('es-CO');
        const processedCanvas = document.getElementById('processedCanvas');
        const processedImg = processedCanvas.toDataURL('image/png');

        const regionsHtml = r.regions.map((reg, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${reg.size.toLocaleString()} px²</td>
                <td>${(reg.size / r.brainArea * 100).toFixed(2)}%</td>
                <td>${reg.maxX - reg.minX} × ${reg.maxY - reg.minY} px</td>
            </tr>
        `).join('');

        const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Reporte de Isquemia MRI</title>
<style>
  body { font-family: Arial, sans-serif; padding: 30px; color: #222; }
  h1 { color: #1a5276; border-bottom: 2px solid #1a5276; padding-bottom: 8px; }
  h2 { color: #2980b9; margin-top: 24px; }
  .badge { display:inline-block; padding: 6px 16px; border-radius: 20px; font-weight: bold; font-size: 1.1em; }
  .positive { background: #f9ebea; color: #c0392b; border: 2px solid #c0392b; }
  .negative { background: #eafaf1; color: #27ae60; border: 2px solid #27ae60; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { background: #2980b9; color: white; padding: 8px; }
  td { padding: 7px; border: 1px solid #ddd; }
  tr:nth-child(even) { background: #f5f5f5; }
  .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0; }
  .metric-box { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
  .metric-label { font-size: 0.8em; color: #666; }
  .metric-value { font-size: 1.4em; font-weight: bold; color: #1a5276; }
  img { max-width: 100%; border: 2px solid #ddd; border-radius: 8px; }
  .footer { margin-top: 30px; font-size: 0.8em; color: #888; border-top: 1px solid #ddd; padding-top: 10px; }
</style>
</head>
<body>
<h1>Reporte de Análisis de Isquemia Cerebral — MRI</h1>
<p><strong>Fecha de análisis:</strong> ${date}</p>
<p><strong>Archivo:</strong> ${this.currentFile?.name || 'Desconocido'}</p>
<p><strong>Dimensiones:</strong> ${r.width} × ${r.height} px</p>

<h2>Resultado de Detección</h2>
<p><span class="badge ${r.hasIschemia ? 'positive' : 'negative'}">
  ${r.hasIschemia ? '⚠ ISQUEMIA DETECTADA' : '✓ SIN ISQUEMIA DETECTADA'}
</span></p>

<h2>Métricas</h2>
<div class="metrics">
  <div class="metric-box">
    <div class="metric-label">Área cerebral total</div>
    <div class="metric-value">${r.brainArea.toLocaleString()} px²</div>
  </div>
  <div class="metric-box">
    <div class="metric-label">Área isquémica</div>
    <div class="metric-value">${r.ischemicArea.toLocaleString()} px²</div>
  </div>
  <div class="metric-box">
    <div class="metric-label">Porcentaje afectado</div>
    <div class="metric-value">${r.percentage.toFixed(2)}%</div>
  </div>
  <div class="metric-box">
    <div class="metric-label">Número de regiones</div>
    <div class="metric-value">${r.numRegions}</div>
  </div>
</div>

${r.regions.length ? `
<h2>Detalle de Regiones Isquémicas</h2>
<table>
  <thead><tr><th>#</th><th>Área (px²)</th><th>% del cerebro</th><th>Dimensiones</th></tr></thead>
  <tbody>${regionsHtml}</tbody>
</table>` : ''}

<h2>Imagen Procesada</h2>
<img src="${processedImg}" alt="Imagen procesada con overlay de isquemia">

<div class="footer">
  Generado por MRI Ischemia Detector · Proyecto académico de procesamiento de imágenes médicas
</div>
</body>
</html>`;

        const win = window.open('', '_blank');
        win.document.write(html);
        win.document.close();
        win.print();
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
