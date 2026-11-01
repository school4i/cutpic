/**
 * Elementary School Record Photo Cropper (초등학교 생활기록부 사진 자동 맞춤 프로그램)
 * Main Application Script
 */
(function() {
  'use strict';

  // --- State ---
  const state = {
    files: [], // Array of photo objects
    selectedId: null,
    settings: {
      resolution: { width: 413, height: 531, label: '나이스 표준 (413 × 531)' },
      format: 'image/jpeg', // 'image/jpeg' or 'image/png'
      jpegQuality: 0.95,
      filenameRule: 'suffix', // 'suffix' | 'original' | 'numbered'
      showGuide: true,
      brightness: 100,
      contrast: 100
    },
    canvas: {
      isDragging: false,
      dragStartX: 0,
      dragStartY: 0,
      initialPanX: 0,
      initialPanY: 0,
      viewportScale: 1.0,
      frame: { x: 0, y: 0, w: 0, h: 0 }
    }
  };

  // --- DOM Elements ---
  const el = {
    fileInput: document.getElementById('fileInput'),
    folderInput: document.getElementById('folderInput'),
    dropzone: document.getElementById('dropzone'),
    fileList: document.getElementById('fileList'),
    fileCount: document.getElementById('fileCount'),
    btnClearAll: document.getElementById('btnClearAll'),
    emptyState: document.getElementById('emptyState'),

    // Canvas & Toolbar
    canvasViewport: document.getElementById('canvasViewport'),
    cropCanvas: document.getElementById('cropCanvas'),
    btnPrev: document.getElementById('btnPrev'),
    btnNext: document.getElementById('btnNext'),
    btnToggleGuide: document.getElementById('btnToggleGuide'),
    btnResetCrop: document.getElementById('btnResetCrop'),
    btnFlipH: document.getElementById('btnFlipH'),
    btnRotate90: document.getElementById('btnRotate90'),

    // Controls
    sliderZoom: document.getElementById('sliderZoom'),
    zoomVal: document.getElementById('zoomVal'),
    sliderRotate: document.getElementById('sliderRotate'),
    rotateVal: document.getElementById('rotateVal'),
    sliderBrightness: document.getElementById('sliderBrightness'),
    brightnessVal: document.getElementById('brightnessVal'),
    sliderContrast: document.getElementById('sliderContrast'),
    contrastVal: document.getElementById('contrastVal'),

    // Preset & Formats
    formatSegments: document.querySelectorAll('.format-segment'),
    qualityGroup: document.getElementById('qualityGroup'),
    sliderQuality: document.getElementById('sliderQuality'),
    qualityVal: document.getElementById('qualityVal'),
    presetCards: document.querySelectorAll('.preset-card'),
    selectFilenameRule: document.getElementById('selectFilenameRule'),

    // Save buttons
    btnSaveCurrent: document.getElementById('btnSaveCurrent'),
    btnSaveAll: document.getElementById('btnSaveAll'),

    // Progress Modal
    progressModal: document.getElementById('progressModal'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    progressDesc: document.getElementById('progressDesc')
  };

  const ctx = el.cropCanvas.getContext('2d');

  // --- Initialization ---
  function init() {
    // Initialize Face Detector module
    if (window.FaceDetectorModule) {
      window.FaceDetectorModule.init();
    }

    bindEvents();
    handleResize();
    updateUI();
  }

  // --- Event Bindings ---
  function bindEvents() {
    // Window Resize
    window.addEventListener('resize', () => {
      handleResize();
      renderCurrentCanvas();
    });

    // File Uploads
    el.dropzone.addEventListener('click', () => el.fileInput.click());
    document.getElementById('btnUploadFiles').addEventListener('click', () => el.fileInput.click());
    document.getElementById('btnUploadFolder').addEventListener('click', () => el.folderInput.click());

    el.fileInput.addEventListener('change', (e) => handleFilesAdded(e.target.files));
    el.folderInput.addEventListener('change', (e) => handleFilesAdded(e.target.files));

    // Drag and Drop
    ['dragenter', 'dragover'].forEach(eventName => {
      el.dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      el.dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.dropzone.classList.remove('dragover');
      });
    });

    el.dropzone.addEventListener('drop', (e) => {
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFilesAdded(e.dataTransfer.files);
      }
    });

    // Clipboard Paste (Ctrl+V)
    window.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        handleFilesAdded(files);
      }
    });

    // Clear All
    el.btnClearAll.addEventListener('click', () => {
      if (state.files.length === 0) return;
      if (confirm('첨부된 모든 사진 목록을 삭제하시겠습니까?')) {
        state.files.forEach(f => URL.revokeObjectURL(f.url));
        state.files = [];
        state.selectedId = null;
        updateFileListUI();
        renderCurrentCanvas();
        updateUI();
      }
    });

    // Navigation Buttons
    el.btnPrev.addEventListener('click', () => navigateFile(-1));
    el.btnNext.addEventListener('click', () => navigateFile(1));

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (['input', 'textarea', 'select'].includes(document.activeElement.tagName.toLowerCase())) {
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        navigateFile(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        navigateFile(1);
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        resetCurrentCrop();
      } else if (e.key.toLowerCase() === 'g') {
        e.preventDefault();
        toggleGuide();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveCurrentPhoto();
      }
    });

    // Canvas Mouse & Touch Dragging (Panning)
    const viewport = el.canvasViewport;

    viewport.addEventListener('mousedown', (e) => {
      const current = getCurrentPhoto();
      if (!current) return;
      state.canvas.isDragging = true;
      state.canvas.dragStartX = e.clientX;
      state.canvas.dragStartY = e.clientY;
      state.canvas.initialPanX = current.crop.panX;
      state.canvas.initialPanY = current.crop.panY;
      viewport.classList.add('dragging');
    });

    window.addEventListener('mousemove', (e) => {
      if (!state.canvas.isDragging) return;
      const current = getCurrentPhoto();
      if (!current) return;

      const dx = e.clientX - state.canvas.dragStartX;
      const dy = e.clientY - state.canvas.dragStartY;

      // Convert screen delta to image coordinates
      const scaleOnScreen = state.canvas.frame.w / current.crop.cropW;
      current.crop.panX = state.canvas.initialPanX - (dx / scaleOnScreen);
      current.crop.panY = state.canvas.initialPanY - (dy / scaleOnScreen);
      current.crop.isManualModified = true;

      renderCurrentCanvas();
      updateFileItemStatus(current);
    });

    window.addEventListener('mouseup', () => {
      if (state.canvas.isDragging) {
        state.canvas.isDragging = false;
        viewport.classList.remove('dragging');
      }
    });

    // Mouse Wheel Zoom
    viewport.addEventListener('wheel', (e) => {
      const current = getCurrentPhoto();
      if (!current) return;
      e.preventDefault();

      const delta = -e.deltaY;
      const factor = delta > 0 ? 1.05 : 0.95;
      let newZoom = current.crop.zoom * factor;
      newZoom = Math.min(3.0, Math.max(0.4, newZoom));

      current.crop.zoom = parseFloat(newZoom.toFixed(2));
      current.crop.isManualModified = true;
      el.sliderZoom.value = current.crop.zoom;
      el.zoomVal.textContent = `${Math.round(current.crop.zoom * 100)}%`;

      renderCurrentCanvas();
      updateFileItemStatus(current);
    }, { passive: false });

    // Toolbar actions
    el.btnToggleGuide.addEventListener('click', toggleGuide);
    el.btnResetCrop.addEventListener('click', resetCurrentCrop);
    el.btnFlipH.addEventListener('click', () => {
      const current = getCurrentPhoto();
      if (!current) return;
      current.crop.flipH = !current.crop.flipH;
      current.crop.isManualModified = true;
      renderCurrentCanvas();
    });
    el.btnRotate90.addEventListener('click', () => {
      const current = getCurrentPhoto();
      if (!current) return;
      current.crop.rotation = (current.crop.rotation + 90) % 360;
      current.crop.isManualModified = true;
      el.sliderRotate.value = current.crop.rotation;
      el.rotateVal.textContent = `${current.crop.rotation}°`;
      renderCurrentCanvas();
    });

    // Adjustments: Zoom Slider
    el.sliderZoom.addEventListener('input', (e) => {
      const current = getCurrentPhoto();
      if (!current) return;
      current.crop.zoom = parseFloat(e.target.value);
      current.crop.isManualModified = true;
      el.zoomVal.textContent = `${Math.round(current.crop.zoom * 100)}%`;
      renderCurrentCanvas();
      updateFileItemStatus(current);
    });

    // Adjustments: Rotation Slider
    el.sliderRotate.addEventListener('input', (e) => {
      const current = getCurrentPhoto();
      if (!current) return;
      current.crop.rotation = parseInt(e.target.value, 10);
      current.crop.isManualModified = true;
      el.rotateVal.textContent = `${current.crop.rotation}°`;
      renderCurrentCanvas();
      updateFileItemStatus(current);
    });

    // Reset Rotate button
    document.getElementById('btnResetRotate').addEventListener('click', () => {
      const current = getCurrentPhoto();
      if (!current) return;
      current.crop.rotation = 0;
      el.sliderRotate.value = 0;
      el.rotateVal.textContent = `0°`;
      renderCurrentCanvas();
    });

    // Reset Zoom button
    document.getElementById('btnResetZoom').addEventListener('click', () => {
      const current = getCurrentPhoto();
      if (!current) return;
      current.crop.zoom = 1.0;
      el.sliderZoom.value = 1.0;
      el.zoomVal.textContent = `100%`;
      renderCurrentCanvas();
    });

    // Adjustments: Brightness
    el.sliderBrightness.addEventListener('input', (e) => {
      state.settings.brightness = parseInt(e.target.value, 10);
      el.brightnessVal.textContent = `${state.settings.brightness}%`;
      renderCurrentCanvas();
    });
    document.getElementById('btnResetBrightness').addEventListener('click', () => {
      state.settings.brightness = 100;
      el.sliderBrightness.value = 100;
      el.brightnessVal.textContent = '100%';
      renderCurrentCanvas();
    });

    // Adjustments: Contrast
    el.sliderContrast.addEventListener('input', (e) => {
      state.settings.contrast = parseInt(e.target.value, 10);
      el.contrastVal.textContent = `${state.settings.contrast}%`;
      renderCurrentCanvas();
    });
    document.getElementById('btnResetContrast').addEventListener('click', () => {
      state.settings.contrast = 100;
      el.sliderContrast.value = 100;
      el.contrastVal.textContent = '100%';
      renderCurrentCanvas();
    });

    // Format selection (JPG vs PNG)
    el.formatSegments.forEach(btn => {
      btn.addEventListener('click', () => {
        el.formatSegments.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.settings.format = btn.dataset.format;
        if (state.settings.format === 'image/jpeg') {
          el.qualityGroup.style.display = 'flex';
        } else {
          el.qualityGroup.style.display = 'none';
        }
      });
    });

    // JPEG Quality
    el.sliderQuality.addEventListener('input', (e) => {
      const q = parseInt(e.target.value, 10);
      state.settings.jpegQuality = q / 100;
      el.qualityVal.textContent = `${q}%`;
    });

    // Preset cards
    el.presetCards.forEach(card => {
      card.addEventListener('click', () => {
        el.presetCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const w = parseInt(card.dataset.width, 10);
        const h = parseInt(card.dataset.height, 10);
        state.settings.resolution = {
          width: w,
          height: h,
          label: card.querySelector('.preset-card-title').textContent
        };
      });
    });

    // Filename Rule
    el.selectFilenameRule.addEventListener('change', (e) => {
      state.settings.filenameRule = e.target.value;
    });

    // Save Actions
    el.btnSaveCurrent.addEventListener('click', saveCurrentPhoto);
    el.btnSaveAll.addEventListener('click', saveAllPhotosZip);
  }

  // --- File Handling & Face Detection ---
  async function handleFilesAdded(fileList) {
    if (!fileList || fileList.length === 0) return;

    const validFiles = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (validFiles.length === 0) {
      alert('선택된 파일 중 유효한 이미지(JPG, PNG 등)가 없습니다.');
      return;
    }

    // Process files sequentially or in small batches
    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      const photoObj = {
        id: 'photo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        file: file,
        name: file.name,
        url: URL.createObjectURL(file),
        img: null,
        width: 0,
        height: 0,
        face: null,
        crop: null,
        status: 'processing'
      };

      state.files.push(photoObj);
      if (!state.selectedId) {
        state.selectedId = photoObj.id;
      }
    }

    updateFileListUI();
    updateUI();

    // Now load image elements and run face detection in the background
    for (const photo of state.files) {
      if (photo.status === 'processing' && !photo.img) {
        await processPhoto(photo);
        updateFileListUI();
        if (state.selectedId === photo.id) {
          syncControlsWithCurrent();
          renderCurrentCanvas();
        }
      }
    }
  }

  async function processPhoto(photo) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = async () => {
        photo.img = img;
        photo.width = img.naturalWidth || img.width;
        photo.height = img.naturalHeight || img.height;

        try {
          // Detect Face
          const face = await window.FaceDetectorModule.detectFace(img);
          photo.face = face;

          // Compute Initial NEIS Crop
          const crop = window.FaceDetectorModule.computeNeisCrop(photo.width, photo.height, face);
          photo.crop = {
            baseCenterX: crop.centerX,
            baseCenterY: crop.centerY,
            cropW: crop.cropW,
            cropH: crop.cropH,
            panX: 0,
            panY: 0,
            zoom: 1.0,
            rotation: 0,
            flipH: false,
            isManualModified: false
          };
          photo.status = 'ready';
        } catch (err) {
          console.error('Error during face detection for photo:', photo.name, err);
          photo.status = 'error';
        }
        resolve();
      };
      img.onerror = () => {
        photo.status = 'error';
        resolve();
      };
      img.src = photo.url;
    });
  }

  function getCurrentPhoto() {
    return state.files.find(f => f.id === state.selectedId) || null;
  }

  function selectPhoto(id) {
    state.selectedId = id;
    updateFileListUI();
    syncControlsWithCurrent();
    renderCurrentCanvas();
    updateUI();
  }

  function removePhoto(id, e) {
    if (e) e.stopPropagation();
    const idx = state.files.findIndex(f => f.id === id);
    if (idx === -1) return;

    URL.revokeObjectURL(state.files[idx].url);
    state.files.splice(idx, 1);

    if (state.selectedId === id) {
      state.selectedId = state.files.length > 0 ? state.files[Math.min(idx, state.files.length - 1)].id : null;
    }

    updateFileListUI();
    syncControlsWithCurrent();
    renderCurrentCanvas();
    updateUI();
  }

  function navigateFile(dir) {
    if (state.files.length <= 1) return;
    const curIdx = state.files.findIndex(f => f.id === state.selectedId);
    let nextIdx = curIdx + dir;
    if (nextIdx < 0) nextIdx = state.files.length - 1;
    if (nextIdx >= state.files.length) nextIdx = 0;
    selectPhoto(state.files[nextIdx].id);

    // Auto scroll list item into view
    const itemEl = document.querySelector(`.file-item[data-id="${state.files[nextIdx].id}"]`);
    if (itemEl) {
      itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function resetCurrentCrop() {
    const current = getCurrentPhoto();
    if (!current || !current.crop) return;

    current.crop.panX = 0;
    current.crop.panY = 0;
    current.crop.zoom = 1.0;
    current.crop.rotation = 0;
    current.crop.flipH = false;
    current.crop.isManualModified = false;

    syncControlsWithCurrent();
    renderCurrentCanvas();
    updateFileItemStatus(current);
  }

  function toggleGuide() {
    state.settings.showGuide = !state.settings.showGuide;
    el.btnToggleGuide.classList.toggle('active', state.settings.showGuide);
    renderCurrentCanvas();
  }

  function syncControlsWithCurrent() {
    const current = getCurrentPhoto();
    if (!current || !current.crop) return;

    el.sliderZoom.value = current.crop.zoom;
    el.zoomVal.textContent = `${Math.round(current.crop.zoom * 100)}%`;

    el.sliderRotate.value = current.crop.rotation;
    el.rotateVal.textContent = `${current.crop.rotation}°`;
  }

  // --- Canvas Rendering & Math ---
  function handleResize() {
    const rect = el.canvasViewport.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    // Device Pixel Ratio for Retina sharpness
    const dpr = window.devicePixelRatio || 1;
    el.cropCanvas.width = w * dpr;
    el.cropCanvas.height = h * dpr;
    el.cropCanvas.style.width = `${w}px`;
    el.cropCanvas.style.height = `${h}px`;

    ctx.scale(dpr, dpr);

    // Compute standard 3.5:4.5 frame centered in viewport
    const targetRatio = 3.5 / 4.5; // ~0.7778
    const margin = 40;
    const maxW = w - margin * 2;
    const maxH = h - margin * 2;

    let frameH = maxH;
    let frameW = frameH * targetRatio;
    if (frameW > maxW) {
      frameW = maxW;
      frameH = frameW / targetRatio;
    }

    state.canvas.frame = {
      x: (w - frameW) / 2,
      y: (h - frameH) / 2,
      w: frameW,
      h: frameH
    };
  }

  function renderCurrentCanvas() {
    const rect = el.canvasViewport.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const frame = state.canvas.frame;

    ctx.clearRect(0, 0, w, h);

    const current = getCurrentPhoto();
    if (!current || !current.img || !current.crop) {
      return;
    }

    const { img, crop } = current;

    // Apply filters (brightness, contrast)
    ctx.save();
    ctx.filter = `brightness(${state.settings.brightness}%) contrast(${state.settings.contrast}%)`;

    // 1. Draw transformed image
    ctx.save();

    // Calculate transformation
    // The frame represents a window of size (crop.cropW / crop.zoom) by (crop.cropH / crop.zoom)
    // in original image coordinates, centered at (baseCenterX + panX, baseCenterY + panY).
    const frameCenterX = frame.x + frame.w / 2;
    const frameCenterY = frame.y + frame.h / 2;

    const effCropW = crop.cropW / crop.zoom;
    const effCropH = crop.cropH / crop.zoom;
    const scale = frame.w / effCropW;

    const imgCenterX = crop.baseCenterX + crop.panX;
    const imgCenterY = crop.baseCenterY + crop.panY;

    // Move canvas context to frame center
    ctx.translate(frameCenterX, frameCenterY);

    // Rotation
    if (crop.rotation !== 0) {
      ctx.rotate((crop.rotation * Math.PI) / 180);
    }

    // Horizontal Flip
    if (crop.flipH) {
      ctx.scale(-1, 1);
    }

    // Draw full image scaled and offset relative to frame center
    const drawX = -imgCenterX * scale;
    const drawY = -imgCenterY * scale;
    const drawW = current.width * scale;
    const drawH = current.height * scale;

    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    ctx.restore(); // Restore transform
    ctx.restore(); // Restore filter

    // 2. Draw Semi-transparent Dim Mask outside the 3.5:4.5 frame
    ctx.save();
    ctx.fillStyle = 'rgba(10, 15, 29, 0.75)';

    // Cutout hole pattern: draw whole viewport then subtract frame
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(frame.x, frame.y, frame.w, frame.h);
    ctx.fill('evenodd');

    // Frame Border
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);

    // Corner Accents on Crop Frame
    const cornerSize = 16;
    ctx.strokeStyle = '#a5b4fc';
    ctx.lineWidth = 3;

    // Top-left
    ctx.beginPath();
    ctx.moveTo(frame.x, frame.y + cornerSize);
    ctx.lineTo(frame.x, frame.y);
    ctx.lineTo(frame.x + cornerSize, frame.y);
    ctx.stroke();

    // Top-right
    ctx.beginPath();
    ctx.moveTo(frame.x + frame.w - cornerSize, frame.y);
    ctx.lineTo(frame.x + frame.w, frame.y);
    ctx.lineTo(frame.x + frame.w, frame.y + cornerSize);
    ctx.stroke();

    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(frame.x, frame.y + frame.h - cornerSize);
    ctx.lineTo(frame.x, frame.y + frame.h);
    ctx.lineTo(frame.x + cornerSize, frame.y + frame.h);
    ctx.stroke();

    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(frame.x + frame.w - cornerSize, frame.y + frame.h);
    ctx.lineTo(frame.x + frame.w, frame.y + frame.h);
    ctx.lineTo(frame.x + frame.w, frame.y + frame.h - cornerSize);
    ctx.stroke();

    ctx.restore();

    // 3. Draw NEIS Standard Guides if enabled
    if (state.settings.showGuide) {
      drawNeisGuides(frame);
    }
  }

  function drawNeisGuides(frame) {
    ctx.save();
    ctx.setLineDash([4, 4]);

    // Center Vertical Line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(frame.x + frame.w / 2, frame.y);
    ctx.lineTo(frame.x + frame.w / 2, frame.y + frame.h);
    ctx.stroke();

    // Crown / Hair Margin Line (13% from top)
    const crownY = frame.y + frame.h * 0.13;
    ctx.strokeStyle = '#f43f5e'; // Pink/Red
    ctx.beginPath();
    ctx.moveTo(frame.x, crownY);
    ctx.lineTo(frame.x + frame.w, crownY);
    ctx.stroke();

    // Eyes Line (40% from top)
    const eyesY = frame.y + frame.h * 0.40;
    ctx.strokeStyle = '#06b6d4'; // Cyan
    ctx.beginPath();
    ctx.moveTo(frame.x, eyesY);
    ctx.lineTo(frame.x + frame.w, eyesY);
    ctx.stroke();

    // Chin Line (68% from top)
    const chinY = frame.y + frame.h * 0.68;
    ctx.strokeStyle = '#10b981'; // Green
    ctx.beginPath();
    ctx.moveTo(frame.x, chinY);
    ctx.lineTo(frame.x + frame.w, chinY);
    ctx.stroke();

    ctx.restore();
  }

  // --- High-Resolution Export Rendering ---
  function renderPhotoToBlob(photo, targetW, targetH, mimeType, quality) {
    return new Promise((resolve) => {
      const outCanvas = document.createElement('canvas');
      outCanvas.width = targetW;
      outCanvas.height = targetH;
      const outCtx = outCanvas.getContext('2d');

      // Quality rendering settings
      outCtx.imageSmoothingEnabled = true;
      outCtx.imageSmoothingQuality = 'high';

      // Apply filters
      outCtx.filter = `brightness(${state.settings.brightness}%) contrast(${state.settings.contrast}%)`;

      const { img, crop } = photo;
      const effCropW = crop.cropW / crop.zoom;
      const effCropH = crop.cropH / crop.zoom;
      const scale = targetW / effCropW;

      const imgCenterX = crop.baseCenterX + crop.panX;
      const imgCenterY = crop.baseCenterY + crop.panY;

      outCtx.save();
      outCtx.translate(targetW / 2, targetH / 2);

      if (crop.rotation !== 0) {
        outCtx.rotate((crop.rotation * Math.PI) / 180);
      }
      if (crop.flipH) {
        outCtx.scale(-1, 1);
      }

      const drawX = -imgCenterX * scale;
      const drawY = -imgCenterY * scale;
      const drawW = photo.width * scale;
      const drawH = photo.height * scale;

      outCtx.drawImage(img, drawX, drawY, drawW, drawH);
      outCtx.restore();

      outCanvas.toBlob((blob) => {
        resolve(blob);
      }, mimeType, quality);
    });
  }

  // --- Filename Generator ---
  function generateFilename(photo, index, total) {
    const rawName = photo.name;
    const baseName = rawName.substring(0, rawName.lastIndexOf('.')) || rawName;
    const ext = state.settings.format === 'image/jpeg' ? 'jpg' : 'png';

    switch (state.settings.filenameRule) {
      case 'suffix':
        return `${baseName}_생기부.${ext}`;
      case 'original':
        return `${baseName}.${ext}`;
      case 'numbered': {
        const padLen = String(total).length;
        const numStr = String(index + 1).padStart(padLen, '0');
        return `${numStr}_${baseName}.${ext}`;
      }
      default:
        return `${baseName}_생기부.${ext}`;
    }
  }

  // --- Save / Download Handlers ---
  async function saveCurrentPhoto() {
    const current = getCurrentPhoto();
    if (!current || !current.img) {
      alert('저장할 사진이 선택되지 않았습니다.');
      return;
    }

    const { width, height } = state.settings.resolution;
    const mime = state.settings.format;
    const quality = state.settings.jpegQuality;

    const blob = await renderPhotoToBlob(current, width, height, mime, quality);
    const filename = generateFilename(current, 0, 1);

    downloadBlob(blob, filename);
  }

  async function saveAllPhotosZip() {
    if (state.files.length === 0) {
      alert('저장할 사진이 없습니다. 먼저 사진을 추가해주세요.');
      return;
    }

    if (!window.JSZip) {
      alert('JSZip 라이브러리가 로드되지 않았습니다.');
      return;
    }

    // Show Progress Modal
    showProgressModal(true, 0, state.files.length);

    try {
      const zip = new window.JSZip();
      const { width, height } = state.settings.resolution;
      const mime = state.settings.format;
      const quality = state.settings.jpegQuality;

      for (let i = 0; i < state.files.length; i++) {
        const photo = state.files[i];
        if (!photo.img || photo.status !== 'ready') {
          continue;
        }

        updateProgress(i + 1, state.files.length, photo.name);

        const blob = await renderPhotoToBlob(photo, width, height, mime, quality);
        const filename = generateFilename(photo, i, state.files.length);
        zip.file(filename, blob);

        // Small yield to allow UI update
        await new Promise(r => setTimeout(r, 20));
      }

      el.progressDesc.textContent = 'ZIP 압축 패키징 중...';
      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const zipName = `생기부사진_일괄저장_${today}.zip`;
      downloadBlob(zipBlob, zipName);

    } catch (err) {
      console.error('Batch ZIP export error:', err);
      alert('일괄 저장 중 오류가 발생했습니다: ' + err.message);
    } finally {
      showProgressModal(false);
    }
  }

  function downloadBlob(blob, filename) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function showProgressModal(show, current = 0, total = 0) {
    if (show) {
      el.progressModal.classList.add('open');
      updateProgress(current, total, '');
    } else {
      el.progressModal.classList.remove('open');
    }
  }

  function updateProgress(current, total, name) {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    el.progressFill.style.width = `${pct}%`;
    el.progressText.textContent = `${pct}% (${current} / ${total})`;
    el.progressDesc.textContent = name ? `처리 중: ${name}` : '준비 중...';
  }

  // --- UI Updates ---
  function updateUI() {
    const hasFiles = state.files.length > 0;
    el.emptyState.style.display = hasFiles ? 'none' : 'flex';
    el.fileCount.textContent = state.files.length;

    // Enable/Disable action buttons
    el.btnSaveCurrent.disabled = !hasFiles;
    el.btnSaveAll.disabled = !hasFiles;
    el.btnPrev.style.display = state.files.length > 1 ? 'flex' : 'none';
    el.btnNext.style.display = state.files.length > 1 ? 'flex' : 'none';
  }

  function updateFileListUI() {
    el.fileList.innerHTML = '';

    state.files.forEach((photo) => {
      const item = document.createElement('div');
      item.className = 'file-item' + (photo.id === state.selectedId ? ' active' : '');
      item.dataset.id = photo.id;

      // Status Badge
      let statusHtml = '';
      if (photo.status === 'processing') {
        statusHtml = '<span class="status-indicator status-processing">감지 중...</span>';
      } else if (photo.crop?.isManualModified) {
        statusHtml = '<span class="status-indicator status-manual">수동 조정됨</span>';
      } else if (photo.face?.source === 'native' || photo.face?.source === 'pico') {
        statusHtml = '<span class="status-indicator status-detected">자동 감지됨</span>';
      } else {
        statusHtml = '<span class="status-indicator status-manual">중앙 기본값</span>';
      }

      item.innerHTML = `
        <img class="file-thumb" src="${photo.url}" alt="${photo.name}" />
        <div class="file-info">
          <div class="file-name" title="${photo.name}">${photo.name}</div>
          <div class="file-sub">
            <span>${photo.width}×${photo.height}</span>
            ${statusHtml}
          </div>
        </div>
        <button class="btn-remove-file" title="목록에서 삭제" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      `;

      item.addEventListener('click', () => selectPhoto(photo.id));

      const btnRemove = item.querySelector('.btn-remove-file');
      btnRemove.addEventListener('click', (e) => removePhoto(photo.id, e));

      el.fileList.appendChild(item);
    });
  }

  function updateFileItemStatus(photo) {
    const item = document.querySelector(`.file-item[data-id="${photo.id}"]`);
    if (!item) return;

    const subEl = item.querySelector('.file-sub');
    if (!subEl) return;

    let statusHtml = '';
    if (photo.crop?.isManualModified) {
      statusHtml = '<span class="status-indicator status-manual">수동 조정됨</span>';
    } else if (photo.face?.source === 'native' || photo.face?.source === 'pico') {
      statusHtml = '<span class="status-indicator status-detected">자동 감지됨</span>';
    } else {
      statusHtml = '<span class="status-indicator status-manual">중앙 기본값</span>';
    }

    subEl.innerHTML = `<span>${photo.width}×${photo.height}</span>${statusHtml}`;
  }

  // Kickstart on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
