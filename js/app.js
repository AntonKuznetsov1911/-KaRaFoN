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

    // PWA install prompt
    this.deferredInstallPrompt = null;

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

    // Реагируем на подключение/отключение аудиоустройств (BT-колонка, наушники)
    this.audioManager.onDeviceChange = (devices) => this.handleAudioDeviceChange(devices);

    // Инициализируем WebRTC (PeerJS, socket не нужен)
    this.webrtcManager = new WebRTCManager(null, this.audioManager);
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
   * Заменено PeerJS — подключение происходит по требованию при входе в комнату
   */
  async connectSocket() {
    // PeerJS не требует постоянного соединения с сервером
    this.socket = null;
    return Promise.resolve();
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
    document.getElementById('btn-settings').addEventListener('click', () => {
      this.showModal('settings');
      this.updateLatencyDisplay();
    });
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

    // Эффекты (модальное окно эффектов + кнопки в секции настроек — оба набора)
    document.querySelectorAll('.effect-option, .effect-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const effect = e.currentTarget.dataset.effect;
        this.applyEffect(effect);
      });
    });

    // Позиция микрофона (нижний / авто / верхний)
    document.querySelectorAll('.mic-pos-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const pos = e.currentTarget.dataset.pos;
        this.changeMicPositionMode(pos);
      });
    });

    // Режим Bluetooth
    document.getElementById('bluetooth-mode').addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.audioManager?.setBluetoothMode(enabled);
      document.getElementById('bluetooth-label').textContent = enabled
        ? 'Включён (звук из BT-колонки)'
        : 'Выключен (для наушников/гарнитуры)';
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

    // ── PWA Install ──────────────────────────────────────────────────────────
    // Браузер генерирует это событие когда приложение можно установить как PWA.
    // Мы его перехватываем и показываем свою кнопку вместо стандартного баннера.
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); // Не показывать автоматический баннер браузера
      this.deferredInstallPrompt = e;
      // Показываем карточку «Установить приложение»
      const card = document.getElementById('install-card');
      if (card) card.style.display = '';
      console.log('[PWA] Install prompt ready');
    });

    // Когда установка завершена — прячем кнопку
    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      const card = document.getElementById('install-card');
      if (card) card.style.display = 'none';
      this.showToast('✅ KaRaFoN установлен на рабочий стол!');
      console.log('[PWA] App installed');
    });

    // Кнопка «Установить»
    document.getElementById('btn-install-pwa')?.addEventListener('click', async () => {
      if (!this.deferredInstallPrompt) {
        // Если prompt не доступен — показываем инструкцию
        this.showInstallInstructions();
        return;
      }
      // Показываем нативный диалог установки браузера
      this.deferredInstallPrompt.prompt();
      const { outcome } = await this.deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        this.showToast('⬇️ Установка началась...');
      }
      this.deferredInstallPrompt = null;
      const card = document.getElementById('install-card');
      if (card) card.style.display = 'none';
    });
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

    // Показываем задержку в шапке при входе на экран пения
    if (screenId === 'karaoke') {
      this.updateLatencyDisplay();
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

    // Создаём комнату через PeerJS (isCreator = true)
    try {
      await this.webrtcManager.joinRoom(this.roomId, this.userName, true);
    } catch (err) {
      console.error('Failed to create room:', err);
      this.showToast('❌ Нет связи с PeerJS сервером. Проверь интернет.');
      this.isInRoom = false;
      this.roomId = null;
      return;
    }

    // Обновляем UI
    document.getElementById('room-label').textContent = 'Комната';
    document.getElementById('room-id-display').textContent = this.roomId;
    document.getElementById('share-room-code').textContent = this.roomId;
    document.getElementById('participants-panel').classList.remove('hidden');

    this.updateParticipantsList([{ id: this.webrtcManager.myPeerId, name: this.userName }]);

    this.showScreen('karaoke');
    this.startVisualizer();

    this.showToast('🎉 Комната создана!');
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

    // Присоединяемся к комнате через PeerJS (isCreator = false)
    try {
      await this.webrtcManager.joinRoom(this.roomId, this.userName, false);
    } catch (err) {
      console.error('Failed to join room:', err);
      // peer-unavailable → "Комната не найдена" (из webrtc.js); остальное — сетевые ошибки
      const msg = err.message?.startsWith('Комната')
        ? `❌ ${err.message}`
        : '❌ Не удалось подключиться. Проверь код и интернет.';
      this.showToast(msg);
      this.isInRoom = false;
      this.roomId = null;
      return;
    }

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
   * Вызывается при user gesture (клик), поэтому здесь безопасно разблокировать
   * параллельное воспроизведение музыки.
   */
  async initAudio() {
    // Инициализируем аудио менеджер
    const audioInit = await this.audioManager.init();
    if (!audioInit) {
      this.showToast('Ошибка инициализации аудио');
      return false;
    }

    // ⚡ Разблокировка: говорим ОС что хотим работать ВМЕСТЕ с музыкой, не вместо неё.
    // Должно вызываться во время user gesture (мы внутри обработчика клика).
    await this.audioManager.unlockAudioMixing();

    // Запрашиваем доступ к микрофону (с fallback-цепочкой для BT)
    const micAccess = await this.audioManager.requestMicrophoneAccess();
    if (!micAccess) {
      this.showToast('❌ Нет доступа к микрофону. Разреши его в настройках браузера.');
      return false;
    }

    // Настраиваем аудио цепочку
    this.audioManager.setupAudioChain();

    // Микрофон стартует заглушённым: getUserMedia включает трек по умолчанию,
    // но мы хотим чтобы пользователь явно нажал кнопку 🎤 прежде чем петь/транслировать.
    this.audioManager.setMicEnabled(false);

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
   * Реакция на изменение аудиоустройств
   * Вызывается когда подключается или отключается BT-колонка / наушники
   */
  async handleAudioDeviceChange(devices) {
    console.log('[App] Audio device change detected, devices:', devices);

    // Обновляем селекторы устройств в настройках
    this.updateDeviceSelectors();

    // Если микрофон сейчас активен — показываем уведомление
    if (this.isMicActive) {
      this.showToast('🔌 Аудиоустройство изменено — перезапуск микрофона...');

      // Небольшая пауза: ОС нужно время на переключение Bluetooth-профиля
      await new Promise(r => setTimeout(r, 800));

      // Перезапрашиваем микрофон с текущими настройками
      // (fallback-цепочка сама выберет лучший вариант для нового устройства)
      const ok = await this.audioManager.requestMicrophoneAccess();
      if (ok) {
        this.audioManager.setupAudioChain();
        // Восстанавливаем состояние mic: новый поток включает треки по умолчанию,
        // но пользователь мог быть на паузе — нужно это сохранить
        this.audioManager.setMicEnabled(this.isMicActive);
        // Обновляем поток в WebRTC если в комнате
        if (this.isInRoom) {
          await this.webrtcManager.updateLocalStream();
        }
        this.showToast('✅ Микрофон переключён');
      } else {
        this.showToast('⚠️ Не удалось переключить микрофон — попробуй вручную');
      }
    } else {
      // Микрофон не активен — просто тихо обновляем список
      this.showToast('🔌 Аудиоустройство изменено');
    }
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
  async toggleMonitoring() {
    if (this.isMonitoring) {
      // Выключаем — мгновенно, без подтверждения
      this.isMonitoring = false;
      this.audioManager.enableMonitoring(false);
      document.getElementById('btn-monitor').classList.remove('active');
      return;
    }

    // Включаем — показываем предупреждение если ещё не видели
    if (!this.monitoringWarningShown) {
      const confirmed = await this.showMonitoringSheet();
      if (!confirmed) return;
      this.monitoringWarningShown = true;
    }

    this.isMonitoring = true;
    this.audioManager.enableMonitoring(true);
    document.getElementById('btn-monitor').classList.add('active');
    this.showToast('⚠️ Мониторинг включен — используйте наушники!');
  }

  /**
   * Красивый bottom-sheet вместо системного confirm().
   * Определяет BT-режим и показывает соответствующее предупреждение.
   * Возвращает Promise<boolean> — true если пользователь подтвердил.
   */
  showMonitoringSheet() {
    return new Promise((resolve) => {
      document.getElementById('monitoring-overlay')?.remove();

      const isBT = this.audioManager?.bluetoothMode;

      const btBlock = isBT ? `
        <div class="monitoring-bt-warning">
          🔵 <strong>Bluetooth режим включён:</strong> через BT-колонку ваш голос задержится
          на 150–300 мс — это ограничение железа. Петь под себя через BT-колонку будет
          некомфортно. Рекомендуем петь «вживую», без мониторинга.
        </div>` : '';

      const overlay = document.createElement('div');
      overlay.id = 'monitoring-overlay';
      overlay.className = 'monitoring-overlay';
      overlay.innerHTML = `
        <div class="monitoring-sheet">
          <div class="monitoring-sheet-header">⚠️ Мониторинг голоса</div>
          <div class="monitoring-sheet-body">
            ${btBlock}
            <p class="monitoring-desc">Вы будете слышать свой голос через динамик или наушники в реальном времени.</p>
            <div class="monitoring-tips">
              <div class="monitoring-tip">🎧 Используйте наушники — без них возможен свист</div>
              <div class="monitoring-tip">🔉 Если слышите писк — уменьшите громкость слайдером</div>
              <div class="monitoring-tip">📱 Держите телефон подальше от колонки</div>
            </div>
            <div class="monitoring-actions">
              <button id="monitoring-cancel" class="btn btn-secondary">Отмена</button>
              <button id="monitoring-confirm" class="btn btn-primary">Включить</button>
            </div>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      document.getElementById('monitoring-confirm').addEventListener('click', () => {
        overlay.remove(); resolve(true);
      });
      document.getElementById('monitoring-cancel').addEventListener('click', () => {
        overlay.remove(); resolve(false);
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { overlay.remove(); resolve(false); }
      });
    });
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

    // Обновляем UI (оба набора кнопок: модал эффектов и секция настроек)
    document.querySelectorAll('.effect-option, .effect-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.effect === effectName);
    });

    this.hideModal('effects');
  }

  /**
   * Сменить позицию (тип) микрофона телефона
   * bottom = нижний (разговорный), top = верхний (громкая связь), auto = система
   */
  async changeMicPositionMode(pos) {
    if (!this.audioManager) return;

    // Обновляем UI
    document.querySelectorAll('.mic-pos-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.mic-pos-btn[data-pos="${pos}"]`)?.classList.add('active');

    // Применяем — перезапрашивает mic и перестраивает цепочку
    const ok = await this.audioManager.setMicPositionMode(pos);
    if (ok && this.audioManager.mediaStream) {
      this.audioManager.setMicEnabled(this.isMicActive);
      if (this.isInRoom) await this.webrtcManager.updateLocalStream();
    }

    const labels = {
      bottom: '🎙️ Нижний микрофон (разговор)',
      top:    '📢 Верхний микрофон (громкая связь)',
      auto:   '🔄 Авто-режим микрофона'
    };
    this.showToast(ok ? labels[pos] : '⚠️ Не удалось переключить микрофон');
  }

  /**
   * Сменить микрофон
   */
  async changeMicrophone(deviceId) {
    if (!deviceId) return;

    const success = await this.audioManager.switchMicrophone(deviceId);
    if (success) {
      // switchMicrophone строит новую цепочку — восстанавливаем текущее состояние mic
      this.audioManager.setMicEnabled(this.isMicActive);
      if (this.isInRoom) {
        await this.webrtcManager.updateLocalStream();
      }
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
    const myId = this.webrtcManager?.myPeerId;

    participants.forEach(p => {
      const isMe = p.id === myId;
      const badge = document.createElement('div');
      badge.className = 'participant-badge';
      badge.id = `participant-${p.id}`;
      badge.innerHTML = `
        <span class="mic-indicator ${isMe ? 'active' : ''}"></span>
        <span>${p.name}${isMe ? ' (вы)' : ''}</span>
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
      this.audioManager?.stopNoiseGate();   // прекращаем 5ms setInterval (иначе крутится вечно)
      this.audioManager?.stopLevelMeter();  // прекращаем requestAnimationFrame индикатора

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
   * Показать актуальную задержку аудиосистемы:
   * • в шапке экрана пения (#header-latency) — всегда видна во время пения
   * • в настройках (#latency-chip) — детальный вид с описанием
   */
  updateLatencyDisplay() {
    if (!this.audioManager?.audioContext) return;

    const ctx   = this.audioManager.audioContext;
    const baseMs = (ctx.baseLatency   || 0) * 1000;
    const outMs  = (ctx.outputLatency || 0) * 1000;
    const total  = baseMs + outMs;
    const quality = total < 15 ? 'good' : total < 30 ? 'ok' : 'slow';
    const text    = `${total.toFixed(1)} мс`;

    // Шапка экрана пения
    const headerChip = document.getElementById('header-latency');
    if (headerChip) {
      headerChip.textContent = text;
      headerChip.className   = 'header-latency ' + quality;
    }

    // Блок в настройках
    const chip = document.getElementById('latency-chip');
    if (chip) {
      chip.textContent = text;
      chip.className   = 'latency-chip ' + quality;
    }

    const desc = document.getElementById('latency-desc');
    if (desc) {
      if (total < 15)      desc.textContent = '✅ Отлично — практически незаметная задержка';
      else if (total < 30) desc.textContent = '🟡 Приемлемо — слабо слышна при мониторинге';
      else                 desc.textContent = '🔴 Высокая — типично для iOS или старых Android';
    }
  }

  /**
   * Показать инструкцию по установке (когда браузер не поддерживает prompt)
   */
  showInstallInstructions() {
    // Убираем старое если есть
    document.getElementById('install-overlay')?.remove();

    const ua = navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua);
    const isSamsung = /samsungbrowser/.test(ua);

    let steps = '';
    if (isIOS) {
      steps = `
        <p>1. Нажми кнопку <strong>«Поделиться»</strong> внизу Safari (квадрат со стрелкой ↑)</p>
        <p>2. Прокрути вниз и выбери <strong>«На экран Домой»</strong></p>
        <p>3. Нажми <strong>«Добавить»</strong></p>`;
    } else if (isSamsung) {
      steps = `
        <p>1. Нажми меню <strong>⋮</strong> (три точки) в браузере</p>
        <p>2. Выбери <strong>«Добавить страницу на…»</strong></p>
        <p>3. Выбери <strong>«Приложения»</strong> (не «Главный экран»)</p>`;
    } else {
      steps = `
        <p>1. Открой <strong>Chrome</strong> на телефоне (не Telegram!)</p>
        <p>2. Перейди по ссылке:<br><code>https://antonkuznetsov1911.github.io/-KaRaFoN/</code></p>
        <p>3. Нажми меню <strong>⋮</strong> → <strong>«Установить приложение»</strong></p>`;
    }

    const overlay = document.createElement('div');
    overlay.id = 'install-overlay';
    overlay.innerHTML = `
      <div class="install-sheet">
        <div class="install-sheet-header">
          <span>📲 Как установить KaRaFoN</span>
          <button onclick="document.getElementById('install-overlay').remove()">✕</button>
        </div>
        <div class="install-sheet-body">
          ${steps}
          <button class="btn btn-primary install-copy-btn" id="btn-copy-link">
            📋 Скопировать ссылку
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('btn-copy-link')?.addEventListener('click', async () => {
      const url = 'https://antonkuznetsov1911.github.io/-KaRaFoN/';
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = url; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy'); ta.remove();
      }
      this.showToast('✅ Ссылка скопирована!');
    });
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
