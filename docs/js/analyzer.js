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

    // Máscara para T1: flood-fill desde los bordes identifica el fondo externo negro;
    // el cerebro = todo lo que no está conectado al borde, incluyendo zonas oscuras internas
    detectBrainMaskFromBorder(gray, width, height) {
        const total = width * height;

        // Umbral de fondo: Otsu × 0.5 para capturar el negro externo sin entrar al tejido
        const hist = this.computeHistogram(gray, width, height, null);
        const bgThresh = this.otsuThreshold(hist, total) * 0.5;

        // Flood-fill desde los cuatro bordes de la imagen
        const bg = new Uint8Array(total);
        const stack = [];
        const visit = (idx) => {
            if (idx >= 0 && idx < total && !bg[idx] && gray[idx] <= bgThresh) {
                bg[idx] = 1; stack.push(idx);
            }
        };
        for (let x = 0; x < width; x++) {
            visit(x); visit((height - 1) * width + x);
        }
        for (let y = 0; y < height; y++) {
            visit(y * width); visit(y * width + width - 1);
        }
        while (stack.length) {
            const idx = stack.pop();
            const x = idx % width, y = Math.floor(idx / width);
            if (x > 0)          visit(idx - 1);
            if (x < width - 1)  visit(idx + 1);
            if (y > 0)          visit(idx - width);
            if (y < height - 1) visit(idx + width);
        }

        // Cerebro = todo lo que no es fondo externo (CSF e isquemia interna incluidos)
        const brain = new Uint8Array(total);
        for (let i = 0; i < total; i++) brain[i] = bg[i] ? 0 : 1;

        // Cierre morfológico para sellar pequeños huecos en el borde de la máscara
        let m = this.dilate(brain, width, height, 4);
        m = this.erode(m, width, height, 4);
        return m;
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
    analyze(imageData, mode = 'auto') {
        const { data, width, height } = imageData;
        const total = width * height;

        // 1. Escala de grises + suavizado
        const gray = this.toGrayscale(imageData);
        const blurred = this.gaussianBlur(gray, width, height);

        // 2. Detección automática del tipo de secuencia mediante histograma
        //    En T1: WM brillante, GM gris, LCR oscuro → distribución equilibrada → ratioBA 0.8–1.3
        //    En T2/FLAIR: LCR brillante → cola hacia valores altos → ratioBA < 0.8
        //    Se excluyen píxeles de fondo negro (≤ 10) para no contaminar la distribución
        let histBajo = 0, histAlto = 0;
        for (let i = 0; i < total; i++) {
            const v = blurred[i];
            if (v <= 10) continue;
            if (v < 128) histBajo++;
            else histAlto++;
        }
        const ratioBA = histAlto > 0 ? histBajo / histAlto : 1.0;
        const esT1 = ratioBA >= 0.8 && ratioBA <= 1.3;
        const modoDeteccion = esT1 ? 'T1 - hipointenso' : 'T2/FLAIR - hiperintenso';

        // 3. Máscara cerebral según tipo detectado
        // T1 oscuro: flood-fill desde borde para incluir zonas oscuras internas
        const brainMask = esT1
            ? this.detectBrainMaskFromBorder(blurred, width, height)
            : this.detectBrainMask(blurred, width, height);
        let brainArea = 0;
        for (let i = 0; i < total; i++) if (brainMask[i]) brainArea++;

        // 3b. Máscara de detección interna: erosión proporcional al cerebro para excluir
        //     el anillo externo (cráneo, meninges, fondo residual, corteza periférica).
        //     T1 usa factor mayor porque la corteza periférica es naturalmente más oscura
        //     y se confunde con anomalías en la comparación hemisférica.
        const erodeRFactor = esT1 ? 0.12 : 0.05;
        const erodeRMin   = esT1 ? 15   : 5;
        const erodeR = Math.max(erodeRMin, Math.min(25, Math.round(Math.sqrt(brainArea / Math.PI) * erodeRFactor)));
        const detectionMask = this.erode(brainMask, width, height, erodeR);

        // 4. Estadísticas sobre la zona interna del cerebro
        // T1: sub-Otsu excluye CSF para que media/std representen WM/GM
        let statsMin = 0;
        if (esT1) {
            const brainHist = this.computeHistogram(blurred, width, height, detectionMask);
            let brainCount = 0;
            for (let i = 0; i < total; i++) if (detectionMask[i]) brainCount++;
            statsMin = this.otsuThreshold(brainHist, brainCount);
        }

        let sum = 0, count = 0;
        for (let i = 0; i < total; i++) {
            if (detectionMask[i] && blurred[i] > statsMin) { sum += blurred[i]; count++; }
        }
        const mean = count ? sum / count : 128;

        let variance = 0;
        for (let i = 0; i < total; i++) {
            if (detectionMask[i] && blurred[i] > statsMin) variance += (blurred[i] - mean) ** 2;
        }
        const std = count ? Math.sqrt(variance / count) : 30;

        // 5. Sensibilidad k = 2.0 fijo
        const k = 2.0;
        const autoK = k;
        const autoKReason = null;

        // 6. Detección de isquemia con referencia cruzada hemisférica
        const ischemiaRaw = new Uint8Array(total);
        const mitad = Math.floor(width / 2);

        if (esT1) {
            // T1: buscar zonas HIPOINTENSAS (oscuras) — hemisferio izquierdo vs referencia derecha y viceversa.
            // Solo píxeles de tejido real (> statsMin) para excluir CSF y fondo residual.
            let sumIzq = 0, countIzq = 0, sumDer = 0, countDer = 0;

            for (let i = 0; i < total; i++) {
                if (!detectionMask[i] || blurred[i] <= statsMin) continue;
                const x = i % width;
                if (x < mitad) { sumIzq += blurred[i]; countIzq++; }
                else            { sumDer += blurred[i]; countDer++; }
            }

            const meanIzqD = countIzq ? sumIzq / countIzq : 128;
            const meanDerD = countDer ? sumDer / countDer : 128;

            let varIzq = 0, varDer = 0;
            for (let i = 0; i < total; i++) {
                if (!detectionMask[i] || blurred[i] <= statsMin) continue;
                const x = i % width;
                if (x < mitad) varIzq += (blurred[i] - meanIzqD) ** 2;
                else           varDer += (blurred[i] - meanDerD) ** 2;
            }
            const stdIzqD = countIzq ? Math.sqrt(varIzq / countIzq) : 30;
            const stdDerD = countDer ? Math.sqrt(varDer / countDer) : 30;

            // Hemisferio izquierdo → referencia: derecho; derecho → referencia: izquierdo
            for (let i = 0; i < total; i++) {
                if (!detectionMask[i]) continue;
                const x = i % width;
                if (x < mitad) {
                    ischemiaRaw[i] = blurred[i] < meanDerD - k * stdDerD ? 1 : 0;
                } else {
                    ischemiaRaw[i] = blurred[i] < meanIzqD - k * stdIzqD ? 1 : 0;
                }
            }
        } else {
            // T2/FLAIR: buscar zonas HIPERINTENSAS (brillantes) — cada lado vs el opuesto como referencia sana.
            // Resuelve el caso en que una lesión grande eleva el promedio global e impide la detección.
            let sumIzq = 0, countIzq = 0, sumDer = 0, countDer = 0;

            for (let i = 0; i < total; i++) {
                if (!brainMask[i]) continue;
                const x = i % width;
                if (x < mitad) { sumIzq += blurred[i]; countIzq++; }
                else            { sumDer += blurred[i]; countDer++; }
            }

            const meanIzq = countIzq ? sumIzq / countIzq : 128;
            const meanDer = countDer ? sumDer / countDer : 128;

            let varIzq = 0, varDer = 0;
            for (let i = 0; i < total; i++) {
                if (!brainMask[i]) continue;
                const x = i % width;
                if (x < mitad) varIzq += (blurred[i] - meanIzq) ** 2;
                else           varDer += (blurred[i] - meanDer) ** 2;
            }
            const stdIzq = countIzq ? Math.sqrt(varIzq / countIzq) : 30;
            const stdDer = countDer ? Math.sqrt(varDer / countDer) : 30;

            // Hemisferio izquierdo → referencia: derecho; derecho → referencia: izquierdo
            for (let i = 0; i < total; i++) {
                if (!brainMask[i]) continue;
                const x = i % width;
                if (x < mitad) {
                    ischemiaRaw[i] = blurred[i] > meanDer + k * stdDer ? 1 : 0;
                } else {
                    ischemiaRaw[i] = blurred[i] > meanIzq + k * stdIzq ? 1 : 0;
                }
            }
        }

        // 7. Solo dilatación leve: se omite la erosión para no destruir lesiones pequeñas
        //    El filtro por tamaño mínimo en CC reemplaza la función anti-ruido de la erosión
        let cleaned = this.dilate(ischemiaRaw, width, height, 1);

        // 8. Componentes conectados + filtro por tamaño mínimo
        const { labels, sizes } = this.connectedComponents(cleaned, width, height);
        const minSize = Math.max(15, brainArea * 0.0003);
        const valid = sizes.filter(s => s.size >= minSize);

        // 9. Máscara final y bounding boxes
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
            autoKReason,
            mode: esT1 ? 'dark' : 'bright',
            esT1,
            ratioBA: Math.round(ratioBA * 100) / 100,
            modoDeteccion
        };

        return this.results;
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
