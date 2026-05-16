const App = {
    originalImageData: null,
    currentFile: null,
    dicomHandler: null,
    analyzer: new IschemiaAnalyzer(),
    results: null,
    activeView: 'overlay',

    init() {
        this.bindEvents();
        this.updateSlider();
    },

    bindEvents() {
        document.getElementById('fileInput').addEventListener('change', e => {
            if (e.target.files[0]) this.loadFile(e.target.files[0]);
        });

        const dz = document.getElementById('dropZone');
        dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
        dz.addEventListener('drop', e => {
            e.preventDefault();
            dz.classList.remove('drag-over');
            if (e.dataTransfer.files[0]) this.loadFile(e.dataTransfer.files[0]);
        });
        dz.addEventListener('click', () => document.getElementById('fileInput').click());

        document.getElementById('sensitivitySlider').addEventListener('input', () => this.updateSlider());
        document.getElementById('analyzeBtn').addEventListener('click', () => this.analyze());

        document.querySelectorAll('.vtab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.vtab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeView = btn.dataset.view;
                this.renderActiveView();
            });
        });

        document.getElementById('exportBtn').addEventListener('click', () => this.exportImage());
        document.getElementById('reportBtn').addEventListener('click', () => this.printReport());
    },

    updateSlider() {
        const v = parseFloat(document.getElementById('sensitivitySlider').value);
        document.getElementById('sensitivityValue').textContent = v.toFixed(1);
    },

    async loadFile(file) {
        this.currentFile = file;
        const ext = file.name.split('.').pop().toLowerCase();
        this.setStatus('loading', 'Cargando imagen...');
        document.getElementById('welcome').style.display = 'none';

        const sec = document.getElementById('imgSection');
        sec.style.display = 'flex';

        try {
            let imageData;
            if (ext === 'dcm' || ext === 'dicom') {
                if (typeof dicomParser === 'undefined') throw new Error('Librería DICOM no disponible.');
                this.dicomHandler = new DICOMHandler();
                imageData = await this.dicomHandler.loadFromFile(file);
                this.showMeta(this.dicomHandler.getMetadata());
            } else {
                imageData = await this.loadImg(file);
                this.dicomHandler = null;
                document.getElementById('dicomMeta').style.display = 'none';
            }

            this.originalImageData = imageData;
            this.renderCanvas('originalCanvas', imageData);
            this.clearProcessed();

            const ok = document.getElementById('fileOk');
            ok.style.display = 'flex';
            document.getElementById('fileName').textContent =
                `${file.name} — ${imageData.width}×${imageData.height} px`;

            this.setStatus('ready', `Imagen cargada: ${file.name} (${imageData.width}×${imageData.height} px)`);
            document.getElementById('analyzeBtn').disabled = false;

        } catch (err) {
            this.setStatus('error', 'Error: ' + err.message);
        }
    },

    loadImg(file) {
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

        this.setStatus('processing', 'Analizando imagen...');
        this.setBtnLoading(true);
        this.setScan(true);

        setTimeout(() => {
            try {
                this.results = this.analyzer.analyze(this.originalImageData, sensitivity, mode);
                this.setScan(false);
                this.showResults();
                this.renderActiveView();
                document.getElementById('exportBtn').disabled = false;
                document.getElementById('reportBtn').disabled = false;
                this.setStatus('done', this.results.hasIschemia
                    ? `Análisis completado — ${this.results.numRegions} región(es) isquémica(s) detectada(s)`
                    : 'Análisis completado — sin evidencia de isquemia');
            } catch (err) {
                this.setScan(false);
                this.setStatus('error', 'Error: ' + err.message);
            }
            this.setBtnLoading(false);
        }, 60);
    },

    setBtnLoading(on) {
        const btn = document.getElementById('analyzeBtn');
        const icon = document.getElementById('btnIcon');
        const text = document.getElementById('btnText');
        btn.disabled = on;
        if (on) {
            icon.setAttribute('class', 'spin-icon');
            icon.innerHTML = '<circle cx="12" cy="12" r="9" stroke-width="2.5" stroke-dasharray="28" stroke-dashoffset="8" opacity=".4"/><path d="M12 3a9 9 0 0 1 9 9" stroke-width="2.5"/>';
            text.textContent = 'Procesando...';
        } else {
            icon.setAttribute('class', '');
            icon.innerHTML = '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>';
            text.textContent = 'Ejecutar análisis';
        }
    },

    setScan(on) {
        document.getElementById('scanline').className = on ? 'scanline on' : 'scanline';
    },

    // Anima un número de 0 al valor objetivo
    animNum(el, target, decimals, suffix, dur = 850) {
        const start = performance.now();
        el.dataset.raw = target;
        const tick = now => {
            const p = Math.min((now - start) / dur, 1);
            const ease = 1 - Math.pow(1 - p, 3);
            el.textContent = (target * ease).toFixed(decimals) + suffix;
            if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    },

    showResults() {
        const r = this.results;
        const panel = document.getElementById('results');
        panel.style.display = 'block';

        // Badge
        const badge = document.getElementById('detBadge');
        const checkSVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
        const warnSVG  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
        badge.style.animation = 'none'; badge.offsetHeight; badge.style.animation = '';
        if (r.hasIschemia) {
            badge.className = 'detection-badge positive';
            badge.innerHTML = `${warnSVG} ISQUEMIA DETECTADA`;
        } else {
            badge.className = 'detection-badge negative';
            badge.innerHTML = `${checkSVG} SIN ISQUEMIA DETECTADA`;
        }

        // Porcentaje bar
        const pct = Math.min(r.percentage, 100);
        const fill = document.getElementById('pctFill');
        fill.style.width = '0%';
        fill.style.background = pct < 5 ? 'var(--success)' : pct < 20 ? 'var(--warn)' : 'var(--danger)';
        setTimeout(() => { fill.style.width = pct + '%'; }, 80);
        this.animNum(document.getElementById('pctNum'), pct, 1, '%', 900);

        // Métricas con contador
        const brainCm2 = this.dicomHandler?.pixelsToArea(r.brainArea);
        const ischCm2  = this.dicomHandler?.pixelsToArea(r.ischemicArea);

        setTimeout(() => {
            const brainEl = document.getElementById('mBrain');
            const ischEl  = document.getElementById('mIsch');
            const pctEl   = document.getElementById('mPct');
            const regEl   = document.getElementById('mReg');

            this.animNum(brainEl, r.brainArea,    0, brainCm2 ? ` px (${brainCm2} cm²)` : ' px²');
            this.animNum(ischEl,  r.ischemicArea, 0, ischCm2  ? ` px (${ischCm2} cm²)`  : ' px²');
            this.animNum(pctEl,   r.percentage,   2, '%', 750);
            this.animNum(regEl,   r.numRegions,   0, '', 400);
        }, 100);

        // Tabla
        const tbody = document.getElementById('regionsBody');
        tbody.innerHTML = '';
        if (!r.regions.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="td-empty">Sin regiones detectadas</td></tr>';
        } else {
            r.regions.forEach((reg, i) => {
                const w = reg.maxX - reg.minX, h = reg.maxY - reg.minY;
                const tr = document.createElement('tr');
                tr.style.cssText = `animation: fadeUp .3s ease ${i * .055}s both`;
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
        let imgData;
        if      (this.activeView === 'overlay') imgData = this.analyzer.generateOverlay(this.originalImageData, this.results);
        else if (this.activeView === 'mask')    imgData = this.buildMask();
        else                                    imgData = this.analyzer.generateBrainMaskImage(this.originalImageData, this.results);

        const canvas = document.getElementById('processedCanvas');
        canvas.style.opacity = '0';
        this.renderCanvas('processedCanvas', imgData);
        requestAnimationFrame(() => { canvas.style.opacity = '1'; });

        if (this.results.hasIschemia && this.activeView === 'overlay') {
            setTimeout(() => this.drawBoxes(canvas), 40);
        }
    },

    buildMask() {
        const { width, height } = this.originalImageData;
        const out = new ImageData(width, height);
        const d = out.data;
        const gray = this.analyzer.toGrayscale(this.originalImageData);
        for (let i = 0; i < width * height; i++) {
            if (this.results.finalMask[i]) {
                d[i*4] = 220; d[i*4+1] = 50; d[i*4+2] = 50; d[i*4+3] = 255;
            } else {
                const v = Math.floor(gray[i] * .28);
                d[i*4] = v; d[i*4+1] = v; d[i*4+2] = v; d[i*4+3] = 255;
            }
        }
        return out;
    },

    renderCanvas(id, imageData) {
        const canvas = document.getElementById(id);
        const box = canvas.parentElement;
        const maxW = box.clientWidth  - 28;
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

    drawBoxes(canvas) {
        if (!this.results?.regions?.length) return;
        const ctx = canvas.getContext('2d');
        const s = parseFloat(canvas.dataset.scale) || 1;
        ctx.strokeStyle = 'rgba(0,205,205,.85)';
        ctx.lineWidth = 1.5;
        ctx.fillStyle = 'rgba(0,205,205,.85)';
        ctx.font = `${Math.max(9, 11 * s)}px "JetBrains Mono", monospace`;
        this.results.regions.forEach((r, i) => {
            const x = r.minX * s, y = r.minY * s;
            const w = (r.maxX - r.minX) * s, h = (r.maxY - r.minY) * s;
            ctx.strokeRect(x, y, w, h);
            ctx.fillText(`R${i + 1}`, x + 3, y > 14 ? y - 4 : y + 12);
        });
    },

    clearProcessed() {
        const canvas = document.getElementById('processedCanvas');
        canvas.width = 300; canvas.height = 200;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#080c11';
        ctx.fillRect(0, 0, 300, 200);
        ctx.fillStyle = '#2d3748';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Ejecute el análisis para ver el resultado', 150, 100);
        ctx.textAlign = 'left';
        document.getElementById('results').style.display = 'none';
        document.getElementById('exportBtn').disabled = true;
        document.getElementById('reportBtn').disabled = true;
    },

    setStatus(type, msg) {
        const bar = document.getElementById('statusBar');
        bar.className = 'statusbar ' + type;
        document.getElementById('statusText').textContent = msg;
        document.getElementById('hDot').className  = 'hstatus-dot ' + type;
        document.getElementById('hText').textContent = msg;
    },

    showMeta(meta) {
        const panel = document.getElementById('dicomMeta');
        panel.style.display = 'block';
        document.getElementById('metaList').innerHTML = Object.entries(meta)
            .map(([k, v]) => `<div class="meta-row"><span class="meta-k">${k}:</span><span class="meta-v">${v || 'N/D'}</span></div>`)
            .join('');
    },

    exportImage() {
        if (!this.results) return;
        const a = document.createElement('a');
        a.download = `isquemia_${Date.now()}.png`;
        a.href = document.getElementById('processedCanvas').toDataURL('image/png');
        a.click();
    },

    printReport() {
        if (!this.results) return;
        const r = this.results;
        const date = new Date().toLocaleString('es-CO');
        const img  = document.getElementById('processedCanvas').toDataURL('image/png');
        const rows = r.regions.map((reg, i) => `<tr>
            <td>${i+1}</td><td>${reg.size.toLocaleString()} px²</td>
            <td>${(reg.size/r.brainArea*100).toFixed(2)}%</td>
            <td>(${reg.minX}, ${reg.minY})</td>
            <td>${reg.maxX-reg.minX} × ${reg.maxY-reg.minY} px</td></tr>`).join('');

        const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Reporte — Isquemia Cerebral</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
  body{font-family:'Inter',Arial,sans-serif;max-width:800px;margin:0 auto;padding:36px 28px;color:#1e293b}
  h1{font-size:1.2rem;font-weight:700;color:#0c4a6e;border-bottom:2px solid #0077b6;padding-bottom:10px;margin-bottom:6px}
  .meta{font-size:.78rem;color:#64748b;margin-bottom:22px}
  h2{font-size:.82rem;font-weight:700;color:#0077b6;text-transform:uppercase;letter-spacing:.05em;margin:22px 0 9px}
  .badge{display:inline-flex;align-items:center;gap:7px;padding:6px 16px;border-radius:5px;font-size:.82rem;font-weight:700}
  .pos{background:#fff0f0;color:#dc2626;border:1.5px solid #dc2626}
  .neg{background:#f0fff8;color:#16a34a;border:1.5px solid #16a34a}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}
  .card{border:1px solid #e2e8f0;border-radius:7px;padding:11px 13px;background:#f8fafc}
  .cl{font-size:.62rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-bottom:4px}
  .cv{font-size:.95rem;font-weight:700;color:#0c4a6e;font-variant-numeric:tabular-nums}
  table{width:100%;border-collapse:collapse;font-size:.78rem}
  th{background:#0077b6;color:#fff;padding:7px 11px;text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.05em}
  td{padding:7px 11px;border-bottom:1px solid #e2e8f0;font-family:monospace}
  tr:nth-child(even) td{background:#f8fafc}
  img{max-width:100%;border:1px solid #e2e8f0;border-radius:7px;margin-top:8px}
  .foot{margin-top:30px;font-size:.7rem;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:10px}
</style></head><body>
<h1>Reporte de Análisis de Isquemia Cerebral</h1>
<div class="meta"><strong>Fecha:</strong> ${date} &nbsp; <strong>Archivo:</strong> ${this.currentFile?.name||'—'} &nbsp; <strong>Dim.:</strong> ${r.width}×${r.height} px</div>
<h2>Resultado</h2>
<div class="badge ${r.hasIschemia?'pos':'neg'}">${r.hasIschemia?'ISQUEMIA DETECTADA':'SIN ISQUEMIA DETECTADA'}</div>
<h2>Métricas</h2>
<div class="grid">
  <div class="card"><div class="cl">Área cerebral</div><div class="cv">${r.brainArea.toLocaleString()} px²</div></div>
  <div class="card"><div class="cl">Área isquémica</div><div class="cv">${r.ischemicArea.toLocaleString()} px²</div></div>
  <div class="card"><div class="cl">Comprometido</div><div class="cv">${r.percentage.toFixed(2)}%</div></div>
  <div class="card"><div class="cl">Regiones</div><div class="cv">${r.numRegions}</div></div>
</div>
${r.regions.length?`<h2>Regiones detectadas</h2>
<table><thead><tr><th>N°</th><th>Área (px²)</th><th>%</th><th>Ubicación</th><th>Dimensiones</th></tr></thead>
<tbody>${rows}</tbody></table>`:''}
<h2>Imagen procesada</h2><img src="${img}" alt="Resultado">
<div class="foot">Detector de Isquemia Cerebral — Procesamiento de imágenes médicas</div>
</body></html>`;

        const win = window.open('', '_blank');
        win.document.write(html);
        win.document.close();
        win.print();
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
