/**
 * KaRaFoN Main Application
 * Главный файл приложения
 */

class KaraFonApp {
  constructor() {
    // Telegram WebApp
    this.tg = window.Telegram?.WebApp;

    // Managers
    this.audioManager = null;
    this.webrtcManager = null;
    this.socket = null;

    // State
    this.currentScreen = 'loading';
    this.isInRoom = false;
    this.roomId = null;
    this.userName = 'Anonymous';
    this.isMicActive = false;
    this.isMonitoring = false;
    this.monitoringWarningShown = false;
    this.currentEffect = 'none';

    // Visualizer
    this.visualizerCanvas = null;
    this.visualizerCtx = null;
    this.visualizerAnimationId = null;

    // Инициализация
    this.init();
  }

  /**
   * Инициализация приложения
   */
  async init() {
    console.log('Initializing KaRaFoN...');

    // Инициализируем Telegram WebApp
    this.initTelegram();

    // Подключаемся к серверу
    await this.connectSocket();

    // Инициализируем аудио менеджер
    this.audioManager = new AudioManager();

    // Инициализируем WebRTC
    this.webrtcManager = new WebRTCManager(this.socket, this.audioManager);
    this.setupWebRTCCallbacks();

    // Настраиваем UI
    this.setupUI();

    // Проверяем параметры URL (для прямого входа в комнату)
    this.checkUrlParams();

    // Показываем главный экран
    setTimeout(() => {
      this.showScreen('main');
    }, 1000);
  }

  /**
   * Инициализация Telegram WebApp
   */
  initTelegram() {
    if (this.tg) {
      // Раскрываем на весь экран
      this.tg.expand();

      // Применяем тему
      document.documentElement.style.setProperty('--tg-theme-bg-color', this.tg.backgroundColor || '#1a1a2e');
      document.documentElement.style.setProperty('--tg-theme-text-color', this.tg.textColor || '#ffffff');
      document.documentElement.style.setProperty('--tg-theme-hint-color', this.tg.hintColor || '#a0a0a0');
      document.documentElement.style.setProperty('--tg-theme-button-color', this.tg.buttonColor || '#6c5ce7');

      // Получаем имя пользователя
      if (this.tg.initDataUnsafe?.user) {
        this.userName = this.tg.initDataUnsafe.user.first_name || 'Anonymous';
      }

      // Настраиваем кнопку "Назад"
      this.tg.BackButton.onClick(() => {
        this.handleBack();
      });

      console.log('Telegram WebApp initialized', this.tg.initDataUnsafe);
    } else {
      console.log('Running outside Telegram');
    }
  }

  /**
   * Подключение к Socket.io серверу
   */
  async connectSocket() {
    return new Promise((resolve) => {
      this.socket = io({
        transports: ['websocket', 'polling']
      });

      this.socket.on('connect', () => {
        console.log('Connected to server:', this.socket.id);
        resolve();
      });

      this.socket.on('disconnect', () => {
        console.log('Disconnected from server');
        this.showToast('Соединение потеряно');
      });

      this.socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
      });
    });
  }

  /**
   * Настройка WebRTC callbacks
   */
  setupWebRTCCallbacks() {
    this.webrtcManager.onParticipantJoined = (data) => {
      this.updateParticipantsList(data.participants);
      this.showToast(`${data.name} присоединился`);
    };

    this.webrtcManager.onParticipantLeft = (data) => {
      this.updateParticipantsList(data.participants);
      this.showToast(`${data.name} вышел`);
    };

    this.webrtcManager.onParticipantMicStatus = (data) => {
      this.updateParticipantMicStatus(data.id, data.enabled);
    };
  }

  /**
   * Настройка UI элементов
   */
  setupUI() {
    // Главный экран
    document.getElementById('btn-solo').addEventListener('click', () => this.startSolo());
    document.getElementById('btn-create-room').addEventListener('click', () => this.createRoom());
    document.getElementById('btn-join-room').addEventListener('click', () => this.joinRoom());

    // Ввод кода комнаты по Enter
    document.getElementById('room-code-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.joinRoom();
    });

    // Экран караоке
    document.getElementById('btn-back').addEventListener('click', () => this.handleBack());
    document.getElementById('btn-settings').addEventListener('click', () => this.showModal('settings'));
    document.getElementById('mic-status').addEventListener('click', () => this.toggleMic());
    document.getElementById('btn-mic-toggle').addEventListener('click', () => this.toggleMic());
    document.getElementById('btn-monitor').addEventListener('click', () => this.toggleMonitoring());
    document.getElementById('btn-effects').addEventListener('click', () => this.showModal('effects'));

    // Громкость
    document.getElementById('volume-slider').addEventListener('input', (e) => {
      const value = e.target.value / 100;
      this.audioManager?.setVolume(value);
      document.getElementById('volume-value').textContent = `${e.target.value}%`;
    });

    // Копирование кода комнаты
    document.getElementById('btn-copy-code').addEventListener('click', () => this.copyRoomCode());

    // Модальные окна
    document.getElementById('btn-close-settings').addEventListener('click', () => this.hideModal('settings'));
    document.getElementById('btn-close-effects').addEventListener('click', () => this.hideModal('effects'));

    // Клик вне модального окна
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.hideAllModals();
        }
      });
    });

    // Выбор устройств
    document.getElementById('mic-select').addEventListener('change', (e) => this.changeMicrophone(e.target.value));
    document.getElementById('speaker-select').addEventListener('change', (e) => this.changeSpeaker(e.target.value));

    // Эффекты
    document.querySelectorAll('.effect-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const effect = e.currentTarget.dataset.effect;
        this.applyEffect(effect);
      });
    });

    // Режим Bluetooth
    document.getElementById('bluetooth-mode').addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.audioManager?.setBluetoothMode(enabled);
      document.getElementById('bluetooth-label').textContent = enabled
        ? 'Включён (рекомендуется для колонок)'
        : 'Выключен';
    });

    // Улучшение звука
    document.getElementById('audio-enhancement').addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.audioManager?.setAudioEnhancement(enabled);
      document.getElementById('enhancement-label').textContent = enabled
        ? 'Включено'
        : 'Выключено';
    });

    // Вокальные пресеты
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const preset = e.currentTarget.dataset.preset;
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.audioManager?.applyVocalPreset(preset);
      });
    });

    // Noise Gate
    document.getElementById('noise-gate').addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.audioManager?.setNoiseGateEnabled(enabled);
      document.getElementById('noise-gate-label').textContent = enabled
        ? 'Включён'
        : 'Выключен';
    });

    document.getElementById('noise-gate-threshold').addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      this.audioManager?.setNoiseGateThreshold(value);
      document.getElementById('noise-gate-value').textContent = `${value} дБ`;
    });

    // De-esser
    document.getElementById('de-esser').addEventListener('change', (e) => {
      this.audioManager?.setDeEsserEnabled(e.target.checked);
    });

    // Presence (чёткость)
    document.getElementById('presence').addEventListener('change', (e) => {
      this.audioManager?.setPresenceEnabled(e.target.checked);
    });

    // Warmth (теплота)
    document.getElementById('warmth').addEventListener('change', (e) => {
      this.audioManager?.setWarmthEnabled(e.target.checked);
    });

    // Anti-feedback
    document.getElementById('anti-feedback').addEventListener('change', (e) => {
      this.audioManager?.setAntiFeedbackEnabled(e.target.checked);
    });

    // Delay compensation (задержка для синхронизации)
    document.getElementById('delay-compensation').addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      this.audioManager?.setDelay(value);
      document.getElementById('delay-compensation-value').textContent = `${value} мс`;
    });

    // Auto-calibrate noise gate
    document.getElementById('btn-calibrate').addEventListener('click', async () => {
      const btn = document.getElementById('btn-calibrate');
      btn.classList.add('calibrating');
      btn.textContent = 'Калибровка...';

      try {
        const threshold = await this.audioManager?.calibrateNoiseGate();
        if (threshold !== undefined) {
          document.getElementById('noise-gate-threshold').value = threshold;
          document.getElementById('noise-gate-value').textContent = `${threshold} дБ`;
          this.audioManager?.setNoiseGateThreshold(threshold);
          this.showToast(`Порог установлен: ${threshold} дБ`);
        }
      } catch (e) {
        console.error('Calibration error:', e);
      }

      btn.classList.remove('calibrating');
      btn.textContent = 'Автокалибровка';
    });

    // Canvas для визуализации
    this.visualizerCanvas = document.getElementById('visualizer');
    this.visualizerCtx = this.visualizerCanvas.getContext('2d');
  }

  /**
   * Проверка параметров URL
   */
  checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');

    if (roomId) {
      document.getElementById('room-code-input').value = roomId;
    }
  }

  /**
   * Показать экран
   */
  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
      screen.classList.remove('active');
    });
    document.getElementById(`${screenId}-screen`).classList.add('active');
    this.currentScreen = screenId;

    // Telegram BackButton
    if (this.tg) {
      if (screenId === 'karaoke') {
        this.tg.BackButton.show();
      } else {
        this.tg.BackButton.hide();
      }
    }
  }

  /**
   * Начать соло режим
   */
  async startSolo() {
    const success = await this.initAudio();
    if (!success) return;

    this.isInRoom = false;
    this.roomId = null;

    document.getElementById('room-label').textContent = 'Соло режим';
    document.getElementById('room-id-display').textContent = '';
    document.getElementById('participants-panel').classList.add('hidden');

    this.showScreen('karaoke');
    this.startVisualizer();
  }

  /**
   * Создать комнату
   */
  async createRoom() {
    const success = await this.initAudio();
    if (!success) return;

    // Генерируем ID комнаты
    this.roomId = this.generateRoomId();
    this.isInRoom = true;

    // Присоединяемся к комнате через WebRTC
    await this.webrtcManager.joinRoom(this.roomId, this.userName);

    // Обновляем UI
    document.getElementById('room-label').textContent = 'Комната';
    document.getElementById('room-id-display').textContent = this.roomId;
    document.getElementById('share-room-code').textContent = this.roomId;
    document.getElementById('participants-panel').classList.remove('hidden');

    this.updateParticipantsList([{ id: this.socket.id, name: this.userName }]);

    this.showScreen('karaoke');
    this.startVisualizer();

    this.showToast('Комната создана!');
  }

  /**
   * Присоединиться к комнате
   */
  async joinRoom() {
    const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();

    if (!roomCode) {
      this.showToast('Введите код комнаты');
      return;
    }

    const success = await this.initAudio();
    if (!success) return;

    this.roomId = roomCode;
    this.isInRoom = true;

    // Присоединяемся к комнате через WebRTC
    await this.webrtcManager.joinRoom(this.roomId, this.userName);

    // Обновляем UI
    document.getElementById('room-label').textContent = 'Комната';
    document.getElementById('room-id-display').textContent = this.roomId;
    document.getElementById('share-room-code').textContent = this.roomId;
    document.getElementById('participants-panel').classList.remove('hidden');

    this.showScreen('karaoke');
    this.startVisualizer();
  }

  /**
   * Инициализация аудио
   */
  async initAudio() {
    // Инициализируем аудио менеджер
    const audioInit = await this.audioManager.init();
    if (!audioInit) {
      this.showToast('Ошибка инициализации аудио');
      return false;
    }

    // Запрашиваем доступ к микрофону
    const micAccess = await this.audioManager.requestMicrophoneAccess();
    if (!micAccess) {
      this.showToast('Нет доступа к микрофону');
      return false;
    }

    // Настраиваем аудио цепочку
    this.audioManager.setupAudioChain();

    // Обновляем список устройств в настройках
    this.updateDeviceSelectors();

    // Подписываемся на обновления уровня сигнала для индикатора
    this.audioManager.onLevelChange((level, peak) => {
      const levelFill = document.getElementById('level-fill');
      const levelPeak = document.getElementById('level-peak');
      if (levelFill) levelFill.style.width = `${level}%`;
      if (levelPeak) levelPeak.style.left = `${peak}%`;
    });

    return true;
  }

  /**
   * Обновить селекторы устройств
   */
  updateDeviceSelectors() {
    const micSelect = document.getElementById('mic-select');
    const speakerSelect = document.getElementById('speaker-select');

    // Микрофоны
    micSelect.innerHTML = '';
    this.audioManager.devices.microphones.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Микрофон ${micSelect.options.length + 1}`;
      micSelect.appendChild(option);
    });

    // Динамики
    speakerSelect.innerHTML = '';
    this.audioManager.devices.speakers.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Динамик ${speakerSelect.options.length + 1}`;
      speakerSelect.appendChild(option);
    });
  }

  /**
   * Переключить микрофон
   */
  toggleMic() {
    this.isMicActive = !this.isMicActive;

    this.audioManager.setMicEnabled(this.isMicActive);

    // Если в комнате, отправляем статус
    if (this.isInRoom) {
      this.webrtcManager.sendMicStatus(this.isMicActive);
    }

    // Обновляем UI
    const micStatus = document.getElementById('mic-status');
    const micBtn = document.getElementById('btn-mic-toggle');
    const micText = document.getElementById('mic-status-text');

    if (this.isMicActive) {
      micStatus.classList.add('active');
      micStatus.classList.remove('muted');
      micBtn.classList.add('active');
      micText.textContent = 'Микрофон включен';
    } else {
      micStatus.classList.remove('active');
      micStatus.classList.add('muted');
      micBtn.classList.remove('active');
      micText.textContent = 'Нажми чтобы начать';
    }
  }

  /**
   * Переключить мониторинг
   */
  toggleMonitoring() {
    // При первом включении мониторинга показываем предупреждение
    if (!this.isMonitoring && !this.monitoringWarningShown) {
      const confirmed = confirm(
        '⚠️ ВНИМАНИЕ: Мониторинг может вызвать feedback (свист)!\n\n' +
        '✅ ИСПОЛЬЗУЙТЕ НАУШНИКИ\n' +
        '✅ Держите микрофон подальше от динамиков\n' +
        '✅ Уменьшите громкость если слышите писк\n\n' +
        'Продолжить?'
      );

      if (!confirmed) {
        return;
      }

      this.monitoringWarningShown = true;
    }

    this.isMonitoring = !this.isMonitoring;

    this.audioManager.enableMonitoring(this.isMonitoring);

    const monitorBtn = document.getElementById('btn-monitor');
    if (this.isMonitoring) {
      monitorBtn.classList.add('active');
      this.showToast('⚠️ Мониторинг включен - используйте наушники!');
    } else {
      monitorBtn.classList.remove('active');
    }
  }

  /**
   * Применить эффект
   */
  applyEffect(effectName) {
    this.currentEffect = effectName;
    this.audioManager.applyEffect(effectName);

    // Обновляем WebRTC поток
    if (this.isInRoom) {
      this.webrtcManager.updateLocalStream();
    }

    // Обновляем UI
    document.querySelectorAll('.effect-option').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.effect === effectName);
    });

    this.hideModal('effects');
  }

  /**
   * Сменить микрофон
   */
  async changeMicrophone(deviceId) {
    if (!deviceId) return;

    const success = await this.audioManager.switchMicrophone(deviceId);
    if (success && this.isInRoom) {
      await this.webrtcManager.updateLocalStream();
    }
  }

  /**
   * Сменить динамик
   */
  async changeSpeaker(deviceId) {
    if (!deviceId) return;
    await this.audioManager.switchSpeaker(deviceId);
  }

  /**
   * Обновить список участников
   */
  updateParticipantsList(participants) {
    const container = document.getElementById('participants-list');
    container.innerHTML = '';

    participants.forEach(p => {
      const badge = document.createElement('div');
      badge.className = 'participant-badge';
      badge.id = `participant-${p.id}`;
      badge.innerHTML = `
        <span class="mic-indicator ${p.id === this.socket.id ? 'active' : ''}"></span>
        <span>${p.name}${p.id === this.socket.id ? ' (вы)' : ''}</span>
      `;
      container.appendChild(badge);
    });

    document.getElementById('participants-count').textContent = participants.length;
  }

  /**
   * Обновить статус микрофона участника
   */
  updateParticipantMicStatus(participantId, enabled) {
    const badge = document.getElementById(`participant-${participantId}`);
    if (badge) {
      const indicator = badge.querySelector('.mic-indicator');
      indicator.classList.toggle('active', enabled);
    }
  }

  /**
   * Запустить визуализатор
   */
  startVisualizer() {
    if (this.visualizerAnimationId) {
      cancelAnimationFrame(this.visualizerAnimationId);
    }

    const draw = () => {
      this.visualizerAnimationId = requestAnimationFrame(draw);

      // Resize canvas
      const container = this.visualizerCanvas.parentElement;
      this.visualizerCanvas.width = container.clientWidth;
      this.visualizerCanvas.height = container.clientHeight;

      const ctx = this.visualizerCtx;
      const width = this.visualizerCanvas.width;
      const height = this.visualizerCanvas.height;

      // Clear
      ctx.clearRect(0, 0, width, height);

      // Get data
      const data = this.audioManager?.getVisualizerData();
      if (!data) return;

      // Draw bars
      const barCount = 64;
      const barWidth = width / barCount;
      const step = Math.floor(data.length / barCount);

      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, '#6c5ce7');
      gradient.addColorStop(0.5, '#a29bfe');
      gradient.addColorStop(1, '#fd79a8');

      ctx.fillStyle = gradient;

      for (let i = 0; i < barCount; i++) {
        const value = data[i * step];
        const barHeight = (value / 255) * height * 0.8;

        const x = i * barWidth;
        const y = height - barHeight;

        ctx.beginPath();
        ctx.roundRect(x + 2, y, barWidth - 4, barHeight, 4);
        ctx.fill();
      }
    };

    draw();
  }

  /**
   * Остановить визуализатор
   */
  stopVisualizer() {
    if (this.visualizerAnimationId) {
      cancelAnimationFrame(this.visualizerAnimationId);
      this.visualizerAnimationId = null;
    }
  }

  /**
   * Обработчик кнопки "Назад"
   */
  handleBack() {
    if (this.currentScreen === 'karaoke') {
      // Останавливаем всё
      this.stopVisualizer();
      this.audioManager?.setMicEnabled(false);
      this.audioManager?.enableMonitoring(false);

      if (this.isInRoom) {
        this.webrtcManager?.leaveRoom();
      }

      this.isMicActive = false;
      this.isMonitoring = false;
      this.isInRoom = false;
      this.roomId = null;

      // Сбрасываем UI
      document.getElementById('btn-mic-toggle').classList.remove('active');
      document.getElementById('btn-monitor').classList.remove('active');
      document.getElementById('mic-status').classList.remove('active', 'muted');

      this.showScreen('main');
    }
  }

  /**
   * Показать модальное окно
   */
  showModal(modalName) {
    document.getElementById(`${modalName}-modal`).classList.remove('hidden');
  }

  /**
   * Скрыть модальное окно
   */
  hideModal(modalName) {
    document.getElementById(`${modalName}-modal`).classList.add('hidden');
  }

  /**
   * Скрыть все модальные окна
   */
  hideAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
      modal.classList.add('hidden');
    });
  }

  /**
   * Копировать код комнаты
   */
  async copyRoomCode() {
    if (!this.roomId) return;

    try {
      await navigator.clipboard.writeText(this.roomId);
      this.showToast('Код скопирован!');
    } catch (error) {
      // Fallback
      const textArea = document.createElement('textarea');
      textArea.value = this.roomId;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      this.showToast('Код скопирован!');
    }
  }

  /**
   * Показать уведомление
   */
  showToast(message) {
    // Удаляем существующие тосты
    document.querySelectorAll('.toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  /**
   * Генерировать ID комнаты
   */
  generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', () => {
  window.app = new KaraFonApp();
});
