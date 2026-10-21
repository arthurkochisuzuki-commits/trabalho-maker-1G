/**
 * ============================================================================
 * BioPhysio AI - Firmware IoT para Sensor de Flexão Leanstar (ESP32 BLE)
 * Papel: Engenheiro de IoT & Firmware C++
 * ============================================================================
 * Circuito Divisor de Tensão (Voltage Divider):
 *   3.3V (VCC) ---> [Sensor Flex Leanstar R_flex] ---> Pino ADC (GPIO 34) ---> [Resistor Fixo R_fixo 47kΩ] ---> GND
 * 
 * Equação da Tensão de Saída (V_out):
 *   V_out = VCC * (R_fixo / (R_flex + R_fixo))
 *   Isolando R_flex:
 *   R_flex = R_fixo * ((VCC / V_out) - 1.0)
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// --- Configurações de Hardware e Divisor de Tensão ---
#define FLEX_PIN        34          // Porta ADC1 (GPIO 34 no ESP32)
#define VCC             3.3         // Tensão de referência da placa (3.3V)
#define ADC_RESOLUTION  4095.0      // Resolução ADC de 12 bits (0 a 4095)
#define R_DIVIDER       47000.0     // Resistor estático do divisor de tensão (47kΩ)

// --- UUIDs do Serviço e Característica BLE ---
#define SERVICE_UUID        "19b10000-e8f2-537e-4f6c-d104768a1214"
#define CHARACTERISTIC_UUID "19b10001-e8f2-537e-4f6c-d104768a1214"

BLEServer* pServer = NULL;
BLECharacteristic* pFlexCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;

// --- Pacote Binário Compacto (12 Bytes) para Notificação BLE ---
#pragma pack(push, 1)
struct FlexSensorPacket {
  uint16_t rawAdc;        // Valor bruto do ADC (0 - 4095)
  uint16_t reserved;      // Alinhamento de memória
  float voltage;          // Voltagem calculada em Volts (V)
  float resistanceOhms;   // Resistência da fita Leanstar em Ohms (Ω)
};
#pragma pack(pop)

// --- Callbacks de Conexão BLE ---
class MyServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    Serial.println("[BLE] Cliente Web Conectado!");
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    Serial.println("[BLE] Cliente Web Desconectado!");
  }
};

void setup() {
  Serial.begin(115200);
  
  // Configura resolução do ADC do ESP32 para 12 bits e atenuação para leitura até ~3.3V
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  pinMode(FLEX_PIN, INPUT);

  Serial.println("====================================================");
  Serial.println("Iniciando BioPhysio IoT - Sensor Leanstar BLE...");
  Serial.println("====================================================");

  // 1. Inicializa o Dispositivo BLE
  BLEDevice::init("BioPhysio-Leanstar");

  // 2. Cria o Servidor BLE
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // 3. Cria o Serviço BLE
  BLEService *pService = pServer->createService(SERVICE_UUID);

  // 4. Cria a Characteristic com permissão de Leitura e Notificação Contínua
  pFlexCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );

  // Adiciona descritor CCCD (0x2902) obrigatório para Web Bluetooth assinar notificações
  pFlexCharacteristic->addDescriptor(new BLE2902());

  // 5. Inicia o Serviço e o Advertising (Anúncio de descoberta)
  pService->start();
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06); // Ajuda na conexão rápida com Web Bluetooth / iOS / Android
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Aguardando pareamento na aplicação Web...");
}

void loop() {
  // 1. Leitura com Oversampling Simples (8 amostras) para mitigar ruído elétrico do ADC
  uint32_t adcSum = 0;
  const int samples = 8;
  for (int i = 0; i < samples; i++) {
    adcSum += analogRead(FLEX_PIN);
    delayMicroseconds(250);
  }
  uint16_t rawAdc = adcSum / samples;

  // 2. Cálculo da Voltagem Exata (V_out)
  float voltage = (rawAdc * VCC) / ADC_RESOLUTION;

  // 3. Cálculo da Resistência Instantânea da Fita Leanstar (Ohms)
  float resistanceOhms = 0.0;
  if (voltage > 0.01 && voltage < (VCC - 0.01)) {
    // Caso A: Sensor ligado ao VCC e Resistor Fixo ao GND -> R_flex = R_fixo * ((VCC / V_out) - 1)
    resistanceOhms = R_DIVIDER * ((VCC / voltage) - 1.0);
  }

  // 4. Verificação de Sucesso no Monitor Serial
  Serial.print("[LEANSTAR] ADC Bruto: ");
  Serial.print(rawAdc);
  Serial.print(" | Tensão: ");
  Serial.print(voltage, 3);
  Serial.print(" V | Resistência: ");
  Serial.print(resistanceOhms, 1);
  Serial.println(" Ohms");

  // 5. Envio Contínuo via BLE (Notify) se o Front-end estiver conectado
  if (deviceConnected) {
    FlexSensorPacket packet;
    packet.rawAdc = rawAdc;
    packet.reserved = 0;
    packet.voltage = voltage;
    packet.resistanceOhms = resistanceOhms;

    pFlexCharacteristic->setValue((uint8_t*)&packet, sizeof(FlexSensorPacket));
    pFlexCharacteristic->notify();
  }

  // Gerenciamento de Reconexão Automática do Advertising
  if (!deviceConnected && oldDeviceConnected) {
    delay(300); // Aguarda a pilha Bluetooth estabilizar
    pServer->startAdvertising();
    Serial.println("[BLE] Reiniciando Advertising...");
    oldDeviceConnected = deviceConnected;
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
  }

  // Taxa de amostragem de 50Hz (a cada 20ms) ideal para reabilitação em tempo real
  delay(20);
}
