/**
 * KaRaFoN WebRTC Manager
 * Управление peer-to-peer соединениями для совместного пения
 * КРИТИЧЕСКИ: Маршрутизация через Web Audio API для правильного вывода на Bluetooth
 */

class WebRTCManager {
  constructor(socket, audioManager) {
    this.socket = socket;
    this.audioManager = audioManager;
    this.peers = new Map(); // peerId -> { connection, stream, sourceNode, gainNode, audioElement }
    this.localStream = null;
    this.roomId = null;

    // ICE серверы для NAT traversal
    this.iceServers = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ]
    };

    this.onParticipantJoined = null;
    this.onParticipantLeft = null;
    this.onParticipantMicStatus = null;

    this.setupSocketListeners();
  }

  /**
   * Настройка обработчиков Socket.io
   */
  setupSocketListeners() {
    // Новый пользователь присоединился
    this.socket.on('user-joined', async (data) => {
      console.log('User joined:', data);

      // Создаём соединение с каждым новым участником
      for (const participant of data.participants) {
        if (participant.id !== this.socket.id && !this.peers.has(participant.id)) {
          await this.createPeerConnection(participant.id, true);
        }
      }

      if (this.onParticipantJoined) {
        this.onParticipantJoined(data);
      }
    });

    // Пользователь ушёл
    this.socket.on('user-left', (data) => {
      console.log('User left:', data);

      this.removePeer(data.id);

      if (this.onParticipantLeft) {
        this.onParticipantLeft(data);
      }
    });

    // Получен offer
    this.socket.on('offer', async (data) => {
      console.log('Received offer from:', data.from);
      await this.handleOffer(data.from, data.offer);
    });

    // Получен answer
    this.socket.on('answer', async (data) => {
      console.log('Received answer from:', data.from);
      await this.handleAnswer(data.from, data.answer);
    });

    // Получен ICE candidate
    this.socket.on('ice-candidate', async (data) => {
      console.log('Received ICE candidate from:', data.from);
      await this.handleIceCandidate(data.from, data.candidate);
    });

    // Статус микрофона другого пользователя
    this.socket.on('user-mic-status', (data) => {
      if (this.onParticipantMicStatus) {
        this.onParticipantMicStatus(data);
      }
    });
  }

  /**
   * Присоединиться к комнате
   */
  async joinRoom(roomId, userName) {
    this.roomId = roomId;

    // Получаем локальный аудио поток
    this.localStream = this.audioManager.getOutputStream();

    if (!this.localStream) {
      console.error('No local stream available');
      return false;
    }

    // Проверяем и включаем все треки (важно для iOS)
    const tracks = this.localStream.getAudioTracks();
    console.log('Local stream tracks:', tracks.length);

    tracks.forEach(track => {
      console.log('Track:', track.label, 'enabled:', track.enabled, 'muted:', track.muted, 'readyState:', track.readyState);
      track.enabled = true;
    });

    // Отправляем запрос на присоединение
    this.socket.emit('join-room', { roomId, name: userName });

    console.log('Joining room:', roomId);
    return true;
  }

  /**
   * Покинуть комнату
   */
  leaveRoom() {
    // Закрываем все соединения
    this.peers.forEach((peer, peerId) => {
      this.removePeer(peerId);
    });

    this.roomId = null;
    console.log('Left room');
  }

  /**
   * Создать peer connection
   */
  async createPeerConnection(peerId, isInitiator) {
    console.log(`Creating peer connection with ${peerId}, initiator: ${isInitiator}`);

    const connection = new RTCPeerConnection(this.iceServers);

    // Добавляем локальный поток
    if (this.localStream) {
      const tracks = this.localStream.getTracks();
      console.log(`Adding ${tracks.length} tracks to peer connection`);

      tracks.forEach(track => {
        console.log(`Adding track: ${track.kind}, label: ${track.label}, enabled: ${track.enabled}, muted: ${track.muted}`);
        const sender = connection.addTrack(track, this.localStream);
        console.log('Track added, sender:', sender);
      });
    } else {
      console.error('⚠️ No local stream available for peer connection!');
    }

    // Обработка ICE candidates
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', {
          to: peerId,
          candidate: event.candidate
        });
      }
    };

    // Обработка состояния соединения
    connection.onconnectionstatechange = () => {
      console.log(`Connection state with ${peerId}:`, connection.connectionState);

      if (connection.connectionState === 'failed' || connection.connectionState === 'disconnected') {
        this.removePeer(peerId);
      }
    };

    // Получение удалённого потока - МАРШРУТИЗИРУЕМ ЧЕРЕЗ WEB AUDIO API
    connection.ontrack = (event) => {
      console.log(`Received track from ${peerId}`);

      const peer = this.peers.get(peerId);
      if (peer) {
        peer.stream = event.streams[0];
        // КРИТИЧЕСКИ: Воспроизводим через Web Audio API на тот же выход (Bluetooth колонку)
        this.playRemoteStreamThroughWebAudio(peerId, event.streams[0]);
      }
    };

    // Сохраняем соединение
    this.peers.set(peerId, {
      connection,
      stream: null,
      sourceNode: null,
      gainNode: null,
      audioElement: null
    });

    // Если инициатор, создаём offer
    if (isInitiator) {
      await this.createOffer(peerId);
    }

    return connection;
  }

  /**
   * Создать и отправить offer
   */
  async createOffer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    try {
      const offer = await peer.connection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });

      await peer.connection.setLocalDescription(offer);

      this.socket.emit('offer', {
        to: peerId,
        offer: peer.connection.localDescription
      });

      console.log('Offer sent to:', peerId);
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  }

  /**
   * Обработать полученный offer
   */
  async handleOffer(peerId, offer) {
    let peer = this.peers.get(peerId);

    if (!peer) {
      await this.createPeerConnection(peerId, false);
      peer = this.peers.get(peerId);
    }

    try {
      await peer.connection.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await peer.connection.createAnswer();
      await peer.connection.setLocalDescription(answer);

      this.socket.emit('answer', {
        to: peerId,
        answer: peer.connection.localDescription
      });

      console.log('Answer sent to:', peerId);
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  }

  /**
   * Обработать полученный answer
   */
  async handleAnswer(peerId, answer) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    try {
      await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('Answer processed from:', peerId);
    } catch (error) {
      console.error('Error handling answer:', error);
    }
  }

  /**
   * Обработать ICE candidate
   */
  async handleIceCandidate(peerId, candidate) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    try {
      await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
    }
  }

  /**
   * КРИТИЧЕСКИ ВАЖНО: Воспроизвести удалённый поток через Web Audio API
   * Это гарантирует, что звук пойдёт на тот же выход (Bluetooth колонку),
   * что и локальный микрофон
   */
  async playRemoteStreamThroughWebAudio(peerId, stream) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    // Проверяем треки
    const tracks = stream.getAudioTracks();
    console.log('Remote stream tracks:', tracks.length);
    tracks.forEach(track => {
      console.log('Remote track:', track.label, 'enabled:', track.enabled, 'muted:', track.muted, 'readyState:', track.readyState);
    });

    // Получаем AudioContext из audioManager
    const audioContext = this.audioManager.audioContext;
    if (!audioContext) {
      console.error('No AudioContext available, falling back to audio element');
      this.playRemoteStreamFallback(peerId, stream);
      return;
    }

    // iOS: Resume AudioContext если suspended
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
        console.log('AudioContext resumed for remote stream playback');
      } catch (e) {
        console.error('Failed to resume AudioContext, falling back:', e);
        this.playRemoteStreamFallback(peerId, stream);
        return;
      }
    }

    // Отключаем старые узлы если есть
    if (peer.sourceNode) {
      try { peer.sourceNode.disconnect(); } catch(e) {}
    }
    if (peer.gainNode) {
      try { peer.gainNode.disconnect(); } catch(e) {}
    }
    // Удаляем fallback audio element если был
    if (peer.audioElement) {
      peer.audioElement.srcObject = null;
      peer.audioElement.remove();
      peer.audioElement = null;
    }

    try {
      // Создаём source из удалённого потока
      const sourceNode = audioContext.createMediaStreamSource(stream);

      // Создаём gain для управления громкостью удалённого участника
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 1.0;

      // Подключаем напрямую к выходу AudioContext
      // Это гарантирует воспроизведение через ту же Bluetooth колонку
      sourceNode.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Сохраняем узлы для управления
      peer.sourceNode = sourceNode;
      peer.gainNode = gainNode;

      console.log(`✅ Remote stream from ${peerId} now playing through Web Audio API (same output as local mic)`);
    } catch (error) {
      console.error('Error setting up Web Audio for remote stream, falling back:', error);
      this.playRemoteStreamFallback(peerId, stream);
    }
  }

  /**
   * Fallback: воспроизведение через audio element (для iOS совместимости)
   */
  playRemoteStreamFallback(peerId, stream) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    // Удаляем старый audio элемент если есть
    if (peer.audioElement) {
      peer.audioElement.srcObject = null;
      peer.audioElement.remove();
    }

    // Создаём новый audio элемент
    const audio = document.createElement('audio');
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.playsInline = true;
    audio.volume = 1.0;

    // Атрибуты для iOS совместимости
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');

    // Скрытый элемент в DOM
    audio.style.display = 'none';
    document.body.appendChild(audio);

    peer.audioElement = audio;

    // Пытаемся воспроизвести с повторными попытками для iOS
    const tryPlay = async () => {
      try {
        await audio.play();
        console.log('✅ Playing remote stream (fallback) from:', peerId);
      } catch (error) {
        console.error('Error playing remote stream:', error);
        // Повторная попытка через 500ms (важно для iOS)
        setTimeout(async () => {
          try {
            await audio.play();
            console.log('✅ Playing remote stream (retry) from:', peerId);
          } catch (retryError) {
            console.error('Failed to play after retry:', retryError);
          }
        }, 500);
      }
    };

    tryPlay();
  }

  /**
   * Установить громкость удалённого участника
   */
  setRemoteVolume(peerId, volume) {
    const peer = this.peers.get(peerId);
    if (peer) {
      if (peer.gainNode) {
        peer.gainNode.gain.value = volume;
      }
      if (peer.audioElement) {
        peer.audioElement.volume = volume;
      }
      console.log(`Remote volume for ${peerId} set to:`, volume);
    }
  }

  /**
   * Удалить peer
   */
  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    // Отключаем Web Audio узлы
    if (peer.sourceNode) {
      try { peer.sourceNode.disconnect(); } catch(e) {}
    }
    if (peer.gainNode) {
      try { peer.gainNode.disconnect(); } catch(e) {}
    }

    // Удаляем audio element (fallback)
    if (peer.audioElement) {
      peer.audioElement.srcObject = null;
      peer.audioElement.remove();
    }

    // Закрываем соединение
    if (peer.connection) {
      peer.connection.close();
    }

    this.peers.delete(peerId);
    console.log('Peer removed:', peerId);
  }

  /**
   * Обновить локальный поток (после смены эффекта)
   */
  async updateLocalStream() {
    this.localStream = this.audioManager.getOutputStream();

    if (!this.localStream) return;

    // Обновляем треки во всех соединениях
    this.peers.forEach((peer, peerId) => {
      const senders = peer.connection.getSenders();

      this.localStream.getTracks().forEach(track => {
        const sender = senders.find(s => s.track && s.track.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track);
        }
      });
    });

    console.log('Local stream updated for all peers');
  }

  /**
   * Отправить статус микрофона
   */
  sendMicStatus(enabled) {
    this.socket.emit('mic-status', { enabled });
  }

  /**
   * Получить количество участников
   */
  getParticipantCount() {
    return this.peers.size + 1; // +1 for self
  }

  /**
   * Освободить ресурсы
   */
  destroy() {
    this.leaveRoom();
    console.log('WebRTCManager destroyed');
  }
}

// Экспортируем глобально
window.WebRTCManager = WebRTCManager;
