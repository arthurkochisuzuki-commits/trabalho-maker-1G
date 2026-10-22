/**
 * ============================================================================
 * BioPhysio AI - Integração IoT: Web Bluetooth API & Calibração Leanstar
 * Papel: Engenheiro de IoT & Desenvolvedor Web Front-end
 * ============================================================================
 */

// ============================================================================
// BLOCO 3: LÓGICA DE CALIBRAÇÃO, FILTRAGEM PASSA-BAIXA E CONVERSÃO ANGULAR
// ============================================================================

/**
 * Filtro Combinado (Média Móvel + Passa-Baixa Exponencial EMA)
 * Evita que o ângulo "trema" (jitter) na tela do paciente devido à oscilação
 * analógica natural das fitas resistivas de carbono/polímero (Leanstar).
 */
class LeanstarSignalFilter {
  constructor(windowSize = 5, alpha = 0.25) {
    this.windowSize = windowSize; // Tamanho da janela da Média Móvel
    this.alpha = alpha;           // Fator de suavização EMA (0.05 = super suave, 1.0 = sem filtro)
    this.buffer = [];
    this.emaValue = null;
  }

  /**
   * Processa uma nova amostra bruta (Voltagem ou ADC) e retorna o sinal estabilizado
   */
  process(rawSample) {
    if (typeof rawSample !== 'number' || isNaN(rawSample)) return 0;

    // 1. Média Móvel Simples (Remove spikes/ruídos impulsivos de curta duração)
    this.buffer.push(rawSample);
    if (this.buffer.length > this.windowSize) {
      this.buffer.shift();
    }
    const movingAvg = this.buffer.reduce((acc, val) => acc + val, 0) / this.buffer.length;

    // 2. Filtro Passa-Baixa Exponencial (EMA - Exponential Moving Average)
    // Garante transição fluida nos ponteiros e medidores visuais da interface
    if (this.emaValue === null) {
      this.emaValue = movingAvg;
    } else {
      this.emaValue = (this.alpha * movingAvg) + ((1.0 - this.alpha) * this.emaValue);
    }

    return this.emaValue;
  }

  reset() {
    this.buffer = [];
    this.emaValue = null;
  }
}

/**
 * Motor de Calibração e Mapeamento Voltagem -> Ângulo Articular (0° a 180°)
 */
class LeanstarAngleConverter {
  constructor() {
    // Valores padrão iniciais (Volts) caso o paciente ainda não tenha calibrado
    this.voltageStraight0Deg = 2.150; // Membro esticado (0°)
    this.voltageBent90Deg    = 1.250; // Membro fletido em 90°
    this.filter = new LeanstarSignalFilter(6, 0.22);
    this.lastFilteredVoltage = 2.150;
  }

  /**
   * Calibra o ponto de extensão total (Membro esticado = 0°)
   * @param {number} currentVoltage Voltagem lida no momento da extensão
   */
  calibrateZeroDegrees(currentVoltage = this.lastFilteredVoltage) {
    this.voltageStraight0Deg = currentVoltage;
    console.info(`[CALIBRAÇÃO LEANSTAR] Ponto 0° (Esticado) salvo em: ${currentVoltage.toFixed(3)} V`);
    return this.voltageStraight0Deg;
  }

  /**
   * Calibra o ponto de flexão de referência (Membro dobrado = 90°)
   * @param {number} currentVoltage Voltagem lida no momento da flexão a 90°
   */
  calibrateNinetyDegrees(currentVoltage = this.lastFilteredVoltage) {
    // Evita divisão por zero caso o usuário clique nos dois botões na mesma posição
    if (Math.abs(currentVoltage - this.voltageStraight0Deg) < 0.02) {
      console.warn("[CALIBRAÇÃO LEANSTAR] A variação de tensão entre 0° e 90° é muito pequena! Dobre mais a fita.");
      return this.voltageBent90Deg;
    }
    this.voltageBent90Deg = currentVoltage;
    console.info(`[CALIBRAÇÃO LEANSTAR] Ponto 90° (Dobrado) salvo em: ${currentVoltage.toFixed(3)} V`);
    return this.voltageBent90Deg;
  }

  /**
   * Converte a voltagem recebida em um ângulo articular suavizado (0° a 180°)
   * Utiliza interpolação/extrapolação linear calibrada com clamping seguro.
   */
  voltageToAngle(rawVoltage) {
    // 1. Filtra o ruído analógico da fita Leanstar
    const cleanVoltage = this.filter.process(rawVoltage);
    this.lastFilteredVoltage = cleanVoltage;

    // 2. Interpolação Linear baseada nos 2 pontos de calibração (0° e 90°)
    // Equação da reta: Angle = ((V_atual - V_0) / (V_90 - V_0)) * 90.0
    const deltaVCalib = this.voltageBent90Deg - this.voltageStraight0Deg;
    if (Math.abs(deltaVCalib) < 0.001) return 0.0;

    let angleDeg = ((cleanVoltage - this.voltageStraight0Deg) / deltaVCalib) * 90.0;

    // 3. Clamping Fisiológico (Limita a leitura entre 0.0° e 180.0°)
    angleDeg = Math.max(0.0, Math.min(180.0, angleDeg));

    return parseFloat(angleDeg.toFixed(1));
  }
}

// ============================================================================
// BLOCO 2: COMUNICAÇÃO WEB BLUETOOTH API (PAREAMENTO E STREAMING BLE)
// ============================================================================

class LeanstarBLEManager {
  constructor(angleConverter, onDataCallback) {
    this.SERVICE_UUID        = "19b10000-e8f2-537e-4f6c-d104768a1214";
    this.CHARACTERISTIC_UUID = "19b10001-e8f2-537e-4f6c-d104768a1214";

    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.isConnected = false;

    this.converter = angleConverter || new LeanstarAngleConverter();
    this.onDataCallback = onDataCallback || (() => {});
  }

  /**
   * Solicita pareamento com o microcontrolador via navegador (Web Bluetooth API)
   */
  async connect() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth API não suportada neste navegador. Utilize Google Chrome ou Edge.");
    }

    try {
      console.log("[WEB BLE] Buscando sensor BioPhysio-Leanstar...");
      
      // 1. Abre o seletor nativo do navegador filtrando pelo Service UUID
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: "BioPhysio" },
          { namePrefix: "ESP" },
          { namePrefix: "Arduino" },
          { namePrefix: "HM" },
          { namePrefix: "BT" },
          { services: [this.SERVICE_UUID] }
        ],
        optionalServices: [this.SERVICE_UUID]
      });

      this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnection());

      // 2. Conecta ao servidor GATT do microcontrolador
      console.log(`[WEB BLE] Conectando ao GATT Server de ${this.device.name}...`);
      this.server = await this.device.gatt.connect();

      // 3. Obtém o Serviço Primário e a Característica de Notificação
      const service = await this.server.getPrimaryService(this.SERVICE_UUID);
      this.characteristic = await service.getCharacteristic(this.CHARACTERISTIC_UUID);

      // 4. Assina (Subscribe) as notificações em tempo real da fita Leanstar
      await this.characteristic.startNotifications();
      this.characteristic.addEventListener(
        'characteristicvaluechanged',
        (event) => this.handleCharacteristicNotification(event)
      );

      this.isConnected = true;
      console.log("[WEB BLE] Pareado com sucesso! Recebendo stream de dados Leanstar...");
      return true;
    } catch (error) {
      console.error("[WEB BLE] Erro ao conectar:", error);
      throw error;
    }
  }

  /**
   * Callback disparado automaticamente a cada pacote BLE recebido do Arduino/ESP32
   */
  handleCharacteristicNotification(event) {
    const dataView = event.target.value;
    let rawAdc = 0;
    let voltage = 0.0;
    let resistanceOhms = 0.0;

    // Suporta tanto o Struct Binário de 12 bytes (Little-Endian) quanto String UTF-8
    if (dataView.byteLength >= 12) {
      rawAdc         = dataView.getUint16(0, true); // Bytes 0..1: uint16_t rawAdc
      voltage        = dataView.getFloat32(4, true); // Bytes 4..7: float voltage
      resistanceOhms = dataView.getFloat32(8, true); // Bytes 8..11: float resistanceOhms
    } else {
      // Fallback caso o firmware envie apenas a string ou uint16
      const decoder = new TextDecoder('utf-8');
      const textVal = parseFloat(decoder.decode(dataView));
      rawAdc = isNaN(textVal) ? 0 : textVal;
      voltage = (rawAdc * 3.3) / 4095.0;
      resistanceOhms = voltage > 0.05 ? 47000.0 * ((3.3 / voltage) - 1.0) : 0;
    }

    // Calcula o ângulo filtrado e calibrado
    const angleDeg = this.converter.voltageToAngle(voltage);

    // VERIFICAÇÃO DE SUCESSO: Exibe os valores brutos e processados no Console (F12)
    console.log(
      `[BLE STREAM] ADC Bruto: ${rawAdc} | Tensão: ${voltage.toFixed(3)}V | Resistência: ${Math.round(resistanceOhms)}Ω | Ângulo Suavizado: ${angleDeg.toFixed(1)}°`
    );

    // Envia os dados estruturados para atualizar a tela do paciente (HUD)
    this.onDataCallback({
      timestamp: Date.now(),
      rawAdc,
      voltage: parseFloat(voltage.toFixed(3)),
      filteredVoltage: parseFloat(this.converter.lastFilteredVoltage.toFixed(3)),
      resistanceOhms: Math.round(resistanceOhms),
      angleDeg
    });
  }

  handleDisconnection() {
    this.isConnected = false;
    console.warn("[WEB BLE] Dispositivo Leanstar desconectado.");
  }

  async disconnect() {
    if (this.device && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
  }
}

window.LeanstarSignalFilter = LeanstarSignalFilter;
window.LeanstarAngleConverter = LeanstarAngleConverter;
window.LeanstarBLEManager = LeanstarBLEManager;
