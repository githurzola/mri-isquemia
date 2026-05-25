/**
 * analyzer.js - Algoritmo de detección de isquemia cerebral en MRI
 * Utiliza umbralización estadística adaptativa sobre la región cerebral
 */

class IschemiaAnalyzer {
    constructor() {
        this.results = null;
    }

    // Convierte RGBA a escala de grises
    toGrayscale(imageData) {
        const { data, width, height } = imageData;
        const gray = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
            gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
        }
        return gray;
    }

    // Kernel gaussiano 5x5
    gaussianBlur(gray, width, height) {
        const kernel = [
            [2,  4,  5,  4,  2],
            [4,  9, 12,  9,  4],
            [5, 12, 15, 12,  5],
            [4,  9, 12,  9,  4],
            [2,  4,  5,  4,  2]
        ];
        const result = new Float32Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0, wSum = 0;
                for (let ky = -2; ky <= 2; ky++) {
                    for (let kx = -2; kx <= 2; kx++) {
                        const ny = y + ky, nx = x + kx;
                        if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
                            const w = kernel[ky + 2][kx + 2];
                            sum += gray[ny * width + nx] * w;
                            wSum += w;
                        }
                    }
                }
                result[y * width + x] = sum / wSum;
            }
        }
        return result;
    }

    // Calcula histograma (opcionalmente sobre máscara)
    computeHistogram(gray, width, height, mask) {
        const hist = new Array(256).fill(0);
        for (let i = 0; i < width * height; i++) {
            if (!mask || mask[i]) {
                const v = Math.min(255, Math.max(0, Math.floor(gray[i])));
                hist[v]++;
            }
        }
        return hist;
    }

    // Umbral de Otsu
    otsuThreshold(hist, total) {
        let sumAll = 0;
        for (let i = 0; i < 256; i++) sumAll += i * hist[i];
        let sumB = 0, wB = 0, best = 0, bestVar = 0;
        for (let t = 0; t < 256; t++) {
            wB += hist[t];
            if (!wB) continue;
            const wF = total - wB;
            if (!wF) break;
            sumB += t * hist[t];
            const mB = sumB / wB;
            const mF = (sumAll - sumB) / wF;
            const v = (wB * wF * (mB - mF) ** 2) / (total * total);
            if (v > bestVar) { bestVar = v; best = t; }
        }
        return best;
    }

    // Dilatación morfológica
    dilate(mask, width, height, r = 1) {
        const out = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let found = false;
                for (let ky = -r; ky <= r && !found; ky++) {
                    for (let kx = -r; kx <= r && !found; kx++) {
                        const ny = y + ky, nx = x + kx;
                        if (ny >= 0 && ny < height && nx >= 0 && nx < width && mask[ny * width + nx]) found = true;
                    }
                }
                out[y * width + x] = found ? 1 : 0;
            }
        }
        return out;
    }

    // Erosión morfológica
    erode(mask, width, height, r = 1) {
        const out = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let all = true;
                outer: for (let ky = -r; ky <= r; ky++) {
                    for (let kx = -r; kx <= r; kx++) {
                        const ny = y + ky, nx = x + kx;
                        if (ny < 0 || ny >= height || nx < 0 || nx >= width || !mask[ny * width + nx]) {
                            all = false; break outer;
                        }
                    }
                }
                out[y * width + x] = all ? 1 : 0;
            }
        }
        return out;
    }

    // Flood fill iterativo (evita stack overflow)
    floodFill(mask, width, height, sx, sy, label, labels) {
        const stack = [sy * width + sx];
        let count = 0;
        while (stack.length) {
            const idx = stack.pop();
            if (idx < 0 || idx >= width * height) continue;
            if (!mask[idx] || labels[idx] !== 0) continue;
            labels[idx] = label;
            count++;
            const x = idx % width, y = Math.floor(idx / width);
            if (x > 0)         stack.push(idx - 1);
            if (x < width - 1) stack.push(idx + 1);
            if (y > 0)         stack.push(idx - width);
            if (y < height - 1) stack.push(idx + width);
        }
        return count;
    }

    // Análisis de componentes conectados
    connectedComponents(mask, width, height) {
        const labels = new Int32Array(width * height);
        const sizes = [];
        let n = 0;
        for (let i = 0; i < width * height; i++) {
            if (mask[i] && labels[i] === 0) {
                n++;
                const x = i % width, y = Math.floor(i / width);
                const size = this.floodFill(mask, width, height, x, y, n, labels);
                sizes.push({ label: n, size });
            }
        }
        return { labels, sizes };
    }

    // Detecta la máscara del cerebro (separa cerebro del fondo)
    detectBrainMask(gray, width, height) {
        const hist = this.computeHistogram(gray, width, height, null);
        const total = width * height;
        let thresh = this.otsuThreshold(hist, total);
        thresh = Math.max(thresh * 0.4, 10); // umbral más permisivo para incluir tejido cerebral

        const mask = new Uint8Array(total);
        for (let i = 0; i < total; i++) {
            mask[i] = gray[i] > thresh ? 1 : 0;
        }

        // Cierre morfológico para rellenar huecos
        let m = this.dilate(mask, width, height, 4);
        m = this.erode(m, width, height, 4);

        // Componente más grande = cerebro
        const { labels, sizes } = this.connectedComponents(m, width, height);
        if (!sizes.length) return mask;
        sizes.sort((a, b) => b.size - a.size);
        const brainLabel = sizes[0].label;

        const brain = new Uint8Array(total);
        for (let i = 0; i < total; i++) brain[i] = labels[i] === brainLabel ? 1 : 0;

        return this.dilate(brain, width, height, 3);
    }

    // Análisis principal
    analyze(imageData, sensitivity = null, mode = 'bright') {
        const { data, width, height } = imageData;
        const total = width * height;

        // 1. Escala de grises + suavizado
        const gray = this.toGrayscale(imageData);
        const blurred = this.gaussianBlur(gray, width, height);

        // 2. Máscara cerebral
        const brainMask = this.detectBrainMask(blurred, width, height);
        let brainArea = 0;
        for (let i = 0; i < total; i++) if (brainMask[i]) brainArea++;

        // 3. Estadísticas dentro del cerebro
        let sum = 0, count = 0;
        for (let i = 0; i < total; i++) {
            if (brainMask[i]) { sum += blurred[i]; count++; }
        }
        const mean = count ? sum / count : 128;

        let variance = 0;
        for (let i = 0; i < total; i++) {
            if (brainMask[i]) variance += (blurred[i] - mean) ** 2;
        }
        const std = count ? Math.sqrt(variance / count) : 30;

        // 4. Determinar k: automático según estadísticas o manual desde parámetro
        let k, autoK, autoKReason;
        if (sensitivity === null) {
            const brainPixels = new Float32Array(count);
            let j = 0;
            for (let i = 0; i < total; i++) {
                if (brainMask[i]) brainPixels[j++] = blurred[i];
            }
            const res = this._calcAutoK(brainPixels, mean, std);
            k = res.k; autoK = res.k; autoKReason = res.reason;
        } else {
            k = sensitivity; autoK = sensitivity; autoKReason = null;
        }

        // 5. Detección de isquemia por umbral estadístico
        const ischemiaRaw = new Uint8Array(total);
        for (let i = 0; i < total; i++) {
            if (!brainMask[i]) continue;
            if (mode === 'bright') {
                ischemiaRaw[i] = blurred[i] > mean + k * std ? 1 : 0;
            } else {
                ischemiaRaw[i] = blurred[i] < mean - k * std ? 1 : 0;
            }
        }

        // 6. Apertura morfológica (elimina ruido pequeño)
        let cleaned = this.erode(ischemiaRaw, width, height, 1);
        cleaned = this.dilate(cleaned, width, height, 2);

        // 7. Componentes conectados + filtro por tamaño mínimo
        const { labels, sizes } = this.connectedComponents(cleaned, width, height);
        const minSize = Math.max(30, brainArea * 0.0005);
        const valid = sizes.filter(s => s.size >= minSize);

        // 8. Máscara final y bounding boxes
        const finalMask = new Uint8Array(total);
        const validSet = new Set(valid.map(v => v.label));
        let ischemicArea = 0;

        const boxes = {};
        for (let i = 0; i < total; i++) {
            if (validSet.has(labels[i])) {
                finalMask[i] = 1;
                ischemicArea++;
                const lbl = labels[i];
                const x = i % width, y = Math.floor(i / width);
                if (!boxes[lbl]) boxes[lbl] = { minX: x, maxX: x, minY: y, maxY: y, size: 0 };
                boxes[lbl].minX = Math.min(boxes[lbl].minX, x);
                boxes[lbl].maxX = Math.max(boxes[lbl].maxX, x);
                boxes[lbl].minY = Math.min(boxes[lbl].minY, y);
                boxes[lbl].maxY = Math.max(boxes[lbl].maxY, y);
                boxes[lbl].size++;
            }
        }

        const regions = valid.map(v => ({ ...boxes[v.label] }));
        const percentage = brainArea > 0 ? (ischemicArea / brainArea) * 100 : 0;

        this.results = {
            hasIschemia: ischemicArea > 0,
            ischemicArea,
            brainArea,
            percentage,
            numRegions: valid.length,
            regions,
            brainMask,
            finalMask,
            mean: Math.round(mean),
            std: Math.round(std),
            width,
            height,
            autoK,
            autoKReason
        };

        return this.results;
    }

    // Calcula k automáticamente según las características estadísticas del tejido cerebral
    _calcAutoK(pixels, mean, std) {
        const n = pixels.length;
        if (n < 10 || std < 1) return { k: 2.0, reason: { cv: 0, skewness: 0, kurtosis: 0, kBase: 2.0 } };

        const cv = mean > 0 ? std / mean : 0;

        // Skewness = mean((x-μ)³) / σ³  y  Kurtosis = mean((x-μ)⁴) / σ⁴ - 3
        let sum3 = 0, sum4 = 0;
        for (let i = 0; i < n; i++) {
            const z = (pixels[i] - mean) / std;
            const z2 = z * z;
            sum3 += z2 * z;
            sum4 += z2 * z2;
        }
        const skewness = sum3 / n;
        const kurtosis  = sum4 / n - 3;

        // k_base según coeficiente de variación: CV alto → imagen heterogénea → k más alto
        let kBase;
        if (cv > 0.5)       kBase = 3.0;
        else if (cv > 0.35) kBase = 2.5;
        else if (cv > 0.20) kBase = 2.0;
        else                kBase = 1.6;

        // Ajuste por skewness: cola hacia brillantes → más píxeles naturalmente altos → subir k
        if (skewness > 1.5)       kBase += 0.4;
        else if (skewness > 0.5)  kBase += 0.2;
        else if (skewness < -0.5) kBase -= 0.2;

        // Ajuste por kurtosis: muchos valores extremos → subir k para ignorar outliers
        if (kurtosis > 3)      kBase += 0.3;
        else if (kurtosis > 1) kBase += 0.1;

        const kFinal = Math.max(1.5, Math.min(3.5, kBase));

        return {
            k: kFinal,
            reason: {
                cv:       parseFloat(cv.toFixed(3)),
                skewness: parseFloat(skewness.toFixed(3)),
                kurtosis: parseFloat(kurtosis.toFixed(3)),
                kBase:    parseFloat(kBase.toFixed(3))
            }
        };
    }

    // Genera imagen con overlay coloreado
    generateOverlay(imageData, results, color = [255, 60, 60]) {
        const { data, width, height } = imageData;
        const out = new ImageData(width, height);
        const d = out.data;

        // Copia imagen original
        for (let i = 0; i < data.length; i++) d[i] = data[i];

        // Overlay semitransparente en regiones isquémicas
        const alpha = 0.65;
        for (let i = 0; i < width * height; i++) {
            if (results.finalMask[i]) {
                d[i * 4]     = Math.round(d[i * 4]     * (1 - alpha) + color[0] * alpha);
                d[i * 4 + 1] = Math.round(d[i * 4 + 1] * (1 - alpha) + color[1] * alpha);
                d[i * 4 + 2] = Math.round(d[i * 4 + 2] * (1 - alpha) + color[2] * alpha);
            }
        }

        // Dibuja contorno (borde de la región isquémica)
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                if (!results.finalMask[idx]) continue;
                const isEdge = !results.finalMask[(y-1)*width+x] ||
                               !results.finalMask[(y+1)*width+x] ||
                               !results.finalMask[y*width+x-1]   ||
                               !results.finalMask[y*width+x+1];
                if (isEdge) {
                    d[idx * 4]     = 255;
                    d[idx * 4 + 1] = 255;
                    d[idx * 4 + 2] = 0;
                    d[idx * 4 + 3] = 255;
                }
            }
        }

        return out;
    }

    // Genera imagen de máscara cerebral (para debug/visualización)
    generateBrainMaskImage(imageData, results) {
        const { width, height } = imageData;
        const out = new ImageData(width, height);
        const d = out.data;
        const gray = this.toGrayscale(imageData);

        for (let i = 0; i < width * height; i++) {
            const v = results.brainMask[i] ? Math.floor(gray[i]) : 0;
            d[i * 4]     = v;
            d[i * 4 + 1] = v;
            d[i * 4 + 2] = v;
            d[i * 4 + 3] = 255;
        }
        return out;
    }
}
