/**
 * KaRaFoN Audio Manager
 * Управление микрофоном, аудио эффектами и визуализацией
 */

class AudioManager {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.gainNode = null;
    this.analyserNode = null;
    this.destinationNode = null;
    this.effectNodes = [];

    this.isInitialized = false;
    this.isMicEnabled = false;
    this.isMonitoringEnabled = false;
    this.currentEffect = 'none';
    this.volume = 1.0;

    // Режим Bluetooth - отключает обработку аудио чтобы не переключать профиль
    this.bluetoothMode = true;

    this.devices = {
      microphones: [],
      speakers: []
    };
  }

  /**
   * Инициализация Audio Context
   */
  async init() {
    if (this.isInitialized) return true;

    try {
      // Создаём Audio Context
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

      // Получаем список устройств
      await this.updateDeviceList();

      // Слушаем изменения устройств
      navigator.mediaDevices.addEventListener('devicechange', () => {
        this.updateDeviceList();
      });

      this.isInitialized = true;
      console.log('AudioManager initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize AudioManager:', error);
      return false;
    }
  }

  /**
   * Обновить список аудио устройств
   */
  async updateDeviceList() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();

      this.devices.microphones = devices.filter(d => d.kind === 'audioinput');
      this.devices.speakers = devices.filter(d => d.kind === 'audiooutput');

      console.log('Audio devices updated:', this.devices);
      return this.devices;
    } catch (error) {
      console.error('Failed to enumerate devices:', error);
      return this.devices;
    }
  }

  /**
   * Установить режим Bluetooth
   * В этом режиме отключается вся обработка аудио чтобы не переключать
   * Bluetooth с A2DP (музыка) на HFP (гарнитура)
   */
  setBluetoothMode(enabled) {
    this.bluetoothMode = enabled;
    console.log('Bluetooth mode:', enabled ? 'ON' : 'OFF');
  }

  /**
   * Запросить доступ к микрофону
   */
  async requestMicrophoneAccess(deviceId = null) {
    try {
      // В режиме Bluetooth отключаем ВСЮ обработку аудио
      // Это предотвращает переключение Bluetooth профиля с A2DP на HFP
      const constraints = {
        audio: this.bluetoothMode ? {
          // Bluetooth режим - минимальные требования
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          // Не указываем sampleRate и channelCount - пусть система выберет
          ...(deviceId && { deviceId: { exact: deviceId } })
        } : {
          // Обычный режим с обработкой
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          ...(deviceId && { deviceId: { exact: deviceId } })
        }
      };

      console.log('Requesting microphone with constraints:', constraints);

      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Обновляем список устройств после получения разрешения
      await this.updateDeviceList();

      console.log('Microphone access granted, Bluetooth mode:', this.bluetoothMode);
      return true;
    } catch (error) {
      console.error('Microphone access denied:', error);
      return false;
    }
  }

  /**
   * Настройка аудио цепочки
   */
  setupAudioChain() {
    if (!this.audioContext || !this.mediaStream) return false;

    // Убираем предыдущую цепочку
    this.disconnectAll();

    // Создаём узлы
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.gainNode = this.audioContext.createGain();
    this.analyserNode = this.audioContext.createAnalyser();

    // Настройки анализатора
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.8;

    // Устанавливаем громкость
    this.gainNode.gain.value = this.volume;

    // Базовая цепочка: source -> gain -> analyser
    this.sourceNode.connect(this.gainNode);
    this.gainNode.connect(this.analyserNode);

    // Применяем эффект если выбран
    this.applyEffect(this.currentEffect);

    console.log('Audio chain setup complete');
    return true;
  }

  /**
   * Включить мониторинг (воспроизведение микрофона через динамики)
   */
  enableMonitoring(enabled) {
    if (!this.audioContext || !this.analyserNode) return;

    this.isMonitoringEnabled = enabled;

    if (enabled) {
      this.analyserNode.connect(this.audioContext.destination);
      console.log('Monitoring enabled');
    } else {
      try {
        this.analyserNode.disconnect(this.audioContext.destination);
      } catch (e) {
        // Может быть не подключен
      }
      console.log('Monitoring disabled');
    }
  }

  /**
   * Применить аудио эффект
   */
  applyEffect(effectName) {
    if (!this.audioContext || !this.gainNode || !this.analyserNode) return;

    // Отключаем старые эффекты
    this.effectNodes.forEach(node => {
      try { node.disconnect(); } catch (e) {}
    });
    this.effectNodes = [];

    // Отключаем gainNode от analyser для перестройки цепочки
    try { this.gainNode.disconnect(); } catch (e) {}

    this.currentEffect = effectName;
    let lastNode = this.gainNode;

    switch (effectName) {
      case 'reverb':
        lastNode = this.createReverbEffect(lastNode);
        break;

      case 'echo':
        lastNode = this.createEchoEffect(lastNode);
        break;

      case 'telephone':
        lastNode = this.createTelephoneEffect(lastNode);
        break;

      case 'deep':
        lastNode = this.createDeepEffect(lastNode);
        break;

      case 'high':
        lastNode = this.createHighEffect(lastNode);
        break;

      case 'robot':
        lastNode = this.createRobotEffect(lastNode);
        break;

      default:
        // Без эффекта
        break;
    }

    // Подключаем к анализатору
    lastNode.connect(this.analyserNode);

    // Если мониторинг включен, подключаем к выводу
    if (this.isMonitoringEnabled) {
      this.analyserNode.connect(this.audioContext.destination);
    }

    console.log(`Effect applied: ${effectName}`);
  }

  /**
   * Эффект реверберации (концертный зал)
   */
  createReverbEffect(inputNode) {
    const convolver = this.audioContext.createConvolver();
    const wetGain = this.audioContext.createGain();
    const dryGain = this.audioContext.createGain();
    const output = this.audioContext.createGain();

    // Генерируем импульсный отклик
    const sampleRate = this.audioContext.sampleRate;
    const length = sampleRate * 2; // 2 секунды
    const impulse = this.audioContext.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const channelData = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
      }
    }

    convolver.buffer = impulse;

    wetGain.gain.value = 0.4;
    dryGain.gain.value = 0.8;

    inputNode.connect(dryGain);
    inputNode.connect(convolver);
    convolver.connect(wetGain);
    dryGain.connect(output);
    wetGain.connect(output);

    this.effectNodes.push(convolver, wetGain, dryGain, output);
    return output;
  }

  /**
   * Эффект эхо
   */
  createEchoEffect(inputNode) {
    const delay = this.audioContext.createDelay(1.0);
    const feedback = this.audioContext.createGain();
    const wetGain = this.audioContext.createGain();
    const output = this.audioContext.createGain();

    delay.delayTime.value = 0.3;
    feedback.gain.value = 0.4;
    wetGain.gain.value = 0.5;

    inputNode.connect(output);
    inputNode.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wetGain);
    wetGain.connect(output);

    this.effectNodes.push(delay, feedback, wetGain, output);
    return output;
  }

  /**
   * Эффект телефона (узкая полоса частот)
   */
  createTelephoneEffect(inputNode) {
    const highpass = this.audioContext.createBiquadFilter();
    const lowpass = this.audioContext.createBiquadFilter();
    const distortion = this.audioContext.createWaveShaper();

    highpass.type = 'highpass';
    highpass.frequency.value = 500;

    lowpass.type = 'lowpass';
    lowpass.frequency.value = 3000;

    // Небольшое искажение
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i - 128) / 128;
      curve[i] = Math.tanh(x * 2);
    }
    distortion.curve = curve;

    inputNode.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(distortion);

    this.effectNodes.push(highpass, lowpass, distortion);
    return distortion;
  }

  /**
   * Эффект глубокого баса
   */
  createDeepEffect(inputNode) {
    const lowShelf = this.audioContext.createBiquadFilter();
    const highShelf = this.audioContext.createBiquadFilter();

    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 300;
    lowShelf.gain.value = 8;

    highShelf.type = 'highshelf';
    highShelf.frequency.value = 3000;
    highShelf.gain.value = -4;

    inputNode.connect(lowShelf);
    lowShelf.connect(highShelf);

    this.effectNodes.push(lowShelf, highShelf);
    return highShelf;
  }

  /**
   * Эффект высокого голоса
   */
  createHighEffect(inputNode) {
    const lowShelf = this.audioContext.createBiquadFilter();
    const highShelf = this.audioContext.createBiquadFilter();

    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 300;
    lowShelf.gain.value = -6;

    highShelf.type = 'highshelf';
    highShelf.frequency.value = 2000;
    highShelf.gain.value = 6;

    inputNode.connect(lowShelf);
    lowShelf.connect(highShelf);

    this.effectNodes.push(lowShelf, highShelf);
    return highShelf;
  }

  /**
   * Эффект робота
   */
  createRobotEffect(inputNode) {
    const oscillator = this.audioContext.createOscillator();
    const oscillatorGain = this.audioContext.createGain();
    const ringModulator = this.audioContext.createGain();

    oscillator.frequency.value = 50;
    oscillator.type = 'sawtooth';
    oscillatorGain.gain.value = 0.5;

    oscillator.connect(oscillatorGain);
    oscillatorGain.connect(ringModulator.gain);
    oscillator.start();

    inputNode.connect(ringModulator);

    this.effectNodes.push(oscillator, oscillatorGain, ringModulator);
    return ringModulator;
  }

  /**
   * Установить громкость микрофона
   */
  setVolume(value) {
    this.volume = value;
    if (this.gainNode) {
      this.gainNode.gain.value = value;
    }
  }

  /**
   * Получить данные для визуализации
   */
  getVisualizerData() {
    if (!this.analyserNode) return null;

    const bufferLength = this.analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyserNode.getByteFrequencyData(dataArray);

    return dataArray;
  }

  /**
   * Получить уровень громкости
   */
  getVolumeLevel() {
    if (!this.analyserNode) return 0;

    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const value = (dataArray[i] - 128) / 128;
      sum += value * value;
    }

    return Math.sqrt(sum / dataArray.length);
  }

  /**
   * Сменить микрофон
   */
  async switchMicrophone(deviceId) {
    if (!deviceId) return false;

    try {
      // Останавливаем текущий поток
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
      }

      // Получаем новый поток
      const success = await this.requestMicrophoneAccess(deviceId);
      if (success) {
        this.setupAudioChain();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to switch microphone:', error);
      return false;
    }
  }

  /**
   * Сменить динамик (если поддерживается)
   */
  async switchSpeaker(deviceId) {
    if (!deviceId) return false;

    try {
      // Используем setSinkId если поддерживается
      const audioElements = document.querySelectorAll('audio, video');
      for (const element of audioElements) {
        if (element.setSinkId) {
          await element.setSinkId(deviceId);
        }
      }
      console.log('Speaker switched to:', deviceId);
      return true;
    } catch (error) {
      console.error('Failed to switch speaker:', error);
      return false;
    }
  }

  /**
   * Включить/выключить микрофон
   */
  setMicEnabled(enabled) {
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
      this.isMicEnabled = enabled;
      console.log('Microphone', enabled ? 'enabled' : 'disabled');
    }
  }

  /**
   * Отключить все узлы
   */
  disconnectAll() {
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (e) {}
    }
    if (this.gainNode) {
      try { this.gainNode.disconnect(); } catch (e) {}
    }
    if (this.analyserNode) {
      try { this.analyserNode.disconnect(); } catch (e) {}
    }
    this.effectNodes.forEach(node => {
      try { node.disconnect(); } catch (e) {}
    });
  }

  /**
   * Получить поток для WebRTC
   */
  getOutputStream() {
    if (!this.audioContext || !this.analyserNode) return null;

    // Создаём destination для WebRTC
    const destination = this.audioContext.createMediaStreamDestination();
    this.analyserNode.connect(destination);

    return destination.stream;
  }

  /**
   * Освободить ресурсы
   */
  destroy() {
    this.disconnectAll();

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }

    this.isInitialized = false;
    console.log('AudioManager destroyed');
  }
}

// Экспортируем глобально
window.AudioManager = AudioManager;
