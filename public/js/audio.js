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

    // Режим Bluetooth - отключает обработку аудио чтобы не переключать профиль.
    // По умолчанию ВКЛЮЧЁН: колонка остаётся в A2DP (стерео), динамик телефона не используется.
    // Выключить нужно только при использовании наушников/гарнитуры в режиме комнаты.
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

    // Anti-feedback
    this.antiFeedbackEnabled = true;
    this.antiFeedbackFilters = [];
    this.feedbackFrequencies = [1000, 2000, 4000]; // Типичные частоты обратной связи

    // Задержка для синхронизации с Bluetooth
    this.delayNode = null;
    this.delayTime = 0; // мс

    // Stereo spread
    this.stereoEnabled = false;
    this.stereoSpreadNode = null;

    // Noise Gate состояние
    this.noiseGateOpen = false;
    this.noiseGateAnimationId = null;

    // Уровень сигнала для индикатора
    this.currentLevel = 0;
    this.peakLevel = 0;
    this.levelCallbacks = [];

    this.devices = {
      microphones: [],
      speakers: []
    };

    // Callback: вызывается когда подключается/отключается аудиоустройство
    this.onDeviceChange = null;
  }

  /**
   * Инициализация Audio Context
   */
  async init() {
    if (this.isInitialized) return true;

    try {
      // Создаём Audio Context
      // iOS/Safari требует особой обработки
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;

      // Не указываем sampleRate для iOS совместимости - система выберет сама
      this.audioContext = new AudioContextClass({
        latencyHint: 'interactive'  // Лучше работает на iOS чем 'playback'
      });

      // iOS: AudioContext создаётся в suspended состоянии, нужно resume
      if (this.audioContext.state === 'suspended') {
        console.log('AudioContext suspended, will resume on user interaction');
      }

      console.log('AudioContext created, state:', this.audioContext.state,
                  'base latency:', (this.audioContext.baseLatency || 0) * 1000, 'ms, sample rate:', this.audioContext.sampleRate);

      // Получаем список устройств
      await this.updateDeviceList();

      // Слушаем изменения устройств (подключение/отключение BT-колонки, наушников и т.д.)
      navigator.mediaDevices.addEventListener('devicechange', async () => {
        await this.updateDeviceList();
        if (this.onDeviceChange) {
          this.onDeviceChange(this.devices);
        }
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
   * Разблокировать параллельное воспроизведение музыки
   *
   * Проблема: когда браузер активирует AudioContext + getUserMedia, он по умолчанию
   * запрашивает у ОС эксклюзивный аудио-фокус → Spotify/YouTube паузируются.
   *
   * Решения:
   * 1. navigator.audioSession API (Chrome 120+, Safari 17.4+) — явно говорим ОС,
   *    что мы хотим смешиваться с другим аудио (playback: ambient).
   * 2. Тихий буфер (iOS trick) — воспроизводим 1 сэмпл тишины при user gesture.
   *    Это принуждает iOS Safari перейти в AVAudioSession.Category.playAndRecord
   *    с опцией .mixWithOthers вместо эксклюзивного режима.
   *
   * ВАЖНО: вызывать ТОЛЬКО во время user gesture (клик кнопки).
   */
  async unlockAudioMixing() {
    // ── 1. Web AudioSession API (экспериментальный, не везде работает) ──
    if ('audioSession' in navigator) {
      try {
        // 'play-and-record' = пишем микрофон + выводим звук, но не прерываем других
        // На iOS это открывает путь к AVAudioSessionCategoryPlayAndRecord+mixWithOthers
        navigator.audioSession.type = 'play-and-record';
        console.log('[Audio] navigator.audioSession.type = play-and-record');
      } catch (e) {
        console.warn('[Audio] navigator.audioSession failed:', e.message);
      }
    }

    // ── 2. Тихий буфер (iOS/Android trick) ──
    // Воспроизводим 1 сэмпл тишины через AudioContext во время user gesture.
    // На iOS это активирует аудио сессию в режиме совместного использования.
    if (!this.audioContext) return;

    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const silentBuf = this.audioContext.createBuffer(1, 1, this.audioContext.sampleRate);
      const src = this.audioContext.createBufferSource();
      src.buffer = silentBuf;

      // Соединяем через gain=0 — тихо, но AudioContext активирован
      const muteGain = this.audioContext.createGain();
      muteGain.gain.value = 0;
      src.connect(muteGain);
      muteGain.connect(this.audioContext.destination);
      src.start(0);

      console.log('[Audio] Silent buffer played — audio mixing unlocked');
    } catch (e) {
      console.warn('[Audio] Silent buffer unlock failed:', e.message);
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
   *
   * Использует цепочку попыток (fallback chain) для совместимости с Bluetooth:
   * 1. Предпочтительные ограничения (A2DP-friendly или с EC)
   * 2. Мягкие ограничения (ideal вместо hard constraints)
   * 3. Минимальные ограничения (audio: true) — работает всегда
   *
   * Проблема: на Android при подключённой BT-колонке некоторые версии Chrome
   * блокируют getUserMedia с echoCancellation: false, потому что Android
   * пытается активировать HFP для микрофона, а колонка без микрофона его не
   * поддерживает → браузер получает отказ от ОС → тихо падает.
   */
  async requestMicrophoneAccess(deviceId = null) {
    // iOS: Обязательно resume AudioContext перед getUserMedia
    if (this.audioContext && this.audioContext.state === 'suspended') {
      console.log('Resuming AudioContext before microphone access...');
      await this.audioContext.resume();
      console.log('AudioContext resumed, state:', this.audioContext.state);
    }

    // Цепочка попыток от строгих ограничений к минимальным
    const attempts = this.bluetoothMode ? [
      // Попытка 1: Идеальный Bluetooth режим (A2DP) — отключаем EC полностью
      // Звук из BT-колонки (A2DP), голос через встроенный микрофон телефона.
      // Может упасть на Android если ОС требует HFP для mic при активном BT.
      {
        label: 'BT A2DP (no EC)',
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          ...(deviceId && { deviceId: { exact: deviceId } })
        }
      },
      // Попытка 2: Мягкое предпочтение — ideal вместо hard false.
      // Даём Android свободу выбора профиля, предпочитаем без EC.
      {
        label: 'BT soft (ideal no EC)',
        audio: {
          echoCancellation: { ideal: false },
          noiseSuppression: { ideal: false },
          autoGainControl: { ideal: false },
          ...(deviceId && { deviceId: { ideal: deviceId } })
        }
      },
      // Попытка 3: Минимальные ограничения — пусть ОС решает сама.
      // Гарантированно работает, но может переключить BT на HFP.
      {
        label: 'minimal (audio:true)',
        audio: true
      }
    ] : [
      // Обычный режим (наушники / гарнитура / без BT-колонки)
      // ideal — предпочтение, но не принудительно; не ломает Bluetooth A2DP
      {
        label: 'standard (ideal EC)',
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 1 },
          ...(deviceId && { deviceId: { exact: deviceId } })
        }
      },
      // Fallback для обычного режима
      {
        label: 'minimal (audio:true)',
        audio: true
      }
    ];

    for (const attempt of attempts) {
      try {
        console.log(`Requesting microphone [${attempt.label}]...`);
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: attempt.audio });

        // Обновляем список устройств после получения разрешения
        await this.updateDeviceList();

        const track = this.mediaStream.getAudioTracks()[0];
        const settings = track?.getSettings?.() || {};
        console.log(`✅ Microphone granted [${attempt.label}]`, {
          echoCancellation: settings.echoCancellation,
          deviceId: settings.deviceId?.substring(0, 8)
        });

        // Сохраняем, какая попытка сработала (для диагностики)
        this.lastMicAttemptLabel = attempt.label;
        return true;
      } catch (err) {
        console.warn(`❌ Attempt [${attempt.label}] failed: ${err.name} — ${err.message}`);
        // Продолжаем к следующей попытке
      }
    }

    // Все попытки провалились
    console.error('Microphone access denied after all fallback attempts');
    return false;
  }

  /**
   * Настройка аудио цепочки
   */
  setupAudioChain() {
    if (!this.audioContext || !this.mediaStream) return false;

    // iOS: Resume AudioContext если suspended
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().then(() => {
        console.log('AudioContext resumed in setupAudioChain');
      });
    }

    // Убираем предыдущую цепочку
    this.disconnectAll();
    this.stopNoiseGate();

    // Создаём источник
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Точка нулевой задержки для мониторинга — подключается ПРЯМО от источника,
    // ДО компрессоров и лимитера. Это убирает ~12ms дополнительной задержки
    // из DynamicsCompressor lookahead при прослушивании своего голоса.
    this.monitorInsertNode = this.audioContext.createGain();
    this.monitorInsertNode.gain.value = 1.0;
    this.sourceNode.connect(this.monitorInsertNode);

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

    // 9. Anti-feedback фильтры - узкополосные notch фильтры на проблемных частотах
    this.antiFeedbackFilters = [];
    if (this.antiFeedbackEnabled) {
      // Создаём notch фильтры на типичных частотах обратной связи
      const feedbackFreqs = [800, 1600, 3200, 4000, 6300];
      feedbackFreqs.forEach(freq => {
        const notch = this.audioContext.createBiquadFilter();
        notch.type = 'notch';
        notch.frequency.value = freq;
        notch.Q.value = 30; // Узкая полоса
        this.antiFeedbackFilters.push(notch);
      });
    }

    // 10. Задержка для синхронизации с Bluetooth
    this.delayNode = this.audioContext.createDelay(1.0);
    this.delayNode.delayTime.value = this.delayTime / 1000; // мс -> сек

    // 11. Лимитер - предотвращает клиппинг и искажения
    this.limiter = this.audioContext.createDynamicsCompressor();
    this.limiter.threshold.value = -3;      // Почти на максимуме
    this.limiter.knee.value = 0;            // Жёсткий лимит
    this.limiter.ratio.value = 20;          // Сильное ограничение
    this.limiter.attack.value = 0.001;      // Мгновенная атака
    this.limiter.release.value = 0.1;       // Быстрый релиз

    // 12. Анализатор для визуализации
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.8;

    // === СБОРКА ЦЕПОЧКИ ===
    // source -> highpass -> lowpass -> deesser -> presence -> warmth ->
    // antifeedback -> compressor -> noiseGate -> gain -> delay -> limiter -> analyser

    if (this.audioEnhancement) {
      let currentNode = this.sourceNode;

      // Базовые фильтры
      currentNode.connect(this.highpassFilter);
      currentNode = this.highpassFilter;

      currentNode.connect(this.lowpassFilter);
      currentNode = this.lowpassFilter;

      currentNode.connect(this.deEsserFilter);
      currentNode = this.deEsserFilter;

      currentNode.connect(this.presenceFilter);
      currentNode = this.presenceFilter;

      currentNode.connect(this.warmthFilter);
      currentNode = this.warmthFilter;

      // Anti-feedback фильтры (цепочка notch фильтров)
      if (this.antiFeedbackEnabled && this.antiFeedbackFilters.length > 0) {
        this.antiFeedbackFilters.forEach(filter => {
          currentNode.connect(filter);
          currentNode = filter;
        });
      }

      // Компрессор -> Noise Gate -> Gain -> Limiter -> Analyser
      // КРИТИЧЕСКИ: Убрали delay из цепочки для минимальной задержки!
      // Delay используется только если пользователь явно установил компенсацию
      currentNode.connect(this.compressor);
      this.compressor.connect(this.noiseGateGain);
      this.noiseGateGain.connect(this.gainNode);

      // Если установлена компенсация задержки > 0, используем delay
      if (this.delayTime > 0) {
        this.gainNode.connect(this.delayNode);
        this.delayNode.connect(this.limiter);
      } else {
        // Без delay - минимальная задержка
        this.gainNode.connect(this.limiter);
      }
      this.limiter.connect(this.analyserNode);

      // Запускаем Noise Gate если включен
      if (this.noiseGateEnabled) {
        this.startNoiseGate();
      }

      // Запускаем мониторинг уровня
      this.startLevelMeter();

      console.log('Audio chain with full enhancement setup');
    } else {
      // Простая цепочка без обработки - МИНИМАЛЬНАЯ ЗАДЕРЖКА
      this.sourceNode.connect(this.gainNode);

      // Delay только если явно установлен > 0
      if (this.delayTime > 0) {
        this.gainNode.connect(this.delayNode);
        this.delayNode.connect(this.analyserNode);
      } else {
        this.gainNode.connect(this.analyserNode);
      }

      this.startLevelMeter();
      console.log('Audio chain without enhancement setup (zero latency)');
    }

    // Применяем вокальный пресет
    this.applyVocalPreset(this.vocalPreset);

    // Применяем эффект если выбран
    this.applyEffect(this.currentEffect);

    console.log('Audio chain setup complete');
    return true;
  }

  /**
   * Индикатор уровня сигнала
   */
  startLevelMeter() {
    if (this.levelMeterAnimationId) return;

    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 256;
    this.sourceNode.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);

    const updateLevel = () => {
      analyser.getFloatTimeDomainData(dataArray);

      // Вычисляем RMS
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / bufferLength);

      // Конвертируем в проценты (0-100)
      // -60 dB = 0%, 0 dB = 100%
      const db = 20 * Math.log10(rms + 0.0001);
      this.currentLevel = Math.max(0, Math.min(100, (db + 60) / 60 * 100));

      // Peak hold
      if (this.currentLevel > this.peakLevel) {
        this.peakLevel = this.currentLevel;
      } else {
        this.peakLevel *= 0.95; // Медленный спад
      }

      // Вызываем callbacks
      this.levelCallbacks.forEach(cb => cb(this.currentLevel, this.peakLevel));

      this.levelMeterAnimationId = requestAnimationFrame(updateLevel);
    };

    updateLevel();
  }

  stopLevelMeter() {
    if (this.levelMeterAnimationId) {
      cancelAnimationFrame(this.levelMeterAnimationId);
      this.levelMeterAnimationId = null;
    }
  }

  /**
   * Подписаться на обновления уровня сигнала
   */
  onLevelChange(callback) {
    this.levelCallbacks.push(callback);
    return () => {
      const index = this.levelCallbacks.indexOf(callback);
      if (index > -1) this.levelCallbacks.splice(index, 1);
    };
  }

  /**
   * Получить текущий уровень
   */
  getLevel() {
    return { current: this.currentLevel, peak: this.peakLevel };
  }

  /**
   * Автокалибровка Noise Gate - определяет уровень фонового шума
   */
  async calibrateNoiseGate() {
    return new Promise((resolve) => {
      if (!this.audioContext || !this.sourceNode) {
        resolve(-45);
        return;
      }

      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 512;
      this.sourceNode.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Float32Array(bufferLength);

      let samples = [];
      let sampleCount = 0;
      const maxSamples = 30; // ~0.5 секунды

      const collectSamples = () => {
        analyser.getFloatTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        const db = 20 * Math.log10(rms + 0.0001);
        samples.push(db);

        sampleCount++;
        if (sampleCount < maxSamples) {
          requestAnimationFrame(collectSamples);
        } else {
          // Вычисляем средний уровень шума + запас 6 dB
          const avgNoise = samples.reduce((a, b) => a + b) / samples.length;
          const threshold = Math.round(avgNoise + 6);

          // Ограничиваем диапазон
          const finalThreshold = Math.max(-60, Math.min(-20, threshold));

          console.log('Noise Gate calibrated:', finalThreshold, 'dB (noise floor:', avgNoise.toFixed(1), 'dB)');
          resolve(finalThreshold);
        }
      };

      collectSamples();
    });
  }

  /**
   * Установить задержку (для синхронизации с Bluetooth)
   * ВНИМАНИЕ: По умолчанию должно быть 0 для минимальной задержки
   */
  setDelay(ms) {
    const oldDelay = this.delayTime;
    this.delayTime = ms;

    if (this.delayNode) {
      this.delayNode.delayTime.setValueAtTime(ms / 1000, this.audioContext.currentTime);
    }

    // Если delay изменился с 0 на >0 или наоборот, перестраиваем цепочку
    const needsRebuild = (oldDelay === 0 && ms > 0) || (oldDelay > 0 && ms === 0);
    if (needsRebuild && this.mediaStream) {
      console.log('Rebuilding audio chain for delay change');
      this.setupAudioChain();
    }

    console.log('Delay set to:', ms, 'ms', needsRebuild ? '(chain rebuilt)' : '');
  }

  /**
   * Включить/выключить Anti-feedback
   */
  setAntiFeedbackEnabled(enabled) {
    this.antiFeedbackEnabled = enabled;
    // Перестраиваем цепочку
    if (this.mediaStream) {
      this.setupAudioChain();
    }
    console.log('Anti-feedback:', enabled ? 'ON' : 'OFF');
  }

  /**
   * Noise Gate - глушит микрофон когда не поёшь
   * Использует setInterval(5ms) вместо requestAnimationFrame (~16.7ms)
   * для втрое более быстрой реакции на изменение уровня сигнала.
   */
  startNoiseGate() {
    if (this.noiseGateAnimationId) return;

    const analyser = this.audioContext.createAnalyser();
    // fftSize 256 вместо 512 — меньше буфер, меньше задержка анализа
    analyser.fftSize = 256;
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
    };

    // 5ms интервал вместо requestAnimationFrame (~16.7ms) — реакция в 3x быстрее
    this.noiseGateAnimationId = setInterval(checkLevel, 5);
    checkLevel(); // Первый вызов немедленно, не ждём 5ms
    console.log('Noise Gate started (5ms interval), threshold:', this.noiseGateThreshold, 'dB');
  }

  stopNoiseGate() {
    if (this.noiseGateAnimationId) {
      clearInterval(this.noiseGateAnimationId);
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
   *
   * Мониторинг подключается к monitorInsertNode — точке ПЕРЕД компрессорами
   * и лимитером. Это убирает ~12ms задержки DynamicsCompressor lookahead,
   * которая была бы слышна при мониторинге своего голоса через наушники.
   */
  enableMonitoring(enabled) {
    if (!this.audioContext) return;

    this.isMonitoringEnabled = enabled;

    // Используем monitorInsertNode (до компрессоров) для минимальной задержки.
    // Если цепочка ещё не построена, используем sourceNode как fallback.
    const monitorSource = this.monitorInsertNode || this.sourceNode;
    if (!monitorSource) return;

    if (enabled) {
      // Создаём gain для мониторинга с пониженной громкостью
      if (!this.monitorGainNode) {
        this.monitorGainNode = this.audioContext.createGain();
        this.monitorGainNode.gain.value = 0.3; // Снижаем для предотвращения feedback
      }

      monitorSource.connect(this.monitorGainNode);
      this.monitorGainNode.connect(this.audioContext.destination);
      console.log('⚠️ Monitoring enabled (zero-latency path) - используйте наушники!');
    } else {
      try {
        if (this.monitorGainNode) {
          monitorSource.disconnect(this.monitorGainNode);
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

    // Мониторинг управляется только через enableMonitoring() — не дублируем здесь

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
    // Останавливаем мониторинг уровня
    this.stopLevelMeter();

    const nodes = [
      this.sourceNode,
      this.monitorInsertNode,
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
      this.monitorGainNode,
      this.delayNode,
      ...this.antiFeedbackFilters
    ];

    nodes.forEach(node => {
      if (node) {
        try { node.disconnect(); } catch (e) {}
      }
    });

    this.effectNodes.forEach(node => {
      try { node.disconnect(); } catch (e) {}
    });

    this.antiFeedbackFilters = [];
  }

  /**
   * Получить поток для WebRTC
   * ВАЖНО: Возвращаем оригинальный mediaStream для лучшей совместимости с iPhone/Safari
   */
  getOutputStream() {
    // Возвращаем оригинальный поток с микрофона
    // Это работает лучше для WebRTC, особенно на iOS
    if (this.mediaStream) {
      console.log('Returning original mediaStream for WebRTC');
      return this.mediaStream;
    }

    // Fallback: если нужен обработанный поток (не рекомендуется для WebRTC)
    if (this.audioContext && this.analyserNode) {
      console.warn('Using processed stream for WebRTC - may cause issues on iOS');
      const destination = this.audioContext.createMediaStreamDestination();
      this.analyserNode.connect(destination);
      return destination.stream;
    }

    return null;
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
