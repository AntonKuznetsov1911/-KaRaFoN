/**
 * KaRaFoN WebRTC Manager (PeerJS)
 * P2P аудио через PeerJS — бэкенд не требуется.
 *
 * Топология:
 *   Создатель комнаты (Creator) регистрируется в PeerJS под ID = кодом комнаты.
 *   Все участники подключают data-канал к Creator; Creator ведёт список.
 *   Аудио: Joiner инициирует звонки ко всем участникам (mesh).
 */

class WebRTCManager {
  constructor(socket, audioManager) {
    // socket-параметр оставлен для совместимости API, не используется
    this.audioManager = audioManager;
    this.peers = new Map(); // peerId -> { call, dataConn, gainNode, sourceNode, audioElement, name }
    this.localStream = null;
    this.roomId = null;
    this.myPeerId = null;
    this.myName = null;
    this.isCreator = false;
    this._participants = [];
    this._creatorConn = null;

    this.onParticipantJoined = null;
    this.onParticipantLeft = null;
    this.onParticipantMicStatus = null;
  }

  /**
   * Создать или присоединиться к комнате
   */
  async joinRoom(roomId, userName, isCreator = false) {
    this.roomId = roomId;
    this.myName = userName;
    this.isCreator = isCreator;
    this.localStream = this.audioManager.getOutputStream();

    if (!this.localStream) {
      console.error('No local stream');
      return false;
    }

    // Состояние треков управляется из app.js через setMicEnabled() — не переопределяем здесь.

    return new Promise((resolve, reject) => {
      const peerId = isCreator ? roomId : undefined;

      this.peer = new Peer(peerId, {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        debug: 0,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        }
      });

      const timeoutId = setTimeout(() => reject(new Error('PeerJS connection timeout')), 12000);

      this.peer.on('open', (id) => {
        clearTimeout(timeoutId);
        this.myPeerId = id;
        this._participants = [{ id, name: userName }];
        console.log('PeerJS open, id:', id, 'isCreator:', isCreator);

        if (!isCreator) {
          this._connectToCreator(roomId);
        }

        resolve(true);
      });

      this.peer.on('error', (err) => {
        clearTimeout(timeoutId);
        console.error('PeerJS error:', err.type, err.message);
        if (err.type === 'peer-unavailable') {
          // Код комнаты не существует в PeerJS — конкретное сообщение для UX
          reject(new Error('Комната не найдена. Проверь код комнаты.'));
        } else {
          reject(err);
        }
      });

      // Входящие data-соединения (только у creator)
      this.peer.on('connection', (conn) => {
        this._handleIncomingConn(conn);
      });

      // Входящие аудио-звонки (у всех)
      this.peer.on('call', (call) => {
        console.log('Incoming call from:', call.peer);
        call.answer(this.localStream);
        call.on('stream', (remoteStream) => {
          this._playRemoteStream(call.peer, remoteStream);
        });
        call.on('error', (err) => console.error('Call error:', err));

        const pd = this.peers.get(call.peer) || {};
        pd.call = call;
        this.peers.set(call.peer, pd);
      });
    });
  }

  /**
   * Joiner подключается к data-каналу creator
   */
  _connectToCreator(creatorId) {
    console.log('Connecting data to creator:', creatorId);
    const conn = this.peer.connect(creatorId, {
      metadata: { name: this.myName },
      reliable: true
    });

    conn.on('open', () => {
      this._creatorConn = conn;
      console.log('Data channel to creator open');
    });

    conn.on('data', (data) => {
      this._handleCreatorMessage(data);
    });

    conn.on('close', () => {
      console.log('Creator data channel closed');
      this._creatorConn = null;
    });

    conn.on('error', (err) => console.error('Creator conn error:', err));
  }

  /**
   * Creator обрабатывает входящий data от нового участника
   */
  _handleIncomingConn(conn) {
    const peerId = conn.peer;
    const peerName = conn.metadata?.name || 'Guest';

    conn.on('open', () => {
      console.log('New participant connected:', peerId, peerName);

      const pd = this.peers.get(peerId) || {};
      pd.dataConn = conn;
      pd.name = peerName;
      this.peers.set(peerId, pd);

      // Отправляем новому участнику текущий список (без него самого)
      const currentList = this._getParticipantList();
      conn.send({ type: 'peer-list', participants: currentList });

      // Обновляем список с новым участником
      const updatedList = [...currentList, { id: peerId, name: peerName }];
      this._participants = updatedList;

      // Оповещаем всех остальных о новом участнике
      this.peers.forEach((peer, id) => {
        if (id !== peerId && peer.dataConn?.open) {
          peer.dataConn.send({
            type: 'peer-joined',
            peer: { id: peerId, name: peerName },
            participants: updatedList
          });
        }
      });

      if (this.onParticipantJoined) {
        this.onParticipantJoined({ name: peerName, participants: updatedList });
      }
    });

    conn.on('data', (data) => {
      if (data.type === 'mic-status') {
        // Ретранслируем всем остальным
        this.peers.forEach((peer, id) => {
          if (id !== peerId && peer.dataConn?.open) {
            peer.dataConn.send({ type: 'mic-status', id: peerId, enabled: data.enabled });
          }
        });
        if (this.onParticipantMicStatus) {
          this.onParticipantMicStatus({ id: peerId, enabled: data.enabled });
        }
      }
    });

    conn.on('close', () => {
      this._handlePeerLeft(peerId);
    });

    conn.on('error', (err) => console.error('Conn error from', peerId, err));
  }

  /**
   * Joiner обрабатывает сообщения от creator
   */
  _handleCreatorMessage(data) {
    if (data.type === 'peer-list') {
      console.log('Received peer list:', data.participants.length, 'participants');
      this._participants = [...data.participants, { id: this.myPeerId, name: this.myName }];

      // Звоним всем существующим участникам
      data.participants.forEach(p => {
        const pd = this.peers.get(p.id) || {};
        pd.name = pd.name || p.name;
        this.peers.set(p.id, pd);
        this._callPeer(p.id);
      });

    } else if (data.type === 'peer-joined') {
      console.log('Peer joined:', data.peer);
      this._participants = data.participants;

      if (data.peer.id !== this.myPeerId) {
        // Только сохраняем запись — новый участник сам инициирует звонок к нам
        const pd = this.peers.get(data.peer.id) || {};
        pd.name = pd.name || data.peer.name;
        this.peers.set(data.peer.id, pd);
      }

      if (this.onParticipantJoined) {
        this.onParticipantJoined({ name: data.peer.name, participants: data.participants });
      }

    } else if (data.type === 'peer-left') {
      this._participants = data.participants;
      this._cleanupPeer(data.peer.id);

      if (this.onParticipantLeft) {
        this.onParticipantLeft({
          id: data.peer.id,
          name: data.peer.name,
          participants: data.participants
        });
      }

    } else if (data.type === 'mic-status') {
      if (this.onParticipantMicStatus) {
        this.onParticipantMicStatus({ id: data.id, enabled: data.enabled });
      }
    }
  }

  /**
   * Инициировать аудио-звонок к участнику
   */
  _callPeer(peerId) {
    if (!this.peer || !this.localStream) return;
    console.log('Calling peer:', peerId);

    setTimeout(() => {
      const call = this.peer.call(peerId, this.localStream);
      if (!call) {
        console.warn('Could not create call to:', peerId);
        return;
      }
      call.on('stream', (remoteStream) => {
        this._playRemoteStream(peerId, remoteStream);
      });
      call.on('error', (err) => console.error('Outgoing call error to', peerId, err));

      const pd = this.peers.get(peerId) || {};
      pd.call = call;
      this.peers.set(peerId, pd);
    }, 400);
  }

  /**
   * Воспроизвести удалённый поток через Web Audio API
   */
  _playRemoteStream(peerId, stream) {
    console.log('Playing remote stream from:', peerId);
    const pd = this.peers.get(peerId) || {};

    if (pd.sourceNode) { try { pd.sourceNode.disconnect(); } catch(e) {} }
    if (pd.gainNode) { try { pd.gainNode.disconnect(); } catch(e) {} }
    if (pd.audioElement) {
      pd.audioElement.srcObject = null;
      try { pd.audioElement.remove(); } catch(e) {}
      pd.audioElement = null;
    }

    const audioCtx = this.audioManager?.audioContext;

    if (audioCtx && audioCtx.state !== 'closed') {
      try {
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(console.error);

        const sourceNode = audioCtx.createMediaStreamSource(stream);
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 1.0;
        sourceNode.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        pd.sourceNode = sourceNode;
        pd.gainNode = gainNode;
        this.peers.set(peerId, pd);
        console.log('Remote via Web Audio API:', peerId);
        return;
      } catch(err) {
        console.error('Web Audio failed, using fallback:', err);
      }
    }

    const audio = document.createElement('audio');
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.playsInline = true;
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    audio.style.display = 'none';
    document.body.appendChild(audio);
    audio.play().catch(err => {
      console.error('Fallback audio play failed:', err);
      setTimeout(() => audio.play().catch(console.error), 500);
    });
    pd.audioElement = audio;
    this.peers.set(peerId, pd);
    console.log('Remote via fallback audio element:', peerId);
  }

  /**
   * Участник ушёл
   */
  _handlePeerLeft(peerId) {
    const pd = this.peers.get(peerId);
    if (!pd) return;

    const name = pd.name || 'Unknown';
    this._cleanupPeer(peerId);

    if (this.isCreator) {
      const participants = this._getParticipantList();
      this._participants = participants;
      this.peers.forEach((peer) => {
        if (peer.dataConn?.open) {
          peer.dataConn.send({ type: 'peer-left', peer: { id: peerId, name }, participants });
        }
      });
    }

    if (this.onParticipantLeft) {
      this.onParticipantLeft({ id: peerId, name, participants: this._getParticipantList() });
    }
  }

  /**
   * Освободить ресурсы конкретного peer
   */
  _cleanupPeer(peerId) {
    const pd = this.peers.get(peerId);
    if (!pd) return;

    if (pd.sourceNode) { try { pd.sourceNode.disconnect(); } catch(e) {} }
    if (pd.gainNode) { try { pd.gainNode.disconnect(); } catch(e) {} }
    if (pd.audioElement) {
      pd.audioElement.srcObject = null;
      try { pd.audioElement.remove(); } catch(e) {}
    }
    if (pd.call) { try { pd.call.close(); } catch(e) {} }
    if (pd.dataConn) { try { pd.dataConn.close(); } catch(e) {} }

    this.peers.delete(peerId);
    this._participants = this._participants.filter(p => p.id !== peerId);
    console.log('Peer cleaned up:', peerId);
  }

  /**
   * Текущий список участников (включая себя)
   */
  _getParticipantList() {
    const list = [{ id: this.myPeerId, name: this.myName }];
    this.peers.forEach((pd, id) => {
      if (pd.name) list.push({ id, name: pd.name });
    });
    return list;
  }

  /**
   * Покинуть комнату
   */
  leaveRoom() {
    Array.from(this.peers.keys()).forEach(id => this._cleanupPeer(id));

    if (this._creatorConn) {
      try { this._creatorConn.close(); } catch(e) {}
      this._creatorConn = null;
    }

    if (this.peer) {
      try { this.peer.destroy(); } catch(e) {}
      this.peer = null;
    }

    this.roomId = null;
    this._participants = [];
    console.log('Left room');
  }

  /**
   * Отправить статус микрофона
   */
  sendMicStatus(enabled) {
    if (this.isCreator) {
      this.peers.forEach((pd) => {
        if (pd.dataConn?.open) {
          pd.dataConn.send({ type: 'mic-status', id: this.myPeerId, enabled });
        }
      });
    } else if (this._creatorConn?.open) {
      this._creatorConn.send({ type: 'mic-status', enabled });
    }
  }

  /**
   * Обновить локальный поток (после смены эффекта)
   */
  async updateLocalStream() {
    this.localStream = this.audioManager.getOutputStream();
    if (!this.localStream) return;

    this.peers.forEach((pd) => {
      const pc = pd.call?.peerConnection;
      if (!pc) return;
      const senders = pc.getSenders();
      this.localStream.getTracks().forEach(track => {
        const sender = senders.find(s => s.track?.kind === track.kind);
        if (sender) sender.replaceTrack(track).catch(console.error);
      });
    });
  }

  getParticipantCount() {
    return this.peers.size + 1;
  }

  destroy() {
    this.leaveRoom();
  }
}

window.WebRTCManager = WebRTCManager;
