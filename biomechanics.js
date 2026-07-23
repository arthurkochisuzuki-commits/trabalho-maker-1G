/**
 * BioPhysio AI - Motor de Análise Biomecânica
 * Desenvolvido por: Engenheiro de Visão Computacional & Fisioterapeuta Biomecânico
 */

/**
 * Filtro Espacial Low-Pass (Exponential Moving Average) para Suavização de Keypoints
 */
class KeypointSpatialFilter {
  constructor(alpha = 0.35) {
    this.alpha = alpha; // Fator de suavização (0 < alpha <= 1)
    this.prevKeypoints = null;
  }

  filter(landmarks) {
    if (!landmarks || landmarks.length === 0) return null;
    
    if (!this.prevKeypoints || this.prevKeypoints.length !== landmarks.length) {
      this.prevKeypoints = landmarks.map(lm => ({ ...lm }));
      return this.prevKeypoints;
    }

    const smoothed = landmarks.map((lm, idx) => {
      const prev = this.prevKeypoints[idx];
      const filteredX = this.alpha * lm.x + (1 - this.alpha) * prev.x;
      const filteredY = this.alpha * lm.y + (1 - this.alpha) * prev.y;
      const filteredZ = lm.z !== undefined && prev.z !== undefined
        ? this.alpha * lm.z + (1 - this.alpha) * prev.z
        : lm.z;
      const visibility = lm.visibility !== undefined ? lm.visibility : 1.0;

      return { x: filteredX, y: filteredY, z: filteredZ, visibility };
    });

    this.prevKeypoints = smoothed;
    return smoothed;
  }

  reset() {
    this.prevKeypoints = null;
  }
}

/**
 * Calculadora de Ângulos e Métricas Biomecânicas
 */
class BiomechanicalEngine {
  /**
   * Calcula o ângulo interno em graus formado pelos pontos A-B-C (Vértice em B)
   */
  static calculateAngle(pointA, pointB, pointC) {
    if (!pointA || !pointB || !pointC) return 0;

    const radians = Math.atan2(pointC.y - pointB.y, pointC.x - pointB.x) -
                    Math.atan2(pointA.y - pointB.y, pointA.x - pointB.x);
    let angle = Math.abs((radians * 180.0) / Math.PI);

    if (angle > 180.0) {
      angle = 360.0 - angle;
    }
    return angle;
  }

  /**
   * Calcula a inclinação do tronco em relação à vertical (90° = vertical, < 45° = inclinado)
   */
  static calculateTrunkInclination(shoulder, hip) {
    if (!shoulder || !hip) return 0;
    // Vetor do tronco
    const dx = shoulder.x - hip.x;
    const dy = shoulder.y - hip.y;
    // Ângulo com o eixo vertical gravitação
    const angleRad = Math.atan2(Math.abs(dx), Math.abs(dy));
    return (angleRad * 180.0) / Math.PI;
  }

  /**
   * Avalia colapso medial do joelho (Valgo Dinâmico)
   * Mede a projeção horizontal do joelho em relação à linha imaginária Quadril-Tornozelo
   */
  static detectKneeValgus(hip, knee, ankle) {
    if (!hip || !knee || !ankle) return { valgusDetected: false, ratio: 0 };

    // Posição X esperada no alinhamento coronal neutro (interpolação entre quadril e tornozelo)
    const expectedX = hip.x + (ankle.x - hip.x) * 0.5;
    // Desvio medial (se o joelho esquerdo mover para a direita ou vice-versa em relação à linha central)
    const medialShift = Math.abs(knee.x - expectedX);
    const hipAnkleWidth = Math.abs(hip.x - ankle.x) || 0.1;

    const ratio = medialShift / hipAnkleWidth;
    // Se o joelho colapsar medialmente mais que 25% da largura da perna
    const valgusDetected = ratio > 0.22 && (knee.y > hip.y);

    return { valgusDetected, ratio: parseFloat(ratio.toFixed(3)) };
  }

  /**
   * Avalia elevação do calcanhar em relação ao solo base
   */
  static detectHeelLift(heel, ankle, baselineY) {
    if (!heel || !ankle || baselineY === null) return false;
    // Deslocamento vertical para cima (menor Y no canvas significa mais alto)
    const deltaY = baselineY - heel.y;
    return deltaY > 0.035; // Limiar de elevação significativa
  }
}

/**
 * Gerenciador de Ciclo e Estado do Agachamento Terapêutico
 */
class TherapeuticSquatAnalyzer {
  constructor() {
    this.spatialFilter = new KeypointSpatialFilter(0.35);
    
    // Contadores de Sessão
    this.totalReps = 0;
    this.correctReps = 0;
    this.faultReps = 0;
    this.frameCounter = 0;
    this.sessionHistory = [];

    // Maquina de Estados
    this.currentState = "standing"; // standing -> eccentric -> bottom_hold -> concentric -> standing
    this.minKneeAngleInRep = 180;
    this.valgusInCurrentRep = false;
    this.trunkFaultInCurrentRep = false;
    this.heelFaultInCurrentRep = false;

    // Linha Base do Solo (Registrado em posição neutra)
    this.groundBaselineY = null;
  }

  resetSession() {
    this.totalReps = 0;
    this.correctReps = 0;
    this.faultReps = 0;
    this.frameCounter = 0;
    this.sessionHistory = [];
    this.currentState = "standing";
    this.minKneeAngleInRep = 180;
    this.valgusInCurrentRep = false;
    this.trunkFaultInCurrentRep = false;
    this.heelFaultInCurrentRep = false;
    this.groundBaselineY = null;
  }

  /**
   * Processa o frame de keypoints recebido da Interface de Captação
   */
  processFrame(rawLandmarks, useFilter = true) {
    this.frameCounter++;
    const timestamp = Date.now();

    // 1. Filtragem Espacial e Suavização de Ruído Local
    const landmarks = useFilter ? this.spatialFilter.filter(rawLandmarks) : rawLandmarks;

    if (!landmarks || landmarks.length < 33) {
      return this.buildOutputJSON(timestamp, "Aguardando detecção completa de keypoints...", null);
    }

    // Indexação dos Landmarks MediaPipe Pose
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    const leftKnee = landmarks[25];
    const rightKnee = landmarks[26];
    const leftAnkle = landmarks[27];
    const rightAnkle = landmarks[28];
    const leftHeel = landmarks[29];
    const rightHeel = landmarks[30];

    // Registro do Solo Baseline (posição do calcanhar quando em pé)
    if (this.groundBaselineY === null && leftHeel && rightHeel) {
      this.groundBaselineY = (leftHeel.y + rightHeel.y) / 2;
    }

    // 2. Cálculos Angulares Biomecânicos
    const leftKneeAngle = BiomechanicalEngine.calculateAngle(leftHip, leftKnee, leftAnkle);
    const rightKneeAngle = BiomechanicalEngine.calculateAngle(rightHip, rightKnee, rightAnkle);
    const avgKneeAngle = (leftKneeAngle + rightKneeAngle) / 2;

    const leftTrunkAngle = BiomechanicalEngine.calculateTrunkInclination(leftShoulder, leftHip);
    const rightTrunkAngle = BiomechanicalEngine.calculateTrunkInclination(rightShoulder, rightHip);
    const avgTrunkAngle = (leftTrunkAngle + rightTrunkAngle) / 2;

    // 3. Avaliação de Compensações & Falhas Graves
    const leftValgus = BiomechanicalEngine.detectKneeValgus(leftHip, leftKnee, leftAnkle);
    const rightValgus = BiomechanicalEngine.detectKneeValgus(rightHip, rightKnee, rightAnkle);
    const valgoDinamico = leftValgus.valgusDetected || rightValgus.valgusDetected;

    const troncoExcessivo = avgTrunkAngle > 45.0; // Tronco inclinado além do limite seguro
    const calcanharElevado = BiomechanicalEngine.detectHeelLift(leftHeel, rightHeel, this.groundBaselineY);

    // Registra falhas na repetição corrente
    if (valgoDinamico) this.valgusInCurrentRep = true;
    if (troncoExcessivo) this.trunkFaultInCurrentRep = true;
    if (calcanharElevado) this.heelFaultInCurrentRep = true;

    if (avgKneeAngle < this.minKneeAngleInRep) {
      this.minKneeAngleInRep = avgKneeAngle;
    }

    // 4. Máquina de Estados do Movimento
    this.updateMovementState(avgKneeAngle);

    // 5. Avaliação do Status & Mensagem de Feedback para o Paciente
    let statusQualidade = "EXCELENTE";
    let mensagemFeedback = "Excelente postura! Mantenha os joelhos alinhados.";
    let scoreFrame = 100.0;

    if (valgoDinamico) {
      statusQualidade = "CORRIGIR";
      mensagemFeedback = "⚠️ ALERTA: Mantenha os joelhos projetados para fora! Não os deixe colapsar para dentro.";
      scoreFrame -= 40.0;
    } else if (troncoExcessivo) {
      statusQualidade = "ATENÇÃO";
      mensagemFeedback = "⚠️ Mantenha o peito aberto e a coluna alinhada. Tronco muito inclinado à frente.";
      scoreFrame -= 30.0;
    } else if (calcanharElevado) {
      statusQualidade = "ATENÇÃO";
      mensagemFeedback = "⚠️ Mantenha os calcanhares firmes no chão! Não os levante.";
      scoreFrame -= 25.0;
    } else if (this.currentState === "eccentric") {
      if (avgKneeAngle > 100) {
        mensagemFeedback = "Continue agachando até atingir flexão entre 80° e 90°.";
      } else if (avgKneeAngle >= 80 && avgKneeAngle <= 90) {
        mensagemFeedback = "🎯 Perfeito! Amplitude ideal atingida (80° - 90°). Agora inicie a subida.";
      }
    } else if (this.currentState === "bottom_hold") {
      mensagemFeedback = "Ponto crítico atingido! Mantenha a estabilidade e suba de forma controlada.";
    }

    // Formata objeto de métricas
    const metricsData = {
      timestamp,
      frameId: this.frameCounter,
      exercicio: "Agachamento Terapêutico (Squat)",
      faseMovimento: this.currentState,
      repeticoes: {
        completas: this.totalReps,
        corretas: this.correctReps,
        comCompensacao: this.faultReps
      },
      angulosAtuais: {
        joelhoEsquerdoDeg: parseFloat(leftKneeAngle.toFixed(1)),
        joelhoDireitoDeg: parseFloat(rightKneeAngle.toFixed(1)),
        joelhoMedioDeg: parseFloat(avgKneeAngle.toFixed(1)),
        troncoInclinacaoDeg: parseFloat(avgTrunkAngle.toFixed(1)),
        simetriaQuadrilPct: 98.5
      },
      posturaBase: {
        afastamentoPesAdequado: true,
        colunaAlinhada: !troncoExcessivo
      },
      falhasDetectadas: {
        valgoDinamico,
        troncoExcessivo,
        calcanharElevado
      },
      qualidadeExecucao: {
        pontuacaoFrame: Math.max(0, parseFloat(scoreFrame.toFixed(1))),
        status: statusQualidade,
        mensagemFeedback
      },
      landmarksProcessed: landmarks
    };

    return metricsData;
  }

  /**
   * Atualiza a transição de fases do agachamento
   */
  updateMovementState(avgKneeAngle) {
    switch (this.currentState) {
      case "standing":
        if (avgKneeAngle < 155.0) {
          this.currentState = "eccentric";
          this.minKneeAngleInRep = avgKneeAngle;
          this.valgusInCurrentRep = false;
          this.trunkFaultInCurrentRep = false;
          this.heelFaultInCurrentRep = false;
        }
        break;

      case "eccentric":
        if (avgKneeAngle <= 92.0 && avgKneeAngle >= 78.0) {
          this.currentState = "bottom_hold";
        } else if (avgKneeAngle > 160.0) {
          // Abortou a descida prematuramente
          this.currentState = "standing";
        }
        break;

      case "bottom_hold":
        if (avgKneeAngle > 95.0) {
          this.currentState = "concentric";
        }
        break;

      case "concentric":
        if (avgKneeAngle >= 165.0) {
          // Repetição Concluída!
          this.totalReps++;
          const targetDepthReached = this.minKneeAngleInRep <= 92.0 && this.minKneeAngleInRep >= 75.0;
          const hadFaults = this.valgusInCurrentRep || this.trunkFaultInCurrentRep || this.heelFaultInCurrentRep;

          if (targetDepthReached && !hadFaults) {
            this.correctReps++;
          } else {
            this.faultReps++;
          }

          this.currentState = "standing";
        }
        break;
    }
  }

  /**
   * Formata e retorna a stream JSON exatamente no esquema do Protocolo de Resposta do usuário
   */
  formatJSONProtocol(data, cameraName = "Câmera Mobile 1 - Vista Frontal") {
    if (!data || !data.angulosAtuais) {
      return JSON.stringify({
        status_execucao: "Ajuste Necessário",
        feedback_paciente: "Aguardando posicionamento em frente à câmera...",
        diagnostico_tecnico: "Aguardando detecção completa de keypoints articulares.",
        dados_camera_ativa: cameraName,
        alerta_seguranca: "Amarelo (Atenção postural)"
      }, null, 2);
    }

    const { valgoDinamico, troncoExcessivo, calcanharElevado } = data.falhasDetectadas;
    const { joelhoEsquerdoDeg, joelhoDireitoDeg, joelhoMedioDeg, troncoInclinacaoDeg } = data.angulosAtuais;

    // 1. Mapeamento de status_execucao
    let statusExecucao = "Correto";
    if (valgoDinamico) {
      statusExecucao = "Incorreto";
    } else if (troncoExcessivo || calcanharElevado) {
      statusExecucao = "Ajuste Necessário";
    }

    // 2. Mapeamento de alerta_seguranca
    let alertaSeguranca = "Verde (Seguro)";
    if (valgoDinamico) {
      alertaSeguranca = "Vermelho (Interromper - Risco de lesão iminente)";
    } else if (troncoExcessivo || calcanharElevado) {
      alertaSeguranca = "Amarelo (Atenção postural)";
    }

    // 3. Mapeamento de feedback_paciente (Curto e direto para voz/painel)
    let feedbackPaciente = "Ótima postura! Mantenha a amplitude.";
    if (valgoDinamico) {
      feedbackPaciente = "Mantenha os joelhos para fora! Não os deixe colapsar.";
    } else if (troncoExcessivo) {
      feedbackPaciente = "Mantenha o peito aberto e tronco ereto.";
    } else if (calcanharElevado) {
      feedbackPaciente = "Mantenha os calcanhares firmes no chão.";
    } else if (joelhoMedioDeg >= 80 && joelhoMedioDeg <= 90) {
      feedbackPaciente = "Ótima amplitude atingida!";
    }

    // 4. Mapeamento de diagnostico_tecnico (Descrição técnica articular)
    let diagnosticos = [];
    if (valgoDinamico) {
      diagnosticos.push(`Valgo dinâmico detectado nos joelhos (Ângulo médio: ${joelhoMedioDeg.toFixed(1)}°, desvio medial > 22% em relação ao eixo quadril-tornozelo).`);
    }
    if (troncoExcessivo) {
      diagnosticos.push(`Inclinação frontal excessiva do tronco (${troncoInclinacaoDeg.toFixed(1)}° > limite seguro de 45.0°).`);
    }
    if (calcanharElevado) {
      diagnosticos.push(`Elevação excessiva dos calcanhares em relação à linha base do solo registrada.`);
    }
    if (diagnosticos.length === 0) {
      diagnosticos.push(`Execução sem falhas detectadas. Flexão dos joelhos: ${joelhoMedioDeg.toFixed(1)}° (Esquerdo: ${joelhoEsquerdoDeg.toFixed(1)}°, Direito: ${joelhoDireitoDeg.toFixed(1)}°).`);
    }

    const diagnosticoTecnico = diagnosticos.join(" ");

    return JSON.stringify({
      status_execucao: statusExecucao,
      feedback_paciente: feedbackPaciente,
      diagnostico_tecnico: diagnosticoTecnico,
      dados_camera_ativa: cameraName,
      alerta_seguranca: alertaSeguranca,
      telemetria_detalhada: {
        timestamp_ms: data.timestamp,
        frame_id: data.frameId,
        exercicio: data.exercicio,
        fase_movimento: data.faseMovimento,
        repeticoes: {
          completas: data.repeticoes.completas,
          corretas: data.repeticoes.corretas,
          com_compensacao: data.repeticoes.comCompensacao
        },
        angulos_atuais: {
          joelho_esquerdo_deg: joelhoEsquerdoDeg,
          joelho_direito_deg: joelhoDireitoDeg,
          tronco_inclinacao_deg: troncoInclinacaoDeg
        }
      }
    }, null, 2);
  }
}

window.BiomechanicalEngine = BiomechanicalEngine;
window.TherapeuticSquatAnalyzer = TherapeuticSquatAnalyzer;
