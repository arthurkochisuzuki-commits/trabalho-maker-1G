/**
 * BioPhysio AI - Interface de Captação e Interação (App Controller)
 */

document.addEventListener('DOMContentLoaded', () => {
  // Inicialização do Motor Biomecânico
  const analyzer = new TherapeuticSquatAnalyzer();
  
  // Elementos do DOM - Captação & Canvas
  const videoElement = document.getElementById('input-video');
  const canvasElement = document.getElementById('output-canvas');
  const canvasCtx = canvasElement.getContext('2d');
  const sourceSelect = document.getElementById('input-source-select');
  const videoFileInput = document.getElementById('video-file-input');

  // Elementos do DOM - Banner de Erro & Status de Câmera
  const cameraErrorBanner = document.getElementById('camera-error-banner');
  const cameraErrorTitle = document.getElementById('camera-error-title');
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
  
  // Elementos do DOM - HUD & Dashboard Paciente
  const hudPhaseText = document.getElementById('hud-phase-text');
  const hudKneeAngle = document.getElementById('hud-knee-angle');
  const canvasWarningToast = document.getElementById('canvas-warning-toast');
  const canvasWarningMsg = document.getElementById('canvas-warning-msg');

  const patientFeedbackCard = document.getElementById('patient-feedback-card');
  const feedbackIconContainer = document.getElementById('feedback-icon-container');
  const feedbackTag = document.getElementById('feedback-tag');
  const feedbackMainMsg = document.getElementById('feedback-main-msg');

  const valKneeAngle = document.getElementById('val-knee-angle');
  const barKneeFlexion = document.getElementById('bar-knee-flexion');
  const valTrunkAngle = document.getElementById('val-trunk-angle');
  const barTrunkAngle = document.getElementById('bar-trunk-angle');

  const valValgusStatus = document.getElementById('val-valgus-status');
  const valValgusRatio = document.getElementById('val-valgus-ratio');
  const indicatorValgus = document.getElementById('indicator-valgus');

  const valHeelStatus = document.getElementById('val-heel-status');
  const valHeelElev = document.getElementById('val-heel-elev');
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

  // Variáveis da Simulação Sintética
  let simTime = 0;

  // Web Speech API (Sintetizador de Voz em Português)
  const synth = window.speechSynthesis;

  function speakFeedback(msg) {
    if (!voiceEnabled || !synth) return;
    const now = Date.now();
    if (msg === lastSpokenMessage && now - lastSpeechTime < 5000) return; // Evita repetição excessiva
    if (now - lastSpeechTime < 3000) return;

    synth.cancel(); // Cancela falas anteriores pendentes
    const utterance = new SpeechSynthesisUtterance(msg);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.05;
    synth.speak(utterance);

    lastSpokenMessage = msg;
    lastSpeechTime = now;
  }

  // Ajusta resolução do Canvas para corresponder ao container
  function resizeCanvas() {
    const wrapper = document.getElementById('canvas-wrapper');
    if (wrapper) {
      canvasElement.width = wrapper.clientWidth || 640;
      canvasElement.height = wrapper.clientHeight || 480;
    }
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // Utilitários de Interface (Status & Erros)
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

  /**
   * INICIALIZAÇÃO DO MEDIAPIPE POSE (Visão Computacional)
   */
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
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      poseEngine.onResults(onPoseResults);
      return true;
    } catch (err) {
      console.error("Erro ao inicializar MediaPipe Pose:", err);
      return false;
    }
  }

  /**
   * CALLBACK DE RESULTADOS DO MEDIAPIPE POSE
   */
  function onPoseResults(results) {
    if (!isRunning) return;
    resizeCanvas();

    const width = canvasElement.width;
    const height = canvasElement.height;
    const sourceMode = sourceSelect.value;
    const useFilter = chkNoiseFilter.checked;

    // 1. Limpar canvas
    canvasCtx.clearRect(0, 0, width, height);

    // 2. Renderizar frame de vídeo do paciente no canvas se estiver em modo webcam/video
    if ((sourceMode === 'webcam' || sourceMode === 'video') && results.image) {
      canvasCtx.save();
      if (sourceMode === 'webcam') {
        // Modo espelho natural para webcam frontal
        canvasCtx.translate(width, 0);
        canvasCtx.scale(-1, 1);
      }
      canvasCtx.drawImage(results.image, 0, 0, width, height);
      canvasCtx.restore();
    }

    // 3. Processar keypoints articulares
    if (results.poseLandmarks && results.poseLandmarks.length >= 33) {
      const processedData = analyzer.processFrame(results.poseLandmarks, useFilter);
      renderBiomechanicalOverlay(processedData.landmarksProcessed, processedData, sourceMode === 'webcam');
      updatePatientUI(processedData);
    } else if (sourceMode === 'webcam' || sourceMode === 'video') {
      // Nenhum corpo visível detectado no frame
      hudPhaseText.textContent = "POSICIONE-SE EM FRENTE À CÂMERA";
      hudKneeAngle.textContent = "--°";
      jsonStreamOutput.textContent = analyzer.formatJSONProtocol(null, sourceMode === 'webcam' ? "Câmera Mobile 1 - Vista Frontal ao Vivo" : "Câmera Mobile 1 - Arquivo de Vídeo");
    }
  }

  /**
   * GERENCIADOR DE STREAM DE MÍDIA (WEBCAM & VÍDEO)
   */
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

  async function startWebcamStream() {
    stopMediaStream();
    hideCameraError();
    updateStatusText("Conectando Câmera...", "yellow");

    if (!initPoseEngine()) {
      showCameraError("Não foi possível carregar a biblioteca MediaPipe Pose. Verifique sua conexão com a internet.");
      updateStatusText("Erro no Motor AI", "red");
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showCameraError("Seu navegador ou modo de conexão exige endereço seguro (localhost/HTTPS) para acessar a webcam.");
      updateStatusText("Sem Suporte de Mídia", "red");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user"
        },
        audio: false
      });

      mediaStream = stream;
      videoElement.srcObject = stream;
      await videoElement.play();

      updateStatusText("Câmera Conectada (30 FPS)", "green");
      if (!isRunning) {
        btnStart.click();
      }
    } catch (err) {
      console.error("Falha ao acessar a câmera do computador:", err);
      let errorMsg = "Não foi possível conectar com a câmera do computador. ";
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        errorMsg += "A permissão de acesso à câmera foi negada. Clique no ícone de permissões do navegador para permitir o uso da câmera.";
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        errorMsg += "Nenhuma câmera física foi encontrada no computador.";
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        errorMsg += "A câmera já está em uso por outro aplicativo (Teams, Zoom, Meet, etc). Feche-o e tente novamente.";
      } else {
        errorMsg += (err.message || "Verifique se a câmera está conectada e liberada.");
      }
      showCameraError(errorMsg);
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
    if (!isRunning) {
      btnStart.click();
    }
  }

  /**
   * 1. GERADOR DE KEYPOINTS SINTÉTICOS (Modo Simulador)
   */
  function generateSyntheticLandmarks() {
    simTime += 0.04;
    const squatDepthFactor = (Math.sin(simTime) + 1) / 2;
    const isValgusCycle = Math.floor(simTime / (Math.PI * 2)) % 3 === 1;

    const shoulderY = 0.28;
    const hipY = 0.50 + squatDepthFactor * 0.18;
    const kneeY = 0.70 + squatDepthFactor * 0.08;
    const ankleY = 0.88;

    const shoulderXDist = 0.12;
    const hipXDist = 0.10;
    let kneeXDist = 0.11;

    if (isValgusCycle && squatDepthFactor > 0.4) {
      kneeXDist = 0.04;
    }

    const ankleXDist = 0.11;
    const lms = new Array(33).fill(0).map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));

    lms[11] = { x: 0.5 - shoulderXDist, y: shoulderY, z: 0, visibility: 0.99 };
    lms[12] = { x: 0.5 + shoulderXDist, y: shoulderY, z: 0, visibility: 0.99 };
    lms[23] = { x: 0.5 - hipXDist, y: hipY, z: 0, visibility: 0.99 };
    lms[24] = { x: 0.5 + hipXDist, y: hipY, z: 0, visibility: 0.99 };
    lms[25] = { x: 0.5 - kneeXDist, y: kneeY, z: 0, visibility: 0.99 };
    lms[26] = { x: 0.5 + kneeXDist, y: kneeY, z: 0, visibility: 0.99 };
    lms[27] = { x: 0.5 - ankleXDist, y: ankleY, z: 0, visibility: 0.99 };
    lms[28] = { x: 0.5 + ankleXDist, y: ankleY, z: 0, visibility: 0.99 };
    lms[29] = { x: 0.5 - ankleXDist, y: ankleY + 0.02, z: 0, visibility: 0.99 };
    lms[30] = { x: 0.5 + ankleXDist, y: ankleY + 0.02, z: 0, visibility: 0.99 };

    return lms;
  }

  /**
   * 2. RENDERIZADOR DO OVERLAY CANVASES (DESENHO BIOMECÂNICO)
   */
  function renderBiomechanicalOverlay(landmarks, data, isMirrored = false) {
    const width = canvasElement.width;
    const height = canvasElement.height;

    if (!landmarks || landmarks.length < 33) return;

    // Em modo espelhado (webcam), inverte X no canvas para combinar com a imagem espelhada
    const toPx = (lm) => {
      const xPx = isMirrored ? (1 - lm.x) * width : lm.x * width;
      return { x: xPx, y: lm.y * height };
    };

    const p11 = toPx(landmarks[11]); // Ombro E
    const p12 = toPx(landmarks[12]); // Ombro D
    const p23 = toPx(landmarks[23]); // Quadril E
    const p24 = toPx(landmarks[24]); // Quadril D
    const p25 = toPx(landmarks[25]); // Joelho E
    const p26 = toPx(landmarks[26]); // Joelho D
    const p27 = toPx(landmarks[27]); // Tornozelo E
    const p28 = toPx(landmarks[28]); // Tornozelo D

    const isValgus = data?.falhasDetectadas?.valgoDinamico;
    const isGoodAngle = data?.angulosAtuais?.joelhoMedioDeg <= 92 && data?.angulosAtuais?.joelhoMedioDeg >= 78;
    
    let jointColor = "#06b6d4"; // Cyan
    if (isValgus) jointColor = "#ef4444"; // Red
    else if (isGoodAngle) jointColor = "#10b981"; // Emerald Green

    canvasCtx.lineWidth = 4;
    canvasCtx.lineJoin = 'round';
    canvasCtx.lineCap = 'round';

    // Connections
    const connections = [
      [p11, p12], [p11, p23], [p12, p24], [p23, p24],
      [p23, p25], [p25, p27],
      [p24, p26], [p26, p28]
    ];

    connections.forEach(([from, to]) => {
      canvasCtx.beginPath();
      canvasCtx.moveTo(from.x, from.y);
      canvasCtx.lineTo(to.x, to.y);
      canvasCtx.strokeStyle = jointColor;
      canvasCtx.shadowColor = jointColor;
      canvasCtx.shadowBlur = 10;
      canvasCtx.stroke();
    });
    canvasCtx.shadowBlur = 0;

    // Joint Nodes
    [p11, p12, p23, p24, p25, p26, p27, p28].forEach(pt => {
      canvasCtx.beginPath();
      canvasCtx.arc(pt.x, pt.y, 7, 0, 2 * Math.PI);
      canvasCtx.fillStyle = "#ffffff";
      canvasCtx.fill();
      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = jointColor;
      canvasCtx.stroke();
    });

    // Angles
    if (data && data.angulosAtuais) {
      drawAngleArc(canvasCtx, p25, `${Math.round(data.angulosAtuais.joelhoEsquerdoDeg)}°`, jointColor);
      drawAngleArc(canvasCtx, p26, `${Math.round(data.angulosAtuais.joelhoDireitoDeg)}°`, jointColor);
    }

    // Valgus line warning
    if (isValgus) {
      canvasCtx.beginPath();
      canvasCtx.setLineDash([6, 6]);
      canvasCtx.moveTo(p25.x, p25.y);
      canvasCtx.lineTo(p26.x, p26.y);
      canvasCtx.strokeStyle = "#ef4444";
      canvasCtx.stroke();
      canvasCtx.setLineDash([]);
    }
  }

  function drawAngleArc(ctx, vertex, labelText, color) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(vertex.x, vertex.y, 24, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fill();

    ctx.font = "bold 13px Outfit, sans-serif";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(labelText, vertex.x, vertex.y + 35);
    ctx.restore();
  }

  /**
   * 3. ATUALIZAÇÃO DA INTERFACE DO PACIENTE
   */
  function updatePatientUI(data) {
    if (!data || !data.angulosAtuais) return;

    const faseMap = {
      "standing": "EM PÉ (NEUTRO)",
      "eccentric": "AGACHANDO (EXCÊNTRICA)",
      "bottom_hold": "PONTO CRÍTICO (ALVO 80°-90°)",
      "concentric": "SUBINDO (CONCÊNTRICA)"
    };
    hudPhaseText.textContent = faseMap[data.faseMovimento] || data.faseMovimento.toUpperCase();
    hudKneeAngle.textContent = `${data.angulosAtuais.joelhoMedioDeg.toFixed(0)}°`;

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

    valKneeAngle.textContent = `${data.angulosAtuais.joelhoMedioDeg.toFixed(1)}°`;
    const kneePct = Math.min(100, Math.max(0, ((180 - data.angulosAtuais.joelhoMedioDeg) / 100) * 100));
    barKneeFlexion.style.width = `${kneePct}%`;

    valTrunkAngle.textContent = `${data.angulosAtuais.troncoInclinacaoDeg.toFixed(1)}°`;
    const trunkPct = Math.min(100, (data.angulosAtuais.troncoInclinacaoDeg / 45) * 100);
    barTrunkAngle.style.width = `${trunkPct}%`;

    if (data.falhasDetectadas.valgoDinamico) {
      valValgusStatus.textContent = "VALGO DETECTADO!";
      valValgusStatus.className = "metric-value status-alert";
      indicatorValgus.className = "status-indicator-bar alert";
    } else {
      valValgusStatus.textContent = "Normal";
      valValgusStatus.className = "metric-value status-ok";
      indicatorValgus.className = "status-indicator-bar";
    }

    if (data.falhasDetectadas.calcanharElevado) {
      valHeelStatus.textContent = "CALCANHAR ELEVADO!";
      valHeelStatus.className = "metric-value status-alert";
      indicatorHeel.className = "status-indicator-bar alert";
    } else {
      valHeelStatus.textContent = "Apoiados";
      valHeelStatus.className = "metric-value status-ok";
      indicatorHeel.className = "status-indicator-bar";
    }

    repTotal.textContent = data.repeticoes.completas;
    repCorrect.textContent = data.repeticoes.corretas;
    repFaults.textContent = data.repeticoes.comCompensacao;

    const cameraLabelMap = {
      "simulated": "Câmera Mobile 1 - Agrupador Sintético Frontal",
      "webcam": "Câmera Mobile 1 - Vista Frontal ao Vivo (Webcam)",
      "video": "Câmera Mobile 1 - Arquivo de Vídeo Processado"
    };
    const activeCam = cameraLabelMap[sourceSelect.value] || "Câmera Mobile 1 - Vista Frontal";
    currentJSONProtocol = analyzer.formatJSONProtocol(data, activeCam);
    jsonStreamOutput.textContent = currentJSONProtocol;

    sessionLogs.push(JSON.parse(currentJSONProtocol));
    if (sessionLogs.length > 500) sessionLogs.shift();
  }

  /**
   * 4. LOOP PRINCIPAL DE PROCESSAMENTO EM TEMPO REAL
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

  // 5. EVENT LISTENERS E CONTROLES

  sourceSelect.addEventListener('change', async (e) => {
    const val = e.target.value;
    if (val === 'simulated') {
      stopMediaStream();
      hideCameraError();
      updateStatusText("Motor Conectado (30 FPS)", "green");
    } else if (val === 'webcam') {
      await startWebcamStream();
    } else if (val === 'video') {
      stopMediaStream();
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
        lucide.createIcons();
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

  // Iniciar por padrão no modo Simulador para demonstração imediata
  btnStart.click();
});
