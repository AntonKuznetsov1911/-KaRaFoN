/**
 * KaRaFoN WebRTC Manager
 * Управление peer-to-peer соединениями для совместного пения
 */

class WebRTCManager {
  constructor(socket, audioManager) {
    this.socket = socket;
    this.audioManager = audioManager;
    this.peers = new Map(); // peerId -> { connection, stream, audioElement }
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

    // Проверяем и включаем все треки
    const tracks = this.localStream.getAudioTracks();
    console.log('Local stream tracks:', tracks.length);

    tracks.forEach(track => {
      console.log('Track:', track.label, 'enabled:', track.enabled, 'muted:', track.muted, 'readyState:', track.readyState);
      // Убеждаемся что трек включен
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

    // Получение удалённого потока
    connection.ontrack = (event) => {
      console.log(`Received track from ${peerId}`);

      const peer = this.peers.get(peerId);
      if (peer) {
        peer.stream = event.streams[0];
        this.playRemoteStream(peerId, event.streams[0]);
      }
    };

    // Сохраняем соединение
    this.peers.set(peerId, {
      connection,
      stream: null,
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
   * Воспроизвести удалённый поток
   */
  playRemoteStream(peerId, stream) {
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
    audio.playsInline = true; // Важно для iOS
    audio.volume = 1.0; // Максимальная громкость

    // Дополнительные атрибуты для совместимости с iOS
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');

    // Добавляем в DOM (скрытый)
    audio.style.display = 'none';
    document.body.appendChild(audio);

    peer.audioElement = audio;

    // Проверяем треки
    const tracks = stream.getAudioTracks();
    console.log('Remote stream tracks:', tracks.length);
    tracks.forEach(track => {
      console.log('Remote track:', track.label, 'enabled:', track.enabled, 'muted:', track.muted, 'readyState:', track.readyState);
    });

    // Пытаемся воспроизвести с повторными попытками для iOS
    const tryPlay = async () => {
      try {
        await audio.play();
        console.log('✅ Playing remote stream from:', peerId);
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
   * Удалить peer
   */
  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    // Закрываем соединение
    if (peer.connection) {
      peer.connection.close();
    }

    // Удаляем audio элемент
    if (peer.audioElement) {
      peer.audioElement.srcObject = null;
      peer.audioElement.remove();
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
