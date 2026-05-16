/**
 * dicom-handler.js - Manejo de archivos DICOM para visualización en el navegador
 * Requiere la librería dicom-parser (CDN)
 */

class DICOMHandler {
    constructor() {
        this.dataset = null;
        this.width = 0;
        this.height = 0;
        this.pixelData = null;
        this.pixelSpacing = null;
        this.metadata = {};
    }

    async loadFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const byteArray = new Uint8Array(e.target.result);
                    this.dataset = dicomParser.parseDicom(byteArray);
                    this._extractMetadata();
                    this._extractPixelData();
                    resolve(this._toImageData());
                } catch (err) {
                    reject(new Error('Error al parsear DICOM: ' + err.message));
                }
            };
            reader.onerror = () => reject(new Error('Error leyendo archivo'));
            reader.readAsArrayBuffer(file);
        });
    }

    _safeGet(tag, method = 'string', fallback = null) {
        try {
            return this.dataset[method](tag) ?? fallback;
        } catch {
            return fallback;
        }
    }

    _extractMetadata() {
        const ds = this.dataset;
        this.width  = this._safeGet('x00280011', 'uint16', 512);
        this.height = this._safeGet('x00280010', 'uint16', 512);
        this.bitsAllocated     = this._safeGet('x00280100', 'uint16', 16);
        this.bitsStored        = this._safeGet('x00280101', 'uint16', 16);
        this.pixelRepresentation = this._safeGet('x00280103', 'uint16', 0);
        this.samplesPerPixel   = this._safeGet('x00280002', 'uint16', 1);
        this.photometric       = (this._safeGet('x00280004', 'string', 'MONOCHROME2') || 'MONOCHROME2').trim();
        this.rescaleSlope      = parseFloat(this._safeGet('x00281053', 'string', '1')) || 1;
        this.rescaleIntercept  = parseFloat(this._safeGet('x00281052', 'string', '0')) || 0;

        // Window/level
        try { this.windowCenter = ds.float32('x00281050'); } catch { this.windowCenter = null; }
        try { this.windowWidth  = ds.float32('x00281051'); } catch { this.windowWidth  = null; }

        // Pixel spacing: mm por pixel (para calcular área real)
        try {
            const ps = ds.string('x00280030');
            if (ps) {
                const parts = ps.split('\\');
                this.pixelSpacing = [parseFloat(parts[0]), parseFloat(parts[1] || parts[0])];
            }
        } catch { this.pixelSpacing = null; }

        // Metadatos informativos
        this.metadata = {
            'Paciente':        this._safeGet('x00100010', 'string', 'Anónimo'),
            'ID Paciente':     this._safeGet('x00100020', 'string', 'N/D'),
            'Fecha Estudio':   this._formatDate(this._safeGet('x00080020', 'string', '')),
            'Modalidad':       this._safeGet('x00080060', 'string', 'MR'),
            'Descripción':     this._safeGet('x00081030', 'string', 'N/D'),
            'Institución':     this._safeGet('x00080080', 'string', 'N/D'),
            'Fabricante':      this._safeGet('x00080070', 'string', 'N/D'),
            'Dimensiones':     `${this.width} × ${this.height} px`,
            'Profundidad':     `${this.bitsAllocated} bits`,
        };
        if (this.pixelSpacing) {
            this.metadata['Espaciado píxel'] = `${this.pixelSpacing[0].toFixed(3)} × ${this.pixelSpacing[1].toFixed(3)} mm`;
        }
    }

    _formatDate(dateStr) {
        if (!dateStr || dateStr.length < 8) return dateStr || 'N/D';
        return `${dateStr.slice(6,8)}/${dateStr.slice(4,6)}/${dateStr.slice(0,4)}`;
    }

    _extractPixelData() {
        const el = this.dataset.elements['x7fe00010'];
        if (!el) throw new Error('Sin datos de píxel en el archivo DICOM');

        const n = this.width * this.height;
        const buf = this.dataset.byteArray.buffer;
        const offset = el.dataOffset;

        if (this.bitsAllocated === 16) {
            this.pixelData = this.pixelRepresentation === 1
                ? new Int16Array(buf, offset, n)
                : new Uint16Array(buf, offset, n);
        } else {
            this.pixelData = new Uint8Array(buf, offset, n);
        }
    }

    _applyWindowing(value, center, width) {
        const lo = center - width / 2;
        const hi = center + width / 2;
        if (value <= lo) return 0;
        if (value >= hi) return 255;
        return Math.round((value - lo) / width * 255);
    }

    _toImageData() {
        const n = this.width * this.height;

        // Aplicar rescale y encontrar rango
        const raw = new Float32Array(n);
        let minV = Infinity, maxV = -Infinity;
        for (let i = 0; i < n; i++) {
            const v = this.pixelData[i] * this.rescaleSlope + this.rescaleIntercept;
            raw[i] = v;
            if (v < minV) minV = v;
            if (v > maxV) maxV = v;
        }

        // Window/level automático si no está en los metadatos
        let wC = this.windowCenter;
        let wW = this.windowWidth;
        if (!wC || !wW || wW <= 0) {
            wW = maxV - minV;
            wC = (maxV + minV) / 2;
        }

        const imageData = new ImageData(this.width, this.height);
        const d = imageData.data;
        for (let i = 0; i < n; i++) {
            let v = this._applyWindowing(raw[i], wC, wW);
            if (this.photometric === 'MONOCHROME1') v = 255 - v;
            d[i * 4]     = v;
            d[i * 4 + 1] = v;
            d[i * 4 + 2] = v;
            d[i * 4 + 3] = 255;
        }
        return imageData;
    }

    // Área en cm² dado número de píxeles isquémicos
    pixelsToArea(pixels) {
        if (!this.pixelSpacing) return null;
        const areaPerPixel = (this.pixelSpacing[0] * this.pixelSpacing[1]) / 100; // mm² → cm²
        return (pixels * areaPerPixel).toFixed(2);
    }

    getMetadata() {
        return this.metadata;
    }
}
