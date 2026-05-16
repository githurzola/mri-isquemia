/**
 * app.js — Controlador principal con animaciones UI/UX
 */

const App = {
    originalImageData: null,
    currentFile: null,
    dicomHandler: null,
    analyzer: new IschemiaAnalyzer(),
    results: null,
    activeView: 'overlay',

    init() {
        this.bindEvents();
        this.updateSensitivityLabel();
    },

    bindEvents() {
        document.getElementById('fileInput').addEventListener('change', e => {
            if (e.target.files[0]) this.loadFile(e.target.files[0]);
        });

        const dropZone = document.getElementById('dropZone');
        dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const f = e.dataTransfer.files[0];
            if (f) this.loadFile(f);
        });
        dropZone.addEventListener('click', () => document.getElementById('fileInput').click());

        document.getElementById('sensitivitySlider').addEventListener('input', () => this.updateSensitivityLabel());
        document.getElementById('analyzeBtn').addEventListener('click', () => this.analyze());

        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeView = btn.dataset.view;
                this.renderActiveView();
            });
        });

        document.getElementById('exportBtn').addEventListener('click', () => this.exportImage());
        document.getElementById('reportBtn').addEventListener('click', () => this.printReport());
    },

    updateSensitivityLabel() {
        const val = parseFloat(document.getElementById('sensitivitySlider').value);
        document.getElementById('sensitivityValue').textContent = val.toFixed(1);
    },

    async loadFile(file) {
        this.currentFile = file;
        const ext = file.name.split('.').pop().toLowerCase();
        this.setStatus('loading', 'Cargando imagen...');

        // Ocultar welcome, mostrar sección
        document.getElementById('welcomeScreen').style.display = 'none';
        this.showSection('imageSection');

        try {
            let imageData;
            if (ext === 'dcm' || ext === 'dicom') {
                if (typeof dicomParser === 'undefined') throw new Error('Librería DICOM no disponible. Verifique su conexión.');
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

            const fi = document.getElementById('fileInfo');
            fi.style.display = 'flex';
            document.getElementById('fileInfoText').textContent = `${file.name} — ${imageData.width}×${imageData.height} px`;

            this.setStatus('ready', `Imagen cargada: ${file.name} (${imageData.width}×${imageData.height} px)`);
            document.getElementById('analyzeBtn').disabled = false;
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
                const c = document.createElement('canvas');
                c.width = img.naturalWidth; c.height = img.naturalHeight;
                c.getContext('2d').drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                resolve(c.getContext('2d').getImageData(0, 0, c.width, c.height));
            };
            img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
            img.src = url;
        });
    },

    analyze() {
        if (!this.originalImageData) return;

        const sensitivity = parseFloat(document.getElementById('sensitivitySlider').value);
        const mode = document.getElementById('detectionMode').value;

        // Estado visual: procesando
        this.setStatus('processing', 'Analizando imagen — por favor espere...');
        this.setAnalyzeButtonState(true);
        this.startScanAnimation();

        setTimeout(() => {
            try {
                this.results = this.analyzer.analyze(this.originalImageData, sensitivity, mode);
                this.stopScanAnimation();
                this.renderResults();
                this.renderActiveView();
                document.getElementById('exportBtn').disabled = false;
                document.getElementById('reportBtn').disabled = false;
                this.setStatus('done', this.results.hasIschemia
                    ? `Análisis completado — ${this.results.numRegions} región(es) isquémica(s) detectada(s)`
                    : 'Análisis completado — Sin evidencia de isquemia detectada');
            } catch (err) {
                this.stopScanAnimation();
                this.setStatus('error', 'Error en el análisis: ' + err.message);
                console.error(err);
            }
            this.setAnalyzeButtonState(false);
        }, 60);
    },

    setAnalyzeButtonState(loading) {
        const btn  = document.getElementById('analyzeBtn');
        const icon = document.getElementById('analyzeBtnIcon');
        const text = document.getElementById('analyzeBtnText');
        btn.disabled = loading;
        if (loading) {
            btn.classList.add('loading-state');
            icon.setAttribute('class', 'spin');
            icon.innerHTML = '<circle cx="12" cy="12" r="10" stroke-width="2.5" stroke-dasharray="32" stroke-dashoffset="0"/>';
            text.textContent = 'Procesando...';
        } else {
            btn.classList.remove('loading-state');
            btn.disabled = false;
            icon.setAttribute('class', '');
            icon.innerHTML = '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>';
            text.textContent = 'Ejecutar análisis';
        }
    },

    startScanAnimation() {
        document.getElementById('scanOverlay').classList.add('active');
    },

    stopScanAnimation() {
        document.getElementById('scanOverlay').classList.remove('active');
    },

    // Anima un número desde su valor actual hasta `target`
    animateValue(el, target, decimals = 0, suffix = '', duration = 900) {
        const start = performance.now();
        const from = parseFloat(el.dataset.raw || 0) || 0;
        el.dataset.raw = target;
        const tick = now => {
            const p = Math.min((now - start) / duration, 1);
            const ease = 1 - Math.pow(1 - p, 4);
            const cur = from + (target - from) * ease;
            el.textContent = cur.toFixed(decimals) + suffix;
            if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    },

    renderResults() {
        const r = this.results;
        const panel = document.getElementById('resultsPanel');
        panel.style.display = 'block';
        // Re-trigger animation
        panel.style.animation = 'none';
        panel.offsetHeight; // reflow
        panel.style.animation = '';

        // Badge de detección
        const badge = document.getElementById('detectionIndicator');
        const checkSVG = `<svg class="badge-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
        const warnSVG  = `<svg class="badge-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
        badge.style.animation = 'none'; badge.offsetHeight; badge.style.animation = '';
        if (r.hasIschemia) {
            badge.className = 'detection-badge positive';
            badge.innerHTML = `${warnSVG} ISQUEMIA DETECTADA`;
        } else {
            badge.className = 'detection-badge negative';
            badge.innerHTML = `${checkSVG} SIN ISQUEMIA DETECTADA`;
        }

        // Métricas con animación de contador
        const brainCm2    = this.dicomHandler?.pixelsToArea(r.brainArea);
        const ischemCm2   = this.dicomHandler?.pixelsToArea(r.ischemicArea);

        const brainEl   = document.getElementById('metricBrainArea');
        const ischemEl  = document.getElementById('metricIschemicArea');
        const pctEl     = document.getElementById('metricPercentage');
        const regEl     = document.getElementById('metricRegions');

        brainEl.textContent  = '0 px²';
        ischemEl.textContent = '0 px²';
        pctEl.textContent    = '0%';
        regEl.textContent    = '0';

        setTimeout(() => {
            this.animateValue(brainEl,  r.brainArea,    0, brainCm2  ? ` px² (${brainCm2} cm²)`  : ' px²');
            this.animateValue(ischemEl, r.ischemicArea, 0, ischemCm2 ? ` px² (${ischemCm2} cm²)` : ' px²');
            this.animateValue(pctEl,    r.percentage,   2, '%', 700);
            this.animateValue(regEl,    r.numRegions,   0, '', 400);
        }, 80);

        // Barra de porcentaje animada
        const pct = Math.min(r.percentage, 100);
        const bar = document.getElementById('percentageBar');
        const pctLabel = document.getElementById('pctLabel');
        bar.style.width = '0%';
        bar.style.backgroundColor = pct < 5 ? 'var(--success)' : pct < 20 ? 'var(--warn)' : 'var(--danger)';
        setTimeout(() => { bar.style.width = pct + '%'; }, 100);
        this.animateValue(pctLabel, pct, 1, '%', 900);

        // Tabla de regiones
        const tbody = document.getElementById('regionsTable');
        tbody.innerHTML = '';
        if (!r.regions.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Sin regiones detectadas</td></tr>';
        } else {
            r.regions.forEach((reg, i) => {
                const w = reg.maxX - reg.minX, h = reg.maxY - reg.minY;
                const tr = document.createElement('tr');
                tr.style.animation = `slideUp .3s ease ${i * 0.05}s both`;
                tr.innerHTML = `
                    <td>${i + 1}</td>
                    <td>${reg.size.toLocaleString()}</td>
                    <td>${(reg.size / r.brainArea * 100).toFixed(2)}%</td>
                    <td>(${reg.minX}, ${reg.minY})</td>
                    <td>${w} &times; ${h} px</td>`;
                tbody.appendChild(tr);
            });
        }
    },

    renderActiveView() {
        if (!this.originalImageData || !this.results) return;
        let imageData;
        if (this.activeView === 'overlay')     imageData = this.analyzer.generateOverlay(this.originalImageData, this.results);
        else if (this.activeView === 'mask')   imageData = this.createMaskImage();
        else                                   imageData = this.analyzer.generateBrainMaskImage(this.originalImageData, this.results);

        const canvas = document.getElementById('processedCanvas');
        canvas.style.opacity = '0';
        this.renderCanvas('processedCanvas', imageData);
        requestAnimationFrame(() => {
            canvas.style.transition = 'opacity .25s ease';
            canvas.style.opacity = '1';
        });

        if (this.results.hasIschemia && this.activeView === 'overlay') {
            setTimeout(() => this.drawBoundingBoxes(canvas), 50);
        }
    },

    createMaskImage() {
        const { width, height } = this.originalImageData;
        const out = new ImageData(width, height);
        const d = out.data;
        const gray = this.analyzer.toGrayscale(this.originalImageData);
        for (let i = 0; i < width * height; i++) {
            if (this.results.finalMask[i]) {
                d[i*4] = 220; d[i*4+1] = 50; d[i*4+2] = 50; d[i*4+3] = 255;
            } else {
                const v = Math.floor(gray[i] * 0.28);
                d[i*4] = v; d[i*4+1] = v; d[i*4+2] = v; d[i*4+3] = 255;
            }
        }
        return out;
    },

    renderCanvas(id, imageData) {
        const canvas = document.getElementById(id);
        const container = canvas.parentElement;
        const maxW = container.clientWidth - 28;
        const maxH = 460;
        const scale = Math.min(maxW / imageData.width, maxH / imageData.height, 1);
        canvas.width  = Math.round(imageData.width  * scale);
        canvas.height = Math.round(imageData.height * scale);
        canvas.dataset.scale = scale;
        const tmp = document.createElement('canvas');
        tmp.width = imageData.width; tmp.height = imageData.height;
        tmp.getContext('2d').putImageData(imageData, 0, 0);
        canvas.getContext('2d').drawImage(tmp, 0, 0, canvas.width, canvas.height);
    },

    drawBoundingBoxes(canvas) {
        if (!this.results?.regions?.length) return;
        const ctx = canvas.getContext('2d');
        const scale = parseFloat(canvas.dataset.scale) || 1;
        ctx.strokeStyle = 'rgba(0,210,210,.9)';
        ctx.lineWidth = 1.5;
        ctx.font = `${Math.max(9, 11 * scale)}px "JetBrains Mono", monospace`;
        ctx.fillStyle = 'rgba(0,210,210,.9)';
        this.results.regions.forEach((reg, i) => {
            const x = reg.minX * scale, y = reg.minY * scale;
            const w = (reg.maxX - reg.minX) * scale, h = (reg.maxY - reg.minY) * scale;
            ctx.strokeRect(x, y, w, h);
            ctx.fillText(`R${i + 1}`, x + 3, y > 14 ? y - 4 : y + 12);
        });
    },

    clearProcessed() {
        const canvas = document.getElementById('processedCanvas');
        canvas.width = 300; canvas.height = 200;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#050810';
        ctx.fillRect(0, 0, 300, 200);
        ctx.fillStyle = '#1a2a38';
        ctx.font = '12px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Ejecute el análisis para visualizar resultados', 150, 100);
        ctx.textAlign = 'left';
        document.getElementById('resultsPanel').style.display = 'none';
        document.getElementById('exportBtn').disabled = true;
        document.getElementById('reportBtn').disabled = true;
    },

    setStatus(type, msg) {
        const bar = document.getElementById('statusBar');
        bar.className = 'status-bar ' + type;
        document.getElementById('statusText').textContent = msg;
        // Header dot
        document.getElementById('hDot').className = 'h-dot ' + type;
        document.getElementById('hStatusText').textContent = msg;
    },

    showSection(id) {
        const el = document.getElementById(id);
        el.style.display = 'flex';
        el.style.flexDirection = 'row';
    },

    showDICOMMetadata(meta) {
        const panel = document.getElementById('dicomMetadata');
        panel.style.display = 'block';
        document.getElementById('metadataList').innerHTML = Object.entries(meta)
            .map(([k, v]) => `<div class="meta-row"><span class="meta-key">${k}:</span><span class="meta-val">${v || 'N/D'}</span></div>`)
            .join('');
    },

    hideDICOMMetadata() {
        document.getElementById('dicomMetadata').style.display = 'none';
    },

    exportImage() {
        if (!this.results) return;
        const canvas = document.getElementById('processedCanvas');
        const link = document.createElement('a');
        link.download = `ischemia_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    },

    printReport() {
        if (!this.results) return;
        const r = this.results;
        const date = new Date().toLocaleString('es-CO');
        const processedImg = document.getElementById('processedCanvas').toDataURL('image/png');
        const regionsHtml = r.regions.map((reg, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${reg.size.toLocaleString()} px²</td>
                <td>${(reg.size / r.brainArea * 100).toFixed(2)}%</td>
                <td>(${reg.minX}, ${reg.minY})</td>
                <td>${reg.maxX - reg.minX} × ${reg.maxY - reg.minY} px</td>
            </tr>`).join('');

        const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>Reporte — Análisis de Isquemia Cerebral</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
  body { font-family: 'Inter', Arial, sans-serif; max-width: 820px; margin: 0 auto; padding: 36px 30px; color: #1e293b; }
  h1 { font-size: 1.3rem; font-weight: 700; color: #0c4a6e; border-bottom: 2px solid #0077b6; padding-bottom: 10px; margin-bottom: 6px; }
  .meta { font-size:.82rem; color:#64748b; margin-bottom: 22px; }
  h2 { font-size:.9rem; font-weight:700; color:#0077b6; text-transform:uppercase; letter-spacing:.05em; margin: 24px 0 10px; }
  .badge { display:inline-flex; align-items:center; gap:8px; padding:8px 20px; border-radius:6px; font-size:.88rem; font-weight:700; letter-spacing:.03em; }
  .positive { background:#fff0f0; color:#dc2626; border:1.5px solid #dc2626; }
  .negative { background:#f0fff8; color:#16a34a; border:1.5px solid #16a34a; }
  .metrics { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin:16px 0; }
  .m { border:1px solid #e2e8f0; border-radius:8px; padding:12px 14px; background:#f8fafc; }
  .ml { font-size:.65rem; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; margin-bottom:5px; }
  .mv { font-size:1rem; font-weight:700; color:#0c4a6e; font-variant-numeric:tabular-nums; }
  table { width:100%; border-collapse:collapse; font-size:.8rem; margin-top:6px; }
  thead th { background:#0077b6; color:#fff; padding:8px 12px; text-align:left; font-weight:600; font-size:.72rem; text-transform:uppercase; letter-spacing:.05em; }
  tbody td { padding:8px 12px; border-bottom:1px solid #e2e8f0; font-family:monospace; }
  tr:nth-child(even) td { background:#f8fafc; }
  img { max-width:100%; border:1px solid #e2e8f0; border-radius:8px; margin-top:8px; }
  .footer { margin-top:32px; font-size:.72rem; color:#94a3b8; border-top:1px solid #e2e8f0; padding-top:12px; }
</style></head><body>
<h1>Reporte de Análisis de Isquemia Cerebral</h1>
<div class="meta">
  <strong>Fecha:</strong> ${date} &nbsp;&nbsp;
  <strong>Archivo:</strong> ${this.currentFile?.name || 'Desconocido'} &nbsp;&nbsp;
  <strong>Dimensiones:</strong> ${r.width} × ${r.height} px
</div>
<h2>Resultado de Detección</h2>
<div class="badge ${r.hasIschemia ? 'positive' : 'negative'}">
  ${r.hasIschemia ? 'ISQUEMIA DETECTADA' : 'SIN ISQUEMIA DETECTADA'}
</div>
<h2>Métricas Cuantitativas</h2>
<div class="metrics">
  <div class="m"><div class="ml">Área cerebral</div><div class="mv">${r.brainArea.toLocaleString()} px²</div></div>
  <div class="m"><div class="ml">Área isquémica</div><div class="mv">${r.ischemicArea.toLocaleString()} px²</div></div>
  <div class="m"><div class="ml">Tejido comprometido</div><div class="mv">${r.percentage.toFixed(2)}%</div></div>
  <div class="m"><div class="ml">Regiones</div><div class="mv">${r.numRegions}</div></div>
</div>
${r.regions.length ? `
<h2>Detalle de Regiones</h2>
<table><thead><tr><th>N°</th><th>Área (px²)</th><th>% cerebro</th><th>Ubicación</th><th>Dimensiones</th></tr></thead>
<tbody>${regionsHtml}</tbody></table>` : ''}
<h2>Imagen Procesada</h2>
<img src="${processedImg}" alt="Resultado del análisis">
<div class="footer">Generado por Detector de Isquemia Cerebral &mdash; Software de procesamiento de imágenes médicas</div>
</body></html>`;

        const win = window.open('', '_blank');
        win.document.write(html);
        win.document.close();
        win.print();
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
