/**
 * FaceDetector Module for School Record (생기부) Photo Cropper
 * - Uses Shape Detection API (window.FaceDetector) when available
 * - Falls back to bundled Pico.js (100% offline, client-side, zero-telemetry)
 */
(function(window) {
  'use strict';

  let picoClassifier = null;
  let isInitialized = false;

  function base64ToInt8Array(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Int8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  function initPicoClassifier() {
    if (picoClassifier) return true;
    try {
      if (window.PICO_FACEFINDER_BASE64 && window.pico) {
        const bytes = base64ToInt8Array(window.PICO_FACEFINDER_BASE64);
        picoClassifier = window.pico.unpack_cascade(bytes);
        isInitialized = true;
        console.log('[FaceDetector] Pico.js cascade unpacked successfully.');
        return true;
      }
    } catch (e) {
      console.warn('[FaceDetector] Failed to unpack pico cascade:', e);
    }
    return false;
  }

  // Convert RGBA to Grayscale uint8 array
  function rgbaToGrayscale(rgba, nrows, ncols) {
    const gray = new Uint8Array(nrows * ncols);
    for (let r = 0; r < nrows; ++r) {
      for (let c = 0; c < ncols; ++c) {
        // Red, Green, Blue
        const idx = (r * ncols + c) * 4;
        gray[r * ncols + c] = (2 * rgba[idx] + 7 * rgba[idx + 1] + 1 * rgba[idx + 2]) / 10;
      }
    }
    return gray;
  }

  const FaceDetectorModule = {
    init() {
      return initPicoClassifier();
    },

    /**
     * Detect face in an HTMLImageElement or ImageBitmap
     * Returns: Promise<{ x, y, width, height, confidence, source: 'native'|'pico'|'default' }>
     */
    async detectFace(img) {
      const origW = img.naturalWidth || img.width;
      const origH = img.naturalHeight || img.height;

      // 1. Try Native Shape Detection API if supported
      if ('FaceDetector' in window) {
        try {
          const detector = new window.FaceDetector({ fastMode: false, maxDetectedFaces: 1 });
          const faces = await detector.detect(img);
          if (faces && faces.length > 0) {
            const b = faces[0].boundingBox;
            console.log('[FaceDetector] Native FaceDetector found face:', b);
            return {
              x: b.x,
              y: b.y,
              width: b.width,
              height: b.height,
              confidence: 0.95,
              source: 'native'
            };
          }
        } catch (err) {
          console.debug('[FaceDetector] Native detector error or permission issue:', err);
        }
      }

      // 2. Pico.js detection on a scaled offscreen canvas
      if (initPicoClassifier()) {
        try {
          // Scale image down to max dimension 480px for fast and reliable scanning
          const maxDim = 480;
          let scale = 1.0;
          if (Math.max(origW, origH) > maxDim) {
            scale = maxDim / Math.max(origW, origH);
          }
          const canvasW = Math.round(origW * scale);
          const canvasH = Math.round(origH * scale);

          const canvas = document.createElement('canvas');
          canvas.width = canvasW;
          canvas.height = canvasH;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, canvasW, canvasH);

          const imgData = ctx.getImageData(0, 0, canvasW, canvasH);
          const gray = rgbaToGrayscale(imgData.data, canvasH, canvasW);

          const imageObj = {
            pixels: gray,
            nrows: canvasH,
            ncols: canvasW,
            ldim: canvasW
          };

          const params = {
            shiftfactor: 0.1, // move the detection window by 10%
            minsize: Math.round(Math.min(canvasW, canvasH) * 0.15), // min face size
            maxsize: Math.round(Math.min(canvasW, canvasH) * 0.85), // max face size
            scalefactor: 1.15 // 15% scale step
          };

          let detections = window.pico.run_cascade(imageObj, picoClassifier, params);
          detections = window.pico.cluster_detections(detections, 0.2);

          // Find strongest detection with score threshold
          let best = null;
          for (let i = 0; i < detections.length; ++i) {
            // detection: [r, c, s, q] -> r: row(y), c: col(x), s: size, q: score
            if (detections[i][3] > 15.0) {
              if (!best || detections[i][3] > best[3]) {
                best = detections[i];
              }
            }
          }

          if (best) {
            const cy = best[0] / scale;
            const cx = best[1] / scale;
            const size = best[2] / scale;
            console.log('[FaceDetector] Pico.js detected face:', { cx, cy, size, score: best[3] });
            return {
              x: cx - size / 2,
              y: cy - size / 2,
              width: size,
              height: size,
              confidence: Math.min(1.0, best[3] / 100),
              source: 'pico'
            };
          }
        } catch (err) {
          console.warn('[FaceDetector] Pico.js error:', err);
        }
      }

      // 3. Fallback: Portrait photo heuristic default (head at top center 1/3)
      console.log('[FaceDetector] No face detected with high confidence, using portrait heuristic.');
      const defSize = Math.min(origW, origH) * 0.45;
      return {
        x: (origW - defSize) / 2,
        y: origH * 0.15,
        width: defSize,
        height: defSize,
        confidence: 0,
        source: 'default'
      };
    },

    /**
     * Compute optimal school record (NEIS) 3.5:4.5 crop parameters
     * @param {number} imgW - Original image width
     * @param {number} imgH - Original image height
     * @param {object} face - Face detection box {x, y, width, height}
     * @returns {object} { centerX, centerY, cropW, cropH, scale }
     */
    computeNeisCrop(imgW, imgH, face) {
      const faceSize = Math.max(face.width, face.height);
      const faceCenterX = face.x + face.width / 2;
      const faceCenterY = face.y + face.height / 2;

      // School record & passport standard:
      // Face occupies ~55% of total photo height
      let targetCropH = faceSize / 0.55;
      let targetCropW = targetCropH * (3.5 / 4.5); // 7:9 ratio

      // Safety check: if target crop exceeds image dimensions, scale down crop
      if (targetCropH > imgH) {
        targetCropH = imgH;
        targetCropW = targetCropH * (3.5 / 4.5);
      }
      if (targetCropW > imgW) {
        targetCropW = imgW;
        targetCropH = targetCropW * (4.5 / 3.5);
      }

      // Vertical position: Face center sits at ~43% from top of crop frame
      // This leaves ~12-15% crown margin above hair and ample chest/shoulder space
      let centerY = faceCenterY + (targetCropH * 0.07);
      let centerX = faceCenterX;

      // Clamp to image bounds initially
      if (centerY - targetCropH / 2 < 0) {
        centerY = targetCropH / 2;
      }
      if (centerY + targetCropH / 2 > imgH) {
        centerY = imgH - targetCropH / 2;
      }
      if (centerX - targetCropW / 2 < 0) {
        centerX = targetCropW / 2;
      }
      if (centerX + targetCropW / 2 > imgW) {
        centerX = imgW - targetCropW / 2;
      }

      return {
        centerX,
        centerY,
        cropW: targetCropW,
        cropH: targetCropH,
        baseScale: 1.0
      };
    }
  };

  window.FaceDetectorModule = FaceDetectorModule;
})(window);
