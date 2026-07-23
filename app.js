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

  // Variáveis da Simulação Sintética
  let simTime = 0;
  let simValgusPhase = false;

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

  /**
   * 1. GERADOR DE KEYPOINTS SINTÉTICOS (Modo Simulador)
   * Permite testar todo o motor biomecânico sem depender de câmera física
   */
  function generateSyntheticLandmarks() {
    simTime += 0.04;
    // Ciclo de agachamento em senoide
    const squatDepthFactor = (Math.sin(simTime) + 1) / 2; // 0.0 (em pé) a 1.0 (agachado profundo)
    
    // Injeta propositalmente valgo dinâmico periodicamente para testar o alerta
    const isValgusCycle = Math.floor(simTime / (Math.PI * 2)) % 3 === 1;

    const headY = 0.15;
    const shoulderY = 0.28;
    const hipY = 0.50 + squatDepthFactor * 0.18;
    const kneeY = 0.70 + squatDepthFactor * 0.08;
    const ankleY = 0.88;

    const shoulderXDist = 0.12;
    const hipXDist = 0.10;
    let kneeXDist = 0.11;

    // Se estiver na fase de valgo, os joelhos colapsam internamente
    if (isValgusCycle && squatDepthFactor > 0.4) {
      kneeXDist = 0.04; // Colapso medial
    }

    const ankleXDist = 0.11;

    // Criar array de 33 landmarks do padrão MediaPipe Pose
    const lms = new Array(33).fill(0).map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));

    // Ombros
    lms[11] = { x: 0.5 - shoulderXDist, y: shoulderY, z: 0, visibility: 0.99 };
    lms[12] = { x: 0.5 + shoulderXDist, y: shoulderY, z: 0, visibility: 0.99 };

    // Quadris
    lms[23] = { x: 0.5 - hipXDist, y: hipY, z: 0, visibility: 0.99 };
    lms[24] = { x: 0.5 + hipXDist, y: hipY, z: 0, visibility: 0.99 };

    // Joelhos
    lms[25] = { x: 0.5 - kneeXDist, y: kneeY, z: 0, visibility: 0.99 };
    lms[26] = { x: 0.5 + kneeXDist, y: kneeY, z: 0, visibility: 0.99 };

    // Tornozelos
    lms[27] = { x: 0.5 - ankleXDist, y: ankleY, z: 0, visibility: 0.99 };
    lms[28] = { x: 0.5 + ankleXDist, y: ankleY, z: 0, visibility: 0.99 };

    // Calcanhares / Pés
    lms[29] = { x: 0.5 - ankleXDist, y: ankleY + 0.02, z: 0, visibility: 0.99 };
    lms[30] = { x: 0.5 + ankleXDist, y: ankleY + 0.02, z: 0, visibility: 0.99 };

    return lms;
  }

  /**
   * 2. RENDERIZADOR DO OVERLAY CANVASES (DESENHO BIOMECÂNICO)
   */
  function renderBiomechanicalOverlay(landmarks, data) {
    const width = canvasElement.width;
    const height = canvasElement.height;
    canvasCtx.clearRect(0, 0, width, height);

    if (!landmarks || landmarks.length < 33) return;

    // Converte coordenada normalizada (0.0 - 1.0) para pixels no canvas
    const toPx = (lm) => ({ x: lm.x * width, y: lm.y * height });

    const p11 = toPx(landmarks[11]); // Ombro E
    const p12 = toPx(landmarks[12]); // Ombro D
    const p23 = toPx(landmarks[23]); // Quadril E
    const p24 = toPx(landmarks[24]); // Quadril D
    const p25 = toPx(landmarks[25]); // Joelho E
    const p26 = toPx(landmarks[26]); // Joelho D
    const p27 = toPx(landmarks[27]); // Tornozelo E
    const p28 = toPx(landmarks[28]); // Tornozelo D

    // Definição de Cores Biomecânicas
    const isValgus = data?.falhasDetectadas?.valgoDinamico;
    const isGoodAngle = data?.angulosAtuais?.joelhoMedioDeg <= 92 && data?.angulosAtuais?.joelhoMedioDeg >= 78;
    
    let jointColor = "#06b6d4"; // Cyan
    if (isValgus) jointColor = "#ef4444"; // Red
    else if (isGoodAngle) jointColor = "#10b981"; // Emerald Green

    canvasCtx.lineWidth = 4;
    canvasCtx.lineJoin = 'round';
    canvasCtx.lineCap = 'round';

    // 1. Desenhar Conexões dos Segmentos (Ossos/Hastes Biomecânicas)
    const connections = [
      [p11, p12], [p11, p23], [p12, p24], [p23, p24], // Tronco & Bacia
      [p23, p25], [p25, p27],                         // Perna Esquerda
      [p24, p26], [p26, p28]                          // Perna Direita
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
    canvasCtx.shadowBlur = 0; // Reset shadow

    // 2. Desenhar Nós Articulares (Joint Nodes)
    [p11, p12, p23, p24, p25, p26, p27, p28].forEach(pt => {
      canvasCtx.beginPath();
      canvasCtx.arc(pt.x, pt.y, 7, 0, 2 * Math.PI);
      canvasCtx.fillStyle = "#ffffff";
      canvasCtx.fill();
      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = jointColor;
      canvasCtx.stroke();
    });

    // 3. Desenhar Arcos Angulares dos Joelhos
    if (data && data.angulosAtuais) {
      drawAngleArc(canvasCtx, p25, p23, p27, `${Math.round(data.angulosAtuais.joelhoEsquerdoDeg)}°`, jointColor);
      drawAngleArc(canvasCtx, p26, p24, p28, `${Math.round(data.angulosAtuais.joelhoDireitoDeg)}°`, jointColor);
    }

    // 4. Desenhar Linha Guiador de Valgo (Vetor Vermelho se Houver Colapso Medial)
    if (isValgus) {
      canvasCtx.beginPath();
      canvasCtx.setLineDash([6, 6]);
      canvasCtx.moveTo(p25.x, p25.y);
      canvasCtx.lineTo(p26.x, p26.y);
      canvasCtx.strokeStyle = "#ef4444";
      canvasCtx.stroke();
      canvasCtx.setLineDash([]); // Reset line dash
    }
  }

  function drawAngleArc(ctx, vertex, pA, pB, labelText, color) {
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
   * 3. ATUALIZAÇÃO DA INTERFACE DO PACIENTE (FRONTEND DO PACIENTE)
   */
  function updatePatientUI(data) {
    if (!data || !data.angulosAtuais) return;

    // 1. Atualizar Overlay HUD Canvas
    const faseMap = {
      "standing": "EM PÉ (NEUTRO)",
      "eccentric": "AGACHANDO (EXCÊNTRICA)",
      "bottom_hold": "PONTO CRÍTICO (ALVO 80°-90°)",
      "concentric": "SUBINDO (CONCÊNTRICA)"
    };
    hudPhaseText.textContent = faseMap[data.faseMovimento] || data.faseMovimento.toUpperCase();
    hudKneeAngle.textContent = `${data.angulosAtuais.joelhoMedioDeg.toFixed(0)}°`;

    // 2. Banner de Feedback do Paciente
    const status = data.qualidadeExecucao.status;
    const msg = data.qualidadeExecucao.mensagemFeedback;

    patientFeedbackCard.className = `patient-feedback-card status-${status === 'EXCELENTE' ? 'good' : (status === 'ATENÇÃO' ? 'warning' : 'danger')}`;
    feedbackTag.textContent = status === 'EXCELENTE' ? 'EXCELENTE POSTURA' : (status === 'ATENÇÃO' ? 'ATENÇÃO À POSTURA' : 'CORREÇÃO NECESSÁRIA');
    feedbackMainMsg.textContent = msg;

    // Alerta de Voz para o Paciente
    if (status !== 'EXCELENTE') {
      speakFeedback(msg);
      canvasWarningToast.classList.remove('hidden');
      canvasWarningMsg.textContent = msg;
    } else {
      canvasWarningToast.classList.add('hidden');
    }

    // 3. Atualizar Medidores Angulares
    valKneeAngle.textContent = `${data.angulosAtuais.joelhoMedioDeg.toFixed(1)}°`;
    // Mapeia flexão (180° = 0%, 80° = 100%)
    const kneePct = Math.min(100, Math.max(0, ((180 - data.angulosAtuais.joelhoMedioDeg) / 100) * 100));
    barKneeFlexion.style.width = `${kneePct}%`;

    valTrunkAngle.textContent = `${data.angulosAtuais.troncoInclinacaoDeg.toFixed(1)}°`;
    const trunkPct = Math.min(100, (data.angulosAtuais.troncoInclinacaoDeg / 45) * 100);
    barTrunkAngle.style.width = `${trunkPct}%`;

    // 4. Medidores de Falhas
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

    // 5. Placar de Repetições
    repTotal.textContent = data.repeticoes.completas;
    repCorrect.textContent = data.repeticoes.corretas;
    repFaults.textContent = data.repeticoes.comCompensacao;

    // 6. Stream de Saída em Formato JSON (Protocolo de Resposta do Sistema)
    const cameraLabelMap = {
      "simulated": "Câmera Mobile 1 - Agrupador Sintético Frontal",
      "webcam": "Câmera Mobile 1 - Vista Frontal ao Vivo",
      "video": "Câmera Mobile 1 - Arquivo de Vídeo Processado"
    };
    const activeCam = cameraLabelMap[sourceSelect.value] || "Câmera Mobile 1 - Vista Frontal";
    currentJSONProtocol = analyzer.formatJSONProtocol(data, activeCam);
    jsonStreamOutput.textContent = currentJSONProtocol;

    // Guardar no histórico da sessão
    sessionLogs.push(JSON.parse(currentJSONProtocol));
    if (sessionLogs.length > 500) sessionLogs.shift();
  }

  /**
   * 4. LOOP PRINCIPAL DE PROCESSAMENTO EM TEMPO REAL
   */
  function mainLoop() {
    if (!isRunning) return;

    resizeCanvas();
    const useFilter = chkNoiseFilter.checked;
    const sourceMode = sourceSelect.value;

    if (sourceMode === 'simulated') {
      const rawLandmarks = generateSyntheticLandmarks();
      const processedData = analyzer.processFrame(rawLandmarks, useFilter);
      renderBiomechanicalOverlay(processedData.landmarksProcessed, processedData);
      updatePatientUI(processedData);
    }

    animationFrameId = requestAnimationFrame(mainLoop);
  }

  // 5. EVENT LISTENERS E CONTROLES

  btnStart.addEventListener('click', () => {
    isRunning = true;
    btnStart.disabled = true;
    btnPause.disabled = false;
    mainLoop();
  });

  btnPause.addEventListener('click', () => {
    isRunning = false;
    btnStart.disabled = false;
    btnPause.disabled = true;
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

  // Seletor de Câmera/Fonte
  sourceSelect.addEventListener('change', (e) => {
    if (e.target.value === 'video') {
      videoFileInput.click();
    }
  });

  // Iniciar por padrão no modo Simulador para demonstração imediata
  btnStart.click();
});
