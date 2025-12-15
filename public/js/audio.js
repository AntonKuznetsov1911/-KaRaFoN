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

    // Узлы для улучшения качества звука
    this.highpassFilter = null;  // Убирает низкочастотный гул
    this.lowpassFilter = null;   // Убирает высокочастотный шум
    this.compressor = null;      // Выравнивает громкость
    this.limiter = null;         // Предотвращает искажения
    this.noiseGate = null;       // Убирает тихий шум

    this.isInitialized = false;
    this.isMicEnabled = false;
    this.isMonitoringEnabled = false;
    this.currentEffect = 'none';
    this.volume = 0.5; // Снижена с 1.0 для предотвращения feedback

    // Режим Bluetooth - отключает обработку аудио чтобы не переключать профиль
    this.bluetoothMode = true;

    // Настройки качества звука
    this.audioEnhancement = true;
    this.noiseGateEnabled = true;
    this.noiseGateThreshold = -45; // dB
    this.deEsserEnabled = true;
    this.presenceEnabled = true;
    this.warmthEnabled = false;

    // Вокальные пресеты
    this.vocalPreset = 'natural'; // natural, bright, warm, radio, telephone

    // Дополнительные узлы
    this.deEsserFilter = null;
    this.presenceFilter = null;
    this.warmthFilter = null;
    this.noiseGateGain = null;

    // Noise Gate состояние
    this.noiseGateOpen = false;
    this.noiseGateAnimationId = null;

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
      // Создаём Audio Context с минимальной задержкой
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextClass({
        latencyHint: 'interactive',  // Минимальная задержка
        sampleRate: 48000            // Высокое качество
      });

      console.log('AudioContext created, latency:', this.audioContext.baseLatency, 'sample rate:', this.audioContext.sampleRate);

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
    this.stopNoiseGate();

    // Создаём источник
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

    // === УЛУЧШЕНИЕ КАЧЕСТВА ЗВУКА ===

    // 1. High-pass фильтр - убирает низкочастотный гул (< 80 Hz)
    this.highpassFilter = this.audioContext.createBiquadFilter();
    this.highpassFilter.type = 'highpass';
    this.highpassFilter.frequency.value = 80;
    this.highpassFilter.Q.value = 0.7;

    // 2. Low-pass фильтр - убирает высокочастотный шум (> 12000 Hz)
    this.lowpassFilter = this.audioContext.createBiquadFilter();
    this.lowpassFilter.type = 'lowpass';
    this.lowpassFilter.frequency.value = 12000;
    this.lowpassFilter.Q.value = 0.7;

    // 3. De-esser - убирает резкие "с", "ш" звуки (4-8 kHz)
    this.deEsserFilter = this.audioContext.createBiquadFilter();
    this.deEsserFilter.type = 'peaking';
    this.deEsserFilter.frequency.value = 6000;
    this.deEsserFilter.Q.value = 2;
    this.deEsserFilter.gain.value = this.deEsserEnabled ? -6 : 0;

    // 4. Presence - добавляет чёткость голосу (2-4 kHz)
    this.presenceFilter = this.audioContext.createBiquadFilter();
    this.presenceFilter.type = 'peaking';
    this.presenceFilter.frequency.value = 3000;
    this.presenceFilter.Q.value = 1;
    this.presenceFilter.gain.value = this.presenceEnabled ? 3 : 0;

    // 5. Warmth - добавляет теплоту (200-400 Hz)
    this.warmthFilter = this.audioContext.createBiquadFilter();
    this.warmthFilter.type = 'peaking';
    this.warmthFilter.frequency.value = 250;
    this.warmthFilter.Q.value = 1;
    this.warmthFilter.gain.value = this.warmthEnabled ? 4 : 0;

    // 6. Компрессор - выравнивает громкость, делает голос чётче
    this.compressor = this.audioContext.createDynamicsCompressor();
    this.compressor.threshold.value = -24;  // Порог срабатывания (dB)
    this.compressor.knee.value = 12;        // Мягкость перехода
    this.compressor.ratio.value = 4;        // Степень сжатия
    this.compressor.attack.value = 0.003;   // Быстрая атака (3ms)
    this.compressor.release.value = 0.15;   // Быстрый релиз (150ms)

    // 7. Noise Gate Gain - для программного noise gate
    this.noiseGateGain = this.audioContext.createGain();
    this.noiseGateGain.gain.value = 1;

    // 8. Gain узел для громкости
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = this.volume;

    // 9. Лимитер - предотвращает клиппинг и искажения
    this.limiter = this.audioContext.createDynamicsCompressor();
    this.limiter.threshold.value = -3;      // Почти на максимуме
    this.limiter.knee.value = 0;            // Жёсткий лимит
    this.limiter.ratio.value = 20;          // Сильное ограничение
    this.limiter.attack.value = 0.001;      // Мгновенная атака
    this.limiter.release.value = 0.1;       // Быстрый релиз

    // 10. Анализатор для визуализации
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.8;

    // === СБОРКА ЦЕПОЧКИ ===
    // source -> highpass -> lowpass -> deesser -> presence -> warmth ->
    // compressor -> noiseGate -> gain -> limiter -> analyser

    if (this.audioEnhancement) {
      this.sourceNode.connect(this.highpassFilter);
      this.highpassFilter.connect(this.lowpassFilter);
      this.lowpassFilter.connect(this.deEsserFilter);
      this.deEsserFilter.connect(this.presenceFilter);
      this.presenceFilter.connect(this.warmthFilter);
      this.warmthFilter.connect(this.compressor);
      this.compressor.connect(this.noiseGateGain);
      this.noiseGateGain.connect(this.gainNode);
      this.gainNode.connect(this.limiter);
      this.limiter.connect(this.analyserNode);

      // Запускаем Noise Gate если включен
      if (this.noiseGateEnabled) {
        this.startNoiseGate();
      }

      console.log('Audio chain with full enhancement setup');
    } else {
      // Простая цепочка без обработки
      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(this.analyserNode);
      console.log('Audio chain without enhancement setup');
    }

    // Применяем вокальный пресет
    this.applyVocalPreset(this.vocalPreset);

    // Применяем эффект если выбран
    this.applyEffect(this.currentEffect);

    console.log('Audio chain setup complete');
    return true;
  }

  /**
   * Noise Gate - глушит микрофон когда не поёшь
   */
  startNoiseGate() {
    if (this.noiseGateAnimationId) return;

    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 512;
    this.sourceNode.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);

    const checkLevel = () => {
      analyser.getFloatTimeDomainData(dataArray);

      // Вычисляем RMS (громкость)
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / bufferLength);
      const db = 20 * Math.log10(rms + 0.0001);

      // Открываем/закрываем gate
      const targetGain = db > this.noiseGateThreshold ? 1 : 0;

      // Плавное изменение (10ms attack, 100ms release)
      const currentTime = this.audioContext.currentTime;
      if (targetGain > this.noiseGateGain.gain.value) {
        // Attack - быстро открываем
        this.noiseGateGain.gain.linearRampToValueAtTime(targetGain, currentTime + 0.01);
      } else {
        // Release - плавно закрываем
        this.noiseGateGain.gain.linearRampToValueAtTime(targetGain, currentTime + 0.1);
      }

      this.noiseGateOpen = targetGain > 0.5;
      this.noiseGateAnimationId = requestAnimationFrame(checkLevel);
    };

    checkLevel();
    console.log('Noise Gate started, threshold:', this.noiseGateThreshold, 'dB');
  }

  stopNoiseGate() {
    if (this.noiseGateAnimationId) {
      cancelAnimationFrame(this.noiseGateAnimationId);
      this.noiseGateAnimationId = null;
    }
  }

  /**
   * Установить порог Noise Gate
   */
  setNoiseGateThreshold(threshold) {
    this.noiseGateThreshold = threshold;
    console.log('Noise Gate threshold:', threshold, 'dB');
  }

  /**
   * Включить/выключить Noise Gate
   */
  setNoiseGateEnabled(enabled) {
    this.noiseGateEnabled = enabled;
    if (enabled && this.audioEnhancement && this.mediaStream) {
      this.startNoiseGate();
    } else {
      this.stopNoiseGate();
      if (this.noiseGateGain) {
        this.noiseGateGain.gain.value = 1;
      }
    }
    console.log('Noise Gate:', enabled ? 'ON' : 'OFF');
  }

  /**
   * Включить/выключить De-esser
   */
  setDeEsserEnabled(enabled) {
    this.deEsserEnabled = enabled;
    if (this.deEsserFilter) {
      this.deEsserFilter.gain.value = enabled ? -6 : 0;
    }
    console.log('De-esser:', enabled ? 'ON' : 'OFF');
  }

  /**
   * Включить/выключить Presence
   */
  setPresenceEnabled(enabled) {
    this.presenceEnabled = enabled;
    if (this.presenceFilter) {
      this.presenceFilter.gain.value = enabled ? 3 : 0;
    }
    console.log('Presence:', enabled ? 'ON' : 'OFF');
  }

  /**
   * Включить/выключить Warmth
   */
  setWarmthEnabled(enabled) {
    this.warmthEnabled = enabled;
    if (this.warmthFilter) {
      this.warmthFilter.gain.value = enabled ? 4 : 0;
    }
    console.log('Warmth:', enabled ? 'ON' : 'OFF');
  }

  /**
   * Применить вокальный пресет
   */
  applyVocalPreset(preset) {
    this.vocalPreset = preset;

    if (!this.audioEnhancement) return;

    // Сбрасываем все настройки
    const presets = {
      natural: {
        highpass: 80, lowpass: 12000,
        deesser: -4, presence: 2, warmth: 0,
        compThreshold: -24, compRatio: 3
      },
      bright: {
        highpass: 100, lowpass: 14000,
        deesser: -3, presence: 5, warmth: -2,
        compThreshold: -20, compRatio: 4
      },
      warm: {
        highpass: 60, lowpass: 10000,
        deesser: -6, presence: 0, warmth: 5,
        compThreshold: -26, compRatio: 3
      },
      radio: {
        highpass: 120, lowpass: 8000,
        deesser: -8, presence: 6, warmth: 2,
        compThreshold: -18, compRatio: 6
      },
      powerful: {
        highpass: 80, lowpass: 12000,
        deesser: -4, presence: 4, warmth: 3,
        compThreshold: -20, compRatio: 5
      }
    };

    const p = presets[preset] || presets.natural;

    if (this.highpassFilter) this.highpassFilter.frequency.value = p.highpass;
    if (this.lowpassFilter) this.lowpassFilter.frequency.value = p.lowpass;
    if (this.deEsserFilter) this.deEsserFilter.gain.value = this.deEsserEnabled ? p.deesser : 0;
    if (this.presenceFilter) this.presenceFilter.gain.value = this.presenceEnabled ? p.presence : 0;
    if (this.warmthFilter) this.warmthFilter.gain.value = this.warmthEnabled ? p.warmth : 0;
    if (this.compressor) {
      this.compressor.threshold.value = p.compThreshold;
      this.compressor.ratio.value = p.compRatio;
    }

    console.log('Vocal preset applied:', preset);
  }

  /**
   * Включить/выключить улучшение звука
   */
  setAudioEnhancement(enabled) {
    this.audioEnhancement = enabled;
    console.log('Audio enhancement:', enabled ? 'ON' : 'OFF');
    // Перестраиваем цепочку
    if (this.mediaStream) {
      this.setupAudioChain();
    }
  }

  /**
   * Включить/выключить мониторинг
   * ВНИМАНИЕ: Может вызвать feedback! Используйте наушники
   */
  enableMonitoring(enabled) {
    if (!this.audioContext || !this.analyserNode) return;

    this.isMonitoringEnabled = enabled;

    if (enabled) {
      // Создаём gain для мониторинга с пониженной громкостью (30%)
      if (!this.monitorGainNode) {
        this.monitorGainNode = this.audioContext.createGain();
        this.monitorGainNode.gain.value = 0.3; // Сильно снижаем для предотвращения feedback
      }

      this.analyserNode.connect(this.monitorGainNode);
      this.monitorGainNode.connect(this.audioContext.destination);
      console.log('⚠️ Monitoring enabled - используйте наушники!');
    } else {
      try {
        if (this.monitorGainNode) {
          this.analyserNode.disconnect(this.monitorGainNode);
          this.monitorGainNode.disconnect(this.audioContext.destination);
        }
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
    const nodes = [
      this.sourceNode,
      this.gainNode,
      this.analyserNode,
      this.highpassFilter,
      this.lowpassFilter,
      this.compressor,
      this.limiter,
      this.deEsserFilter,
      this.presenceFilter,
      this.warmthFilter,
      this.noiseGateGain,
      this.monitorGainNode
    ];

    nodes.forEach(node => {
      if (node) {
        try { node.disconnect(); } catch (e) {}
      }
    });

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
