/**
 * BioPhysio AI - Interface de Captação e Interação (App Controller - Fase 2)
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elementos do DOM - Captação & Canvas
  const videoElement = document.getElementById('input-video');
  const canvasElement = document.getElementById('output-canvas');
  const canvasCtx = canvasElement.getContext('2d');
  const sourceSelect = document.getElementById('input-source-select');
  const exerciseSelect = document.getElementById('exercise-select');
  const videoFileInput = document.getElementById('video-file-input');

  // Inicialização do Motor Biomecânico Unificado
  const analyzer = new TherapeuticExerciseAnalyzer(exerciseSelect ? exerciseSelect.value : "biceps_curl");

  // Elementos do DOM - IoT & Câmera
  const btnConnectArduino = document.getElementById('btn-connect-arduino');
  const cameraErrorBanner = document.getElementById('camera-error-banner');
  const cameraErrorMsg = document.getElementById('camera-error-msg');
  const btnRetryCamera = document.getElementById('btn-retry-camera');
  const statusText = document.getElementById('status-text');
  const statusDot = document.querySelector('#system-status .pulse-dot');
  
  // Elementos do DOM - Controles
  const btnStart = document.getElementById('btn-start-stream');
  const btnPause = document.getElementById('btn-pause-stream');
  const btnReset = document.getElementById('btn-reset-counters');
  const btnToggleVoice = document.getElementById('btn-toggle-voice');
  const chkNoiseFilter = document.getElementById('chk-noise-filter');
  
  // Elementos do DOM - HUD, Distância e Rastreamento de Paciente
  const hudPhaseText = document.getElementById('hud-phase-text');
  const hudKneeAngle = document.getElementById('hud-knee-angle');
  const hudAngleSub = document.getElementById('hud-angle-sub');
  const canvasDistanceToast = document.getElementById('canvas-distance-toast');
  const canvasDistanceMsg = document.getElementById('canvas-distance-msg');
  const canvasLockBadge = document.getElementById('canvas-lock-badge');
  const btnUnlockSubject = document.getElementById('btn-unlock-subject');

  const canvasWarningToast = document.getElementById('canvas-warning-toast');
  const canvasWarningMsg = document.getElementById('canvas-warning-msg');

  const patientFeedbackCard = document.getElementById('patient-feedback-card');
  const feedbackTag = document.getElementById('feedback-tag');
  const feedbackMainMsg = document.getElementById('feedback-main-msg');

  const valKneeAngle = document.getElementById('val-knee-angle');
  const barKneeFlexion = document.getElementById('bar-knee-flexion');
  const valTrunkAngle = document.getElementById('val-trunk-angle');
  const barTrunkAngle = document.getElementById('bar-trunk-angle');

  const valValgusStatus = document.getElementById('val-valgus-status');
  const indicatorValgus = document.getElementById('indicator-valgus');

  const valHeelStatus = document.getElementById('val-heel-status');
  const indicatorHeel = document.getElementById('indicator-heel');

  const repTotal = document.getElementById('rep-total');
  const repCorrect = document.getElementById('rep-correct');
  const repFaults = document.getElementById('rep-faults');

  const jsonStreamOutput = document.getElementById('json-stream-output');
  const btnCopyJson = document.getElementById('btn-copy-json');
  const btnDownloadSession = document.getElementById('btn-download-session');

  // Estado da Aplicação
  let isRunning = false;
  let animationFrameId = null;
  let voiceEnabled = true;
  let lastSpokenMessage = "";
  let lastSpeechTime = 0;
  let currentJSONProtocol = "";
  let sessionLogs = [];

  // Estado do Motor MediaPipe Pose & Conexão de Mídia
  let poseEngine = null;
  let mediaStream = null;
  let isSendingFrame = false;
  let simTime = 0;

  const synth = window.speechSynthesis;

  function speakFeedback(msg) {
    if (!voiceEnabled || !synth) return;
    const now = Date.now();
    if (msg === lastSpokenMessage && now - lastSpeechTime < 5000) return;
    if (now - lastSpeechTime < 3000) return;

    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(msg);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.05;
    synth.speak(utterance);

    lastSpokenMessage = msg;
    lastSpeechTime = now;
  }

  function resizeCanvas() {
    const wrapper = document.getElementById('canvas-wrapper');
    if (wrapper) {
      canvasElement.width = wrapper.clientWidth || 640;
      canvasElement.height = wrapper.clientHeight || 480;
    }
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function showCameraError(msg) {
    if (cameraErrorBanner) {
      cameraErrorMsg.textContent = msg;
      cameraErrorBanner.classList.remove('hidden');
    }
  }

  function hideCameraError() {
    if (cameraErrorBanner) {
      cameraErrorBanner.classList.add('hidden');
    }
  }

  function updateStatusText(text, dotColor = "green") {
    if (statusText) statusText.textContent = text;
    if (statusDot) {
      statusDot.className = `pulse-dot ${dotColor}`;
    }
  }

  function initPoseEngine() {
    if (poseEngine) return true;
    if (typeof window.Pose === 'undefined') {
      console.error("SDK do MediaPipe Pose não encontrado no window.");
      return false;
    }

    try {
      poseEngine = new window.Pose({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
      });

      poseEngine.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        smoothSegmentation: false,
        minDetectionConfidence: 0.65,
        minTrackingConfidence: 0.65
      });

      poseEngine.onResults(onPoseResults);
      return true;
    } catch (err) {
      console.error("Erro ao inicializar MediaPipe Pose:", err);
      return false;
    }
  }

  function onPoseResults(results) {
    if (!isRunning) return;
    resizeCanvas();

    const width = canvasElement.width;
    const height = canvasElement.height;
    const sourceMode = sourceSelect.value;
    const useFilter = chkNoiseFilter.checked;

    canvasCtx.clearRect(0, 0, width, height);

    if ((sourceMode === 'webcam' || sourceMode === 'video') && results.image) {
      canvasCtx.save();
      if (sourceMode === 'webcam') {
        canvasCtx.translate(width, 0);
        canvasCtx.scale(-1, 1);
      }
      canvasCtx.drawImage(results.image, 0, 0, width, height);
      canvasCtx.restore();
    }

    if (results.poseLandmarks && results.poseLandmarks.length >= 33) {
      const processedData = analyzer.processFrame(results.poseLandmarks, useFilter);
      renderBiomechanicalOverlay(processedData.landmarksProcessed, processedData, sourceMode === 'webcam');
      updatePatientUI(processedData);
    } else if (sourceMode === 'webcam' || sourceMode === 'video') {
      hudPhaseText.textContent = "POSICIONE-SE EM FRENTE À CÂMERA";
      hudKneeAngle.textContent = "--°";
      jsonStreamOutput.textContent = analyzer.formatJSONProtocol(null, sourceMode === 'webcam' ? "Câmera BioPhysio IoT - Vista Frontal ao Vivo" : "Câmera BioPhysio IoT - Arquivo de Vídeo");
    }
  }

  // Elementos do DOM - Câmeras Físicas
  const cameraDeviceSelect = document.getElementById('camera-device-select');
  const btnScanCameras = document.getElementById('btn-scan-cameras');
  const btnScanCamerasError = document.getElementById('btn-scan-cameras-error');

  function stopMediaStream() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    if (videoElement) {
      videoElement.pause();
      videoElement.srcObject = null;
      videoElement.removeAttribute('src');
    }
  }

  /**
   * DETECÇÃO E LISTAGEM DE CÂMERAS PRESENTES NO DISPOSITIVO
   */
  async function detectAvailableCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      alert("Seu navegador não suporta detecção de dispositivos de mídia.");
      return [];
    }

    try {
      updateStatusText("Buscando Câmeras...", "yellow");
      
      // Solicita permissão temporária para revelar os nomes/labels das câmeras caso estejam vazias
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        tempStream.getTracks().forEach(t => t.stop());
      } catch (e) {
        console.warn("Permissão de câmera não concedida previamente:", e);
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');

      if (cameraDeviceSelect) {
        cameraDeviceSelect.innerHTML = '';

        if (videoDevices.length === 0) {
          const opt = document.createElement('option');
          opt.value = "";
          opt.textContent = "❌ Nenhuma Câmera Encontrada";
          cameraDeviceSelect.appendChild(opt);
          cameraDeviceSelect.classList.remove('hidden');
          showCameraError("Nenhuma câmera física ou virtual foi localizada no seu computador.");
          updateStatusText("Nenhuma Câmera", "red");
        } else {
          videoDevices.forEach((device, index) => {
            const opt = document.createElement('option');
            opt.value = device.deviceId;
            opt.textContent = `📷 ${device.label || `Câmera ${index + 1}`}`;
            cameraDeviceSelect.appendChild(opt);
          });

          cameraDeviceSelect.classList.remove('hidden');
          updateStatusText(`${videoDevices.length} Câmera(s) Localizada(s)`, "green");
        }
      }

      return videoDevices;
    } catch (err) {
      console.error("Erro ao enumerar câmeras do dispositivo:", err);
      showCameraError(`Erro na busca de câmeras: ${err.message}`);
      return [];
    }
  }

  async function startWebcamStream(targetDeviceId = null) {
    stopMediaStream();
    hideCameraError();
    updateStatusText("Conectando Câmera...", "yellow");

    if (!initPoseEngine()) {
      showCameraError("Não foi possível carregar a biblioteca MediaPipe Pose.");
      updateStatusText("Erro no Motor AI", "red");
      return;
    }

    try {
      const selectedDeviceId = targetDeviceId || (cameraDeviceSelect ? cameraDeviceSelect.value : null);
      
      const videoConstraints = selectedDeviceId && selectedDeviceId !== ""
        ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } };

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false
      });

      mediaStream = stream;
      videoElement.srcObject = stream;
      await videoElement.play();

      // Atualiza lista de câmeras caso ainda não populada
      if (cameraDeviceSelect && cameraDeviceSelect.children.length <= 1) {
        detectAvailableCameras();
      }

      updateStatusText("Câmera Conectada (30 FPS)", "green");
      if (!isRunning) btnStart.click();
    } catch (err) {
      console.error("Erro ao iniciar webcam:", err);
      showCameraError(err.message || "Erro de acesso à câmera selecionada.");
      updateStatusText("Câmera Desconectada", "red");
    }
  }

  function handleVideoFile(file) {
    stopMediaStream();
    hideCameraError();
    if (!file) return;

    if (!initPoseEngine()) {
      showCameraError("Erro ao inicializar biblioteca de Visão Computacional.");
      return;
    }

    const url = URL.createObjectURL(file);
    videoElement.src = url;
    videoElement.loop = true;
    videoElement.play();
    updateStatusText(`Vídeo: ${file.name}`, "green");
    if (!isRunning) btnStart.click();
  }

  /**
   * GERADOR DE KEYPOINTS SINTÉTICOS (Modo Simulador Biomecânico de Alta Precisão)
   * Cinemática realista com movimento sincronizado de cabeça, ombros, tronco e quadril.
   */
  function generateSyntheticLandmarks() {
    simTime += 0.035;
    const exKey = exerciseSelect ? exerciseSelect.value : "biceps_curl";
    const lms = new Array(33).fill(0).map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));

    if (exKey === "squat") {
      // Cinemática Realista de Agachamento Terapêutico (100% reto e alinhado, sem joelhos para dentro)
      const depth = (Math.sin(simTime) + 1) / 2; // 0 (em pé: 175°) a 1 (agachado: 85°)

      // Ângulo articular 3D alvo dos joelhos (175° em extensão -> 85° no fundo do agachamento)
      const targetKneeDeg = 175.0 - depth * 90.0;
      const thetaRad = (targetKneeDeg * Math.PI) / 180.0;

      // Inclinação tibial frontal suave (2° em pé -> 15° agachado)
      const shinTiltRad = ((2.0 + depth * 13.0) * Math.PI) / 180.0;
      const shankLen = 0.16;
      const thighLen = 0.18;

      const ankleY = 0.86;
      const heelY = 0.88;
      const ankleZ = 0.0;

      // Joelho alinhado verticalmente em X (0.39 e 0.61), sem colapso medial (valgo)
      const kneeY = ankleY - shankLen * Math.cos(shinTiltRad);
      const kneeZ = ankleZ - shankLen * Math.sin(shinTiltRad);

      // Quadril calculado pela cinemática 3D para manter coluna ereta e ângulo exato
      const thighAngleRad = thetaRad + shinTiltRad;
      const hipY = kneeY + thighLen * Math.cos(thighAngleRad);
      const hipZ = kneeZ + thighLen * Math.sin(thighAngleRad);

      const shoulderY = hipY - 0.24;
      const headY = shoulderY - 0.12;

      // Cabeça & Face (Landmarks 0 a 10)
      lms[0] = { x: 0.50, y: headY, z: hipZ - 0.02, visibility: 0.99 };         // Nariz
      lms[2] = { x: 0.48, y: headY - 0.01, z: hipZ - 0.02, visibility: 0.99 };  // Olho E
      lms[5] = { x: 0.52, y: headY - 0.01, z: hipZ - 0.02, visibility: 0.99 };  // Olho D
      lms[7] = { x: 0.46, y: headY, z: hipZ, visibility: 0.99 };                // Orelha E
      lms[8] = { x: 0.54, y: headY, z: hipZ, visibility: 0.99 };                // Orelha D

      // Tronco e Ombros retos (Landmarks 11, 12, 23, 24)
      lms[11] = { x: 0.38, y: shoulderY, z: hipZ, visibility: 0.99 };           // Ombro E
      lms[12] = { x: 0.62, y: shoulderY, z: hipZ, visibility: 0.99 };           // Ombro D
      lms[23] = { x: 0.39, y: hipY, z: hipZ, visibility: 0.99 };                // Quadril E
      lms[24] = { x: 0.61, y: hipY, z: hipZ, visibility: 0.99 };                // Quadril D

      // Braços estabilizados à frente durante a descida
      lms[13] = { x: 0.36, y: shoulderY + 0.11, z: hipZ - 0.08, visibility: 0.99 }; // Cotovelo E
      lms[14] = { x: 0.64, y: shoulderY + 0.11, z: hipZ - 0.08, visibility: 0.99 }; // Cotovelo D
      lms[15] = { x: 0.36, y: shoulderY + 0.19 - depth * 0.04, z: hipZ - 0.16, visibility: 0.99 }; // Pulso E
      lms[16] = { x: 0.64, y: shoulderY + 0.19 - depth * 0.04, z: hipZ - 0.16, visibility: 0.99 }; // Pulso D

      // Membros Inferiores 100% alinhados (Quadril, Joelho e Tornozelo na mesma linha vertical X)
      lms[25] = { x: 0.39, y: kneeY, z: kneeZ, visibility: 0.99 };              // Joelho E (Reto)
      lms[26] = { x: 0.61, y: kneeY, z: kneeZ, visibility: 0.99 };              // Joelho D (Reto)
      lms[27] = { x: 0.39, y: ankleY, z: ankleZ, visibility: 0.99 };            // Tornozelo E
      lms[28] = { x: 0.61, y: ankleY, z: ankleZ, visibility: 0.99 };            // Tornozelo D
      lms[29] = { x: 0.39, y: heelY, z: ankleZ + 0.03, visibility: 0.99 };      // Calcanhar E
      lms[30] = { x: 0.61, y: heelY, z: ankleZ + 0.03, visibility: 0.99 };      // Calcanhar D
    } else if (exKey === "shoulder_abduction") {
      // Abdução de Ombro (Elevação Lateral com os braços levemente flexionados)
      const factor = (Math.sin(simTime) + 1) / 2;
      // Eleva de ~10° (repouso ao lado do corpo) até 90° (linha dos ombros)
      const minAngle = (10.0 * Math.PI) / 180.0;
      const maxAngle = (90.0 * Math.PI) / 180.0;
      const armAngle = minAngle + factor * (maxAngle - minAngle);

      // Flexão suave e constante dos cotovelos (~22° de curvatura anatômica)
      const elbowBendRad = (22.0 * Math.PI) / 180.0;
      const forearmAngle = armAngle - elbowBendRad;

      const shoulderY = 0.28;
      const hipY = 0.52;
      const kneeY = 0.70;
      const ankleY = 0.86;

      lms[0] = { x: 0.50, y: 0.16, z: 0, visibility: 0.99 };
      lms[11] = { x: 0.38, y: shoulderY, z: 0, visibility: 0.99 };
      lms[12] = { x: 0.62, y: shoulderY, z: 0, visibility: 0.99 };
      lms[23] = { x: 0.40, y: hipY, z: 0, visibility: 0.99 };
      lms[24] = { x: 0.60, y: hipY, z: 0, visibility: 0.99 };
      lms[25] = { x: 0.40, y: kneeY, z: 0, visibility: 0.99 };
      lms[26] = { x: 0.60, y: kneeY, z: 0, visibility: 0.99 };
      lms[27] = { x: 0.40, y: ankleY, z: 0, visibility: 0.99 };
      lms[28] = { x: 0.60, y: ankleY, z: 0, visibility: 0.99 };
      lms[29] = { x: 0.40, y: 0.88, z: 0.02, visibility: 0.99 };
      lms[30] = { x: 0.60, y: 0.88, z: 0.02, visibility: 0.99 };

      const armLen1 = 0.15;
      const armLen2 = 0.14;

      // Cotovelos
      const leftElbowX = 0.38 - Math.sin(armAngle) * armLen1;
      const leftElbowY = shoulderY + Math.cos(armAngle) * armLen1;
      const rightElbowX = 0.62 + Math.sin(armAngle) * armLen1;
      const rightElbowY = shoulderY + Math.cos(armAngle) * armLen1;

      lms[13] = { x: leftElbowX, y: leftElbowY, z: -0.02, visibility: 0.99 };
      lms[14] = { x: rightElbowX, y: rightElbowY, z: -0.02, visibility: 0.99 };

      // Antebraços levemente flexionados (punhos seguem com leve angulação em relação ao úmero)
      lms[15] = {
        x: leftElbowX - Math.sin(forearmAngle) * armLen2,
        y: leftElbowY + Math.cos(forearmAngle) * armLen2,
        z: -0.05,
        visibility: 0.99
      };
      lms[16] = {
        x: rightElbowX + Math.sin(forearmAngle) * armLen2,
        y: rightElbowY + Math.cos(forearmAngle) * armLen2,
        z: -0.05,
        visibility: 0.99
      };
    } else if (exKey === "biceps_curl") {
      // Rosca Direta de Bíceps com arco articular 3D realista (165° estendido a 40° contraído)
      const curlFactor = (Math.sin(simTime) + 1) / 2;
      const elbowAngleDeg = 165.0 - curlFactor * 125.0;
      const elbowAngleRad = (elbowAngleDeg * Math.PI) / 180.0;

      const shoulderY = 0.28;
      const hipY = 0.52;
      const kneeY = 0.70;
      const ankleY = 0.86;

      lms[0] = { x: 0.50, y: 0.16, z: 0, visibility: 0.99 };
      lms[11] = { x: 0.38, y: shoulderY, z: 0, visibility: 0.99 };
      lms[12] = { x: 0.62, y: shoulderY, z: 0, visibility: 0.99 };
      lms[23] = { x: 0.40, y: hipY, z: 0, visibility: 0.99 };
      lms[24] = { x: 0.60, y: hipY, z: 0, visibility: 0.99 };
      lms[25] = { x: 0.40, y: kneeY, z: 0, visibility: 0.99 };
      lms[26] = { x: 0.60, y: kneeY, z: 0, visibility: 0.99 };
      lms[27] = { x: 0.40, y: ankleY, z: 0, visibility: 0.99 };
      lms[28] = { x: 0.60, y: ankleY, z: 0, visibility: 0.99 };
      lms[29] = { x: 0.40, y: 0.88, z: 0.02, visibility: 0.99 };
      lms[30] = { x: 0.60, y: 0.88, z: 0.02, visibility: 0.99 };

      const elbowY = shoulderY + 0.16;
      lms[13] = { x: 0.37, y: elbowY, z: 0, visibility: 0.99 }; // Cotovelo E fixo ao lado do tronco
      lms[14] = { x: 0.63, y: elbowY, z: 0, visibility: 0.99 }; // Cotovelo D fixo ao lado do tronco

      const forearmLen = 0.15;
      // Arco circular 3D do antebraço (mantém comprimento real e ângulo 3D exato)
      const wristY = elbowY - Math.cos(elbowAngleRad) * forearmLen;
      const wristZ = -Math.sin(elbowAngleRad) * forearmLen;
      const wristXOffset = Math.sin(elbowAngleRad) * 0.025;

      lms[15] = { x: 0.37 + wristXOffset, y: wristY, z: wristZ, visibility: 0.99 };
      lms[16] = { x: 0.63 - wristXOffset, y: wristY, z: wristZ, visibility: 0.99 };
    }

    return lms;
  }

  /**
   * RENDERIZADOR VOLUMÉTRICO AVANÇADO DE MANEQUIM 3D E ESTÚDIO BIOMECÂNICO
   */
  function renderBiomechanicalOverlay(landmarks, data, isMirrored = false) {
    const width = canvasElement.width;
    const height = canvasElement.height;
    const isSimulated = sourceSelect.value === 'simulated';

    if (!landmarks || landmarks.length < 33) return;

    // 1. RENDERIZAR ESTÚDIO DE ANÁLISE 3D FUTURISTA (SE MODO SIMULADOR)
    if (isSimulated) {
      drawStudioGridEnvironment(canvasCtx, width, height);
    }

    const toPx = (lm) => {
      const xPx = isMirrored ? (1 - lm.x) * width : lm.x * width;
      return { x: xPx, y: lm.y * height };
    };

    const nose = lmsToPx(landmarks[0], toPx);
    const p11 = lmsToPx(landmarks[11], toPx); // Ombro E
    const p12 = lmsToPx(landmarks[12], toPx); // Ombro D
    const p13 = lmsToPx(landmarks[13], toPx); // Cotovelo E
    const p14 = lmsToPx(landmarks[14], toPx); // Cotovelo D
    const p15 = lmsToPx(landmarks[15], toPx); // Pulso E
    const p16 = lmsToPx(landmarks[16], toPx); // Pulso D
    const p23 = lmsToPx(landmarks[23], toPx); // Quadril E
    const p24 = lmsToPx(landmarks[24], toPx); // Quadril D
    const p25 = lmsToPx(landmarks[25], toPx); // Joelho E
    const p26 = lmsToPx(landmarks[26], toPx); // Joelho D
    const p27 = lmsToPx(landmarks[27], toPx); // Tornozelo E
    const p28 = lmsToPx(landmarks[28], toPx); // Tornozelo D

    const isAlert = data?.qualidadeExecucao?.status !== "EXCELENTE";
    const statusColor = isAlert ? "#ef4444" : "#10b981";
    const accentColor = isAlert ? "rgba(239, 68, 68, 0.35)" : "rgba(16, 185, 129, 0.25)";

    // 2. RENDERIZAR MALHA VOLUMÉTRICA DO TRONCO (PEITORAL / ABDÔMEN)
    if (p11 && p12 && p23 && p24) {
      canvasCtx.save();
      canvasCtx.beginPath();
      canvasCtx.moveTo(p11.x, p11.y);
      canvasCtx.lineTo(p12.x, p12.y);
      canvasCtx.lineTo(p24.x, p24.y);
      canvasCtx.lineTo(p23.x, p23.y);
      canvasCtx.closePath();

      const torsoGrad = canvasCtx.createLinearGradient(0, p11.y, 0, p23.y);
      torsoGrad.addColorStop(0, accentColor);
      torsoGrad.addColorStop(1, "rgba(6, 182, 212, 0.05)");

      canvasCtx.fillStyle = torsoGrad;
      canvasCtx.fill();
      canvasCtx.lineWidth = 1.5;
      canvasCtx.strokeStyle = statusColor;
      canvasCtx.stroke();
      canvasCtx.restore();
    }

    // 3. RENDERIZAR CABEÇA E MANEQUIM FACIAL
    if (nose && p11 && p12) {
      const shoulderCenterX = (p11.x + p12.x) / 2;
      const shoulderCenterY = (p11.y + p12.y) / 2;
      const headRadius = Math.max(18, Math.abs(p12.x - p11.x) * 0.25);

      canvasCtx.save();
      // Cabeça
      canvasCtx.beginPath();
      canvasCtx.arc(shoulderCenterX, nose.y - 5, headRadius, 0, Math.PI * 2);
      canvasCtx.fillStyle = "rgba(15, 23, 42, 0.8)";
      canvasCtx.fill();
      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = statusColor;
      canvasCtx.stroke();

      // Viseira Tecnológica Futurista
      drawRoundRect(canvasCtx, shoulderCenterX - headRadius * 0.6, nose.y - 12, headRadius * 1.2, 8, 4);
      canvasCtx.fillStyle = isAlert ? "#fca5a5" : "#38bdf8";
      canvasCtx.shadowColor = isAlert ? "#ef4444" : "#0284c7";
      canvasCtx.shadowBlur = 8;
      canvasCtx.fill();
      canvasCtx.restore();
    }

    // 4. RENDERIZAR SEGMENTOS MUSCULARES VOLUMÉTRICOS (CÁPSULAS ANATÔMICAS)
    const capsules = [
      [p11, p13, 14], [p13, p15, 11], // Braço E, Antebraço E
      [p12, p14, 14], [p14, p16, 11], // Braço D, Antebraço D
      [p23, p25, 20], [p25, p27, 16], // Coxa E (Quads), Perna E
      [p24, p26, 20], [p26, p28, 16]  // Coxa D (Quads), Perna D
    ];

    capsules.forEach(([from, to, radius]) => {
      if (from && to) {
        drawLimbCapsule(canvasCtx, from, to, radius, statusColor, isAlert);
      }
    });

    // 5. RENDERIZAR ESFERAS ARTICULARES E ANÉIS
    const jointNodes = [p11, p12, p13, p14, p15, p16, p23, p24, p25, p26, p27, p28];
    jointNodes.forEach(pt => {
      if (!pt) return;
      canvasCtx.save();
      // Brilho Neon Externo
      canvasCtx.beginPath();
      canvasCtx.arc(pt.x, pt.y, 8, 0, 2 * Math.PI);
      canvasCtx.fillStyle = "rgba(255, 255, 255, 0.9)";
      canvasCtx.shadowColor = statusColor;
      canvasCtx.shadowBlur = 12;
      canvasCtx.fill();

      // Anel metálico
      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = statusColor;
      canvasCtx.stroke();
      canvasCtx.restore();
    });

    // 6. RENDERIZAR MEDIDOR DE ÂNGULO E VETORES
    if (data && data.angulosAtuais) {
      const exKey = data.exerciseKey || "biceps_curl";
      if (exKey === "squat" && p25) {
        drawAngleBadge(canvasCtx, p25, `${Math.round(data.angulosAtuais.principalDeg)}°`, statusColor, "Flexão Joelho");
      } else if (exKey === "shoulder_abduction" && p11) {
        drawAngleBadge(canvasCtx, p11, `${Math.round(data.angulosAtuais.principalDeg)}°`, statusColor, "Abdução Ombro");
      } else if (exKey === "biceps_curl" && p13) {
        drawAngleBadge(canvasCtx, p13, `${Math.round(data.angulosAtuais.principalDeg)}°`, statusColor, "Flexão Cotovelo");
      }
    }

    // 7. ALERTA VISUAL DE VETOR DE VALGO (SE DETECTADO)
    if (data?.falhasDetectadas?.valgoDinamico && p25 && p26) {
      canvasCtx.save();
      canvasCtx.beginPath();
      canvasCtx.setLineDash([6, 6]);
      canvasCtx.moveTo(p25.x, p25.y);
      canvasCtx.lineTo(p26.x, p26.y);
      canvasCtx.strokeStyle = "#ef4444";
      canvasCtx.lineWidth = 3;
      canvasCtx.stroke();

      // Seta de força medial
      const midX = (p25.x + p26.x) / 2;
      const midY = (p25.y + p26.y) / 2;
      canvasCtx.font = "bold 12px Inter, sans-serif";
      canvasCtx.fillStyle = "#ef4444";
      canvasCtx.fillText("⚠️ COLAPSO MEDIAL (VALGO)", midX - 80, midY - 10);
      canvasCtx.restore();
    }
  }

  function lmsToPx(lm, toPxFn) {
    return lm ? toPxFn(lm) : null;
  }

  /**
   * RENDERIZADOR DE ESTÚDIO BIOMECÂNICO FUTURISTA (BACKGROUND GRID)
   */
  function drawStudioGridEnvironment(ctx, w, h) {
    ctx.save();
    // Fundo Degradê Estúdio Neon Dark
    const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, w * 0.75);
    bgGrad.addColorStop(0, "#0f172a");
    bgGrad.addColorStop(1, "#020617");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Grade de Perspectiva 3D do Solo
    const horizonY = h * 0.58;
    ctx.strokeStyle = "rgba(51, 65, 85, 0.35)";
    ctx.lineWidth = 1;

    // Linhas Verticais de Perspectiva
    for (let x = -w; x <= w * 2; x += w / 8) {
      ctx.beginPath();
      ctx.moveTo(w / 2, horizonY);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Linhas Horizontais do Solo
    for (let y = horizonY; y <= h; y += (h - horizonY) / 6) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Plataforma Circular sob os pés do paciente
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.88, w * 0.28, h * 0.06, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(6, 182, 212, 0.4)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Régua de Calibração Lateral de Altura
    ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
    ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
    ctx.font = "10px Inter, monospace";
    ctx.beginPath();
    ctx.moveTo(25, 40);
    ctx.lineTo(25, h - 40);
    ctx.stroke();

    for (let y = 60; y < h - 40; y += 40) {
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(30, y);
      ctx.stroke();
      const heightMeters = ((h - y) / h * 2.2).toFixed(1);
      ctx.fillText(`${heightMeters}m`, 34, y + 3);
    }

    ctx.restore();
  }

  /**
   * RENDERIZADOR DE CÁPSULAS ANATÔMICAS VOLUMÉTRICAS DE MEMBROS
   */
  function drawLimbCapsule(ctx, pA, pB, radius, color, isAlert) {
    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;

    const angle = Math.atan2(dy, dx);

    ctx.save();
    ctx.translate(pA.x, pA.y);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.arc(0, 0, radius, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.lineTo(len, -radius);
    ctx.arc(len, 0, radius, (3 * Math.PI) / 2, Math.PI / 2);
    ctx.closePath();

    ctx.fillStyle = isAlert ? "rgba(239, 68, 68, 0.15)" : "rgba(6, 182, 212, 0.12)";
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * HELPER SEGURO DE RETÂNGULO COM CANTOS ARREDONDADOS
   */
  function drawRoundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, width, height, radius);
    } else {
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
    }
  }

  /**
   * CRACHÁ DE ÂNGULO COM TIPOGRAFIA MODERNA E INDICADOR ARTICULAR
   */
  function drawAngleBadge(ctx, vertex, labelText, color, jointTitle) {
    ctx.save();
    const boxW = 86;
    const boxH = 34;
    const x = vertex.x - boxW / 2;
    const y = vertex.y + 25;

    drawRoundRect(ctx, x, y, boxW, boxH, 8);
    ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.font = "bold 13px Outfit, sans-serif";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(labelText, vertex.x, y + 16);

    ctx.font = "9px Inter, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(jointTitle, vertex.x, y + 28);
    ctx.restore();
  }

  /**
   * ATUALIZAÇÃO DA INTERFACE DO PACIENTE
   */
  function updatePatientUI(data) {
    if (!data || !data.angulosAtuais) return;

    hudPhaseText.textContent = data.faseMovimento ? data.faseMovimento.toUpperCase() : "NEUTRO";
    hudKneeAngle.textContent = `${data.angulosAtuais.principalDeg.toFixed(0)}°`;
    if (hudAngleSub) hudAngleSub.textContent = data.targetJointName || "Ângulo Alvo";

    // Regulador de Distância
    if (data.distanceEval && canvasDistanceToast) {
      canvasDistanceMsg.textContent = data.distanceEval.message;
      canvasDistanceToast.className = `canvas-distance-toast ${data.distanceEval.status.toLowerCase().replace('_', '-')}`;
    }

    const status = data.qualidadeExecucao.status;
    const msg = data.qualidadeExecucao.mensagemFeedback;

    patientFeedbackCard.className = `patient-feedback-card status-${status === 'EXCELENTE' ? 'good' : (status === 'ATENÇÃO' ? 'warning' : 'danger')}`;
    feedbackTag.textContent = status === 'EXCELENTE' ? 'EXCELENTE POSTURA' : (status === 'ATENÇÃO' ? 'ATENÇÃO À POSTURA' : 'CORREÇÃO NECESSÁRIA');
    feedbackMainMsg.textContent = msg;

    if (status !== 'EXCELENTE') {
      speakFeedback(msg);
      canvasWarningToast.classList.remove('hidden');
      canvasWarningMsg.textContent = msg;
    } else {
      canvasWarningToast.classList.add('hidden');
    }

    valKneeAngle.textContent = `${data.angulosAtuais.principalDeg.toFixed(1)}°`;
    const mainPct = Math.min(100, Math.max(0, (data.angulosAtuais.principalDeg / 180) * 100));
    barKneeFlexion.style.width = `${mainPct}%`;

    const primaryHeaderSpan = valKneeAngle.closest('.metric-card')?.querySelector('.metric-header span');
    const primaryTargetDiv = valKneeAngle.closest('.metric-card')?.querySelector('.metric-target');
    if (primaryHeaderSpan && data.targetJointName) primaryHeaderSpan.textContent = data.targetJointName;
    if (primaryTargetDiv && data.targetRange) primaryTargetDiv.textContent = `Alvo: ${data.targetRange}`;

    valTrunkAngle.textContent = `${data.angulosAtuais.secundarioDeg.toFixed(1)}°`;
    const secPct = Math.min(100, (data.angulosAtuais.secundarioDeg / 45) * 100);
    barTrunkAngle.style.width = `${secPct}%`;

    repTotal.textContent = data.repeticoes.completas;
    repCorrect.textContent = data.repeticoes.corretas;
    repFaults.textContent = data.repeticoes.comCompensacao;

    const activeCam = sourceSelect.value === 'webcam' ? "Câmera BioPhysio IoT - Vista Frontal ao Vivo" : "Câmera BioPhysio IoT - Simulador Sintético";
    currentJSONProtocol = analyzer.formatJSONProtocol(data, activeCam);
    jsonStreamOutput.textContent = currentJSONProtocol;

    sessionLogs.push(JSON.parse(currentJSONProtocol));
    if (sessionLogs.length > 500) sessionLogs.shift();
  }

  /**
   * LOOP PRINCIPAL DE PROCESSAMENTO
   */
  async function mainLoop() {
    if (!isRunning) return;

    resizeCanvas();
    const useFilter = chkNoiseFilter.checked;
    const sourceMode = sourceSelect.value;

    if (sourceMode === 'simulated') {
      hideCameraError();
      const rawLandmarks = generateSyntheticLandmarks();
      const processedData = analyzer.processFrame(rawLandmarks, useFilter);
      renderBiomechanicalOverlay(processedData.landmarksProcessed, processedData, false);
      updatePatientUI(processedData);
    } else if (sourceMode === 'webcam' || sourceMode === 'video') {
      if (videoElement && videoElement.readyState >= 2 && !videoElement.paused && !videoElement.ended) {
        if (poseEngine && !isSendingFrame) {
          isSendingFrame = true;
          try {
            await poseEngine.send({ image: videoElement });
          } catch (err) {
            console.error("Erro no envio do frame para o MediaPipe:", err);
          } finally {
            isSendingFrame = false;
          }
        }
      }
    }

    animationFrameId = requestAnimationFrame(mainLoop);
  }

  // EVENT LISTENERS DE INTERFAZ E REQUISITOS FASE 2

  // 1. Troca de Exercício Modular
  if (exerciseSelect) {
    exerciseSelect.addEventListener('change', (e) => {
      const selectedId = e.target.value;
      analyzer.setExercise(selectedId);
      btnReset.click();
    });
  }

  // 2. Conexão Arduino (IoT) via Web Serial
  if (btnConnectArduino) {
    btnConnectArduino.addEventListener('click', async () => {
      try {
        await analyzer.iotBridge.connect();
        btnConnectArduino.classList.remove('btn-outline');
        btnConnectArduino.classList.add('btn-primary');
        btnConnectArduino.innerHTML = `<i data-lucide="cpu"></i> Arduino Conectado`;
        if (window.lucide) lucide.createIcons();
      } catch (err) {
        alert(`Não foi possível conectar ao Arduino: ${err.message}`);
      }
    });
  }

  // 3. Trava de Rastreamento de Paciente ao Clicar no Canvas
  canvasElement.addEventListener('click', (e) => {
    const rect = canvasElement.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / rect.width;
    const clickY = (e.clientY - rect.top) / rect.height;

    analyzer.subjectTracker.setTarget(clickX, clickY);
    if (canvasLockBadge) canvasLockBadge.classList.remove('hidden');
  });

  if (btnUnlockSubject) {
    btnUnlockSubject.addEventListener('click', (e) => {
      e.stopPropagation();
      analyzer.subjectTracker.clearTarget();
      if (canvasLockBadge) canvasLockBadge.classList.add('hidden');
    });
  }

  // 4. Detecção e Seleção de Câmeras Físicas
  if (btnScanCameras) {
    btnScanCameras.addEventListener('click', async () => {
      sourceSelect.value = 'webcam';
      const videoDevices = await detectAvailableCameras();
      if (videoDevices.length > 0) {
        await startWebcamStream(videoDevices[0].deviceId);
      }
    });
  }

  if (btnScanCamerasError) {
    btnScanCamerasError.addEventListener('click', async () => {
      sourceSelect.value = 'webcam';
      const videoDevices = await detectAvailableCameras();
      if (videoDevices.length > 0) {
        await startWebcamStream(videoDevices[0].deviceId);
      }
    });
  }

  if (cameraDeviceSelect) {
    cameraDeviceSelect.addEventListener('change', async (e) => {
      if (e.target.value) {
        sourceSelect.value = 'webcam';
        await startWebcamStream(e.target.value);
      }
    });
  }

  sourceSelect.addEventListener('change', async (e) => {
    const val = e.target.value;
    if (val === 'simulated') {
      stopMediaStream();
      hideCameraError();
      if (cameraDeviceSelect) cameraDeviceSelect.classList.add('hidden');
      updateStatusText("Motor Conectado (30 FPS)", "green");
    } else if (val === 'webcam') {
      await detectAvailableCameras();
      await startWebcamStream();
    } else if (val === 'video') {
      stopMediaStream();
      if (cameraDeviceSelect) cameraDeviceSelect.classList.add('hidden');
      videoFileInput.click();
    }
  });

  videoFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleVideoFile(e.target.files[0]);
    }
  });

  if (btnRetryCamera) {
    btnRetryCamera.addEventListener('click', async () => {
      if (sourceSelect.value === 'webcam') {
        await detectAvailableCameras();
        await startWebcamStream();
      }
    });
  }

  btnStart.addEventListener('click', async () => {
    isRunning = true;
    btnStart.disabled = true;
    btnPause.disabled = false;

    if (sourceSelect.value === 'webcam' && !mediaStream) {
      await startWebcamStream();
    } else if (sourceSelect.value === 'video' && videoElement.paused) {
      videoElement.play();
    }

    mainLoop();
  });

  btnPause.addEventListener('click', () => {
    isRunning = false;
    btnStart.disabled = false;
    btnPause.disabled = true;
    if (videoElement && !videoElement.paused) {
      videoElement.pause();
    }
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
  });

  btnReset.addEventListener('click', () => {
    analyzer.resetSession();
    sessionLogs = [];
    repTotal.textContent = "0";
    repCorrect.textContent = "0";
    repFaults.textContent = "0";
    jsonStreamOutput.textContent = '{\n  "status": "Sessão reiniciada."\n}';
  });

  btnToggleVoice.addEventListener('click', () => {
    voiceEnabled = !voiceEnabled;
    btnToggleVoice.classList.toggle('active', voiceEnabled);
    if (!voiceEnabled && synth) synth.cancel();
  });

  btnCopyJson.addEventListener('click', () => {
    if (currentJSONProtocol) {
      navigator.clipboard.writeText(currentJSONProtocol);
      btnCopyJson.innerHTML = `<i data-lucide="check"></i> Copiado!`;
      setTimeout(() => {
        btnCopyJson.innerHTML = `<i data-lucide="copy"></i> Copiar`;
        if (window.lucide) lucide.createIcons();
      }, 2000);
    }
  });

  btnDownloadSession.addEventListener('click', () => {
    if (sessionLogs.length === 0) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(sessionLogs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `biophysio_session_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });

  // Iniciar simulador por padrão
  btnStart.click();
});

